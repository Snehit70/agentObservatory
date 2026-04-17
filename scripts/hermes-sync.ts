import 'dotenv/config';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '../src/lib/db/schema';
import { normalizeModelId } from '../src/lib/server/model-pricing';
import { createWorkerClient } from '../src/lib/server/postgres-client';

const DEFAULT_SYNC_INTERVAL_MS = 5000;

const client = createWorkerClient(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });
const hermesDb = new Database('/home/snehit/.hermes/state.db', { readonly: true });

const { requests, dailySummary, sessions, turns, assistantTextParts, toolCalls, fileEdits } = schema;

type HermesSessionRow = {
	id: string;
	source: string | null;
	model: string | null;
	billing_provider: string | null;
	started_at: number | null;
	ended_at: number | null;
	message_count: number | null;
	tool_call_count: number | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens: number | null;
	cache_write_tokens: number | null;
	reasoning_tokens: number | null;
	title: string | null;
};

type HermesMessageRow = {
	id: number;
	role: string;
	content: string | null;
	tool_call_id: string | null;
	tool_calls: string | null;
	finish_reason: string | null;
	timestamp: number;
};

type CompletedTurn = {
	userMessageId: string;
	assistantMessageId: string;
	requestMessageId: string;
	prompt: string;
	assistantText: string;
	createdAt: Date;
	completedAt: Date;
	finishReason: string | null;
	partId: string;
	tools: HermesToolCall[];
};

type HermesToolCall = {
	callId: string;
	tool: string;
	title: string | null;
	args: unknown;
	output: string | null;
	startedAt: Date;
	completedAt: Date | null;
	success: boolean | null;
	fileEdits: HermesFileEdit[];
};

type HermesFileEdit = {
	filePath: string;
	operation: 'read' | 'write' | 'edit';
	createdAt: Date;
};

type HermesAssistantToolCallEntry = {
	id?: string;
	call_id?: string;
	type?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
};

type PendingUserState = {
	id: string;
	prompt: string;
	createdAt: Date;
};

type HermesTurnBuilderState = {
	pendingUser: PendingUserState | null;
	pendingToolCalls: HermesToolCall[];
	syntheticIndex: number;
};

type SessionSyncState = HermesTurnBuilderState & {
	signature: string;
	lastMessageId: number;
};

type SyncSessionResult = {
	insertedRequests: number;
	messageCount: number;
	nextState: SessionSyncState;
};

type SyncCycleStats = {
	durationMs: number;
	totalSessions: number;
	changedSessions: number;
	skippedSessions: number;
	scannedMessages: number;
	insertedRequests: number;
};

const sessionsToSyncQuery = hermesDb.query(
	`SELECT id, source, model, billing_provider, started_at, ended_at,
	        message_count, tool_call_count, input_tokens, output_tokens,
	        cache_read_tokens, cache_write_tokens, reasoning_tokens, title
	 FROM sessions
	 WHERE message_count > 0 OR input_tokens > 0 OR output_tokens > 0
	 ORDER BY started_at ASC`
);

const messagesBySessionQuery = hermesDb.query(
	`SELECT id, role, content, tool_call_id, tool_calls, finish_reason, timestamp
	 FROM messages
	 WHERE session_id = ?
	 ORDER BY id ASC`
);

const messagesBySessionSinceIdQuery = hermesDb.query(
	`SELECT id, role, content, tool_call_id, tool_calls, finish_reason, timestamp
	 FROM messages
	 WHERE session_id = ?
	   AND id > ?
	 ORDER BY id ASC`
);

const sessionStates = new Map<string, SessionSyncState>();

function createTurnBuilderState(): HermesTurnBuilderState {
	return {
		pendingUser: null,
		pendingToolCalls: [],
		syntheticIndex: 0
	};
}

function createSessionSyncState(signature: string): SessionSyncState {
	return {
		signature,
		lastMessageId: 0,
		...createTurnBuilderState()
	};
}

