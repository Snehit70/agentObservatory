/**
 * Codex Sync Daemon
 * 
 * Watches ~/.codex/sessions/ for new JSONL session files and syncs
 * telemetry data to the opencode-dashboard database.
 * 
 * Codex stores session data in:
 *   ~/.codex/sessions/{year}/{month}/{day}/rollout-{timestamp}-{session-id}.jsonl
 * 
 * Each line is a JSON event with types:
 *   - session_meta: Session metadata (model, provider, cwd)
 *   - token_count: Token usage per turn
 *   - user_message: User prompts
 *   - agent_message: Assistant responses
 *   - task_started/task_complete: Turn boundaries
 * 
 * Usage:
 *   bun run scripts/codex-sync.ts
 */

import { watch } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/db/schema';
import { sql } from "drizzle-orm";
import { createWorkerClient } from '../src/lib/server/postgres-client';

const client = createWorkerClient(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });
const { requests, dailySummary, sessions, turns, toolCalls, fileEdits, assistantTextParts } = schema;

const CODEX_DIR = join(homedir(), ".codex");
const SESSIONS_DIR = join(CODEX_DIR, "sessions");

// Track processed lines per file to support incremental sync
const fileProgress = new Map<string, number>();

// Session metadata cache (extracted from session_meta events)
const sessionMeta = new Map<string, {
    modelProvider: string;
    model: string;
    cwd: string;
    cliVersion: string;
}>();

// Turn tracking for associating token_count with turns
const turnState = new Map<string, {
    turnId: string;
    startedAt: Date;
    messageCount: number;
}>();

// Session-level cumulative token totals for deriving stable per-event deltas
const tokenTotalsState = new Map<string, {
    input: number;
    cacheRead: number;
    output: number;
    reasoning: number;
}>();

interface CodexEvent {
    timestamp: string;
    type: string;
    payload: any;
}

interface ParsedCommand {
    type?: string;
    cmd?: string;
    path?: string | null;
    name?: string;
}

interface TokenUsage {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
    total_tokens: number;
}

function extractSessionId(filename: string): string | null {
    // Format: rollout-{timestamp}-{uuid}.jsonl
    const match = filename.match(/rollout-[\dT-]+-([0-9a-f-]+)\.jsonl$/);
    return match ? match[1] : null;
}

function normalizeCodexModel(model: string): string {
    // Codex model strings are already fairly normalized
    // e.g., "gpt-5.4", "gpt-5.3-codex"
    return model.toLowerCase();
}

function getTurnMessageId(sessionId: string, timestamp: Date, prefix: string): string {
    const turn = turnState.get(sessionId);
    return turn?.turnId || `${prefix}-${sessionId}-${timestamp.getTime()}`;
}

function inferToolName(payload: any): string {
    const firstParsed = payload?.parsed_cmd?.[0];
    if (typeof firstParsed?.type === 'string' && firstParsed.type.length > 0) {
        return firstParsed.type;
    }
    return payload?.type === 'write_stdin' ? 'write_stdin' : 'exec_command';
}

function inferToolTitle(payload: any): string | null {
    const firstParsed = payload?.parsed_cmd?.[0];
    if (typeof firstParsed?.cmd === 'string' && firstParsed.cmd.length > 0) {
        return firstParsed.cmd.slice(0, 240);
    }
    const command = Array.isArray(payload?.command) ? payload.command.join(' ') : '';
    return command ? command.slice(0, 240) : null;
}

function durationToMs(duration: any): number | null {
    if (!duration || typeof duration !== 'object') return null;
    const secs = typeof duration.secs === 'number' ? duration.secs : 0;
    const nanos = typeof duration.nanos === 'number' ? duration.nanos : 0;
    return Math.round(secs * 1000 + nanos / 1_000_000);
}

function extensionForPath(filePath: string | null | undefined): string | null {
    if (!filePath) return null;
    const filename = filePath.split('/').pop() || filePath;
    const dot = filename.lastIndexOf('.');
    if (dot <= 0 || dot === filename.length - 1) return null;
    return filename.slice(dot + 1).toLowerCase();
}

