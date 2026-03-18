import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql, sum } from 'drizzle-orm';
import { 
  pgTable, 
  text, 
  integer, 
  timestamp, 
  bigint,
  real
} from 'drizzle-orm/pg-core';

const { Pool } = pg;

const requests = pgTable('requests', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  modelId: text('model_id'),
  providerId: text('provider_id'),
  tokensInput: bigint('tokens_input', { mode: 'number' }),
  tokensOutput: bigint('tokens_output', { mode: 'number' }),
  tokensReasoning: bigint('tokens_reasoning', { mode: 'number' }),
  tokensCacheRead: bigint('tokens_cache_read', { mode: 'number' }),
  tokensCacheWrite: bigint('tokens_cache_write', { mode: 'number' }),
  costUsd: real('cost_usd'),
  durationMs: integer('duration_ms'),
  agent: text('agent'),
  createdAt: timestamp('created_at').defaultNow()
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const db = drizzle(pool);

// Get total input tokens
const [totals] = await db
  .select({
    total_input: sum(requests.tokensInput),
    total_cache_read: sum(requests.tokensCacheRead),
    total_cache_write: sum(requests.tokensCacheWrite),
    first_request: sql`MIN(${requests.createdAt})`,
    last_request: sql`MAX(${requests.createdAt})`
  })
  .from(requests);

// Get daily breakdown for trend analysis
const daily = await db
  .select({
    date: sql<string>`DATE(${requests.createdAt})::text`,
    tokens_input: sum(requests.tokensInput),
    tokens_cache_read: sum(requests.tokensCacheRead)
  })
  .from(requests)
  .groupBy(sql`DATE(${requests.createdAt})`)
  .orderBy(sql`DATE(${requests.createdAt})`);

console.log('=== TOTALS ===');
console.log(JSON.stringify(totals, null, 2));
console.log('=== DAILY (last 30 days) ===');
const recentDaily = daily.slice(-30);
console.log(JSON.stringify(recentDaily, null, 2));
console.log('=== ALL DAYS COUNT ===');
console.log(daily.length);

await pool.end();
process.exit(0);
