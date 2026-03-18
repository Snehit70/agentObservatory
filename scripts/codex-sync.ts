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
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { sql } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });
const { requests, dailySummary, sessions, turns } = schema;

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

interface CodexEvent {
    timestamp: string;
    type: string;
    payload: any;
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
            await processEvent(sessionId, event, meta);
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
    meta: { modelProvider: string; model: string; cwd: string }
): Promise<void> {
    const timestamp = new Date(event.timestamp);

    // Handle token_count events - these are the main telemetry
    if (event.type === 'event_msg' && event.payload?.type === 'token_count') {
        const info = event.payload.info;
        const lastUsage: TokenUsage = info.last_token_usage;
        
        if (!lastUsage || (lastUsage.input_tokens === 0 && lastUsage.output_tokens === 0)) {
            return;
        }

        const turn = turnState.get(sessionId);
        const messageId = turn?.turnId || `codex-${sessionId}-${timestamp.getTime()}`;
        const dateStr = timestamp.toISOString().split('T')[0];

        const tokensInput = lastUsage.input_tokens || 0;
        const tokensOutput = lastUsage.output_tokens || 0;
        const tokensReasoning = lastUsage.reasoning_output_tokens || 0;
        const tokensCacheRead = lastUsage.cached_input_tokens || 0;

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
            const turn = turnState.get(sessionId);
            const messageId = turn?.turnId || `codex-prompt-${timestamp.getTime()}`;

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

async function initialSync(): Promise<void> {
    console.log(`[Codex] Initial sync from ${SESSIONS_DIR}`);
    
    const files = await findSessionFiles(SESSIONS_DIR);
    console.log(`[Codex] Found ${files.length} session files`);
    
    // Sort by modification time, newest first
    const filesWithStats = await Promise.all(
        files.map(async (f) => {
            const s = await stat(f);
            return { path: f, mtime: s.mtime };
        })
    );
    filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    // Process last 20 sessions for initial sync
    const recentFiles = filesWithStats.slice(0, 20);
    
    for (const { path } of recentFiles) {
        await processSessionFile(path);
    }
    
    console.log(`[Codex] Initial sync complete`);
}

function watchDirectory(dir: string, depth: number = 0): void {
    if (depth > 4) return; // year/month/day/file = 3 levels max
    
    try {
        watch(dir, async (eventType, filename) => {
            if (!filename) return;
            
            const fullPath = join(dir, filename);
            
            try {
                const s = await stat(fullPath);
                
                if (s.isDirectory()) {
                    // New day/month/year directory created
                    watchDirectory(fullPath, depth + 1);
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

    // Initial sync of recent sessions
    await initialSync();
    
    // Watch for new session files
    console.log(`[Codex] Watching for new sessions...`);
    watchDirectory(SESSIONS_DIR);
    
    // Also watch session_index.jsonl for quick updates
    try {
        watch(join(CODEX_DIR, "session_index.jsonl"), async () => {
            // When session index updates, re-scan for new files
            const files = await findSessionFiles(SESSIONS_DIR);
            const unprocessed = files.filter(f => !fileProgress.has(f));
            for (const f of unprocessed.slice(0, 5)) {
                await processSessionFile(f);
            }
        });
    } catch (e) {
        // session_index.jsonl doesn't exist
    }
    
    // Periodic re-scan every 5 minutes
    setInterval(async () => {
        const files = await findSessionFiles(SESSIONS_DIR);
        // Re-process files that may have been appended to
        for (const f of files.slice(0, 10)) {
            const currentSize = fileProgress.get(f) || 0;
            try {
                const s = await stat(f);
                // If file grew, reprocess it
                const content = await readFile(f, 'utf-8');
                const lineCount = content.split('\n').length;
                if (lineCount > currentSize) {
                    await processSessionFile(f);
                }
            } catch (e) {
                // File was deleted
            }
        }
    }, 5 * 60 * 1000);
}

main().catch(console.error);