function normalizeFileOperation(type: string | undefined): 'read' | 'write' | 'edit' | null {
    if (!type) return null;
    if (type === 'read') return 'read';
    if (type === 'write' || type === 'create') return 'write';
    if (type === 'edit' || type === 'patch') return 'edit';
    return null;
}

async function getOpenTurnId(sessionId: string): Promise<number | null> {
    const [row] = await db.execute(sql`
        SELECT id
        FROM turns
        WHERE session_id = ${sessionId}
        ORDER BY created_at DESC
        LIMIT 1
    `);
    const id = row && typeof row.id === 'number' ? row.id : Number(row?.id);
    return Number.isFinite(id) ? id : null;
}

async function notifyLiveRef(type: string, id: string, sessionId: string): Promise<void> {
    await client.notify('live_event', JSON.stringify({ type, id, sessionId }));
}

async function notifyLiveFull(event: Record<string, unknown>): Promise<void> {
    await client.notify('live_event', JSON.stringify(event));
}

async function insertFileEditsFromParsedCommand(
    sessionId: string,
    callId: string,
    parsed: ParsedCommand[] | undefined,
    timestamp: Date
): Promise<void> {
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    const turnId = await getOpenTurnId(sessionId);
    const [toolRow] = await db.execute(sql`
        SELECT id
        FROM tool_calls
        WHERE call_id = ${callId}
        LIMIT 1
    `);
    const toolCallId = toolRow && typeof toolRow.id === 'number' ? toolRow.id : Number(toolRow?.id);
    const normalizedToolCallId = Number.isFinite(toolCallId) ? toolCallId : null;

    for (const item of parsed) {
        const operation = normalizeFileOperation(item?.type);
        const filePath = typeof item?.path === 'string' ? item.path : null;
        if (!operation || !filePath) continue;

        const existing = await db.execute(sql`
            SELECT id
            FROM file_edits
            WHERE session_id = ${sessionId}
              AND file_path = ${filePath}
              AND operation = ${operation}
              AND created_at = ${timestamp}
              AND (
                (${normalizedToolCallId} IS NULL AND tool_call_id IS NULL)
                OR tool_call_id = ${normalizedToolCallId}
              )
            LIMIT 1
        `);
        if (existing.length > 0) continue;

        await db.insert(fileEdits).values({
            sessionId,
            turnId,
            toolCallId: normalizedToolCallId,
            filePath,
            fileExtension: extensionForPath(filePath),
            operation,
            linesAdded: 0,
            linesRemoved: 0,
            createdAt: timestamp
        });

        await notifyLiveFull({
            type: 'file.edit',
            sessionId,
            toolCallId: callId,
            filePath,
            fileExtension: extensionForPath(filePath),
            operation,
            linesAdded: 0,
            linesRemoved: 0,
            createdAt: timestamp.toISOString()
        });
    }
}

async function processSessionFile(filePath: string): Promise<void> {
    const filename = filePath.split('/').pop() || '';
    const sessionId = extractSessionId(filename);
    
    if (!sessionId) {
        console.log(`[Skip] Cannot extract session ID from: ${filename}`);
        return;
    }

    const startLine = fileProgress.get(filePath) || 0;
    let currentLine = 0;
    let newEvents = 0;

    const fileStream = createReadStream(filePath);
    const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let meta: typeof sessionMeta extends Map<string, infer V> ? V : never = {
        modelProvider: 'openai',
        model: 'gpt-5.4',
        cwd: '',
        cliVersion: ''
    };

    for await (const line of rl) {
        currentLine++;
        
        // Skip already processed lines
        if (currentLine <= startLine) continue;
        
        if (!line.trim()) continue;

        try {
            const event: CodexEvent = JSON.parse(line);
            await processEvent(sessionId, event, meta, currentLine);
            newEvents++;

            // Update metadata from session_meta events
            if (event.type === 'session_meta' && event.payload) {
                meta = {
                    modelProvider: event.payload.model_provider || 'openai',
                    model: event.payload.model || 'gpt-5.4',
                    cwd: event.payload.cwd || '',
                    cliVersion: event.payload.cli_version || ''
                };
                sessionMeta.set(sessionId, meta);
            }
        } catch (e) {
            // Skip malformed lines
        }
    }

    fileProgress.set(filePath, currentLine);

    if (newEvents > 0) {
        console.log(`[Codex] ${sessionId.slice(0, 8)}: ${newEvents} events synced`);
    }
}

