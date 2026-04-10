import { json } from '@sveltejs/kit';
import { db, client } from '$lib/server/db';
import { 
    requests, 
    dailySummary, 
    sessions,
    turns, 
    toolCalls, 
    fileEdits 
} from '$lib/db/schema';
import { sql, eq, isNull, and, desc } from 'drizzle-orm';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const event = await request.json();
        const type = event.type;
        let notify = false;

        if (type === 'request') {
            const createdAt = new Date(event.createdAt);
            const dateStr = createdAt.toISOString().split('T')[0];
            
            await db.insert(requests).values({
                messageId: event.messageId,
                sessionId: event.sessionId,
                providerId: event.providerId || 'unknown',
                modelId: event.modelId || 'unknown',
                agent: event.agent || 'unknown',
                tokensInput: event.tokens?.input || 0,
                tokensOutput: event.tokens?.output || 0,
                tokensReasoning: event.tokens?.reasoning || 0,
                tokensCacheRead: event.tokens?.cache?.read || 0,
                tokensCacheWrite: event.tokens?.cache?.write || 0,
                costUsd: event.cost || 0,
                durationMs: event.durationMs,
                finishReason: event.finishReason,
                workingDir: event.workingDir,
                createdAt: createdAt,
                completedAt: event.completedAt ? new Date(event.completedAt) : null
            });

            await db.insert(dailySummary).values({
                date: dateStr,
                providerId: event.providerId || 'unknown',
                modelId: event.modelId || 'unknown',
                requestCount: 1,
                tokensInput: event.tokens?.input || 0,
                tokensOutput: event.tokens?.output || 0,
                tokensReasoning: event.tokens?.reasoning || 0,
                tokensCacheRead: event.tokens?.cache?.read || 0,
                tokensCacheWrite: event.tokens?.cache?.write || 0,
                costUsd: event.cost || 0
            }).onConflictDoUpdate({
                target: [dailySummary.date, dailySummary.providerId, dailySummary.modelId],
                set: {
                    requestCount: sql`${dailySummary.requestCount} + 1`,
                    tokensInput: sql`${dailySummary.tokensInput} + ${event.tokens?.input || 0}`,
                    tokensOutput: sql`${dailySummary.tokensOutput} + ${event.tokens?.output || 0}`,
                    tokensReasoning: sql`${dailySummary.tokensReasoning} + ${event.tokens?.reasoning || 0}`,
                    tokensCacheRead: sql`${dailySummary.tokensCacheRead} + ${event.tokens?.cache?.read || 0}`,
                    tokensCacheWrite: sql`${dailySummary.tokensCacheWrite} + ${event.tokens?.cache?.write || 0}`,
                    costUsd: sql`${dailySummary.costUsd} + ${event.cost || 0}`
                }
            });

            const tokensIn = event.tokens?.input || 0;
            const tokensOut = event.tokens?.output || 0;
            const costUsd = event.cost || 0;
            
            await db.insert(sessions).values({
                sessionId: event.sessionId,
                projectDir: event.workingDir || null,
                title: event.sessionTitle || null,
                firstRequestAt: createdAt,
                lastRequestAt: createdAt,
                totalRequests: 1,
                totalCostUsd: costUsd,
                totalTokensInput: tokensIn,
                totalTokensOutput: tokensOut
            }).onConflictDoUpdate({
                target: [sessions.sessionId],
                set: {
                    projectDir: sql`COALESCE(${event.workingDir || null}, ${sessions.projectDir})`,
                    title: sql`COALESCE(${event.sessionTitle || null}, ${sessions.title})`,
                    lastRequestAt: createdAt,
                    totalRequests: sql`${sessions.totalRequests} + 1`,
                    totalCostUsd: sql`${sessions.totalCostUsd} + ${costUsd}`,
                    totalTokensInput: sql`${sessions.totalTokensInput} + ${tokensIn}`,
                    totalTokensOutput: sql`${sessions.totalTokensOutput} + ${tokensOut}`
                }
            });

            notify = true;
        }

        else if (type === 'prompt') {
            await db.insert(turns).values({
                sessionId: event.sessionId,
                userMessageId: event.messageId, 
                prompt: event.prompt,
                agent: event.agent,
                providerId: event.providerId,
                modelId: event.modelId,
                createdAt: new Date(event.createdAt)
            });

            // Auto-derive session title if missing
            if (event.prompt) {
                const derivedTitle = event.prompt.slice(0, 100).trim();
                if (derivedTitle) {
                    await db.update(sessions)
                        .set({ title: derivedTitle })
                        .where(and(
                            eq(sessions.sessionId, event.sessionId),
                            isNull(sessions.title)
                        ));
                }
            }
        }

        else if (type === 'tool.before') {
            const openTurn = await db
                .select({ id: turns.id })
                .from(turns)
                .where(and(eq(turns.sessionId, event.sessionId), isNull(turns.assistantMessageId)))
                .orderBy(desc(turns.createdAt))
                .limit(1);

            await db.insert(toolCalls).values({
                sessionId: event.sessionId,
                turnId: openTurn[0]?.id ?? null,
                callId: event.callId,
                tool: event.tool,
                args: event.args, 
                startedAt: new Date(event.createdAt)
            });
            notify = true;
        }

        else if (type === 'tool.after') {
            await db.update(toolCalls)
                .set({
                    output: event.output,
                    title: event.title,
                    metadata: event.metadata,
                    durationMs: event.durationMs,
                    success: event.success, 
                    errorMessage: event.success === true ? null : event.errorMessage ?? null,
                    completedAt: new Date(event.createdAt)
                })
                .where(sql`call_id = ${event.callId}`);
            notify = true;
        }

        else if (type === 'file.edit') {
            const openTurn = await db
                .select({ id: turns.id })
                .from(turns)
                .where(and(eq(turns.sessionId, event.sessionId), isNull(turns.assistantMessageId)))
                .orderBy(desc(turns.createdAt))
                .limit(1);

            await db.insert(fileEdits).values({
                sessionId: event.sessionId,
                turnId: openTurn[0]?.id ?? null,
                filePath: event.filePath,
                fileExtension: event.fileExtension,
                operation: event.operation,
                linesAdded: event.linesAdded,
                linesRemoved: event.linesRemoved,
                createdAt: new Date(event.createdAt)
            });
            notify = true;
        }

        else if (type === 'session') {
            await db.insert(sessions).values({
                sessionId: event.sessionId,
                projectDir: event.projectDir || null,
                title: event.title || null,
                firstRequestAt: event.createdAt ? new Date(event.createdAt) : null,
                lastRequestAt: event.createdAt ? new Date(event.createdAt) : null,
                totalRequests: 0,
                totalCostUsd: 0,
                totalTokensInput: 0,
                totalTokensOutput: 0
            }).onConflictDoUpdate({
                target: [sessions.sessionId],
                set: {
                    projectDir: sql`COALESCE(${event.projectDir || null}, ${sessions.projectDir})`,
                    title: sql`COALESCE(${event.title || null}, ${sessions.title})`
                }
            });
        }

        if (notify) {
            // Send minimal payload to trigger fetch in live.ts
            // This avoids PG NOTIFY 8000 byte limit
            await client.notify('live_event', JSON.stringify({
                type: event.type,
                id: event.messageId || event.callId, // Use appropriate ID
                sessionId: event.sessionId
            }));
        }

        return json({ success: true });
    } catch (e: any) {
        // Ignore duplicate key errors (already processed)
        const pgError = e.cause || e;
        if (pgError.code === '23505') {
            return json({ success: true, duplicate: true });
        }
        console.error('Ingest error:', e);
        return json({ success: false, error: String(e) }, { status: 500 });
    }
}
