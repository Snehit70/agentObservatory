import { query } from '$app/server';
import { db } from '$lib/server/db';
import { resolveCostUsd, normalizeModelId, getModelDisplayName } from '$lib/server/model-pricing';
import { requests, dailySummary, toolCalls, fileEdits, turns } from '$lib/db/schema';
import { desc, sql, sum, count, avg, isNotNull, and, notInArray } from 'drizzle-orm';
import * as v from 'valibot';

export const getTotals = query(v.optional(v.number()), async (days?: number) => {
	const baseQuery = db
		.select({
			request_count: count(),
			tokens_input: sum(requests.tokensInput),
			tokens_output: sum(requests.tokensOutput),
			tokens_reasoning: sum(requests.tokensReasoning),
			tokens_cache_read: sum(requests.tokensCacheRead),
			tokens_cache_write: sum(requests.tokensCacheWrite),
			cost_usd: sum(requests.costUsd),
			provider_id: requests.providerId,
			model_id: requests.modelId
		})
		.from(requests);

	const filteredQuery =
		days != null
			? baseQuery.where(sql`${requests.createdAt} >= NOW() - make_interval(days => ${days})`)
			: baseQuery;

	const rows = await filteredQuery.groupBy(requests.modelId, requests.providerId);

	const totals = rows.reduce(
		(acc, row) => {
			const tokensInput = Number(row.tokens_input ?? 0);
			const tokensOutput = Number(row.tokens_output ?? 0);
			const tokensReasoning = Number(row.tokens_reasoning ?? 0);
			const tokensCacheRead = Number(row.tokens_cache_read ?? 0);
			const tokensCacheWrite = Number(row.tokens_cache_write ?? 0);
			const costUsd = Number(row.cost_usd ?? 0);
			const resolvedCost = resolveCostUsd({
				costUsd,
				providerId: row.provider_id,
				modelId: row.model_id,
				tokensInput,
				tokensOutput,
				tokensReasoning,
				tokensCacheRead,
				tokensCacheWrite
			});
			return {
				total_requests: acc.total_requests + Number(row.request_count ?? 0),
				total_input: acc.total_input + tokensInput,
				total_output: acc.total_output + tokensOutput,
				total_reasoning: acc.total_reasoning + tokensReasoning,
				total_cache_read: acc.total_cache_read + tokensCacheRead,
				total_cache_write: acc.total_cache_write + tokensCacheWrite,
				total_cost: acc.total_cost + resolvedCost
			};
		},
		{
			total_requests: 0,
			total_input: 0,
			total_output: 0,
			total_reasoning: 0,
			total_cache_read: 0,
			total_cache_write: 0,
			total_cost: 0
		}
	);

	return totals;
});

export const getLatencyStats = query(v.optional(v.number()), async (days?: number) => {
	const whereClause =
		days != null
			? and(
					isNotNull(requests.durationMs),
					sql`${requests.createdAt} >= NOW() - make_interval(days => ${days})`
				)
			: isNotNull(requests.durationMs);

	const [row] = await db
		.select({
			avg_ms: avg(requests.durationMs),
			p95_ms: sql<number>`percentile_cont(0.95) WITHIN GROUP (ORDER BY ${requests.durationMs})`,
			total: count()
		})
		.from(requests)
		.where(whereClause);

	return {
		avg_ms: Number(row?.avg_ms ?? 0),
		p95_ms: Number(row?.p95_ms ?? 0),
		total: Number(row?.total ?? 0)
	};
});


// Velocity stats - requests per active day/hour
export const getVelocity = query(async () => {
	const dailyCounts = await db
		.select({
			day: sql<string>`created_at::date`,
			req_count: count()
		})
		.from(requests)
		.groupBy(sql`created_at::date`);

	const activeDays = dailyCounts.length;
	const totalRequests = dailyCounts.reduce((sum, d) => sum + Number(d.req_count), 0);
	const requestsPerDay = activeDays > 0 ? Math.round((totalRequests / activeDays) * 10) / 10 : 0;
	const requestsPerHour = Math.round((requestsPerDay / 12) * 10) / 10;

	return {
		active_days: activeDays,
		total_days_span: activeDays,
		total_requests: totalRequests,
		requests_per_day: requestsPerDay,
		requests_per_hour: requestsPerHour
	};
});

// Cost by model query - aggregated by normalized model name
export const getCostByModel = query(v.optional(v.number()), async (days?: number) => {
	const baseQuery = db
		.select({
			model_id: requests.modelId,
			provider_id: requests.providerId,
			request_count: count(),
			tokens_input: sum(requests.tokensInput),
			tokens_output: sum(requests.tokensOutput),
			tokens_reasoning: sum(requests.tokensReasoning),
			tokens_cache_read: sum(requests.tokensCacheRead),
			tokens_cache_write: sum(requests.tokensCacheWrite),
			cost_usd: sum(requests.costUsd)
		})
		.from(requests);

	const filteredQuery =
		days != null
			? baseQuery.where(
					sql`${requests.createdAt} >= NOW() - make_interval(days => ${days})`
				)
			: baseQuery;

	const result = await filteredQuery.groupBy(requests.modelId, requests.providerId);

	// First compute costs per raw model
	const rawMapped = result.map((r) => ({
		model_id: r.model_id,
		normalized_model: normalizeModelId(r.model_id ?? ''),
		display_name: getModelDisplayName(r.model_id ?? ''),
		request_count: Number(r.request_count),
		tokens_input: Number(r.tokens_input ?? 0),
		tokens_output: Number(r.tokens_output ?? 0),
		tokens_reasoning: Number(r.tokens_reasoning ?? 0),
		tokens_cache_read: Number(r.tokens_cache_read ?? 0),
		tokens_cache_write: Number(r.tokens_cache_write ?? 0),
		cost_usd: resolveCostUsd({
			costUsd: Number(r.cost_usd ?? 0),
			providerId: r.provider_id,
			modelId: r.model_id,
			tokensInput: Number(r.tokens_input ?? 0),
			tokensOutput: Number(r.tokens_output ?? 0),
			tokensReasoning: Number(r.tokens_reasoning ?? 0),
			tokensCacheRead: Number(r.tokens_cache_read ?? 0),
			tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
		})
	}));

	// Aggregate by normalized model name
	const aggregated = new Map<string, {
		model_id: string;
		display_name: string;
		request_count: number;
		tokens_input: number;
		tokens_output: number;
		tokens_reasoning: number;
		tokens_cache_read: number;
		tokens_cache_write: number;
		cost_usd: number;
	}>();

	for (const r of rawMapped) {
		const key = r.normalized_model;
		const existing = aggregated.get(key);
		if (existing) {
			existing.request_count += r.request_count;
			existing.tokens_input += r.tokens_input;
			existing.tokens_output += r.tokens_output;
			existing.tokens_reasoning += r.tokens_reasoning;
			existing.tokens_cache_read += r.tokens_cache_read;
			existing.tokens_cache_write += r.tokens_cache_write;
			existing.cost_usd += r.cost_usd;
		} else {
			aggregated.set(key, {
				model_id: r.normalized_model,
				display_name: r.display_name,
				request_count: r.request_count,
				tokens_input: r.tokens_input,
				tokens_output: r.tokens_output,
				tokens_reasoning: r.tokens_reasoning,
				tokens_cache_read: r.tokens_cache_read,
				tokens_cache_write: r.tokens_cache_write,
				cost_usd: r.cost_usd
			});
		}
	}

	return Array.from(aggregated.values()).sort((a, b) => b.cost_usd - a.cost_usd);
});