async function processEvent(
    sessionId: string,
    event: CodexEvent,
    meta: { modelProvider: string; model: string; cwd: string },
    lineNumber: number
): Promise<void> {
    const timestamp = new Date(event.timestamp);

    // Handle token_count events - these are the main telemetry
    if (event.type === 'event_msg' && event.payload?.type === 'token_count') {
        const info = event.payload.info;
        const lastUsage: TokenUsage | undefined = info?.last_token_usage;
        const totalUsage: TokenUsage | undefined = info?.total_token_usage;
        if (!lastUsage) return;

        let rawInput = Number(lastUsage.input_tokens || 0);
        let tokensCacheRead = Number(lastUsage.cached_input_tokens || 0);
        let tokensOutput = Number(lastUsage.output_tokens || 0);
        let tokensReasoning = Number(lastUsage.reasoning_output_tokens || 0);

        if (totalUsage) {
            const totalInput = Number(totalUsage.input_tokens || 0);
            const totalCacheRead = Number(totalUsage.cached_input_tokens || 0);
            const totalOutput = Number(totalUsage.output_tokens || 0);
            const totalReasoning = Number(totalUsage.reasoning_output_tokens || 0);
            const prev = tokenTotalsState.get(sessionId);

            if (prev) {
                rawInput = Math.max(0, totalInput - prev.input);
                tokensCacheRead = Math.max(0, totalCacheRead - prev.cacheRead);
                tokensOutput = Math.max(0, totalOutput - prev.output);
                tokensReasoning = Math.max(0, totalReasoning - prev.reasoning);
            } else {
                rawInput = totalInput;
                tokensCacheRead = totalCacheRead;
                tokensOutput = totalOutput;
                tokensReasoning = totalReasoning;
            }

            tokenTotalsState.set(sessionId, {
                input: totalInput,
                cacheRead: totalCacheRead,
                output: totalOutput,
                reasoning: totalReasoning
            });
        }

        if (rawInput === 0 && tokensOutput === 0 && tokensReasoning === 0 && tokensCacheRead === 0) {
            return;
        }

        const messageId = `codex-${sessionId}-line-${lineNumber}`;
        const dateStr = timestamp.toISOString().split('T')[0];

        // Codex input includes cached input; normalize to non-cached input
        const tokensInput = Math.max(0, rawInput - tokensCacheRead);

        try {
            // Insert request record
            await db.insert(requests).values({
                messageId,
                sessionId,
                providerId: meta.modelProvider,
                modelId: normalizeCodexModel(meta.model),
                agent: 'codex',
                tokensInput,
                tokensOutput,
                tokensReasoning,
                tokensCacheRead,
                tokensCacheWrite: 0,
                costUsd: 0, // Will be computed by dashboard
                durationMs: null,
                finishReason: 'stop',
                workingDir: meta.cwd,
                createdAt: timestamp,
                completedAt: timestamp
            });

            // Update daily summary
            await db.insert(dailySummary).values({
                date: dateStr,
                providerId: meta.modelProvider,
                modelId: normalizeCodexModel(meta.model),
                requestCount: 1,
                tokensInput,
                tokensOutput,
                tokensReasoning,
                tokensCacheRead,
                tokensCacheWrite: 0,
                costUsd: 0
            }).onConflictDoUpdate({
                target: [dailySummary.date, dailySummary.providerId, dailySummary.modelId],
                set: {
                    requestCount: sql`${dailySummary.requestCount} + 1`,
                    tokensInput: sql`${dailySummary.tokensInput} + ${tokensInput}`,
                    tokensOutput: sql`${dailySummary.tokensOutput} + ${tokensOutput}`,
                    tokensReasoning: sql`${dailySummary.tokensReasoning} + ${tokensReasoning}`,
                    tokensCacheRead: sql`${dailySummary.tokensCacheRead} + ${tokensCacheRead}`
                }
            });

            // Update session aggregate
            await db.insert(sessions).values({
                sessionId,
                projectDir: meta.cwd || null,
                title: null,
                firstRequestAt: timestamp,
                lastRequestAt: timestamp,
                totalRequests: 1,
                totalCostUsd: 0,
                totalTokensInput: tokensInput,
                totalTokensOutput: tokensOutput
            }).onConflictDoUpdate({
                target: [sessions.sessionId],
                set: {
                    lastRequestAt: timestamp,
                    totalRequests: sql`${sessions.totalRequests} + 1`,
                    totalTokensInput: sql`${sessions.totalTokensInput} + ${tokensInput}`,
                    totalTokensOutput: sql`${sessions.totalTokensOutput} + ${tokensOutput}`
                }
            });

            // Send live notification
            await client.notify('live_event', JSON.stringify({
                type: 'request',
                id: messageId,
                sessionId
            }));

        } catch (e: any) {
            // Ignore duplicate key errors
            const pgError = e.cause || e;
            if (pgError.code !== '23505') {
                // console.error(`[Error] Insert failed:`, e.message);
            }
        }
    }

    // Track turn boundaries
    if (event.type === 'event_msg' && event.payload?.type === 'task_started') {
        turnState.set(sessionId, {
            turnId: event.payload.turn_id || `turn-${timestamp.getTime()}`,
            startedAt: timestamp,
            messageCount: 0
        });
    }

    if (event.type === 'event_msg' && event.payload?.type === 'task_complete') {
        turnState.delete(sessionId);
    }

    // Handle user messages for prompts
    if (event.type === 'event_msg' && event.payload?.type === 'user_message') {
        const prompt = event.payload.message;
        if (prompt && prompt.trim()) {
            const messageId = getTurnMessageId(sessionId, timestamp, 'codex-prompt');

            try {
                await db.insert(turns).values({
                    sessionId,
                    userMessageId: messageId,
                    prompt: prompt.slice(0, 10000), // Truncate long prompts
                    agent: 'codex',
                    providerId: meta.modelProvider,
                    modelId: normalizeCodexModel(meta.model),
                    createdAt: timestamp
                });

                // Update session title from first prompt
                const derivedTitle = prompt.slice(0, 100).trim();
                await db.update(sessions)
                    .set({ title: derivedTitle })
                    .where(sql`session_id = ${sessionId} AND title IS NULL`);

                await notifyLiveFull({
                    type: 'prompt',
                    sessionId,
                    messageId,
                    prompt: prompt.slice(0, 10000),
                    agent: 'codex',
                    providerId: meta.modelProvider,
                    modelId: normalizeCodexModel(meta.model),
                    createdAt: timestamp.toISOString()
                });

            } catch (e: any) {
                const pgError = e.cause || e;
                if (pgError.code !== '23505') {
                    // Ignore duplicates
                }
            }
        }
    }

    // Extract session title from session_meta if available
    if (event.type === 'session_meta' && event.payload?.thread_name) {
        try {
            await db.update(sessions)
                .set({ title: event.payload.thread_name })
                .where(sql`session_id = ${sessionId}`);
        } catch (e) {
            // Ignore
        }
    }

    if (event.type === 'event_msg' && event.payload?.type === 'agent_message') {
        const text = typeof event.payload.message === 'string' ? event.payload.message : null;
        if (!text || !text.trim()) return;

        const turnMessageId = getTurnMessageId(sessionId, timestamp, 'codex-assistant');
        const messageId = `${turnMessageId}:assistant`;
        const partId = event.payload.id || timestamp.toISOString();

        try {
            await db
                .insert(assistantTextParts)
                .values({
                    sessionId,
                    messageId,
                    partId,
                    text,
                    createdAt: timestamp
                })
                .onConflictDoNothing();

            await db
                .update(turns)
                .set({
                    assistantMessageId: messageId,
                    assistantText: text,
                    completedAt: timestamp
                })
                .where(sql`session_id = ${sessionId} AND user_message_id = ${turnMessageId}`);

            await notifyLiveFull({
                type: 'assistant.text',
                sessionId,
                messageId,
                partId,
                text,
                createdAt: timestamp.toISOString()
            });
        } catch (e) {
            // Ignore duplicate or partial assistant updates
        }
    }

    if (event.type === 'event_msg' && event.payload?.type === 'exec_command_start') {
        const callId = event.payload.call_id || `codex-call-${timestamp.getTime()}`;
        const turnId = await getOpenTurnId(sessionId);

        try {
            await db
                .insert(toolCalls)
                .values({
                    sessionId,
                    turnId,
                    callId,
                    tool: inferToolName(event.payload),
                    args: {
                        command: event.payload.command,
                        parsed_cmd: event.payload.parsed_cmd,
                        cwd: event.payload.cwd
                    },
                    startedAt: timestamp
                })
                .onConflictDoNothing();

            await notifyLiveRef('tool.before', callId, sessionId);
        } catch (e) {
            // Ignore duplicate tool start events
        }
    }

    if (event.type === 'event_msg' && event.payload?.type === 'exec_command_end') {
        const callId = event.payload.call_id || `codex-call-${timestamp.getTime()}`;
        const turnId = await getOpenTurnId(sessionId);

        try {
            await db
                .insert(toolCalls)
                .values({
                    sessionId,
                    turnId,
                    callId,
                    tool: inferToolName(event.payload),
                    args: {
                        command: event.payload.command,
                        parsed_cmd: event.payload.parsed_cmd,
                        cwd: event.payload.cwd
                    },
                    title: inferToolTitle(event.payload),
                    output: event.payload.aggregated_output || event.payload.stdout || '',
                    metadata: {
                        process_id: event.payload.process_id,
                        exit_code: event.payload.exit_code,
                        source: event.payload.source,
                        parsed_cmd: event.payload.parsed_cmd
                    },
                    durationMs: durationToMs(event.payload.duration),
                    success: event.payload.exit_code === 0,
                    errorMessage: event.payload.stderr || null,
                    startedAt: timestamp,
                    completedAt: timestamp
                })
                .onConflictDoUpdate({
                    target: toolCalls.callId,
                    set: {
                        turnId,
                        tool: inferToolName(event.payload),
                        title: inferToolTitle(event.payload),
                        output: event.payload.aggregated_output || event.payload.stdout || '',
                        metadata: {
                            process_id: event.payload.process_id,
                            exit_code: event.payload.exit_code,
                            source: event.payload.source,
                            parsed_cmd: event.payload.parsed_cmd
                        },
                        durationMs: durationToMs(event.payload.duration),
                        success: event.payload.exit_code === 0,
                        errorMessage: event.payload.stderr || null,
                        completedAt: timestamp
                    }
                });

            await insertFileEditsFromParsedCommand(
                sessionId,
                callId,
                event.payload.parsed_cmd,
                timestamp
            );
            await notifyLiveRef('tool.after', callId, sessionId);
        } catch (e) {
            // Ignore duplicate tool completion events
        }
    }
}

