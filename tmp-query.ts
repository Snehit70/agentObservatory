import postgres from 'postgres';
const client = postgres(process.env.DATABASE_URL || 'postgres://postgres@localhost/opencode_dashboard');

const result = await client.unsafe(`
SELECT 
  t.model_id,
  COUNT(tc.id) as total_tool_calls,
  COUNT(*) FILTER (WHERE tc.success = false) as failed_calls,
  CASE 
    WHEN COUNT(tc.id) > 0 
    THEN (COUNT(*) FILTER (WHERE tc.success = false)::float / COUNT(tc.id) * 100)::numeric(5,1)
    ELSE 0 
  END as error_rate_pct,
  CASE 
    WHEN COUNT(tc.id) > 0 
    THEN (1.96 * SQRT((COUNT(*) FILTER (WHERE tc.success = false)::float / COUNT(tc.id) * (1 - COUNT(*) FILTER (WHERE tc.success = false)::float / COUNT(tc.id))) / COUNT(tc.id)) * 100)::numeric(5,1)
    ELSE 0 
  END as margin_of_error_pct
FROM turns t
LEFT JOIN tool_calls tc ON t.id = tc.turn_id
WHERE t.model_id IS NOT NULL
GROUP BY t.model_id
HAVING COUNT(tc.id) >= 385
ORDER BY error_rate_pct DESC
LIMIT 10
`);

console.table(result);
await client.end();
