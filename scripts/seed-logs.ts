import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/db/schema';
import { sql } from "drizzle-orm";
import { createWorkerClient } from '../src/lib/server/postgres-client';

const client = createWorkerClient(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });
const { requests, dailySummary, turns, sessions: sessionsTable } = schema;

const LOG_DIR = join(homedir(), ".local/share/opencode/storage/message");

async function seed() {
  console.log(`Scanning logs in ${LOG_DIR}...`);
  try {
      const allSessions = await readdir(LOG_DIR);
      
      console.log("Sorting sessions by date...");
      const sessionStats = await Promise.all(
        allSessions
            .filter(s => s.startsWith("ses_"))
            .map(async s => ({
                name: s,
                time: (await stat(join(LOG_DIR, s))).mtime.getTime()
            }))
      );
      
      const sessions = sessionStats
        .sort((a, b) => b.time - a.time)
        .map(s => s.name);

      console.log(`Found ${sessions.length} sessions. Processing newest first...`);

      let count = 0;
      let skipped = 0;

      for (const session of sessions) {
        const sessionDir = join(LOG_DIR, session);
        
        // Session Aggregation Stats
        let sMeta = {
            firstRequestAt: null as Date | null,
            lastRequestAt: null as Date | null,
            totalRequests: 0,
            totalCostUsd: 0,
            totalTokensInput: 0,
            totalTokensOutput: 0,
            projectDir: null as string | null,
            title: null as string | null
        };

        try {
            const files = await readdir(sessionDir);
            for (const file of files) {
                if (!file.endsWith(".json")) continue;
                const content = await readFile(join(sessionDir, file), "utf-8");
                try {
                    const msg = JSON.parse(content);
                    
                    // Handle Assistant Messages (Stats & Turns)
                    if (msg.role === "assistant") {
                        if (!msg.tokens || (!msg.tokens.input && !msg.tokens.output)) continue;

                        const createdAt = new Date(msg.time.created);
                        const dateStr = createdAt.toISOString().split('T')[0];
                        const providerId = msg.providerID || msg.model?.providerID || "unknown";
                        const modelId = msg.modelID || msg.model?.modelID || "unknown";
                        
                        // Update Session Meta
                        sMeta.totalRequests++;
                        sMeta.totalTokensInput += (msg.tokens.input || 0);
                        sMeta.totalTokensOutput += (msg.tokens.output || 0);
                        // Cost would be calculated here ideally, but for now we sum 0
                        
                        if (!sMeta.firstRequestAt || createdAt < sMeta.firstRequestAt) sMeta.firstRequestAt = createdAt;
                        if (!sMeta.lastRequestAt || createdAt > sMeta.lastRequestAt) sMeta.lastRequestAt = createdAt;
                        if (msg.path?.cwd) sMeta.projectDir = msg.path.cwd;

                        // Insert Request (Stats)
                        try {
                            await db.insert(requests).values({
                                messageId: msg.id,
                                sessionId: msg.sessionID,
                                providerId,
                                modelId,
                                agent: msg.agent || msg.mode || "unknown",
                                tokensInput: msg.tokens.input || 0,
                                tokensOutput: msg.tokens.output || 0,
                                tokensReasoning: msg.tokens.reasoning || 0,
                                tokensCacheRead: msg.tokens.cache?.read || 0,
                                tokensCacheWrite: msg.tokens.cache?.write || 0,
                                costUsd: 0,
                                durationMs: msg.time.completed ? (msg.time.completed - msg.time.created) : null,
                                finishReason: msg.finish || null,
                                workingDir: msg.path?.cwd,
                                createdAt,
                                completedAt: msg.time.completed ? new Date(msg.time.completed) : null
                            });
                            
                            // Upsert Daily Summary
                            await db.insert(dailySummary).values({
                                date: dateStr,
                                providerId,
                                modelId,
                                requestCount: 1,
                                tokensInput: msg.tokens.input || 0,
                                tokensOutput: msg.tokens.output || 0,
                                tokensReasoning: msg.tokens.reasoning || 0,
                                tokensCacheRead: msg.tokens.cache?.read || 0,
                                tokensCacheWrite: msg.tokens.cache?.write || 0,
                                costUsd: 0
                            }).onConflictDoUpdate({
                                target: [dailySummary.date, dailySummary.providerId, dailySummary.modelId],
                                set: {
                                    requestCount: sql`${dailySummary.requestCount} + 1`,
                                    tokensInput: sql`${dailySummary.tokensInput} + ${msg.tokens.input || 0}`,
                                    tokensOutput: sql`${dailySummary.tokensOutput} + ${msg.tokens.output || 0}`,
                                    tokensReasoning: sql`${dailySummary.tokensReasoning} + ${msg.tokens.reasoning || 0}`,
                                    tokensCacheRead: sql`${dailySummary.tokensCacheRead} + ${msg.tokens.cache?.read || 0}`,
                                    tokensCacheWrite: sql`${dailySummary.tokensCacheWrite} + ${msg.tokens.cache?.write || 0}`
                                }
                            });
                            count++;
                        } catch (e: any) {
                            const pgError = e.cause || e;
                            if (pgError.code === '23505') skipped++;
                            else console.error(e);
                        }
                    }

                    // Handle User Messages (Prompts for Turns)
                    if (msg.role === "user") {
                        const promptText = msg.parts 
                            ? msg.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n')
                            : (msg.content || ""); 
                        
                        // Use first prompt as title if not set
                        if (!sMeta.title && promptText) {
                            sMeta.title = promptText.slice(0, 50) + (promptText.length > 50 ? '...' : '');
                        }

                        try {
                            await db.insert(turns).values({
                                sessionId: msg.sessionID,
                                userMessageId: msg.id,
                                prompt: promptText,
                                agent: msg.agent || "unknown",
                                providerId: msg.model?.providerID || "unknown",
                                modelId: msg.model?.modelID || "unknown",
                                createdAt: new Date(msg.time.created)
                            });
                        } catch (e: any) {
                             // Ignore duplicates
                        }
                    }
                    
                } catch (e) {
                    
                }
            }

            // Insert Session Record
            if (sMeta.totalRequests > 0) {
                try {
                    await db.insert(sessionsTable).values({
                        sessionId: session,
                        projectDir: sMeta.projectDir,
                        title: sMeta.title || "Untitled Session",
                        firstRequestAt: sMeta.firstRequestAt,
                        lastRequestAt: sMeta.lastRequestAt,
                        totalRequests: sMeta.totalRequests,
                        totalCostUsd: sMeta.totalCostUsd,
                        totalTokensInput: sMeta.totalTokensInput,
                        totalTokensOutput: sMeta.totalTokensOutput
                    }).onConflictDoUpdate({
                        target: [sessionsTable.sessionId],
                        set: {
                            lastRequestAt: sMeta.lastRequestAt,
                            totalRequests: sMeta.totalRequests,
                            totalTokensInput: sMeta.totalTokensInput,
                            totalTokensOutput: sMeta.totalTokensOutput,
                            projectDir: sMeta.projectDir,
                            title: sMeta.title || sql`excluded.title`
                        }
                    });
                } catch (e) {
                    console.error(`Failed to insert session ${session}:`, e);
                }
            }

        } catch (e) {
            
        }
        
        if (count % 100 === 0) process.stdout.write(`\rImported ${count} requests (skipped ${skipped})...`);
      }
      console.log(`\nDone. Imported ${count} requests.`);
      await client.end();
  } catch (e) {
      console.error("Failed to read log directory:", e);
      await client.end();
  }
}

seed();