async function findSessionFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            
            if (entry.isDirectory()) {
                // Recurse into year/month/day directories
                const subFiles = await findSessionFiles(fullPath);
                files.push(...subFiles);
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                files.push(fullPath);
            }
        }
    } catch (e) {
        // Directory doesn't exist yet
    }
    
    return files;
}

async function seedExistingFiles(): Promise<void> {
    console.log(`[Codex] Scanning existing session files from ${SESSIONS_DIR}`);

    const files = await findSessionFiles(SESSIONS_DIR);
    console.log(`[Codex] Found ${files.length} existing session files`);

    // Query DB for sessions that already have codex requests synced
    const existingSessions = await db.execute(sql`
        SELECT DISTINCT session_id FROM requests WHERE agent = 'codex'
    `);
    const syncedIds = new Set(existingSessions.map((r: any) => r.session_id));

    let seeded = 0;
    let toSync = 0;

    for (const filePath of files) {
        const filename = filePath.split('/').pop() || '';
        const sessionId = extractSessionId(filename);

        if (sessionId && syncedIds.has(sessionId)) {
            // Already synced — mark as processed to avoid re-inserting
            try {
                const content = await readFile(filePath, 'utf-8');
                const lineCount = content.split('\n').length;
                fileProgress.set(filePath, lineCount);
                seeded++;
            } catch {
                // Ignore files that disappear
            }
        } else {
            // Not yet synced — leave out of fileProgress so re-scan picks it up
            toSync++;
        }
    }

    console.log(`[Codex] ${seeded} files already synced, ${toSync} files pending sync`);
}