// Cost over time (last 30 days)
export const getCostOverTime = query(async () => {
	const rows = await db
		.select({
			date: dailySummary.date,
			provider_id: dailySummary.providerId,
			model_id: dailySummary.modelId,
			request_count: dailySummary.requestCount,
			tokens_input: dailySummary.tokensInput,
			tokens_output: dailySummary.tokensOutput,
			tokens_reasoning: dailySummary.tokensReasoning,
			tokens_cache_read: dailySummary.tokensCacheRead,
			tokens_cache_write: dailySummary.tokensCacheWrite,
			cost_usd: dailySummary.costUsd
		})
		.from(dailySummary)
		.where(sql`${dailySummary.date}::date >= CURRENT_DATE - INTERVAL '30 days'`)
		.orderBy(dailySummary.date);

	const byDate = rows.reduce((map, row) => {
		const date = row.date;
		const tokensInput = Number(row.tokens_input ?? 0);
		const tokensOutput = Number(row.tokens_output ?? 0);
		const tokensReasoning = Number(row.tokens_reasoning ?? 0);
		const tokensCacheRead = Number(row.tokens_cache_read ?? 0);
		const tokensCacheWrite = Number(row.tokens_cache_write ?? 0);
		const costUsd = Number(row.cost_usd ?? 0);
		const resolvedCost = resolveCostUsd({
			costUsd,
			providerId: row.provider_id,
			modelId: row.model_id,
			tokensInput,
			tokensOutput,
			tokensReasoning,
			tokensCacheRead,
			tokensCacheWrite
		});
		const existing = map.get(date) ?? {
			date,
			request_count: 0,
			tokens_input: 0,
			tokens_output: 0,
			cost_usd: 0
		};
		existing.request_count += Number(row.request_count ?? 0);
		existing.tokens_input += tokensInput;
		existing.tokens_output += tokensOutput;
		existing.cost_usd += resolvedCost;
		map.set(date, existing);
		return map;
	}, new Map<string, { date: string; request_count: number; tokens_input: number; tokens_output: number; cost_usd: number }>());

	return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
});

export const getTokensData = query(v.number(), async (_tzOffsetMinutes: number) => {
	const tokensByHourToday = await db
		.select({
			hour: sql<number>`EXTRACT(HOUR FROM ${requests.createdAt} AT TIME ZONE 'Asia/Kolkata')::int`,
			tokens_input: sql<number>`COALESCE(SUM(${requests.tokensInput}), 0)`,
			tokens_output: sql<number>`COALESCE(SUM(${requests.tokensOutput}), 0)`
		})
		.from(requests)
		.where(
			sql`DATE(${requests.createdAt} AT TIME ZONE 'Asia/Kolkata') = DATE(NOW() AT TIME ZONE 'Asia/Kolkata')`
		)
		.groupBy(sql`EXTRACT(HOUR FROM ${requests.createdAt} AT TIME ZONE 'Asia/Kolkata')`)
		.orderBy(sql`EXTRACT(HOUR FROM ${requests.createdAt} AT TIME ZONE 'Asia/Kolkata')`);

	const tokensByDay = await db
		.select({
			date: dailySummary.date,
			tokens_input: sql<number>`COALESCE(SUM(${dailySummary.tokensInput}), 0)`,
			tokens_output: sql<number>`COALESCE(SUM(${dailySummary.tokensOutput}), 0)`
		})
		.from(dailySummary)
		.where(sql`${dailySummary.date}::date >= CURRENT_DATE - INTERVAL '365 days'`)
		.groupBy(dailySummary.date)
		.orderBy(dailySummary.date);

	return {
		hourly: tokensByHourToday.map((r) => ({
			hour: Number(r.hour),
			tokens_input: Number(r.tokens_input),
			tokens_output: Number(r.tokens_output)
		})),
		daily: tokensByDay.map((r) => ({
			date: r.date,
			tokens_input: Number(r.tokens_input),
			tokens_output: Number(r.tokens_output)
		}))
	};
});

// Agent breakdown
export const getAgentBreakdown = query(async () => {
	const rows = await db
		.select({
			agent: requests.agent,
			provider_id: requests.providerId,
			model_id: requests.modelId,
			tokens_input: requests.tokensInput,
			tokens_output: requests.tokensOutput,
			tokens_reasoning: requests.tokensReasoning,
			tokens_cache_read: requests.tokensCacheRead,
			tokens_cache_write: requests.tokensCacheWrite,
			cost_usd: requests.costUsd
		})
		.from(requests);

	const totals = rows.reduce((map, row) => {
		const agent = row.agent ?? 'unknown';
		const tokensInput = Number(row.tokens_input ?? 0);
		const tokensOutput = Number(row.tokens_output ?? 0);
		const tokensReasoning = Number(row.tokens_reasoning ?? 0);
		const tokensCacheRead = Number(row.tokens_cache_read ?? 0);
		const tokensCacheWrite = Number(row.tokens_cache_write ?? 0);
		const costUsd = Number(row.cost_usd ?? 0);
		const resolvedCost = resolveCostUsd({
			costUsd,
			providerId: row.provider_id,
			modelId: row.model_id,
			tokensInput,
			tokensOutput,
			tokensReasoning,
			tokensCacheRead,
			tokensCacheWrite
		});
		const existing = map.get(agent) ?? {
			agent,
			request_count: 0,
			tokens_input: 0,
			tokens_output: 0,
			cost_usd: 0
		};
		existing.request_count += 1;
		existing.tokens_input += tokensInput;
		existing.tokens_output += tokensOutput;
		existing.cost_usd += resolvedCost;
		map.set(agent, existing);
		return map;
	}, new Map<string, { agent: string; request_count: number; tokens_input: number; tokens_output: number; cost_usd: number }>());

	return Array.from(totals.values()).sort((a, b) => b.cost_usd - a.cost_usd);
});

// Model performance (avg duration) - aggregated by normalized model
export const getModelPerformance = query(v.optional(v.number()), async (days?: number) => {
	const whereClause =
		days != null
			? and(
					isNotNull(requests.durationMs),
					sql`${requests.createdAt} >= NOW() - make_interval(days => ${days})`
				)
			: isNotNull(requests.durationMs);

	const result = await db
		.select({
			model_id: requests.modelId,
			duration_ms: requests.durationMs,
		})
		.from(requests)
		.where(whereClause);

	// Aggregate by normalized model
	const aggregated = new Map<string, {
		model_id: string;
		display_name: string;
		total_duration: number;
		request_count: number;
	}>();

	for (const r of result) {
		const normalized = normalizeModelId(r.model_id ?? '');
		const displayName = getModelDisplayName(r.model_id ?? '');
		const duration = Number(r.duration_ms ?? 0);
		
		const existing = aggregated.get(normalized);
		if (existing) {
			existing.total_duration += duration;
			existing.request_count += 1;
		} else {
			aggregated.set(normalized, {
				model_id: normalized,
				display_name: displayName,
				total_duration: duration,
				request_count: 1
			});
		}
	}

	return Array.from(aggregated.values())
		.map(r => ({
			model_id: r.model_id,
			display_name: r.display_name,
			avg_duration_ms: r.request_count > 0 ? r.total_duration / r.request_count : 0,
			request_count: r.request_count
		}))
		.sort((a, b) => b.avg_duration_ms - a.avg_duration_ms);
});

// Recent requests
export const getRecentRequests = query(async () => {
	const result = await db
		.select({
			id: requests.id,
			model_id: requests.modelId,
			provider_id: requests.providerId,
			tokens_input: requests.tokensInput,
			tokens_output: requests.tokensOutput,
			tokens_cache_read: requests.tokensCacheRead,
			tokens_cache_write: requests.tokensCacheWrite,
			cost_usd: requests.costUsd,
			created_at: requests.createdAt
		})
		.from(requests)
		.orderBy(desc(requests.createdAt))
		.limit(100);

	return result.map((r) => ({
		id: r.id,
		model_id: r.model_id,
		display_name: getModelDisplayName(r.model_id ?? ''),
		tokens_input: Number(r.tokens_input ?? 0),
		tokens_output: Number(r.tokens_output ?? 0),
		tokens_cache_read: Number(r.tokens_cache_read ?? 0),
		tokens_cache_write: Number(r.tokens_cache_write ?? 0),
		cost_usd: resolveCostUsd({
			costUsd: Number(r.cost_usd ?? 0),
			providerId: r.provider_id,
			modelId: r.model_id,
			tokensInput: Number(r.tokens_input ?? 0),
			tokensOutput: Number(r.tokens_output ?? 0),
			tokensCacheRead: Number(r.tokens_cache_read ?? 0),
			tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
		}),
		created_at: r.created_at?.toISOString() ?? new Date().toISOString()
	}));
});

// Tool usage stats
export const getToolStats = query(async () => {
	const result = await db
		.select({
			tool: toolCalls.tool,
			call_count: count(),
			success_count: sql<number>`COUNT(*) FILTER (WHERE ${toolCalls.success} = true)`,
			failure_count: sql<number>`COUNT(*) FILTER (WHERE ${toolCalls.success} = false)`,
			avg_duration_ms: avg(toolCalls.durationMs),
			total_duration_ms: sum(toolCalls.durationMs)
		})
		.from(toolCalls)
		.where(isNotNull(toolCalls.completedAt))
		.groupBy(toolCalls.tool)
		.orderBy(desc(count()));

	return result.map((r) => ({
		tool: r.tool,
		call_count: Number(r.call_count),
		success_count: Number(r.success_count ?? 0),
		failure_count: Number(r.failure_count ?? 0),
		success_rate:
			Number(r.call_count) > 0 ? Number(r.success_count ?? 0) / Number(r.call_count) : 0,
		avg_duration_ms: Number(r.avg_duration_ms ?? 0),
		total_duration_ms: Number(r.total_duration_ms ?? 0)
	}));
});

