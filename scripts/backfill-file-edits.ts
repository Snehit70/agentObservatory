import { drizzle } from 'drizzle-orm/postgres-js';
import { toolCalls, fileEdits } from '../src/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { createWorkerClient } from '../src/lib/server/postgres-client';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/opencode_dashboard';
const client = createWorkerClient(DATABASE_URL);
const db = drizzle(client);

const getExtension = (filePath: string): string | null => {
	const match = filePath.match(/(\.[^./\\]+)$/);
	return match ? match[1].toLowerCase() : null;
};

const countLines = (str: string | undefined): number => {
	if (!str) return 0;
	return str.split('\n').length;
};

async function backfill() {
	console.log('Fetching tool calls for read/edit/write...');

	const calls = await db
		.select({
			id: toolCalls.id,
			sessionId: toolCalls.sessionId,
			tool: toolCalls.tool,
			args: toolCalls.args,
			startedAt: toolCalls.startedAt,
			success: toolCalls.success
		})
		.from(toolCalls)
		.where(inArray(toolCalls.tool, ['read', 'edit', 'write']));

	console.log(`Found ${calls.length} file operation tool calls`);

	let inserted = 0;
	let skipped = 0;

	for (const call of calls) {
		const args = call.args as Record<string, unknown> | null;
		if (!args || !args.filePath) {
			skipped++;
			continue;
		}

		const filePath = args.filePath as string;
		const fileExtension = getExtension(filePath);
		const operation = call.tool;

		let linesAdded = 0;
		let linesRemoved = 0;

		if (operation === 'edit') {
			const oldString = args.oldString as string | undefined;
			const newString = args.newString as string | undefined;
			linesRemoved = countLines(oldString);
			linesAdded = countLines(newString);
		} else if (operation === 'write') {
			const content = args.content as string | undefined;
			linesAdded = countLines(content);
		}

		try {
			await db.insert(fileEdits).values({
				sessionId: call.sessionId,
				filePath,
				fileExtension,
				operation,
				linesAdded,
				linesRemoved,
				createdAt: call.startedAt
			});
			inserted++;
		} catch (e: any) {
			if (e.code === '23505') {
				skipped++;
			} else {
				console.error('Error inserting:', e.message);
			}
		}

		if (inserted % 500 === 0 && inserted > 0) {
			console.log(`Inserted ${inserted} records...`);
		}
	}

	console.log(`Done! Inserted: ${inserted}, Skipped: ${skipped}`);
	process.exit(0);
}

backfill().catch((e) => {
	console.error('Backfill failed:', e);
	process.exit(1);
});
