import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { join } from "path";
import { readdir } from "fs/promises";
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";
import { createWorkerClient } from "../src/lib/server/postgres-client";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres@localhost/opencode_dashboard";

const sessions = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  projectDir: text("project_dir"),
  title: text("title"),
  firstRequestAt: timestamp("first_request_at", { withTimezone: true }),
  lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
  totalRequests: integer("total_requests").default(0),
  totalCostUsd: doublePrecision("total_cost_usd").default(0),
  totalTokensInput: integer("total_tokens_input").default(0),
  totalTokensOutput: integer("total_tokens_output").default(0),
});

const client = createWorkerClient(DATABASE_URL);
const db = drizzle(client);

const OPENCODE_STORAGE_PATH = join(
  process.env.HOME || "",
  ".local/share/opencode/storage/session"
);

interface SessionData {
  id: string;
  title?: string;
  directory?: string;
}

async function* walkSessionFiles(): AsyncGenerator<SessionData> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(OPENCODE_STORAGE_PATH);
  } catch {
    console.error(`Cannot read ${OPENCODE_STORAGE_PATH}`);
    return;
  }

  for (const projectHash of projectDirs) {
    const projectPath = join(OPENCODE_STORAGE_PATH, projectHash);

    let sessionFiles: string[];
    try {
      sessionFiles = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const fileName of sessionFiles) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = join(projectPath, fileName);
      try {
        const file = Bun.file(filePath);
        const data: SessionData = await file.json();
        if (data.id && data.title) {
          yield data;
        }
      } catch {}
    }
  }
}

async function main() {
  console.log("Backfilling session titles from OpenCode storage...\n");

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for await (const sessionData of walkSessionFiles()) {
    const existing = await db
      .select({ sessionId: sessions.sessionId, title: sessions.title })
      .from(sessions)
      .where(eq(sessions.sessionId, sessionData.id))
      .limit(1);

    if (existing.length === 0) {
      notFound++;
      continue;
    }

    const currentTitle = existing[0].title;
    
    // We trust the file system title as the source of truth
    // unless the current title is exactly the same
    if (currentTitle === sessionData.title) {
      skipped++;
      continue;
    }

    await db
      .update(sessions)
      .set({ title: sessionData.title })
      .where(eq(sessions.sessionId, sessionData.id));

    console.log(`  ✓ ${sessionData.id.slice(0, 16)}… → "${sessionData.title}"`);
    updated++;
  }

  console.log(`\nDone.`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (already has title): ${skipped}`);
  console.log(`  Not in DB: ${notFound}`);

  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Error:", err);
  await client.end();
  process.exit(1);
});
