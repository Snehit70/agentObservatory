import { watch } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { createWorkerClient } from '../src/lib/server/postgres-client';

const client = createWorkerClient(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });
const { requests, dailySummary, sessions, turns, assistantTextParts } = schema;

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

const fileProgress = new Map<string, number>();
const args = process.argv.slice(2);
const runOnce = args.includes('--once');
const catchupDays = getNumberArg('--since-days', 14);

function getNumberArg(name: string, fallback: number): number {
    const prefix = `${name}=`;
    const match = args.find((arg) => arg.startsWith(prefix));
    const value = Number(match?.slice(prefix.length));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function renderMessageContent(content: unknown): string {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return '';

    return content
        .map((item) => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item && 'text' in item) return String((item as any).text);
            return '';
        })
        .join('')
        .trim();
}

async function seedExistingFiles(): Promise<void> {
    console.log(`[Claude] Seeding ${PROJECTS_DIR}`);
    const files = await findProjectFiles(PROJECTS_DIR);
    const catchupCutoff = Date.now() - catchupDays * 24 * 60 * 60 * 1000;
    for (const file of files) {
        try {
            const info = await stat(file);
            if (info.mtimeMs >= catchupCutoff) {
                await processFile(file);
            } else {
                fileProgress.set(file, await countFileLines(file));
            }
        } catch {
            // ignore
        }
    }
}

async function countFileLines(filePath: string): Promise<number> {
    let lines = 0;
    const stream = createReadStream(filePath);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const _line of rl) {
        lines += 1;
    }
    return lines;
}

async function processFile(filePath: string): Promise<void> {
    const seen = fileProgress.get(filePath) || 0;
    let current = 0;
    let newEvents = 0;

    const stream = createReadStream(filePath);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
        current += 1;
        if (current <= seen) continue;
        if (!line.trim()) continue;

        try {
            const event = JSON.parse(line) as Record<string, any>;
            await processEvent(event);
            newEvents += 1;
        } catch {
            // skip malformed
        }
    }

    fileProgress.set(filePath, current);
    if (newEvents > 0) {
        console.log(`[Claude] ${filePath.split('/').pop()}: ${newEvents} new events`);
    }
}

function getContentText(event: Record<string, any>): string {
    return renderMessageContent(event.message?.content ?? '');
}

function getCacheCreationTokens(usage: Record<string, any> | null | undefined): number {
    if (!usage) return 0;
    const direct = Number(usage.cache_creation_input_tokens ?? 0);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const cacheCreation = usage.cache_creation;
    if (!cacheCreation || typeof cacheCreation !== 'object') return 0;

    const oneHour = Number(cacheCreation.ephemeral_1h_input_tokens ?? 0);
    const fiveMinute = Number(cacheCreation.ephemeral_5m_input_tokens ?? 0);
    return Math.max(0, (Number.isFinite(oneHour) ? oneHour : 0) + (Number.isFinite(fiveMinute) ? fiveMinute : 0));
}