// Tool stats over time (last 30 days)
export const getToolStatsOverTime = query(async () => {
	const result = await db
		.select({
			date: sql<string>`DATE(${toolCalls.startedAt})::text`,
			tool: toolCalls.tool,
			call_count: count(),
			success_count: sql<number>`COUNT(*) FILTER (WHERE ${toolCalls.success} = true)`,
			failure_count: sql<number>`COUNT(*) FILTER (WHERE ${toolCalls.success} = false)`,
			avg_duration_ms: avg(toolCalls.durationMs)
		})
		.from(toolCalls)
		.where(sql`${toolCalls.startedAt} >= CURRENT_DATE - INTERVAL '30 days'`)
		.groupBy(sql`DATE(${toolCalls.startedAt})`, toolCalls.tool)
		.orderBy(sql`DATE(${toolCalls.startedAt})`);

	return result.map((r) => ({
		date: r.date,
		tool: r.tool,
		call_count: Number(r.call_count),
		success_count: Number(r.success_count ?? 0),
		failure_count: Number(r.failure_count ?? 0),
		avg_duration_ms: Number(r.avg_duration_ms ?? 0)
	}));
});

export const getToolSuccessSummary = query(v.optional(v.number()), async (days?: number) => {
	const whereClause =
		days != null
			? and(
					isNotNull(toolCalls.completedAt),
					sql`${toolCalls.startedAt} >= NOW() - make_interval(days => ${days})`
				)
			: isNotNull(toolCalls.completedAt);

	const [row] = await db
		.select({
			total: count(),
			success_count: sql<number>`COUNT(*) FILTER (WHERE ${toolCalls.success} = true)`,
			failure_count: sql<number>`COUNT(*) FILTER (WHERE ${toolCalls.success} = false)`
		})
		.from(toolCalls)
		.where(whereClause);

	const total = Number(row?.total ?? 0);
	const successCount = Number(row?.success_count ?? 0);
	const failureCount = Number(row?.failure_count ?? 0);
	const successRate = total > 0 ? successCount / total : 0;

	return {
		total,
		success_count: successCount,
		failure_count: failureCount,
		success_rate: successRate
	};
});

export const getBashCommandBreakdown = query(async () => {
	const rows = await db
		.select({
			args: toolCalls.args,
			success: toolCalls.success
		})
		.from(toolCalls)
		.where(sql`${toolCalls.tool} = 'bash' AND ${toolCalls.args} IS NOT NULL`);

	const categories: Record<string, { count: number; success: number; samples: string[] }> = {};

	for (const row of rows) {
		const args = row.args as { command?: string } | null;
		const command = args?.command ?? '';
		const { category, matched } = categorizeBashCommand(command);
		
		if (!categories[category]) {
			categories[category] = { count: 0, success: 0, samples: [] };
		}
		categories[category].count++;
		if (row.success) {
			categories[category].success++;
		}
		if (categories[category].samples.length < 3 && matched) {
			categories[category].samples.push(matched);
		}
	}

	const result = Object.entries(categories)
		.filter(([_, stats]) => stats.count > 0)
		.map(([category, stats]) => ({
			category,
			count: stats.count,
			success: stats.success,
			success_rate: stats.count > 0 ? stats.success / stats.count : 0,
			samples: stats.samples
		}))
		.sort((a, b) => {
			if (a.category === 'other') return 1;
			if (b.category === 'other') return -1;
			return b.count - a.count;
		});

	return result;
});

function categorizeBashCommand(command: string): { category: string; matched: string } {
	const cmd = command.trim().toLowerCase();
	const firstWord = cmd.split(' ')[0];
	
	if (cmd.startsWith('git ')) return { category: 'git', matched: cmd.split(' ').slice(0, 3).join(' ') };
	if (/^(gh|hub|gitlab)/.test(cmd)) return { category: 'cli', matched: firstWord };
	
	if (/^(npm|bun|yarn|pnpm)\s/.test(cmd)) return { category: 'package', matched: cmd.split(' ').slice(0, 3).join(' ') };
	if (/^(pip|uv|poetry|python\d?)\s/.test(cmd)) return { category: 'python', matched: cmd.split(' ').slice(0, 3).join(' ') };
	if (cmd.startsWith('cargo ')) return { category: 'rust', matched: firstWord };
	if (/^go\s/.test(cmd)) return { category: 'go', matched: firstWord };
	
	if (/^(mkdir|rm|cp|mv|touch|cat|ls|find|chmod|chown|head|tail|wc|sort|uniq|tree|xargs)/.test(cmd)) return { category: 'file', matched: firstWord };
	if (/^(tar|zip|unzip|gzip|gunzip|zcat)/.test(cmd)) return { category: 'archive', matched: firstWord };
	if (/^(grep|sed|awk|jq|rg|ag|yq|xmllint)/.test(cmd)) return { category: 'text', matched: firstWord };
	if (/^(echo|printf|export|source|cd|pwd|env|which|type|alias|set|unset|read)/.test(cmd)) return { category: 'shell', matched: firstWord };
	if (/^(ps|kill|killall|top|htop|bg|fg|jobs|nohup|nice|renice)/.test(cmd)) return { category: 'process', matched: firstWord };
	if (/^(curl|wget|http|ssh|scp|rsync|nc|netstat|ss|lsof|ping|dig|nslookup)/.test(cmd)) return { category: 'network', matched: firstWord };
	if (/^(docker|podman|kubectl|helm|docker-compose)/.test(cmd)) return { category: 'container', matched: firstWord };
	if (/^(aws|gcloud|az|terraform|ansible)/.test(cmd)) return { category: 'cloud', matched: firstWord };
	if (/^(make|cmake|gcc|g\+\+|clang|ninja|bazel)/.test(cmd)) return { category: 'build', matched: firstWord };
	if (/^(test|jest|vitest|pytest|mocha|cypress|playwright|karma)/.test(cmd)) return { category: 'test', matched: firstWord };
	if (/^(eslint|prettier|biome|tsc|typescript|ruff|black|isort|mypy)/.test(cmd)) return { category: 'lint', matched: firstWord };
	if (/^(node|deno|tsx|ts-node)\s/.test(cmd)) return { category: 'node', matched: firstWord };
	if (/^(psql|mysql|sqlite|redis-cli|mongo|mongosh|prisma|drizzle)/.test(cmd)) return { category: 'database', matched: firstWord };
	if (/^(nvm|fnm|pyenv|rbenv|jenv|sdkman)/.test(cmd)) return { category: 'version', matched: firstWord };
	if (/^(uname|hostname|whoami|id|date|cal|uptime|free|df|du|lsblk)/.test(cmd)) return { category: 'system', matched: firstWord };
	if (/^(fzf|fd|bat|exa|lsd|ripgrep|rg|delta|lazygit)/.test(cmd)) return { category: 'tools', matched: firstWord };
	if (/^(op|pass|sops|dotenv|direnv)/.test(cmd)) return { category: 'secrets', matched: firstWord };

	if (firstWord && firstWord.length > 0) {
		return { category: 'other', matched: firstWord };
	}
	return { category: 'other', matched: '' };
}

export const getPeakDays = query(async () => {
	const rows = await db
		.select({
			date: sql<string>`DATE(${requests.createdAt})::text`,
			cost_usd: sum(requests.costUsd),
			tokens_input: sum(requests.tokensInput),
			tokens_output: sum(requests.tokensOutput),
			tokens_reasoning: sum(requests.tokensReasoning),
			tokens_cache_read: sum(requests.tokensCacheRead),
			tokens_cache_write: sum(requests.tokensCacheWrite)
		})
		.from(requests)
		.groupBy(sql`DATE(${requests.createdAt})`);

	let peakCostDay: { date: string; cost_usd: number } | null = null;
	let peakTokenDay: { date: string; tokens: number } | null = null;

	for (const row of rows) {
		const costUsd = Number(row.cost_usd ?? 0);
		const tokens =
			Number(row.tokens_input ?? 0) +
			Number(row.tokens_output ?? 0) +
			Number(row.tokens_reasoning ?? 0) +
			Number(row.tokens_cache_read ?? 0) +
			Number(row.tokens_cache_write ?? 0);

		if (!peakCostDay || costUsd > peakCostDay.cost_usd) {
			peakCostDay = { date: row.date, cost_usd: costUsd };
		}
		if (!peakTokenDay || tokens > peakTokenDay.tokens) {
			peakTokenDay = { date: row.date, tokens };
		}
	}

	return { peak_cost_day: peakCostDay, peak_token_day: peakTokenDay };
});

