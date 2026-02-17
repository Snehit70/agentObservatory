import { query } from '$app/server';
import { db } from '$lib/server/db';
import { resolveCostUsd, normalizeModelId, getModelDisplayName } from '$lib/server/model-pricing';
import { requests, dailySummary, toolCalls, fileEdits } from '$lib/db/schema';
import { desc, sql, sum, count, avg, isNotNull, and } from 'drizzle-orm';
import * as v from 'valibot';

// Totals query - aggregate stats
export const getTotals = query(async () => {
	const rows = await db
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
		.from(requests)
		.groupBy(requests.modelId, requests.providerId);

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
		cost_usd: number;
	}>();

	for (const r of rawMapped) {
		const key = r.normalized_model;
		const existing = aggregated.get(key);
		if (existing) {
			existing.request_count += r.request_count;
			existing.tokens_input += r.tokens_input;
			existing.tokens_output += r.tokens_output;
			existing.cost_usd += r.cost_usd;
		} else {
			aggregated.set(key, {
				model_id: r.normalized_model,
				display_name: r.display_name,
				request_count: r.request_count,
				tokens_input: r.tokens_input,
				tokens_output: r.tokens_output,
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

// File type summary (aggregated by extension)
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
		.groupBy(fileEdits.fileExtension)
		.orderBy(desc(count()));

	return result.map((r) => ({
		file_extension: r.file_extension,
		total_operations: Number(r.total_operations),
		edit_count: Number(r.edit_count ?? 0),
		write_count: Number(r.write_count ?? 0),
		read_count: Number(r.read_count ?? 0),
		total_lines_added: Number(r.total_lines_added ?? 0),
		total_lines_removed: Number(r.total_lines_removed ?? 0),
		net_lines: Number(r.total_lines_added ?? 0) - Number(r.total_lines_removed ?? 0)
	}));
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
