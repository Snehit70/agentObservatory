import { watch } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { sql } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });
const { requests, dailySummary } = schema;

const LOG_DIR = join(homedir(), ".local/share/opencode/storage/message");

// Cache of processed file sizes to detect appended content vs new files
const fileSizes = new Map<string, number>();

async function processFile(filePath: string) {
    try {
        const content = await readFile(filePath, "utf-8");
        const msg = JSON.parse(content);
        
        // Only care about assistant messages with tokens
        if (msg.role !== "assistant") return;
        if (!msg.tokens || (!msg.tokens.input && !msg.tokens.output)) return;

        const createdAt = new Date(msg.time.created);
        const dateStr = createdAt.toISOString().split('T')[0];
        const providerId = msg.providerID || msg.model?.providerID || "unknown";
        const modelId = msg.modelID || msg.model?.modelID || "unknown";

        const tokensInput = msg.tokens.input || 0;
        const tokensOutput = msg.tokens.output || 0;
        const tokensReasoning = msg.tokens.reasoning || 0;
        const tokensCacheRead = msg.tokens.cache?.read || 0;
        const tokensCacheWrite = msg.tokens.cache?.write || 0;

        try {
            await db.insert(requests).values({
                messageId: msg.id,
                sessionId: msg.sessionID,
                providerId,
                modelId,
                agent: msg.agent || msg.mode || "unknown",
                tokensInput,
                tokensOutput,
                tokensReasoning,
                tokensCacheRead,
                tokensCacheWrite,
                costUsd: 0, 
                durationMs: msg.time.completed ? (msg.time.completed - msg.time.created) : null,
                finishReason: msg.finish || null,
                workingDir: msg.path?.cwd,
                createdAt,
                completedAt: msg.time.completed ? new Date(msg.time.completed) : null
            });

            // Update daily summary
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

            // Notify live dashboard
            const liveEvent = {
                type: 'request',
                messageId: msg.id,
                sessionId: msg.sessionID,
                providerId,
                modelId,
                agent: msg.agent || msg.mode || "unknown",
                tokens: {
                    input: tokensInput,
                    output: tokensOutput,
                    reasoning: tokensReasoning,
                    cache: { read: tokensCacheRead, write: tokensCacheWrite }
                },
                cost: 0,
                durationMs: msg.time.completed ? (msg.time.completed - msg.time.created) : null,
                finishReason: msg.finish || null,
                workingDir: msg.path?.cwd,
                createdAt: createdAt.toISOString(),
                completedAt: msg.time.completed ? new Date(msg.time.completed).toISOString() : null
            };
            
            await client.notify('live_event', JSON.stringify(liveEvent));

            console.log(`[New] ${modelId}: ${tokensInput} in / ${tokensOutput} out`);
        } catch (insertError: any) {
             const pgError = insertError.cause || insertError;
            if (pgError.code !== '23505') {
                 // throw insertError;
            }
        }

    } catch (e: any) {
        // Ignore parsing errors for incomplete files
    }
}

console.log(`Watching for new logs in ${LOG_DIR}...`);

const watchers = new Map<string, any>();

function watchSessionDir(sessionDir: string) {
    if (watchers.has(sessionDir)) return;
    
    console.log(`Watching session: ${sessionDir.split('/').pop()}`);
    const watcher = watch(sessionDir, async (eventType, filename) => {
        if (eventType === 'rename' && filename && filename.endsWith('.json')) {
            // New file created
            const fullPath = join(sessionDir, filename);
            // Wait brief moment for write to complete
            setTimeout(() => processFile(fullPath), 100);
        }
    });
    watchers.set(sessionDir, watcher);
}

// Watch root for new sessions
watch(LOG_DIR, (eventType, filename) => {
    if (eventType === 'rename' && filename && filename.startsWith('ses_')) {
        watchSessionDir(join(LOG_DIR, filename));
    }
});

// Watch existing recent sessions (last 5)
import { readdir } from "node:fs/promises";
readdir(LOG_DIR).then(files => {
    files.filter(f => f.startsWith('ses_'))
         .sort() // approximate recency by name
         .slice(-5)
         .forEach(f => watchSessionDir(join(LOG_DIR, f)));
});