export const getLiveMetrics = query(async () => {
	const topModelRows = await db
		.select({
			model_id: requests.modelId,
			request_count: count(),
			cost_usd: sum(requests.costUsd)
		})
		.from(requests)
		.where(sql`${requests.createdAt} >= NOW() - INTERVAL '10 minutes'`)
		.groupBy(requests.modelId)
		.orderBy(desc(sql`COALESCE(SUM(${requests.costUsd}), 0)`))
		.limit(1);

	const [errorRow] = await db
		.select({
			error_count: count()
		})
		.from(toolCalls)
		.where(
			and(
				sql`${toolCalls.completedAt} >= NOW() - INTERVAL '15 minutes'`,
				sql`${toolCalls.success} = false`
			)
		);

	const topModel = topModelRows[0]
		? {
				model_id: topModelRows[0].model_id,
				request_count: Number(topModelRows[0].request_count ?? 0),
				cost_usd: Number(topModelRows[0].cost_usd ?? 0)
			}
		: null;

	return {
		top_model: topModel,
		error_count: Number(errorRow?.error_count ?? 0)
	};
});

// File type stats (language breakdown)
export const getFileTypeStats = query(async () => {
	const result = await db
		.select({
			file_extension: fileEdits.fileExtension,
			operation: fileEdits.operation,
			file_count: count(),
			lines_added: sum(fileEdits.linesAdded),
			lines_removed: sum(fileEdits.linesRemoved)
		})
		.from(fileEdits)
		.where(isNotNull(fileEdits.fileExtension))
		.groupBy(fileEdits.fileExtension, fileEdits.operation)
		.orderBy(desc(count()));

	return result.map((r) => ({
		file_extension: r.file_extension,
		operation: r.operation,
		file_count: Number(r.file_count),
		lines_added: Number(r.lines_added ?? 0),
		lines_removed: Number(r.lines_removed ?? 0),
		net_lines: Number(r.lines_added ?? 0) - Number(r.lines_removed ?? 0)
	}));
});

export const getFileTypeSummary = query(async () => {
	const result = await db
		.select({
			file_extension: fileEdits.fileExtension,
			total_operations: count(),
			edit_count: sql<number>`COUNT(*) FILTER (WHERE ${fileEdits.operation} = 'edit')`,
			write_count: sql<number>`COUNT(*) FILTER (WHERE ${fileEdits.operation} = 'write')`,
			read_count: sql<number>`COUNT(*) FILTER (WHERE ${fileEdits.operation} = 'read')`,
			total_lines_added: sum(fileEdits.linesAdded),
			total_lines_removed: sum(fileEdits.linesRemoved)
		})
		.from(fileEdits)
		.where(isNotNull(fileEdits.fileExtension))
		.groupBy(fileEdits.fileExtension);

	const aggregated = result.reduce((map, r) => {
		const ext = (r.file_extension ?? '')
			.replace(/^\./, '')
			.toLowerCase()
			.trim();
		if (!ext) return map;

		const existing = map.get(ext);
		if (existing) {
			existing.total_operations += Number(r.total_operations);
			existing.edit_count += Number(r.edit_count ?? 0);
			existing.write_count += Number(r.write_count ?? 0);
			existing.read_count += Number(r.read_count ?? 0);
			existing.total_lines_added += Number(r.total_lines_added ?? 0);
			existing.total_lines_removed += Number(r.total_lines_removed ?? 0);
		} else {
			map.set(ext, {
				file_extension: ext,
				total_operations: Number(r.total_operations),
				edit_count: Number(r.edit_count ?? 0),
				write_count: Number(r.write_count ?? 0),
				read_count: Number(r.read_count ?? 0),
				total_lines_added: Number(r.total_lines_added ?? 0),
				total_lines_removed: Number(r.total_lines_removed ?? 0)
			});
		}
		return map;
	}, new Map<string, {
		file_extension: string;
		total_operations: number;
		edit_count: number;
		write_count: number;
		read_count: number;
		total_lines_added: number;
		total_lines_removed: number;
	}>());

	return Array.from(aggregated.values())
		.map((r) => ({
			...r,
			net_lines: r.total_lines_added - r.total_lines_removed
		}))
		.sort((a, b) => b.total_lines_added - a.total_lines_added);
});

// Cost trend - today vs N-day average
export const getCostTrend = query(v.optional(v.number()), async (days?: number) => {
	const lookbackDays = days ?? 7;
	const rows = await db
		.select({
			date: sql<string>`DATE(${requests.createdAt})::text`,
			provider_id: requests.providerId,
			model_id: requests.modelId,
			tokens_input: sum(requests.tokensInput),
			tokens_output: sum(requests.tokensOutput),
			tokens_reasoning: sum(requests.tokensReasoning),
			tokens_cache_read: sum(requests.tokensCacheRead),
			tokens_cache_write: sum(requests.tokensCacheWrite),
			cost_usd: sum(requests.costUsd)
		})
		.from(requests)
		.where(sql`DATE(${requests.createdAt}) >= CURRENT_DATE - make_interval(days => ${lookbackDays})`)
		.groupBy(sql`DATE(${requests.createdAt})`, requests.providerId, requests.modelId);

	const costByDate = new Map<string, number>();
	for (const row of rows) {
		const date = row.date;
		const tokensInput = Number(row.tokens_input ?? 0);
		const tokensOutput = Number(row.tokens_output ?? 0);
		const tokensReasoning = Number(row.tokens_reasoning ?? 0);
		const tokensCacheRead = Number(row.tokens_cache_read ?? 0);
		const tokensCacheWrite = Number(row.tokens_cache_write ?? 0);
		const costUsd = Number(row.cost_usd ?? 0);
		const resolvedCost = resolveCostUsd({
			costUsd,
			providerId: row.provider_id,
			modelId: row.model_id,
			tokensInput,
			tokensOutput,
			tokensReasoning,
			tokensCacheRead,
			tokensCacheWrite
		});
		costByDate.set(date, (costByDate.get(date) ?? 0) + resolvedCost);
	}

	const today = new Date().toISOString().split('T')[0];
	const todayCost = costByDate.get(today) ?? 0;
	let totalPastCost = 0;
	let pastDaysCount = 0;
	for (const [date, cost] of costByDate) {
		if (date !== today) {
			totalPastCost += cost;
			pastDaysCount++;
		}
	}
	const avgCost = pastDaysCount > 0 ? totalPastCost / pastDaysCount : 0;

	let trend: 'up' | 'down' | 'neutral' = 'neutral';
	let percentChange = 0;

	if (avgCost > 0) {
		percentChange = ((todayCost - avgCost) / avgCost) * 100;
		if (percentChange > 5) trend = 'up';
		else if (percentChange < -5) trend = 'down';
	}

	return {
		today_cost: todayCost,
		avg_7day_cost: avgCost,
		days_in_avg: pastDaysCount,
		trend,
		percent_change: percentChange
	};
});

export const getSessionStats = query(async () => {
	const sessionTimes = await db
		.select({
			session_id: requests.sessionId,
			first_request: sql<Date>`MIN(${requests.createdAt})`,
			last_request: sql<Date>`MAX(${requests.createdAt})`,
			request_count: count(),
			total_tokens: sql<number>`COALESCE(SUM(${requests.tokensInput}), 0) + COALESCE(SUM(${requests.tokensOutput}), 0)`
		})
		.from(requests)
		.groupBy(requests.sessionId);

	const MIN_TOKENS_THRESHOLD = 100;
	const MIN_DURATION_MS = 30000;

	const validSessions = sessionTimes.filter((s) => {
		const tokens = Number(s.total_tokens ?? 0);
		return tokens >= MIN_TOKENS_THRESHOLD;
	});

	const durations = validSessions.map((s) => {
		const first = s.first_request ? new Date(s.first_request).getTime() : 0;
		const last = s.last_request ? new Date(s.last_request).getTime() : 0;
		return last - first;
	});

	const meaningfulDurations = durations.filter((d) => d >= MIN_DURATION_MS);

	const totalSessions = validSessions.length;
	const avgDurationMs = meaningfulDurations.length > 0
		? meaningfulDurations.reduce((a, b) => a + b, 0) / meaningfulDurations.length
		: 0;
	const longestDurationMs = meaningfulDurations.length > 0 ? Math.max(...meaningfulDurations) : 0;

	const [sessionsPerDayRow] = await db
		.select({
			days: sql<number>`COUNT(DISTINCT DATE(${requests.createdAt}))`,
			sessions: sql<number>`COUNT(DISTINCT ${requests.sessionId})`
		})
		.from(requests);

	const days = Number(sessionsPerDayRow?.days ?? 1);
	const sessions = Number(sessionsPerDayRow?.sessions ?? 0);
	const sessionsPerDay = days > 0 ? sessions / days : 0;

	return {
		total_sessions: totalSessions,
		avg_duration_ms: avgDurationMs,
		longest_duration_ms: longestDurationMs,
		sessions_per_day: sessionsPerDay
	};
});