async function processEvent(event: Record<string, any>): Promise<void> {
    const timestamp = new Date(event.timestamp || Date.now());
    const sessionId = event.sessionId ?? event.sessionId;
    if (!sessionId) return;

    const providerId = 'anthropic';
    const modelId = event.message?.model || event.model || 'claude-code';
    const cwd = event.cwd || event.directory || null;

    if (event.type === 'user') {
        const text = getContentText(event);
        if (!text) return;

        const messageId = event.message?.id || `claude-prompt-${timestamp.getTime()}`;

        await db.insert(turns).values({
            sessionId,
            userMessageId: messageId,
            prompt: text.slice(0, 10000),
            agent: 'claude-code',
            providerId,
            modelId,
            createdAt: timestamp
        }).onConflictDoNothing();

        const derivedTitle = text.slice(0, 100).trim();
        if (derivedTitle) {
            await db.update(sessions)
                .set({ title: derivedTitle })
                .where(sql`session_id = ${sessionId} AND title IS NULL`);
        }

        await client.notify('live_event', JSON.stringify({
            type: 'prompt',
            sessionId,
            messageId,
            prompt: text,
            agent: 'claude-code',
            providerId,
            modelId,
            createdAt: timestamp.toISOString()
        }));

        return;
    }

    if (event.type === 'assistant') {
        const message = event.message;
        if (!message) return;
        const text = getContentText(event);
        const messageId = message.id || `claude-${sessionId}-${timestamp.getTime()}`;
        const tokensInput = message.usage?.input_tokens ?? 0;
        const tokensOutput = message.usage?.output_tokens ?? 0;
        const tokensReasoning = message.usage?.reasoning_output_tokens ?? 0;
        const tokensCacheRead = message.usage?.cache_read_input_tokens ?? 0;
        const tokensCacheWrite = getCacheCreationTokens(message.usage);

        const dateStr = timestamp.toISOString().split('T')[0];

        const insertedRequests = await db.insert(requests).values({
            messageId,
            sessionId,
            providerId,
            modelId,
            agent: 'claude-code',
            tokensInput,
            tokensOutput,
            tokensReasoning,
            tokensCacheRead,
            tokensCacheWrite,
            costUsd: 0,
            durationMs: null,
            finishReason: message.stop_reason ?? null,
            workingDir: cwd,
            createdAt: timestamp,
            completedAt: timestamp
        }).onConflictDoNothing().returning({ id: requests.id });

        const insertedRequest = insertedRequests.length > 0;

        if (insertedRequest) {
            await db.insert(dailySummary).values({
                date: dateStr,
                providerId,
                modelId,
                requestCount: 1,
                tokensInput,
                tokensOutput,
                tokensReasoning,
                tokensCacheRead,
                tokensCacheWrite,
                costUsd: 0
            }).onConflictDoUpdate({
                target: [dailySummary.date, dailySummary.providerId, dailySummary.modelId],
                set: {
                    requestCount: sql`${dailySummary.requestCount} + 1`,
                    tokensInput: sql`${dailySummary.tokensInput} + ${tokensInput}`,
                    tokensOutput: sql`${dailySummary.tokensOutput} + ${tokensOutput}`,
                    tokensReasoning: sql`${dailySummary.tokensReasoning} + ${tokensReasoning}`,
                    tokensCacheRead: sql`${dailySummary.tokensCacheRead} + ${tokensCacheRead}`,
                    tokensCacheWrite: sql`${dailySummary.tokensCacheWrite} + ${tokensCacheWrite}`
                }
            });

            await db.insert(sessions).values({
                sessionId,
                projectDir: cwd,
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
        }

        const turn = await db.select({ id: turns.id }).from(turns).where(eq(turns.sessionId, sessionId)).orderBy(desc(turns.createdAt)).limit(1);
        const turnId = turn[0]?.id ?? null;

        if (turnId) {
            await db.update(turns)
                .set({
                    assistantMessageId: messageId,
                    assistantText: text,
                    completedAt: timestamp,
                    tokensInput,
                    tokensOutput,
                    tokensReasoning,
                    tokensCacheRead,
                    tokensCacheWrite
                })
                .where(eq(turns.id, turnId));
        }

        await db.insert(assistantTextParts).values({
            sessionId,
            messageId,
            partId: message.uuid ?? timestamp.toISOString(),
            text,
            createdAt: timestamp
        }).onConflictDoNothing();

        if (insertedRequest) {
            await client.notify('live_event', JSON.stringify({
                type: 'request',
                messageId,
                sessionId,
                providerId,
                modelId,
                agent: 'claude-code',
                tokens: {
                    input: tokensInput,
                    output: tokensOutput,
                    reasoning: tokensReasoning,
                    cache: { read: tokensCacheRead, write: tokensCacheWrite }
                },
                cost: 0,
                createdAt: timestamp.toISOString(),
                workingDir: cwd
            }));
        }

        await client.notify('live_event', JSON.stringify({
            type: 'assistant.text',
            sessionId,
            messageId,
            text,
            createdAt: timestamp.toISOString()
        }));
    }
}

async function findProjectFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...(await findProjectFiles(fullPath)));
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                files.push(fullPath);
            }
        }
    } catch {
        // ignore
    }
    return files;
}

const watchers = new Map<string, ReturnType<typeof watch>>();

function watchDirectory(dir: string): void {
    if (watchers.has(dir)) return;
    try {
        const watcher = watch(dir, (eventType, filename) => {
            if (!filename) return;
            const fullPath = join(dir, filename);
            if (filename.endsWith('.jsonl') && (eventType === 'rename' || eventType === 'change')) {
                setTimeout(() => processFile(fullPath), 200);
            }
        });
        watchers.set(dir, watcher);
    } catch {
        // ignore
    }
}

async function main(): Promise<void> {
    await seedExistingFiles();
    if (runOnce) {
        await client.end({ timeout: 5 });
        return;
    }

    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            watchDirectory(join(PROJECTS_DIR, entry.name));
        }
    }

    watch(PROJECTS_DIR, (eventType, filename) => {
        if (!filename) return;
        const target = join(PROJECTS_DIR, filename);
        stat(target).then((info) => {
            if (info.isDirectory()) {
                watchDirectory(target);
            }
        }).catch(() => {});
    });
}

main().catch(console.error);