function toDate(seconds: number | null | undefined): Date {
	return new Date((seconds ?? 0) * 1000);
}

function toInt(value: number | null | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.round(value));
}

function parseIntervalMs(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? '', 10);
	if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_SYNC_INTERVAL_MS;
	return parsed;
}

function getSessionSignature(session: HermesSessionRow): string {
	return [
		toInt(session.message_count),
		toInt(session.tool_call_count),
		toInt(session.input_tokens),
		toInt(session.output_tokens),
		toInt(session.cache_read_tokens),
		toInt(session.cache_write_tokens),
		toInt(session.reasoning_tokens),
		toInt(session.started_at),
		toInt(session.ended_at)
	].join(':');
}

function normalizeProviderId(session: HermesSessionRow): string {
	if (session.billing_provider) return session.billing_provider;
	const model = session.model?.toLowerCase() ?? '';
	if (model.startsWith('gpt') || model.includes('codex')) return 'openai';
	if (model.startsWith('claude')) return 'anthropic';
	if (model.startsWith('gemini')) return 'google';
	return 'hermes';
}

function splitEvenly(total: number, parts: number): number[] {
	if (parts <= 0) return [];
	if (total <= 0) return new Array(parts).fill(0);
	const base = Math.floor(total / parts);
	const remainder = total % parts;
	return new Array(parts).fill(base).map((value, index) => value + (index < remainder ? 1 : 0));
}