// Model diversity score (Shannon entropy)
export const getModelDiversity = query(async () => {
	const modelCounts = await db
		.select({
			model_id: requests.modelId,
			request_count: count()
		})
		.from(requests)
		.groupBy(requests.modelId);

	const total = modelCounts.reduce((sum, m) => sum + Number(m.request_count), 0);
	if (total === 0) return { entropy: 0, normalized_entropy: 0, model_count: 0 };

	// Shannon entropy: -sum(p * log2(p))
	let entropy = 0;
	for (const m of modelCounts) {
		const p = Number(m.request_count) / total;
		if (p > 0) {
			entropy -= p * Math.log2(p);
		}
	}

	// Normalized entropy (0-1 scale, where 1 = perfectly uniform)
	const maxEntropy = Math.log2(modelCounts.length);
	const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

	return {
		entropy,
		normalized_entropy: normalizedEntropy,
		model_count: modelCounts.length
	};
});

// Cost forecast - projected monthly cost based on recent rate
export const getCostForecast = query(v.optional(v.number()), async (lookbackDays?: number) => {
	const daysToLookBack = lookbackDays ?? 7;
	const recentRows = await db
		.select({
			provider_id: requests.providerId,
			model_id: requests.modelId,
			tokens_input: sum(requests.tokensInput),
			tokens_output: sum(requests.tokensOutput),
			tokens_reasoning: sum(requests.tokensReasoning),
			tokens_cache_read: sum(requests.tokensCacheRead),
			tokens_cache_write: sum(requests.tokensCacheWrite),
			cost_usd: sum(requests.costUsd)
		})
		.from(requests)
		.where(sql`${requests.createdAt} >= CURRENT_DATE - make_interval(days => ${daysToLookBack})`)
		.groupBy(requests.providerId, requests.modelId);

	let totalCost = 0;
	for (const row of recentRows) {
		const tokensInput = Number(row.tokens_input ?? 0);
		const tokensOutput = Number(row.tokens_output ?? 0);
		const tokensReasoning = Number(row.tokens_reasoning ?? 0);
		const tokensCacheRead = Number(row.tokens_cache_read ?? 0);
		const tokensCacheWrite = Number(row.tokens_cache_write ?? 0);
		const costUsd = Number(row.cost_usd ?? 0);
		totalCost += resolveCostUsd({
			costUsd,
			providerId: row.provider_id,
			modelId: row.model_id,
			tokensInput,
			tokensOutput,
			tokensReasoning,
			tokensCacheRead,
			tokensCacheWrite
		});
	}

	const days = recentRows.length > 0 ? daysToLookBack : 0;

	const mtdRows = await db
		.select({
			provider_id: requests.providerId,
			model_id: requests.modelId,
			tokens_input: sum(requests.tokensInput),
			tokens_output: sum(requests.tokensOutput),
			tokens_reasoning: sum(requests.tokensReasoning),
			tokens_cache_read: sum(requests.tokensCacheRead),
			tokens_cache_write: sum(requests.tokensCacheWrite),
			cost_usd: sum(requests.costUsd)
		})
		.from(requests)
		.where(sql`${requests.createdAt} >= DATE_TRUNC('month', CURRENT_DATE)`)
		.groupBy(requests.providerId, requests.modelId);

	let mtdCost = 0;
	for (const row of mtdRows) {
		const tokensInput = Number(row.tokens_input ?? 0);
		const tokensOutput = Number(row.tokens_output ?? 0);
		const tokensReasoning = Number(row.tokens_reasoning ?? 0);
		const tokensCacheRead = Number(row.tokens_cache_read ?? 0);
		const tokensCacheWrite = Number(row.tokens_cache_write ?? 0);
		const costUsd = Number(row.cost_usd ?? 0);
		mtdCost += resolveCostUsd({
			costUsd,
			providerId: row.provider_id,
			modelId: row.model_id,
			tokensInput,
			tokensOutput,
			tokensReasoning,
			tokensCacheRead,
			tokensCacheWrite
		});
	}

	const mtdDays = mtdRows.length > 0 ? new Date().getDate() : 0;

	const dailyRate = days > 0 ? totalCost / days : 0;
	const monthlyProjection = dailyRate * 30;
	const yearlyProjection = dailyRate * 365;

	const today = new Date();
	const daysRemainingInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();

	return {
		daily_rate: dailyRate,
		monthly_projection: monthlyProjection,
		yearly_projection: yearlyProjection,
		based_on_days: days,
		mtd_cost: mtdCost,
		mtd_days: mtdDays,
		days_remaining_in_month: daysRemainingInMonth
	};
});

// Busiest hour heatmap - requests by hour and day of week
export const getActivityHeatmap = query(async () => {
	const result = await db
		.select({
			day_of_week: sql<number>`EXTRACT(DOW FROM ${requests.createdAt})::int`,
			hour: sql<number>`EXTRACT(HOUR FROM ${requests.createdAt})::int`,
			request_count: count(),
			cost_usd: sum(requests.costUsd)
		})
		.from(requests)
		.groupBy(
			sql`EXTRACT(DOW FROM ${requests.createdAt})`,
			sql`EXTRACT(HOUR FROM ${requests.createdAt})`
		)
		.orderBy(
			sql`EXTRACT(DOW FROM ${requests.createdAt})`,
			sql`EXTRACT(HOUR FROM ${requests.createdAt})`
		);

	return result.map((r) => ({
		day_of_week: Number(r.day_of_week), // 0 = Sunday, 6 = Saturday
		hour: Number(r.hour),
		request_count: Number(r.request_count),
		cost_usd: Number(r.cost_usd ?? 0)
	}));
});

// Error rate by model
export const getErrorRateByModel = query(async () => {
	// Join requests with tool_calls to get error rates per model
	const result = await db
		.select({
			model_id: requests.modelId,
			total_requests: sql<number>`COUNT(DISTINCT ${requests.id})`,
			total_tool_calls: count(toolCalls.id),
			failed_tool_calls: sql<number>`COUNT(*) FILTER (WHERE ${toolCalls.success} = false)`
		})
		.from(requests)
		.leftJoin(toolCalls, sql`${requests.sessionId} = ${toolCalls.sessionId}`)
		.groupBy(requests.modelId)
		.orderBy(desc(sql`COUNT(*) FILTER (WHERE ${toolCalls.success} = false)`));

	return result.map((r) => {
		const totalCalls = Number(r.total_tool_calls ?? 0);
		const failedCalls = Number(r.failed_tool_calls ?? 0);
		return {
			model_id: r.model_id,
			display_name: getModelDisplayName(r.model_id ?? ''),
			total_requests: Number(r.total_requests ?? 0),
			total_tool_calls: totalCalls,
			failed_tool_calls: failedCalls,
			error_rate: totalCalls > 0 ? failedCalls / totalCalls : 0
		};
	});
});

