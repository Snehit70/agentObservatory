import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import { createWorkerClient } from '../src/lib/server/postgres-client';

async function main() {
  const filePath = process.argv[2];
  const sessionId = process.argv[3];
  if (!filePath || !sessionId) {
    throw new Error('Usage: bun run scripts/backfill-codex-session.ts <jsonl-file> <session-id>');
  }

  const sql = createWorkerClient(process.env.DATABASE_URL!);
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  let model = 'gpt-5.4';
  let provider = 'openai';
  let cwd: string | null = null;
  let inserted = 0;
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;
  let sumInput = 0;
  let sumOutput = 0;
  let prevTotalInput = 0;
  let prevTotalCacheRead = 0;
  let prevTotalOutput = 0;
  let prevTotalReasoning = 0;
  let havePrevTotals = false;

  for (let i = 0; i < lines.length; i++) {
    const event = JSON.parse(lines[i]);

    if (event.type === 'session_meta' && event.payload) {
      model = String(event.payload.model || model).toLowerCase();
      provider = String(event.payload.model_provider || provider);
      cwd = typeof event.payload.cwd === 'string' && event.payload.cwd.length > 0 ? event.payload.cwd : cwd;
      continue;
    }

    if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;
    const info = event.payload?.info;
    const usage = info?.last_token_usage;
    const totals = info?.total_token_usage;
    if (!usage) continue;

    let rawInput = Number(usage.input_tokens ?? 0);
    let cacheRead = Number(usage.cached_input_tokens ?? 0);
    let output = Number(usage.output_tokens ?? 0);
    let reasoning = Number(usage.reasoning_output_tokens ?? 0);

    if (totals) {
      const totalInput = Number(totals.input_tokens ?? 0);
      const totalCacheRead = Number(totals.cached_input_tokens ?? 0);
      const totalOutput = Number(totals.output_tokens ?? 0);
      const totalReasoning = Number(totals.reasoning_output_tokens ?? 0);

      if (!havePrevTotals) {
        rawInput = totalInput;
        cacheRead = totalCacheRead;
        output = totalOutput;
        reasoning = totalReasoning;
        havePrevTotals = true;
      } else {
        rawInput = Math.max(0, totalInput - prevTotalInput);
        cacheRead = Math.max(0, totalCacheRead - prevTotalCacheRead);
        output = Math.max(0, totalOutput - prevTotalOutput);
        reasoning = Math.max(0, totalReasoning - prevTotalReasoning);
      }

      prevTotalInput = totalInput;
      prevTotalCacheRead = totalCacheRead;
      prevTotalOutput = totalOutput;
      prevTotalReasoning = totalReasoning;
    }
    if (rawInput === 0 && output === 0 && reasoning === 0) continue;

    const input = Math.max(0, rawInput - cacheRead);
    const ts = new Date(event.timestamp);
    const messageId = `codex-${sessionId}-evt-${i + 1}`;

    await sql`
      INSERT INTO requests (
        message_id,
        session_id,
        provider_id,
        model_id,
        agent,
        tokens_input,
        tokens_output,
        tokens_reasoning,
        tokens_cache_read,
        tokens_cache_write,
        cost_usd,
        duration_ms,
        finish_reason,
        working_dir,
        created_at,
        completed_at
      ) VALUES (
        ${messageId},
        ${sessionId},
        ${provider},
        ${model},
        ${'codex'},
        ${input},
        ${output},
        ${reasoning},
        ${cacheRead},
        ${0},
        ${0},
        ${null},
        ${'stop'},
        ${cwd},
        ${ts},
        ${ts}
      )
      ON CONFLICT (message_id) DO NOTHING
    `;

    if (!firstAt || ts < firstAt) firstAt = ts;
    if (!lastAt || ts > lastAt) lastAt = ts;
    sumInput += input;
    sumOutput += output;
    inserted++;
  }

  if (inserted > 0 && firstAt && lastAt) {
    await sql`
      INSERT INTO sessions (
        session_id,
        project_dir,
        title,
        first_request_at,
        last_request_at,
        total_requests,
        total_cost_usd,
        total_tokens_input,
        total_tokens_output
      ) VALUES (
        ${sessionId},
        ${cwd},
        ${null},
        ${firstAt},
        ${lastAt},
        ${inserted},
        ${0},
        ${sumInput},
        ${sumOutput}
      )
      ON CONFLICT (session_id) DO UPDATE SET
        project_dir = EXCLUDED.project_dir,
        first_request_at = EXCLUDED.first_request_at,
        last_request_at = EXCLUDED.last_request_at,
        total_requests = EXCLUDED.total_requests,
        total_tokens_input = EXCLUDED.total_tokens_input,
        total_tokens_output = EXCLUDED.total_tokens_output
    `;
  }

  console.log(`Inserted ${inserted} requests for ${sessionId}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