// Track watched directories to avoid duplicate watchers
const watchedDirs = new Set<string>();

function watchDirectory(dir: string, depth: number = 0): void {
    if (depth > 4) return; // year/month/day/file = 3 levels max
    if (watchedDirs.has(dir)) return;
    watchedDirs.add(dir);
    
    try {
        watch(dir, async (eventType, filename) => {
            if (!filename) return;
            
            const fullPath = join(dir, filename);
            
            try {
                const s = await stat(fullPath);
                
                if (s.isDirectory()) {
                    // New day/month/year directory created - watch it and its children
                    watchDirectory(fullPath, depth + 1);
                    // Also scan for any files already in the new dir
                    const children = await readdir(fullPath, { withFileTypes: true });
                    for (const child of children) {
                        if (child.isDirectory()) {
                            watchDirectory(join(fullPath, child.name), depth + 2);
                        } else if (child.name.endsWith('.jsonl')) {
                            setTimeout(() => processSessionFile(join(fullPath, child.name)), 500);
                        }
                    }
                } else if (filename.endsWith('.jsonl')) {
                    // New or updated session file
                    setTimeout(() => processSessionFile(fullPath), 500);
                }
            } catch (e) {
                // File/dir was deleted, ignore
            }
        });
        
        // Watch existing subdirectories
        readdir(dir, { withFileTypes: true }).then(entries => {
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    watchDirectory(join(dir, entry.name), depth + 1);
                }
            }
        }).catch(() => {});
        
    } catch (e) {
        // Directory doesn't exist
    }
}