// Avg tokens per request
export const getAvgTokensPerRequest = query(v.optional(v.number()), async (days?: number) => {
	const baseQuery = db
		.select({
			request_count: count(),
			total_input: sum(requests.tokensInput),
			total_output: sum(requests.tokensOutput),
			total_reasoning: sum(requests.tokensReasoning),
			total_cache_read: sum(requests.tokensCacheRead),
			total_cache_write: sum(requests.tokensCacheWrite)
		})
		.from(requests);

	const filteredQuery =
		days != null
			? baseQuery.where(sql`${requests.createdAt} >= NOW() - make_interval(days => ${days})`)
			: baseQuery;

	const [row] = await filteredQuery;

	const requestCount = Number(row?.request_count ?? 0);
	const totalInput = Number(row?.total_input ?? 0);
	const totalOutput = Number(row?.total_output ?? 0);
	const totalReasoning = Number(row?.total_reasoning ?? 0);
	const totalCacheRead = Number(row?.total_cache_read ?? 0);
	const totalCacheWrite = Number(row?.total_cache_write ?? 0);

	return {
		request_count: requestCount,
		avg_input: requestCount > 0 ? totalInput / requestCount : 0,
		avg_output: requestCount > 0 ? totalOutput / requestCount : 0,
		avg_reasoning: requestCount > 0 ? totalReasoning / requestCount : 0,
		avg_cache_read: requestCount > 0 ? totalCacheRead / requestCount : 0,
		avg_cache_write: requestCount > 0 ? totalCacheWrite / requestCount : 0,
		avg_total: requestCount > 0 ? (totalInput + totalOutput + totalReasoning + totalCacheRead + totalCacheWrite) / requestCount : 0
	};
});

// Coding streak - consecutive days with activity
export const getCodingStreak = query(async () => {
	// Get all distinct dates with activity
	const activeDates = await db
		.select({
			date: sql<string>`DATE(${requests.createdAt})::text`
		})
		.from(requests)
		.groupBy(sql`DATE(${requests.createdAt})`)
		.orderBy(desc(sql`DATE(${requests.createdAt})`));

	if (activeDates.length === 0) {
		return { current_streak: 0, longest_streak: 0, total_active_days: 0 };
	}

	const dates = activeDates.map((d) => new Date(d.date));
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Calculate current streak (must include today or yesterday)
	let currentStreak = 0;
	const mostRecentDate = dates[0];
	mostRecentDate.setHours(0, 0, 0, 0);

	const daysSinceLastActivity = Math.floor((today.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24));

	if (daysSinceLastActivity <= 1) {
		// Streak is active
		currentStreak = 1;
		for (let i = 1; i < dates.length; i++) {
			const prevDate = dates[i - 1];
			const currDate = dates[i];
			prevDate.setHours(0, 0, 0, 0);
			currDate.setHours(0, 0, 0, 0);
			const diff = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
			if (diff === 1) {
				currentStreak++;
			} else {
				break;
			}
		}
	}

	// Calculate longest streak
	let longestStreak = 1;
	let tempStreak = 1;
	for (let i = 1; i < dates.length; i++) {
		const prevDate = dates[i - 1];
		const currDate = dates[i];
		prevDate.setHours(0, 0, 0, 0);
		currDate.setHours(0, 0, 0, 0);
		const diff = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
		if (diff === 1) {
			tempStreak++;
			longestStreak = Math.max(longestStreak, tempStreak);
		} else {
			tempStreak = 1;
		}
	}

	return {
		current_streak: currentStreak,
		longest_streak: longestStreak,
		total_active_days: dates.length
	};
});

// File type stats over time
export const getFileTypeStatsOverTime = query(async () => {
	const result = await db
		.select({
			date: sql<string>`DATE(${fileEdits.createdAt})::text`,
			file_extension: fileEdits.fileExtension,
			file_count: count(),
			lines_added: sum(fileEdits.linesAdded),
			lines_removed: sum(fileEdits.linesRemoved)
		})
		.from(fileEdits)
		.where(
			sql`${fileEdits.createdAt} >= CURRENT_DATE - INTERVAL '30 days' AND ${fileEdits.fileExtension} IS NOT NULL`
		)
		.groupBy(sql`DATE(${fileEdits.createdAt})`, fileEdits.fileExtension)
		.orderBy(sql`DATE(${fileEdits.createdAt})`);

	return result.map((r) => ({
		date: r.date,
		file_extension: r.file_extension,
		file_count: Number(r.file_count),
		lines_added: Number(r.lines_added ?? 0),
		lines_removed: Number(r.lines_removed ?? 0)
	}));
});

// Cache Hit Rate - percentage of tokens served from cache
export const getCacheHitRate = query(v.optional(v.number()), async (days?: number) => {
	const baseQuery = db
		.select({
			total_input: sum(requests.tokensInput),
			total_cache_read: sum(requests.tokensCacheRead),
			total_cache_write: sum(requests.tokensCacheWrite)
		})
		.from(requests);

	const filteredQuery =
		days != null
			? baseQuery.where(sql`${requests.createdAt} >= NOW() - make_interval(days => ${days})`)
			: baseQuery;

	const [row] = await filteredQuery;

	const tokensInput = Number(row?.total_input ?? 0);
	const tokensCacheRead = Number(row?.total_cache_read ?? 0);
	const tokensCacheWrite = Number(row?.total_cache_write ?? 0);

	const totalWithCache = tokensInput + tokensCacheRead;
	const hitRate = totalWithCache > 0 ? tokensCacheRead / totalWithCache : 0;

	const totalTokens = totalWithCache + tokensCacheWrite;
	const cacheEfficiency = totalTokens > 0 ? (tokensCacheRead + tokensCacheWrite) / totalTokens : 0;

	return {
		cache_hit_rate: hitRate,
		cache_efficiency: cacheEfficiency,
		tokens_input: tokensInput,
		tokens_cache_read: tokensCacheRead,
		tokens_cache_write: tokensCacheWrite,
		total_tokens: totalWithCache
	};
});

export const getSessionDepthStats = query(async () => {
	const allTurnsBySession = await db
		.select({
			session_id: turns.sessionId,
			agent: turns.agent,
			turn_count: count()
		})
		.from(turns)
		.groupBy(turns.sessionId, turns.agent);

	const backgroundAgents = new Set(['explore', 'librarian', 'multimodal-looker', 'sisyphus-junior']);
	
	const sessionMap = new Map<string, number>();
	
	for (const row of allTurnsBySession) {
		if (row.agent && backgroundAgents.has(row.agent)) {
			continue;
		}
		const current = sessionMap.get(row.session_id) || 0;
		sessionMap.set(row.session_id, current + Number(row.turn_count));
	}
	
	const turnCounts = Array.from(sessionMap.values())
		.filter(count => count > 0)
		.sort((a, b) => a - b);
	
	if (turnCounts.length === 0) {
		return {
			total_sessions: 0,
			total_turns: 0,
			avg_turns: 0,
			median_turns: 0,
			max_turns: 0,
			min_turns: 0,
			single_turn_count: 0,
			single_turn_percent: 0,
			distribution: []
		};
	}

	const totalTurns = turnCounts.reduce((a, b) => a + b, 0);
	const avgTurns = totalTurns / turnCounts.length;
	const medianTurns = turnCounts[Math.floor(turnCounts.length / 2)];
	const maxTurns = turnCounts[turnCounts.length - 1];
	const minTurns = turnCounts[0];
	const singleTurnCount = turnCounts.filter(c => c === 1).length;

	const buckets = [
		{ label: '1', min: 1, max: 1 },
		{ label: '2-3', min: 2, max: 3 },
		{ label: '4-5', min: 4, max: 5 },
		{ label: '6-10', min: 6, max: 10 },
		{ label: '11-20', min: 11, max: 20 },
		{ label: '21-30', min: 21, max: 30 },
		{ label: '31-50', min: 31, max: 50 },
		{ label: '51+', min: 51, max: Infinity }
	];

	const distribution = buckets.map(bucket => {
		const count = turnCounts.filter(c => c >= bucket.min && c <= bucket.max).length;
		return {
			label: bucket.label,
			count,
			percent: turnCounts.length > 0 ? count / turnCounts.length : 0
		};
	});

	return {
		total_sessions: turnCounts.length,
		total_turns: totalTurns,
		avg_turns: Math.round(avgTurns * 10) / 10,
		median_turns: medianTurns,
		max_turns: maxTurns,
		min_turns: minTurns,
		single_turn_count: singleTurnCount,
		single_turn_percent: turnCounts.length > 0 ? singleTurnCount / turnCounts.length : 0,
		distribution
	};
});

type TimeRange = 'day' | 'week' | 'month' | 'all';

type TimeDataPoint = {
	label: string;
	cost_usd: number;
	tokens_input: number;
	tokens_output: number;
	tokens_reasoning: number;
	tokens_cache_read: number;
	tokens_cache_write: number;
};

const timeRangeSchema = v.union([
	v.literal('day'),
	v.literal('week'),
	v.literal('month'),
	v.literal('all')
]);

