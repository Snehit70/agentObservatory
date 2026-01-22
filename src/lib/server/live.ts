import { client, db } from '$lib/server/db';
import { requests, toolCalls } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

type LiveEvent = Record<string, unknown>;

type Subscriber = {
	controller: ReadableStreamDefaultController<Uint8Array>;
	keepAlive: ReturnType<typeof setInterval>;
};

const encoder = new TextEncoder();
const subscribers = new Set<Subscriber>();

// Listen for PG notifications
let listening = false;
async function ensureListening() {
    if (listening) return;
    listening = true;
    try {
        await client.listen('live_event', async (payload) => {
            try {
                const event = JSON.parse(payload);
                
                // If it's a notification with ID, fetch full data
                if (event.id && event.type) {
                    let fullEvent = event;
                    
                    if (event.type === 'request') {
                        const [row] = await db.select().from(requests).where(eq(requests.messageId, event.id));
                        if (row) {
                            fullEvent = {
                                type: 'request',
                                messageId: row.messageId,
                                sessionId: row.sessionId,
                                providerId: row.providerId,
                                modelId: row.modelId,
                                agent: row.agent,
                                tokens: {
                                    input: row.tokensInput,
                                    output: row.tokensOutput,
                                    reasoning: row.tokensReasoning,
                                    cache: { read: row.tokensCacheRead, write: row.tokensCacheWrite }
                                },
                                cost: row.costUsd,
                                durationMs: row.durationMs,
                                finishReason: row.finishReason,
                                workingDir: row.workingDir,
                                createdAt: row.createdAt.toISOString(),
                                completedAt: row.completedAt?.toISOString()
                            };
                        }
                    } else if (event.type === 'tool.before' || event.type === 'tool.after') {
                        const [row] = await db.select().from(toolCalls).where(eq(toolCalls.callId, event.id));
                        if (row) {
                            fullEvent = {
                                type: event.type,
                                sessionId: row.sessionId,
                                callId: row.callId,
                                tool: row.tool,
                                args: row.args,
                                output: row.output,
                                title: row.title,
                                metadata: row.metadata,
                                durationMs: row.durationMs,
                                success: row.success,
                                errorMessage: row.errorMessage,
                                createdAt: (row.completedAt || row.startedAt).toISOString()
                            };
                        }
                    }
                    // For file edits, we might have passed full payload if small, or need similar logic
                    
                    publishLiveEvent(fullEvent);
                } else {
                    // Fallback for full payloads (if small)
                    publishLiveEvent(event);
                }
            } catch (e) {
                console.error('Failed to parse or fetch live event:', e);
            }
        });
        console.log('Listening for live_event notifications...');
    } catch (e) {
        console.error('Failed to listen for live events:', e);
        listening = false;
        setTimeout(ensureListening, 5000);
    }
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, payload: string) {
	controller.enqueue(encoder.encode(payload));
}

export function publishLiveEvent(event: LiveEvent) {
	const payload = `data: ${JSON.stringify(event)}\n\n`;
	for (const sub of subscribers) {
		try {
			send(sub.controller, payload);
		} catch {
			// Ignore errors — stream will be cleaned up on cancel
		}
	}
}

export function createLiveStream(): ReadableStream<Uint8Array> {
	let subscriber: Subscriber | undefined;
    
    // Ensure we are listening to PG
    ensureListening();

	return new ReadableStream<Uint8Array>({
		start(controller) {
			// Initial comment line so proxies open the stream
			send(controller, ': connected\n\n');

			const keepAlive = setInterval(() => {
				try {
					send(controller, ': ping\n\n');
				} catch {
					// ignore
				}
			}, 15_000);

			subscriber = { controller, keepAlive };
			subscribers.add(subscriber);
		},
		cancel() {
			if (!subscriber) return;
			clearInterval(subscriber.keepAlive);
			subscribers.delete(subscriber);
			subscriber = undefined;
		}
	});
}