async function main(): Promise<void> {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Codex Sync Daemon for Dashboard              ║
╠═══════════════════════════════════════════════════════════╣
║  Watching: ~/.codex/sessions/                             ║
║  Agent ID: codex                                          ║
║  Provider: openai                                         ║
╚═══════════════════════════════════════════════════════════╝
`);

    // Match the OpenCode watcher: ignore old history and stream only new activity.
    await seedExistingFiles();
    
    // Immediate one-time catch-up for any unsynced files
    const initialFiles = await findSessionFiles(SESSIONS_DIR);
    const initialPending = initialFiles.filter((f) => !fileProgress.has(f));
    if (initialPending.length > 0) {
        console.log(`[Codex] Initial catch-up: syncing ${initialPending.length} pending files`);
        for (const f of initialPending) {
            await processSessionFile(f);
        }
    }

    // Watch for new session files
    console.log(`[Codex] Watching for new sessions...`);
    watchDirectory(SESSIONS_DIR);
    
    // Also watch session_index.jsonl for quick updates
    try {
        watch(join(CODEX_DIR, "session_index.jsonl"), async () => {
            // When session index updates, re-scan for new files
            const files = await findSessionFiles(SESSIONS_DIR);
            const unprocessed = files.filter(f => !fileProgress.has(f));
            for (const f of unprocessed) {
                await processSessionFile(f);
            }
        });
    } catch (e) {
        // session_index.jsonl doesn't exist
    }
    
    // Periodic re-scan every 60 seconds - catches files missed by fs.watch
    setInterval(async () => {
        const files = await findSessionFiles(SESSIONS_DIR);
        for (const f of files) {
            try {
                const content = await readFile(f, 'utf-8');
                const lineCount = content.split('\n').length;
                const knownLines = fileProgress.get(f) || 0;
                // Process if file is new (not in fileProgress) or has new lines
                if (lineCount > knownLines) {
                    await processSessionFile(f);
                }
            } catch (e) {
                // File was deleted
            }
        }
    }, 60 * 1000);
}

main().catch(console.error);