export const getTimeExplorerData = query(timeRangeSchema, async (range: TimeRange) => {
	if (range === 'day') {
		const rows = await db
			.select({
				hour: sql<number>`EXTRACT(HOUR FROM ${requests.createdAt} AT TIME ZONE 'Asia/Kolkata')::int`,
				tokens_input: sum(requests.tokensInput),
				tokens_output: sum(requests.tokensOutput),
				tokens_reasoning: sum(requests.tokensReasoning),
				tokens_cache_read: sum(requests.tokensCacheRead),
				tokens_cache_write: sum(requests.tokensCacheWrite),
				cost_usd: sum(requests.costUsd),
				provider_id: requests.providerId,
				model_id: requests.modelId
			})
			.from(requests)
			.where(sql`${requests.createdAt} >= NOW() - INTERVAL '24 hours'`)
			.groupBy(sql`EXTRACT(HOUR FROM ${requests.createdAt} AT TIME ZONE 'Asia/Kolkata')`, requests.providerId, requests.modelId);

		const hourMap = new Map<number, TimeDataPoint>();
		for (const r of rows) {
			const h = Number(r.hour);
			const existing = hourMap.get(h) ?? {
				label: `${String(h).padStart(2, '0')}:00`,
				cost_usd: 0,
				tokens_input: 0,
				tokens_output: 0,
				tokens_reasoning: 0,
				tokens_cache_read: 0,
				tokens_cache_write: 0
			};
			existing.tokens_input += Number(r.tokens_input ?? 0);
			existing.tokens_output += Number(r.tokens_output ?? 0);
			existing.tokens_reasoning += Number(r.tokens_reasoning ?? 0);
			existing.tokens_cache_read += Number(r.tokens_cache_read ?? 0);
			existing.tokens_cache_write += Number(r.tokens_cache_write ?? 0);
			existing.cost_usd += resolveCostUsd({
				costUsd: Number(r.cost_usd ?? 0),
				providerId: r.provider_id,
				modelId: r.model_id,
				tokensInput: Number(r.tokens_input ?? 0),
				tokensOutput: Number(r.tokens_output ?? 0),
				tokensReasoning: Number(r.tokens_reasoning ?? 0),
				tokensCacheRead: Number(r.tokens_cache_read ?? 0),
				tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
			});
			hourMap.set(h, existing);
		}

		const currentHour = new Date().getHours();
		const result: TimeDataPoint[] = [];
		for (let i = 0; i < 24; i++) {
			const h = (currentHour - 23 + i + 24) % 24;
			const entry = hourMap.get(h);
			result.push(entry ?? {
				label: `${String(h).padStart(2, '0')}:00`,
				cost_usd: 0,
				tokens_input: 0,
				tokens_output: 0,
				tokens_reasoning: 0,
				tokens_cache_read: 0,
				tokens_cache_write: 0
			});
		}
		return result;
	}

	if (range === 'week') {
		const dailyRows = await db
			.select({
				date: dailySummary.date,
				provider_id: dailySummary.providerId,
				model_id: dailySummary.modelId,
				tokens_input: sum(dailySummary.tokensInput),
				tokens_output: sum(dailySummary.tokensOutput),
				tokens_reasoning: sum(dailySummary.tokensReasoning),
				tokens_cache_read: sum(dailySummary.tokensCacheRead),
				tokens_cache_write: sum(dailySummary.tokensCacheWrite),
				cost_usd: sum(dailySummary.costUsd)
			})
			.from(dailySummary)
			.where(sql`${dailySummary.date}::date >= CURRENT_DATE - INTERVAL '7 days' AND ${dailySummary.date}::date < CURRENT_DATE`)
			.groupBy(dailySummary.date, dailySummary.providerId, dailySummary.modelId)
			.orderBy(dailySummary.date);

		const todayRows = await db
			.select({
				provider_id: requests.providerId,
				model_id: requests.modelId,
				tokens_input: sum(requests.tokensInput),
				tokens_output: sum(requests.tokensOutput),
				tokens_reasoning: sum(requests.tokensReasoning),
				tokens_cache_read: sum(requests.tokensCacheRead),
				tokens_cache_write: sum(requests.tokensCacheWrite),
				cost_usd: sum(requests.costUsd)
			})
			.from(requests)
			.where(sql`${requests.createdAt}::date = CURRENT_DATE`)
			.groupBy(requests.providerId, requests.modelId);

		const dateMap = new Map<string, { data: TimeDataPoint; date: Date }>();
		for (const r of dailyRows) {
			const existing = dateMap.get(r.date) ?? {
				data: {
					label: '',
					cost_usd: 0,
					tokens_input: 0,
					tokens_output: 0,
					tokens_reasoning: 0,
					tokens_cache_read: 0,
					tokens_cache_write: 0
				},
				date: new Date(0)
			};
			const [year, month, day] = r.date.split('-').map(Number);
			const date = new Date(year, month - 1, day);
			existing.date = date;
			existing.data.label = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
			existing.data.tokens_input += Number(r.tokens_input ?? 0);
			existing.data.tokens_output += Number(r.tokens_output ?? 0);
			existing.data.tokens_reasoning += Number(r.tokens_reasoning ?? 0);
			existing.data.tokens_cache_read += Number(r.tokens_cache_read ?? 0);
			existing.data.tokens_cache_write += Number(r.tokens_cache_write ?? 0);
			existing.data.cost_usd += resolveCostUsd({
				costUsd: Number(r.cost_usd ?? 0),
				providerId: r.provider_id,
				modelId: r.model_id,
				tokensInput: Number(r.tokens_input ?? 0),
				tokensOutput: Number(r.tokens_output ?? 0),
				tokensReasoning: Number(r.tokens_reasoning ?? 0),
				tokensCacheRead: Number(r.tokens_cache_read ?? 0),
				tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
			});
			dateMap.set(r.date, existing);
		}

		const today = new Date();
		const todayKey = today.toISOString().split('T')[0];
		const todayEntry = {
			data: {
				label: today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
				cost_usd: 0,
				tokens_input: 0,
				tokens_output: 0,
				tokens_reasoning: 0,
				tokens_cache_read: 0,
				tokens_cache_write: 0
			},
			date: today
		};
		for (const r of todayRows) {
			todayEntry.data.tokens_input += Number(r.tokens_input ?? 0);
			todayEntry.data.tokens_output += Number(r.tokens_output ?? 0);
			todayEntry.data.tokens_reasoning += Number(r.tokens_reasoning ?? 0);
			todayEntry.data.tokens_cache_read += Number(r.tokens_cache_read ?? 0);
			todayEntry.data.tokens_cache_write += Number(r.tokens_cache_write ?? 0);
			todayEntry.data.cost_usd += resolveCostUsd({
				costUsd: Number(r.cost_usd ?? 0),
				providerId: r.provider_id,
				modelId: r.model_id,
				tokensInput: Number(r.tokens_input ?? 0),
				tokensOutput: Number(r.tokens_output ?? 0),
				tokensReasoning: Number(r.tokens_reasoning ?? 0),
				tokensCacheRead: Number(r.tokens_cache_read ?? 0),
				tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
			});
		}
		dateMap.set(todayKey, todayEntry);

		return Array.from(dateMap.values())
			.sort((a, b) => a.date.getTime() - b.date.getTime())
			.map((d) => d.data);
	}

	if (range === 'month') {
		const dailyRows = await db
			.select({
				date: dailySummary.date,
				provider_id: dailySummary.providerId,
				model_id: dailySummary.modelId,
				tokens_input: sum(dailySummary.tokensInput),
				tokens_output: sum(dailySummary.tokensOutput),
				tokens_reasoning: sum(dailySummary.tokensReasoning),
				tokens_cache_read: sum(dailySummary.tokensCacheRead),
				tokens_cache_write: sum(dailySummary.tokensCacheWrite),
				cost_usd: sum(dailySummary.costUsd)
			})
			.from(dailySummary)
			.where(sql`${dailySummary.date}::date >= CURRENT_DATE - INTERVAL '28 days' AND ${dailySummary.date}::date < CURRENT_DATE`)
			.groupBy(dailySummary.date, dailySummary.providerId, dailySummary.modelId);

		const todayRows = await db
			.select({
				provider_id: requests.providerId,
				model_id: requests.modelId,
				tokens_input: sum(requests.tokensInput),
				tokens_output: sum(requests.tokensOutput),
				tokens_reasoning: sum(requests.tokensReasoning),
				tokens_cache_read: sum(requests.tokensCacheRead),
				tokens_cache_write: sum(requests.tokensCacheWrite),
				cost_usd: sum(requests.costUsd)
			})
			.from(requests)
			.where(sql`${requests.createdAt}::date = CURRENT_DATE`)
			.groupBy(requests.providerId, requests.modelId);

		const weekMap = new Map<string, { data: TimeDataPoint; date: Date }>();
		const today = new Date();

		for (let i = 0; i < 4; i++) {
			const weekEnd = new Date(today);
			weekEnd.setDate(today.getDate() - (i * 7));
			const weekEndStr = weekEnd.toISOString().split('T')[0];

			weekMap.set(weekEndStr, {
				data: {
					label: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
					cost_usd: 0,
					tokens_input: 0,
					tokens_output: 0,
					tokens_reasoning: 0,
					tokens_cache_read: 0,
					tokens_cache_write: 0
				},
				date: weekEnd
			});
		}

		for (const r of dailyRows) {
			const [year, month, day] = r.date.split('-').map(Number);
			const rowDate = new Date(year, month - 1, day);
			const daysDiff = Math.floor((today.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24));
			const weekIndex = Math.floor(daysDiff / 7);
			const weekEnd = new Date(today);
			weekEnd.setDate(today.getDate() - (weekIndex * 7));
			const weekKey = weekEnd.toISOString().split('T')[0];

			const existing = weekMap.get(weekKey);
			if (existing) {
				existing.data.tokens_input += Number(r.tokens_input ?? 0);
				existing.data.tokens_output += Number(r.tokens_output ?? 0);
				existing.data.tokens_reasoning += Number(r.tokens_reasoning ?? 0);
				existing.data.tokens_cache_read += Number(r.tokens_cache_read ?? 0);
				existing.data.tokens_cache_write += Number(r.tokens_cache_write ?? 0);
				existing.data.cost_usd += resolveCostUsd({
					costUsd: Number(r.cost_usd ?? 0),
					providerId: r.provider_id,
					modelId: r.model_id,
					tokensInput: Number(r.tokens_input ?? 0),
					tokensOutput: Number(r.tokens_output ?? 0),
					tokensReasoning: Number(r.tokens_reasoning ?? 0),
					tokensCacheRead: Number(r.tokens_cache_read ?? 0),
					tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
				});
			}
		}

		const todayKey = today.toISOString().split('T')[0];
		const todayEntry = weekMap.get(todayKey);
		if (todayEntry) {
			for (const r of todayRows) {
				todayEntry.data.tokens_input += Number(r.tokens_input ?? 0);
				todayEntry.data.tokens_output += Number(r.tokens_output ?? 0);
				todayEntry.data.tokens_reasoning += Number(r.tokens_reasoning ?? 0);
				todayEntry.data.tokens_cache_read += Number(r.tokens_cache_read ?? 0);
				todayEntry.data.tokens_cache_write += Number(r.tokens_cache_write ?? 0);
				todayEntry.data.cost_usd += resolveCostUsd({
					costUsd: Number(r.cost_usd ?? 0),
					providerId: r.provider_id,
					modelId: r.model_id,
					tokensInput: Number(r.tokens_input ?? 0),
					tokensOutput: Number(r.tokens_output ?? 0),
					tokensReasoning: Number(r.tokens_reasoning ?? 0),
					tokensCacheRead: Number(r.tokens_cache_read ?? 0),
					tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
				});
			}
		}

		return Array.from(weekMap.values())
			.sort((a, b) => a.date.getTime() - b.date.getTime())
			.map((d) => d.data);
	}

	// all - monthly aggregation, all time
	const monthRows = await db
		.select({
			month_start: sql<string>`DATE_TRUNC('month', ${dailySummary.date}::date)::text`,
			provider_id: dailySummary.providerId,
			model_id: dailySummary.modelId,
			tokens_input: sum(dailySummary.tokensInput),
			tokens_output: sum(dailySummary.tokensOutput),
			tokens_reasoning: sum(dailySummary.tokensReasoning),
			tokens_cache_read: sum(dailySummary.tokensCacheRead),
			tokens_cache_write: sum(dailySummary.tokensCacheWrite),
			cost_usd: sum(dailySummary.costUsd)
		})
		.from(dailySummary)
		.where(sql`${dailySummary.date}::date < DATE_TRUNC('month', CURRENT_DATE)`)
		.groupBy(sql`DATE_TRUNC('month', ${dailySummary.date}::date)`, dailySummary.providerId, dailySummary.modelId)
		.orderBy(sql`DATE_TRUNC('month', ${dailySummary.date}::date)`);

	const currentMonthRows = await db
		.select({
			provider_id: requests.providerId,
			model_id: requests.modelId,
			tokens_input: sum(requests.tokensInput),
			tokens_output: sum(requests.tokensOutput),
			tokens_reasoning: sum(requests.tokensReasoning),
			tokens_cache_read: sum(requests.tokensCacheRead),
			tokens_cache_write: sum(requests.tokensCacheWrite),
			cost_usd: sum(requests.costUsd)
		})
		.from(requests)
		.where(sql`${requests.createdAt} >= DATE_TRUNC('month', CURRENT_DATE)`)
		.groupBy(requests.providerId, requests.modelId);

	const monthMap = new Map<string, { data: TimeDataPoint; date: Date }>();
	for (const r of monthRows) {
		const existing = monthMap.get(r.month_start) ?? {
			data: {
				label: '',
				cost_usd: 0,
				tokens_input: 0,
				tokens_output: 0,
				tokens_reasoning: 0,
				tokens_cache_read: 0,
				tokens_cache_write: 0
			},
			date: new Date(0)
		};
		const datePart = r.month_start.split(' ')[0];
		const [year, month] = datePart.split('-').map(Number);
		const date = new Date(year, month - 1, 1);
		existing.date = date;
		existing.data.label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
		existing.data.tokens_input += Number(r.tokens_input ?? 0);
		existing.data.tokens_output += Number(r.tokens_output ?? 0);
		existing.data.tokens_reasoning += Number(r.tokens_reasoning ?? 0);
		existing.data.tokens_cache_read += Number(r.tokens_cache_read ?? 0);
		existing.data.tokens_cache_write += Number(r.tokens_cache_write ?? 0);
		existing.data.cost_usd += resolveCostUsd({
			costUsd: Number(r.cost_usd ?? 0),
			providerId: r.provider_id,
			modelId: r.model_id,
			tokensInput: Number(r.tokens_input ?? 0),
			tokensOutput: Number(r.tokens_output ?? 0),
			tokensReasoning: Number(r.tokens_reasoning ?? 0),
			tokensCacheRead: Number(r.tokens_cache_read ?? 0),
			tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
		});
		monthMap.set(r.month_start, existing);
	}

	const today = new Date();
	const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
	const todayMonthKey = todayMonth.toISOString().split('T')[0];
	const todayMonthEntry = monthMap.get(`${todayMonthKey} 00:00:00`) ?? {
		data: {
			label: todayMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
			cost_usd: 0,
			tokens_input: 0,
			tokens_output: 0,
			tokens_reasoning: 0,
			tokens_cache_read: 0,
			tokens_cache_write: 0
		},
		date: todayMonth
	};

	for (const r of currentMonthRows) {
		todayMonthEntry.data.tokens_input += Number(r.tokens_input ?? 0);
		todayMonthEntry.data.tokens_output += Number(r.tokens_output ?? 0);
		todayMonthEntry.data.tokens_reasoning += Number(r.tokens_reasoning ?? 0);
		todayMonthEntry.data.tokens_cache_read += Number(r.tokens_cache_read ?? 0);
		todayMonthEntry.data.tokens_cache_write += Number(r.tokens_cache_write ?? 0);
		todayMonthEntry.data.cost_usd += resolveCostUsd({
			costUsd: Number(r.cost_usd ?? 0),
			providerId: r.provider_id,
			modelId: r.model_id,
			tokensInput: Number(r.tokens_input ?? 0),
			tokensOutput: Number(r.tokens_output ?? 0),
			tokensReasoning: Number(r.tokens_reasoning ?? 0),
			tokensCacheRead: Number(r.tokens_cache_read ?? 0),
			tokensCacheWrite: Number(r.tokens_cache_write ?? 0)
		});
	}
	monthMap.set(`${todayMonthKey} 00:00:00`, todayMonthEntry);

	return Array.from(monthMap.values())
		.sort((a, b) => a.date.getTime() - b.date.getTime())
		.map((d) => d.data);
});