function truncateForNotify(value: string, maxLength: number = 4000): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 1)}...`;
}

function safeJsonParse<T>(value: string | null | undefined): T | null {
	if (!value) return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function toolCallIdForDb(sessionId: string, rawCallId: string): string {
	return `hermes-${sessionId}-${rawCallId}`;
}

function extensionForPath(filePath: string | null | undefined): string | null {
	if (!filePath) return null;
	const filename = filePath.split('/').pop() || filePath;
	const dot = filename.lastIndexOf('.');
	if (dot <= 0 || dot === filename.length - 1) return null;
	return filename.slice(dot + 1).toLowerCase();
}

function normalizeFileOperation(value: string | null | undefined): 'read' | 'write' | 'edit' | null {
	if (!value) return null;
	const v = value.toLowerCase();
	if (v.includes('read') || v.includes('search') || v.includes('glob') || v.includes('list')) {
		return 'read';
	}
	if (v.includes('write') || v.includes('create')) return 'write';
	if (v.includes('edit') || v.includes('patch') || v.includes('apply')) return 'edit';
	return null;
}

function inferFileEdits(tool: string, args: unknown, timestamp: Date): HermesFileEdit[] {
	if (!args || typeof args !== 'object') return [];
	const operation = normalizeFileOperation(tool);
	if (!operation) return [];

	const obj = args as Record<string, unknown>;
	const candidateKeys = ['path', 'filePath', 'file', 'target', 'filepath'];
	const edits: HermesFileEdit[] = [];

	for (const key of candidateKeys) {
		const value = obj[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			edits.push({ filePath: value.trim(), operation, createdAt: timestamp });
		}
	}

	if (Array.isArray(obj.paths)) {
		for (const item of obj.paths) {
			if (typeof item === 'string' && item.trim().length > 0) {
				edits.push({ filePath: item.trim(), operation, createdAt: timestamp });
			}
		}
	}

	return edits;
}

function parseAssistantToolCalls(
	sessionId: string,
	messageId: number,
	rawToolCalls: string | null,
	timestamp: Date
): HermesToolCall[] {
	const parsed = safeJsonParse<HermesAssistantToolCallEntry[]>(rawToolCalls);
	if (!Array.isArray(parsed)) return [];

	return parsed
		.map((entry, index) => {
			const rawCallId = entry.call_id || entry.id || `${messageId}-${index}`;
			const tool = entry.function?.name || entry.type || 'tool';
			const args = safeJsonParse<unknown>(entry.function?.arguments ?? null);
			const fileEdits = inferFileEdits(tool, args, timestamp);
			return {
				callId: toolCallIdForDb(sessionId, rawCallId),
				tool,
				title: typeof entry.function?.arguments === 'string' ? entry.function.arguments.slice(0, 240) : null,
				args,
				output: null,
				startedAt: timestamp,
				completedAt: null,
				success: null,
				fileEdits
			} as HermesToolCall;
		})
		.filter((call) => call.callId.length > 0);
}

function mergeToolOutput(call: HermesToolCall, content: string | null, timestamp: Date): HermesToolCall {
	const parsed = safeJsonParse<Record<string, unknown>>(content ?? null);
	const output = typeof parsed?.output === 'string' ? parsed.output : content;
	const success =
		typeof parsed?.success === 'boolean'
			? parsed.success
			: typeof parsed?.ok === 'boolean'
				? parsed.ok
				: null;

	return {
		...call,
		output: output?.slice(0, 20000) ?? null,
		completedAt: timestamp,
		success
	};
}

function cloneToolCall(call: HermesToolCall): HermesToolCall {
	return {
		...call,
		fileEdits: [...call.fileEdits]
	};
}

function cloneTurnBuilderState(state: HermesTurnBuilderState): HermesTurnBuilderState {
	return {
		pendingUser: state.pendingUser ? { ...state.pendingUser } : null,
		pendingToolCalls: state.pendingToolCalls.map(cloneToolCall),
		syntheticIndex: state.syntheticIndex
	};
}

function buildCompletedTurns(
	sessionId: string,
	messages: HermesMessageRow[],
	initialState: HermesTurnBuilderState = createTurnBuilderState()
): {
	completedTurns: CompletedTurn[];
	nextState: HermesTurnBuilderState;
	lastMessageId: number;
} {
	const completed: CompletedTurn[] = [];
	let lastMessageId = 0;
	let { pendingUser, pendingToolCalls, syntheticIndex } = cloneTurnBuilderState(initialState);

	for (const message of messages) {
		lastMessageId = message.id;
		const timestamp = toDate(message.timestamp);
		const content = message.content?.trim() ?? '';

		if (message.role === 'user') {
			if (!content) continue;
			pendingToolCalls = [];
			pendingUser = {
				id: `hermes-user-${sessionId}-${message.id}`,
				prompt: content,
				createdAt: timestamp
			};
			continue;
		}

		if (message.role === 'tool') {
			const rawToolCallId = message.tool_call_id;
			if (!rawToolCallId) continue;
			const callId = toolCallIdForDb(sessionId, rawToolCallId);
			const index = pendingToolCalls.findIndex((call) => call.callId === callId);
			if (index >= 0) {
				pendingToolCalls[index] = mergeToolOutput(pendingToolCalls[index], message.content, timestamp);
			}
			continue;
		}

		if (message.role !== 'assistant') continue;

		const finishReason = message.finish_reason ?? 'stop';
		if (finishReason === 'tool_calls') {
			pendingToolCalls.push(...parseAssistantToolCalls(sessionId, message.id, message.tool_calls, timestamp));
			continue;
		}
		if (!content) continue;

		const turn = pendingUser ?? {
			id: `hermes-user-${sessionId}-synthetic-${syntheticIndex}`,
			prompt: '[Hermes response without captured user prompt]',
			createdAt: timestamp
		};

		completed.push({
			userMessageId: turn.id,
			assistantMessageId: `hermes-assistant-${sessionId}-${message.id}`,
			requestMessageId: `hermes-request-${sessionId}-${message.id}`,
			prompt: turn.prompt.slice(0, 10000),
			assistantText: content,
			createdAt: turn.createdAt,
			completedAt: timestamp,
			finishReason,
			partId: `hermes-part-${message.id}`,
			tools: pendingToolCalls.map(cloneToolCall)
		});

		pendingUser = null;
		pendingToolCalls = [];
		syntheticIndex += 1;
	}

	return {
		completedTurns: completed,
		nextState: {
			pendingUser,
			pendingToolCalls,
			syntheticIndex
		},
		lastMessageId
	};
}

async function getTurnIdsByUserMessageId(sessionId: string): Promise<Map<string, number>> {
	const rows = await db.execute(sql`
		SELECT id, user_message_id
		FROM turns
		WHERE session_id = ${sessionId}
		  AND user_message_id IS NOT NULL
	`);

	const ids = new Map<string, number>();
	for (const row of rows) {
		if (typeof row.user_message_id === 'string' && row.user_message_id.length > 0) {
			ids.set(row.user_message_id, Number(row.id));
		}
	}
	return ids;
}

async function ensureToolAndFileTelemetry(sessionId: string, turnId: number, toolsForTurn: HermesToolCall[]): Promise<void> {
	for (const toolEvent of toolsForTurn) {
		const result = await db
			.insert(toolCalls)
			.values({
				sessionId,
				turnId,
				callId: toolEvent.callId,
				tool: toolEvent.tool,
				args: (toolEvent.args as Record<string, unknown> | null) ?? null,
				title: toolEvent.title,
				output: toolEvent.output,
				metadata: null,
				durationMs:
					toolEvent.completedAt && toolEvent.startedAt
						? Math.max(0, toolEvent.completedAt.getTime() - toolEvent.startedAt.getTime())
						: null,
				success: toolEvent.success,
				errorMessage: null,
				startedAt: toolEvent.startedAt,
				completedAt: toolEvent.completedAt
			})
			.onConflictDoUpdate({
				target: toolCalls.callId,
				set: {
					turnId,
					tool: toolEvent.tool,
					title: toolEvent.title,
					args: (toolEvent.args as Record<string, unknown> | null) ?? null,
					output: toolEvent.output,
					durationMs:
						toolEvent.completedAt && toolEvent.startedAt
							? Math.max(0, toolEvent.completedAt.getTime() - toolEvent.startedAt.getTime())
							: null,
					success: toolEvent.success,
					completedAt: toolEvent.completedAt
				}
			})
			.returning({ id: toolCalls.id });

		const toolCallId = result[0]?.id ?? null;

		await client.notify(
			'live_event',
			JSON.stringify({
				type: 'tool.before',
				sessionId,
				callId: toolEvent.callId,
				tool: toolEvent.tool,
				title: toolEvent.title,
				createdAt: toolEvent.startedAt.toISOString()
			})
		);

		await client.notify(
			'live_event',
			JSON.stringify({
				type: 'tool.after',
				sessionId,
				callId: toolEvent.callId,
				tool: toolEvent.tool,
				title: toolEvent.title,
				success: toolEvent.success,
				durationMs:
					toolEvent.completedAt && toolEvent.startedAt
						? Math.max(0, toolEvent.completedAt.getTime() - toolEvent.startedAt.getTime())
						: null,
				createdAt: (toolEvent.completedAt ?? toolEvent.startedAt).toISOString()
			})
		);

		if (!toolCallId) continue;

		for (const edit of toolEvent.fileEdits) {
			const existing = await db.execute(sql`
				SELECT id
				FROM file_edits
				WHERE session_id = ${sessionId}
				  AND turn_id = ${turnId}
				  AND tool_call_id = ${toolCallId}
				  AND file_path = ${edit.filePath}
				  AND operation = ${edit.operation}
				LIMIT 1
			`);
			if (existing.length > 0) continue;

			await db.insert(fileEdits).values({
				sessionId,
				turnId,
				toolCallId,
				filePath: edit.filePath,
				fileExtension: extensionForPath(edit.filePath),
				operation: edit.operation,
				linesAdded: 0,
				linesRemoved: 0,
				createdAt: edit.createdAt
			});

			await client.notify(
				'live_event',
				JSON.stringify({
					type: 'file.edit',
					sessionId,
					toolCallId: toolEvent.callId,
					filePath: edit.filePath,
					fileExtension: extensionForPath(edit.filePath),
					operation: edit.operation,
					linesAdded: 0,
					linesRemoved: 0,
					createdAt: edit.createdAt.toISOString()
				})
			);
		}
	}
}

async function getSyncedTokenTotals(sessionId: string): Promise<{
	tokensInput: number;
	tokensOutput: number;
	tokensReasoning: number;
	tokensCacheRead: number;
	tokensCacheWrite: number;
}> {
	const [row] = await db.execute(sql`
		SELECT
			COALESCE(SUM(tokens_input), 0) AS tokens_input,
			COALESCE(SUM(tokens_output), 0) AS tokens_output,
			COALESCE(SUM(tokens_reasoning), 0) AS tokens_reasoning,
			COALESCE(SUM(tokens_cache_read), 0) AS tokens_cache_read,
			COALESCE(SUM(tokens_cache_write), 0) AS tokens_cache_write
		FROM requests
		WHERE session_id = ${sessionId}
		  AND agent = 'hermes'
	`);

	return {
		tokensInput: Number(row?.tokens_input ?? 0),
		tokensOutput: Number(row?.tokens_output ?? 0),
		tokensReasoning: Number(row?.tokens_reasoning ?? 0),
		tokensCacheRead: Number(row?.tokens_cache_read ?? 0),
		tokensCacheWrite: Number(row?.tokens_cache_write ?? 0)
	};
}

async function upsertTurn(
	sessionId: string,
	providerId: string,
	modelId: string,
	turn: CompletedTurn,
	tokens: {
		tokensInput: number;
		tokensOutput: number;
		tokensReasoning: number;
		tokensCacheRead: number;
		tokensCacheWrite: number;
	}
): Promise<void> {
	await db
		.insert(turns)
		.values({
			sessionId,
			userMessageId: turn.userMessageId,
			assistantMessageId: turn.assistantMessageId,
			prompt: turn.prompt,
			assistantText: turn.assistantText,
			agent: 'hermes',
			providerId,
			modelId,
			tokensInput: tokens.tokensInput,
			tokensOutput: tokens.tokensOutput,
			tokensReasoning: tokens.tokensReasoning,
			tokensCacheRead: tokens.tokensCacheRead,
			tokensCacheWrite: tokens.tokensCacheWrite,
			costUsd: 0,
			finishReason: turn.finishReason,
			createdAt: turn.createdAt,
			completedAt: turn.completedAt
		})
		.onConflictDoNothing();

	await db
		.update(turns)
		.set({
			assistantMessageId: turn.assistantMessageId,
			assistantText: turn.assistantText,
			providerId,
			modelId,
			tokensInput: tokens.tokensInput,
			tokensOutput: tokens.tokensOutput,
			tokensReasoning: tokens.tokensReasoning,
			tokensCacheRead: tokens.tokensCacheRead,
			tokensCacheWrite: tokens.tokensCacheWrite,
			costUsd: 0,
			finishReason: turn.finishReason,
			completedAt: turn.completedAt
		})
		.where(sql`user_message_id = ${turn.userMessageId}`);

	await db
		.insert(assistantTextParts)
		.values({
			sessionId,
			messageId: turn.requestMessageId,
			partId: turn.partId,
			text: turn.assistantText,
			createdAt: turn.completedAt
		})
		.onConflictDoNothing();
}

async function insertRequest(
	session: HermesSessionRow,
	providerId: string,
	modelId: string,
	turn: CompletedTurn,
	tokens: {
		tokensInput: number;
		tokensOutput: number;
		tokensReasoning: number;
		tokensCacheRead: number;
		tokensCacheWrite: number;
	}
): Promise<void> {
	const dateStr = turn.completedAt.toISOString().split('T')[0];

	await db.insert(requests).values({
		messageId: turn.requestMessageId,
		sessionId: session.id,
		providerId,
		modelId,
		agent: 'hermes',
		tokensInput: tokens.tokensInput,
		tokensOutput: tokens.tokensOutput,
		tokensReasoning: tokens.tokensReasoning,
		tokensCacheRead: tokens.tokensCacheRead,
		tokensCacheWrite: tokens.tokensCacheWrite,
		costUsd: 0,
		durationMs: Math.max(0, turn.completedAt.getTime() - turn.createdAt.getTime()),
		finishReason: turn.finishReason,
		workingDir: null,
		createdAt: turn.completedAt,
		completedAt: turn.completedAt
	});

	await db.insert(dailySummary).values({
		date: dateStr,
		providerId,
		modelId,
		requestCount: 1,
		tokensInput: tokens.tokensInput,
		tokensOutput: tokens.tokensOutput,
		tokensReasoning: tokens.tokensReasoning,
		tokensCacheRead: tokens.tokensCacheRead,
		tokensCacheWrite: tokens.tokensCacheWrite,
		costUsd: 0
	}).onConflictDoUpdate({
		target: [dailySummary.date, dailySummary.providerId, dailySummary.modelId],
		set: {
			requestCount: sql`${dailySummary.requestCount} + 1`,
			tokensInput: sql`${dailySummary.tokensInput} + ${tokens.tokensInput}`,
			tokensOutput: sql`${dailySummary.tokensOutput} + ${tokens.tokensOutput}`,
			tokensReasoning: sql`${dailySummary.tokensReasoning} + ${tokens.tokensReasoning}`,
			tokensCacheRead: sql`${dailySummary.tokensCacheRead} + ${tokens.tokensCacheRead}`,
			tokensCacheWrite: sql`${dailySummary.tokensCacheWrite} + ${tokens.tokensCacheWrite}`
		}
	});

	const title = session.title?.trim() || turn.prompt.slice(0, 100).trim() || null;

	await db.insert(sessions).values({
		sessionId: session.id,
		projectDir: null,
		title,
		firstRequestAt: turn.completedAt,
		lastRequestAt: turn.completedAt,
		totalRequests: 1,
		totalCostUsd: 0,
		totalTokensInput: tokens.tokensInput,
		totalTokensOutput: tokens.tokensOutput
	}).onConflictDoUpdate({
		target: [sessions.sessionId],
		set: {
			title: title ?? sql`${sessions.title}`,
			lastRequestAt: turn.completedAt,
			totalRequests: sql`${sessions.totalRequests} + 1`,
			totalTokensInput: sql`${sessions.totalTokensInput} + ${tokens.tokensInput}`,
			totalTokensOutput: sql`${sessions.totalTokensOutput} + ${tokens.tokensOutput}`
		}
	});

	await client.notify('live_event', JSON.stringify({
		type: 'prompt',
		sessionId: session.id,
		messageId: turn.userMessageId,
		prompt: truncateForNotify(turn.prompt),
		agent: 'hermes',
		providerId,
		modelId,
		createdAt: turn.createdAt.toISOString()
	}));

	await client.notify('live_event', JSON.stringify({
		type: 'request',
		messageId: turn.requestMessageId,
		sessionId: session.id,
		providerId,
		modelId,
		agent: 'hermes',
		tokens: {
			input: tokens.tokensInput,
			output: tokens.tokensOutput,
			reasoning: tokens.tokensReasoning,
			cache: { read: tokens.tokensCacheRead, write: tokens.tokensCacheWrite }
		},
		cost: 0,
		durationMs: Math.max(0, turn.completedAt.getTime() - turn.createdAt.getTime()),
		finishReason: turn.finishReason,
		workingDir: null,
		createdAt: turn.completedAt.toISOString(),
		completedAt: turn.completedAt.toISOString()
	}));

	await client.notify('live_event', JSON.stringify({
		type: 'assistant.text',
		sessionId: session.id,
		messageId: turn.requestMessageId,
		partId: turn.partId,
		text: truncateForNotify(turn.assistantText),
		createdAt: turn.completedAt.toISOString()
	}));
}

async function syncSession(session: HermesSessionRow): Promise<SyncSessionResult> {
	const providerId = normalizeProviderId(session);
	const modelId = normalizeModelId(session.model ?? 'unknown');
	const signature = getSessionSignature(session);
	const previousState = sessionStates.get(session.id) ?? createSessionSyncState(signature);
	const messages =
		previousState.lastMessageId > 0
			? (messagesBySessionSinceIdQuery.all(session.id, previousState.lastMessageId) as HermesMessageRow[])
			: (messagesBySessionQuery.all(session.id) as HermesMessageRow[]);
	const { completedTurns, nextState: turnBuilderState, lastMessageId } = buildCompletedTurns(
		session.id,
		messages,
		previousState
	);
	const nextState: SessionSyncState = {
		signature,
		lastMessageId: lastMessageId > 0 ? lastMessageId : previousState.lastMessageId,
		...turnBuilderState
	};

	if (completedTurns.length === 0) {
		return { insertedRequests: 0, messageCount: messages.length, nextState };
	}

	const syncedOrInsertedRequestIds = new Set(
		(
			await db.execute(sql`
				SELECT message_id
				FROM requests
				WHERE session_id = ${session.id}
				  AND agent = 'hermes'
			`)
		).map((row) => String(row.message_id))
	);

	const unsyncedTurns = completedTurns.filter((turn) => !syncedOrInsertedRequestIds.has(turn.requestMessageId));

	const tokenByRequestId = new Map<
		string,
		{
			tokensInput: number;
			tokensOutput: number;
			tokensReasoning: number;
			tokensCacheRead: number;
			tokensCacheWrite: number;
		}
	>();

	if (unsyncedTurns.length > 0) {
		const syncedTotals = await getSyncedTokenTotals(session.id);
		const sessionTotals = {
			tokensInput: toInt(session.input_tokens) - toInt(session.cache_read_tokens),
			tokensOutput: toInt(session.output_tokens),
			tokensReasoning: toInt(session.reasoning_tokens),
			tokensCacheRead: toInt(session.cache_read_tokens),
			tokensCacheWrite: toInt(session.cache_write_tokens)
		};

		const deltas = {
			tokensInput: Math.max(0, sessionTotals.tokensInput - syncedTotals.tokensInput),
			tokensOutput: Math.max(0, sessionTotals.tokensOutput - syncedTotals.tokensOutput),
			tokensReasoning: Math.max(0, sessionTotals.tokensReasoning - syncedTotals.tokensReasoning),
			tokensCacheRead: Math.max(0, sessionTotals.tokensCacheRead - syncedTotals.tokensCacheRead),
			tokensCacheWrite: Math.max(0, sessionTotals.tokensCacheWrite - syncedTotals.tokensCacheWrite)
		};

		const allocations = {
			input: splitEvenly(deltas.tokensInput, unsyncedTurns.length),
			output: splitEvenly(deltas.tokensOutput, unsyncedTurns.length),
			reasoning: splitEvenly(deltas.tokensReasoning, unsyncedTurns.length),
			cacheRead: splitEvenly(deltas.tokensCacheRead, unsyncedTurns.length),
			cacheWrite: splitEvenly(deltas.tokensCacheWrite, unsyncedTurns.length)
		};

		for (const [index, turn] of unsyncedTurns.entries()) {
			tokenByRequestId.set(turn.requestMessageId, {
				tokensInput: allocations.input[index] ?? 0,
				tokensOutput: allocations.output[index] ?? 0,
				tokensReasoning: allocations.reasoning[index] ?? 0,
				tokensCacheRead: allocations.cacheRead[index] ?? 0,
				tokensCacheWrite: allocations.cacheWrite[index] ?? 0
			});
		}
	}

	let insertedRequests = 0;
	for (const turn of unsyncedTurns) {
		const tokens = tokenByRequestId.get(turn.requestMessageId) ?? {
			tokensInput: 0,
			tokensOutput: 0,
			tokensReasoning: 0,
			tokensCacheRead: 0,
			tokensCacheWrite: 0
		};

		await upsertTurn(session.id, providerId, modelId, turn, tokens);
		await insertRequest(session, providerId, modelId, turn, tokens);
		syncedOrInsertedRequestIds.add(turn.requestMessageId);
		insertedRequests += 1;
	}

	const turnIdsByUserMessageId = await getTurnIdsByUserMessageId(session.id);
	for (const turn of completedTurns) {
		if (!syncedOrInsertedRequestIds.has(turn.requestMessageId)) continue;
		const turnId = turnIdsByUserMessageId.get(turn.userMessageId);
		if (!turnId) continue;
		await ensureToolAndFileTelemetry(session.id, turnId, turn.tools);
	}

	return { insertedRequests, messageCount: messages.length, nextState };
}

async function syncAllSessions(): Promise<SyncCycleStats> {
	const startedAt = Date.now();
	const sessionsToSync = sessionsToSyncQuery.all() as HermesSessionRow[];

	let changedSessions = 0;
	let skippedSessions = 0;
	let scannedMessages = 0;
	let insertedRequests = 0;

	for (const session of sessionsToSync) {
		const signature = getSessionSignature(session);
		const previousState = sessionStates.get(session.id);
		if (previousState?.signature === signature) {
			skippedSessions += 1;
			continue;
		}

		const result = await syncSession(session);
		sessionStates.set(session.id, result.nextState);
		changedSessions += 1;
		scannedMessages += result.messageCount;
		insertedRequests += result.insertedRequests;
	}

	return {
		durationMs: Date.now() - startedAt,
		totalSessions: sessionsToSync.length,
		changedSessions,
		skippedSessions,
		scannedMessages,
		insertedRequests
	};
}

async function main(): Promise<void> {
	const intervalMs = parseIntervalMs(process.env.HERMES_SYNC_INTERVAL_MS);
	const runOnce = process.env.HERMES_SYNC_RUN_ONCE === '1';
	const logEveryCycle = process.env.HERMES_SYNC_LOG_CYCLES === '1' || runOnce;
	let syncInFlight = false;

	const runCycle = async (label: string): Promise<SyncCycleStats> => {
		const stats = await syncAllSessions();
		if (logEveryCycle || stats.insertedRequests > 0 || stats.changedSessions > 0) {
			console.log(
				`[Hermes] ${label}: ${stats.durationMs}ms total=${stats.totalSessions} changed=${stats.changedSessions} skipped=${stats.skippedSessions} messages=${stats.scannedMessages} inserted=${stats.insertedRequests}`
			);
		}
		return stats;
	};

	console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Hermes Sync Daemon for Dashboard             ║
╠═══════════════════════════════════════════════════════════╣
║  Source DB: ~/.hermes/state.db                            ║
║  Agent ID: hermes                                         ║
║  Mode: session-token delta allocation                     ║
╚═══════════════════════════════════════════════════════════╝
`);

	await runCycle('Initial sync');
	if (runOnce) return;

	setInterval(async () => {
		if (syncInFlight) {
			console.warn('[Hermes] Previous sync still running, skipping tick');
			return;
		}

		syncInFlight = true;
		try {
			await runCycle('Periodic sync');
		} catch (error) {
			console.error('[Hermes] Sync failed', error);
		} finally {
			syncInFlight = false;
		}
	}, intervalMs);
}

main().catch(console.error);
