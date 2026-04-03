<script lang="ts">
	import { untrack } from 'svelte';
	import AreaChart from '$lib/components/AreaChart.svelte';
	import BarChart from '$lib/components/BarChart.svelte';
	import DonutChart from '$lib/components/DonutChart.svelte';
	import TokensChart from '$lib/components/TokensChart.svelte';
	import TimeExplorer from '$lib/components/TimeExplorer.svelte';
	import {
		getTotals,
		getCostByModel,
		getTimeExplorerData,
		getModelPerformance,
		getRecentRequests,
		getFileTypeSummary,
		getVelocity,
		getToolSuccessSummary,
		getPeakDays,
		getLatencyStats,
		getCostTrend,
		getSessionStats,
		getModelDiversity,
		getCostForecast,
		getActivityHeatmap,
		getErrorRateByModel,
		getAvgTokensPerRequest,
		getCodingStreak,
		getCacheHitRate,
		getToolStats,
		getBashCommandBreakdown,
		getSessionDepthStats,
		getLatencyOverTime
	} from '$lib/remote/stats.remote';
	import FileTypeChart from '$lib/components/FileTypeChart.svelte';
	import MultiLineChart from '$lib/components/MultiLineChart.svelte';

	// Types for our data
	type Totals = {
		total_requests: number;
		total_input: number;
		total_output: number;
		total_reasoning: number;
		total_cache_read: number;
		total_cache_write: number;
		total_cost: number;
	};
	type CostByModelItem = {
		model_id: string;
		display_name: string;
		request_count: number;
		tokens_input: number;
		tokens_output: number;
		tokens_reasoning: number;
		tokens_cache_read: number;
		tokens_cache_write: number;
		cost_usd: number;
	};
	type TimeRange = 'all' | 'day' | 'week' | 'month';
	type TimeExplorerRange = 'day' | 'week' | 'month' | 'all';
	type TimeExplorerDataPoint = {
		label: string;
		cost_usd: number;
		tokens_input: number;
		tokens_output: number;
		tokens_reasoning: number;
		tokens_cache_read: number;
		tokens_cache_write: number;
	};
	type ModelPerformanceItem = {
		model_id: string;
		display_name: string;
		avg_duration_ms: number;
		request_count: number;
	};
	type RecentRequestItem = {
		id: number;
		model_id: string;
		display_name: string;
		tokens_input: number;
		tokens_output: number;
		tokens_cache_read: number;
		tokens_cache_write: number;
		cost_usd: number;
		created_at: string;
	};
	type FileTypeSummaryItem = {
		file_extension: string | null;
		total_operations: number;
		edit_count: number;
		write_count: number;
		read_count: number;
		total_lines_added: number;
		total_lines_removed: number;
		net_lines: number;
	};
	type Velocity = {
		active_days: number;
		total_days_span: number;
		total_requests: number;
		requests_per_day: number;
		requests_per_hour: number;
	};
	type ToolSuccessSummary = {
		total: number;
		success_count: number;
		failure_count: number;
		success_rate: number;
	};
	type ToolStatsItem = {
		tool: string;
		call_count: number;
		success_count: number;
		failure_count: number;
		success_rate: number;
		avg_duration_ms: number;
		total_duration_ms: number;
	};
	type BashCommandBreakdown = {
		category: string;
		count: number;
		success: number;
		success_rate: number;
		samples: string[];
	};
	type SessionDepthStats = {
		total_sessions: number;
		total_turns: number;
		avg_turns: number;
		median_turns: number;
		max_turns: number;
		min_turns: number;
		single_turn_count: number;
		single_turn_percent: number;
		distribution: { label: string; count: number; percent: number }[];
	};
	type PeakDay = {
		date: string;
		cost_usd?: number;
		tokens?: number;
	};
	type PeakDays = {
		peak_cost_day: PeakDay | null;
		peak_token_day: PeakDay | null;
	};
	type LatencyStats = {
		avg_ms: number;
		p50_ms: number;
		p95_ms: number;
		total: number;
	};
	type CostTrend = {
		today_cost: number;
		avg_7day_cost: number;
		days_in_avg: number;
		trend: 'up' | 'down' | 'neutral';
		percent_change: number;
	};
	type SessionStats = {
		total_sessions: number;
		avg_duration_ms: number;
		longest_duration_ms: number;
		sessions_per_day: number;
	};
	type ModelDiversity = {
		entropy: number;
		normalized_entropy: number;
		model_count: number;
	};
	type CostForecast = {
		daily_rate: number;
		monthly_projection: number;
		yearly_projection: number;
		based_on_days: number;
		mtd_cost: number;
		mtd_days: number;
		days_remaining_in_month: number;
	};
	type ActivityHeatmapItem = {
		day_of_week: number;
		hour: number;
		request_count: number;
		cost_usd: number;
	};
	type ErrorRateByModelItem = {
		model_id: string;
		display_name: string;
		total_requests: number;
		total_tool_calls: number;
		failed_tool_calls: number;
		error_rate: number;
	};
	type AvgTokensPerRequest = {
		request_count: number;
		avg_input: number;
		avg_output: number;
		avg_reasoning: number;
		avg_cache_read: number;
		avg_cache_write: number;
		avg_total: number;
	};
	type CodingStreak = {
		current_streak: number;
		longest_streak: number;
		total_active_days: number;
	};
	type CacheHitRate = {
		cache_hit_rate: number;
		cache_efficiency: number;
		tokens_input: number;
		tokens_cache_read: number;
		tokens_cache_write: number;
		total_tokens: number;
	};

	// State for all data
	let totals = $state<Totals | null>(null);
	let costByModel = $state<CostByModelItem[] | null>(null);
	let modelsData = $state<CostByModelItem[] | null>(null);
	let modelViewMode = $state<'cost' | 'tokens'>('cost');
	let timeExplorerData = $state<TimeExplorerDataPoint[] | null>(null);
	let timeExplorerRange = $state<TimeExplorerRange>('week');
	let timeExplorerViewMode = $state<'cost' | 'tokens'>('cost');
	let modelPerformance = $state<ModelPerformanceItem[] | null>(null);
	let recentRequests = $state<RecentRequestItem[] | null>(null);
	let fileTypeSummary = $state<FileTypeSummaryItem[] | null>(null);
	let velocity = $state<Velocity | null>(null);
	let toolSuccessSummary = $state<ToolSuccessSummary | null>(null);
	let peakDays = $state<PeakDays | null>(null);
	let latencyStats = $state<LatencyStats | null>(null);
	let costTrend = $state<CostTrend | null>(null);
	let sessionStats = $state<SessionStats | null>(null);
	let modelDiversity = $state<ModelDiversity | null>(null);
	let costForecast = $state<CostForecast | null>(null);
	let activityHeatmap = $state<ActivityHeatmapItem[] | null>(null);
	let errorRateByModel = $state<ErrorRateByModelItem[] | null>(null);
	let avgTokensPerRequest = $state<AvgTokensPerRequest | null>(null);
	let codingStreak = $state<CodingStreak | null>(null);
	let cacheHitRate = $state<CacheHitRate | null>(null);
	let toolStats = $state<ToolStatsItem[] | null>(null);
	let bashBreakdown = $state<BashCommandBreakdown[] | null>(null);
	let sessionDepthStats = $state<SessionDepthStats | null>(null);
	let latencyOverTimeData = $state<{ date: string; avg_ms: number; p50_ms: number; p95_ms: number }[] | null>(null);
	let costByModelRange = $state<TimeRange>('all');
	let modelPerformanceRange = $state<TimeRange>('all');
	let costMetricsRange = $state<TimeRange>('all');
	let performanceMetricsRange = $state<TimeRange>('all');
	let latencyRange = $state<TimeRange>('month');

	// Loading states
	let totalsLoading = $state(true);
	let costByModelLoading = $state(true);
	let modelsDataLoading = $state(true);
	let timeExplorerLoading = $state(true);
	let modelPerformanceLoading = $state(true);
	let recentRequestsLoading = $state(true);
	let fileTypeSummaryLoading = $state(true);
	let velocityLoading = $state(true);
	let toolSuccessSummaryLoading = $state(true);
	let peakDaysLoading = $state(true);
	let latencyStatsLoading = $state(true);
	let latencyOverTimeLoading = $state(true);
	let costTrendLoading = $state(true);
	let sessionStatsLoading = $state(true);
	let modelDiversityLoading = $state(true);
	let costForecastLoading = $state(true);
	let activityHeatmapLoading = $state(true);
	let errorRateByModelLoading = $state(true);
	let avgTokensPerRequestLoading = $state(true);
	let codingStreakLoading = $state(true);
	let cacheHitRateLoading = $state(true);
	let toolStatsLoading = $state(true);
	let bashBreakdownLoading = $state(true);
	let sessionDepthLoading = $state(true);

	// Error states
	let totalsError = $state<Error | null>(null);
	let costByModelError = $state<Error | null>(null);
	let modelsDataError = $state<Error | null>(null);
	let timeExplorerError = $state<Error | null>(null);
	let modelPerformanceError = $state<Error | null>(null);
	let recentRequestsError = $state<Error | null>(null);
	let fileTypeSummaryError = $state<Error | null>(null);
	let velocityError = $state<Error | null>(null);
	let toolSuccessSummaryError = $state<Error | null>(null);
	let peakDaysError = $state<Error | null>(null);
	let latencyStatsError = $state<Error | null>(null);
	let latencyOverTimeError = $state<Error | null>(null);
	let costTrendError = $state<Error | null>(null);
	let sessionStatsError = $state<Error | null>(null);
	let modelDiversityError = $state<Error | null>(null);
	let costForecastError = $state<Error | null>(null);
	let activityHeatmapError = $state<Error | null>(null);
	let errorRateByModelError = $state<Error | null>(null);
	let avgTokensPerRequestError = $state<Error | null>(null);
	let codingStreakError = $state<Error | null>(null);
	let cacheHitRateError = $state<Error | null>(null);
	let toolStatsError = $state<Error | null>(null);
	let bashBreakdownError = $state<Error | null>(null);
	let sessionDepthError = $state<Error | null>(null);

	let currentTime = $state(new Date().toLocaleTimeString());

	type TabId = 'overview' | 'models' | 'activity' | 'code' | 'tools';
	let activeTab = $state<TabId>('overview');

	// Fetch functions
	async function fetchTotals() {
		totalsLoading = true;
		totalsError = null;
		try {
			const days =
				costMetricsRange === 'day'
					? 1
					: costMetricsRange === 'week'
						? 7
						: costMetricsRange === 'month'
							? 30
							: undefined;
			totals = await getTotals(days);
		} catch (e) {
			totalsError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			totalsLoading = false;
		}
	}

	async function fetchCostByModel() {
		costByModelLoading = true;
		costByModelError = null;
		try {
			const days =
				costByModelRange === 'day'
					? 1
					: costByModelRange === 'week'
						? 7
						: costByModelRange === 'month'
							? 30
							: undefined;
			costByModel = await getCostByModel(days);
		} catch (e) {
			costByModelError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			costByModelLoading = false;
		}
	}

	async function fetchModelsData() {
		modelsDataLoading = true;
		modelsDataError = null;
		try {
			const days =
				modelPerformanceRange === 'day'
					? 1
					: modelPerformanceRange === 'week'
						? 7
						: modelPerformanceRange === 'month'
							? 30
							: undefined;
			modelsData = await getCostByModel(days);
		} catch (e) {
			modelsDataError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			modelsDataLoading = false;
		}
	}

	async function fetchTimeExplorerData() {
		timeExplorerLoading = true;
		timeExplorerError = null;
		try {
			timeExplorerData = await getTimeExplorerData(timeExplorerRange);
		} catch (e) {
			timeExplorerError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			timeExplorerLoading = false;
		}
	}

	async function fetchModelPerformance() {
		modelPerformanceLoading = true;
		modelPerformanceError = null;
		try {
			const days =
				modelPerformanceRange === 'day'
					? 1
					: modelPerformanceRange === 'week'
						? 7
						: modelPerformanceRange === 'month'
							? 30
							: undefined;
			modelPerformance = await getModelPerformance(days);
		} catch (e) {
			modelPerformanceError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			modelPerformanceLoading = false;
		}
	}

	async function fetchRecentRequests() {
		recentRequestsLoading = true;
		recentRequestsError = null;
		try {
			recentRequests = await getRecentRequests();
		} catch (e) {
			recentRequestsError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			recentRequestsLoading = false;
		}
	}

	async function fetchFileTypeSummary() {
		fileTypeSummaryLoading = true;
		fileTypeSummaryError = null;
		try {
			fileTypeSummary = await getFileTypeSummary();
		} catch (e) {
			fileTypeSummaryError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			fileTypeSummaryLoading = false;
		}
	}

	async function fetchVelocity() {
		velocityLoading = true;
		velocityError = null;
		try {
			velocity = await getVelocity();
			console.log('Velocity data:', velocity);
		} catch (e) {
			console.error('Velocity error:', e);
			velocityError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			velocityLoading = false;
		}
	}

	async function fetchToolSuccessSummary() {
		toolSuccessSummaryLoading = true;
		toolSuccessSummaryError = null;
		try {
			const days =
				performanceMetricsRange === 'day'
					? 1
					: performanceMetricsRange === 'week'
						? 7
						: performanceMetricsRange === 'month'
							? 30
							: undefined;
			toolSuccessSummary = await getToolSuccessSummary(days);
		} catch (e) {
			toolSuccessSummaryError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			toolSuccessSummaryLoading = false;
		}
	}

	async function fetchPeakDays() {
		peakDaysLoading = true;
		peakDaysError = null;
		try {
			peakDays = await getPeakDays();
		} catch (e) {
			peakDaysError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			peakDaysLoading = false;
		}
	}

	async function fetchLatencyStats() {
		latencyStatsLoading = true;
		latencyStatsError = null;
		try {
			const days =
				performanceMetricsRange === 'day'
					? 1
					: performanceMetricsRange === 'week'
						? 7
						: performanceMetricsRange === 'month'
							? 30
							: undefined;
			latencyStats = await getLatencyStats(days);
		} catch (e) {
			latencyStatsError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			latencyStatsLoading = false;
		}
	}

	async function fetchLatencyOverTime() {
		latencyOverTimeLoading = true;
		latencyOverTimeError = null;
		try {
			const days = latencyRange === 'day' ? 1 : latencyRange === 'week' ? 7 : latencyRange === 'month' ? 30 : undefined;
			latencyOverTimeData = await getLatencyOverTime(days);
		} catch (e) {
			latencyOverTimeError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			latencyOverTimeLoading = false;
		}
	}

	async function fetchCostTrend() {
		costTrendLoading = true;
		costTrendError = null;
		try {
			costTrend = await getCostTrend(7);
		} catch (e) {
			console.error('costTrend error:', e);
			costTrendError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			costTrendLoading = false;
		}
	}

	async function fetchSessionStats() {
		sessionStatsLoading = true;
		sessionStatsError = null;
		try {
			sessionStats = await getSessionStats();
		} catch (e) {
			sessionStatsError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			sessionStatsLoading = false;
		}
	}

	async function fetchModelDiversity() {
		modelDiversityLoading = true;
		modelDiversityError = null;
		try {
			modelDiversity = await getModelDiversity();
		} catch (e) {
			modelDiversityError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			modelDiversityLoading = false;
		}
	}

	async function fetchCostForecast() {
		costForecastLoading = true;
		costForecastError = null;
		try {
			costForecast = await getCostForecast(7);
		} catch (e) {
			costForecastError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			costForecastLoading = false;
		}
	}

	async function fetchActivityHeatmap() {
		activityHeatmapLoading = true;
		activityHeatmapError = null;
		try {
			activityHeatmap = await getActivityHeatmap();
		} catch (e) {
			activityHeatmapError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			activityHeatmapLoading = false;
		}
	}

	async function fetchErrorRateByModel() {
		errorRateByModelLoading = true;
		errorRateByModelError = null;
		try {
			errorRateByModel = await getErrorRateByModel();
		} catch (e) {
			errorRateByModelError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			errorRateByModelLoading = false;
		}
	}

	async function fetchAvgTokensPerRequest() {
		avgTokensPerRequestLoading = true;
		avgTokensPerRequestError = null;
		try {
			const days =
				performanceMetricsRange === 'day'
					? 1
					: performanceMetricsRange === 'week'
						? 7
						: performanceMetricsRange === 'month'
							? 30
							: undefined;
			avgTokensPerRequest = await getAvgTokensPerRequest(days);
		} catch (e) {
			avgTokensPerRequestError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			avgTokensPerRequestLoading = false;
		}
	}

	async function fetchCodingStreak() {
		codingStreakLoading = true;
		codingStreakError = null;
		try {
			codingStreak = await getCodingStreak();
		} catch (e) {
			codingStreakError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			codingStreakLoading = false;
		}
	}

	async function fetchCacheHitRate() {
		cacheHitRateLoading = true;
		cacheHitRateError = null;
		try {
			const days =
				performanceMetricsRange === 'day'
					? 1
					: performanceMetricsRange === 'week'
						? 7
						: performanceMetricsRange === 'month'
							? 30
							: undefined;
			cacheHitRate = await getCacheHitRate(days);
		} catch (e) {
			cacheHitRateError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			cacheHitRateLoading = false;
		}
	}

	async function fetchToolStats() {
		toolStatsLoading = true;
		toolStatsError = null;
		try {
			toolStats = await getToolStats();
		} catch (e) {
			toolStatsError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			toolStatsLoading = false;
		}
	}

	async function fetchBashBreakdown() {
		bashBreakdownLoading = true;
		bashBreakdownError = null;
		try {
			bashBreakdown = await getBashCommandBreakdown();
		} catch (e) {
			bashBreakdownError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			bashBreakdownLoading = false;
		}
	}

	async function fetchSessionDepthStats() {
		sessionDepthLoading = true;
		sessionDepthError = null;
		try {
			sessionDepthStats = await getSessionDepthStats();
		} catch (e) {
			sessionDepthError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			sessionDepthLoading = false;
		}
	}

	function refreshAll() {
		fetchTotals();
		fetchCostByModel();
		fetchModelsData();
		fetchTimeExplorerData();
		fetchModelPerformance();
		fetchRecentRequests();
		fetchFileTypeSummary();
		fetchVelocity();
		fetchToolSuccessSummary();
		fetchPeakDays();
		fetchLatencyStats();
		fetchLatencyOverTime();
		fetchCostTrend();
		fetchSessionStats();
		fetchModelDiversity();
		fetchCostForecast();
		fetchActivityHeatmap();
		fetchErrorRateByModel();
		fetchAvgTokensPerRequest();
		fetchCodingStreak();
		fetchCacheHitRate();
		fetchToolStats();
		fetchBashBreakdown();
		fetchSessionDepthStats();
	}

	$effect(() => {
		costByModelRange;
		fetchCostByModel();
	});

	$effect(() => {
		timeExplorerRange;
		fetchTimeExplorerData();
	});

	$effect(() => {
		modelPerformanceRange;
		fetchModelsData();
		fetchModelPerformance();
	});

	$effect(() => {
		costMetricsRange;
		fetchTotals();
	});

	$effect(() => {
		performanceMetricsRange;
		fetchLatencyStats();
		fetchToolSuccessSummary();
		fetchAvgTokensPerRequest();
		fetchCacheHitRate();
	});

	$effect(() => {
		latencyRange;
		fetchLatencyOverTime();
	});

	$effect(() => {
		untrack(() => refreshAll());

		const interval = setInterval(() => {
			currentTime = new Date().toLocaleTimeString();
		}, 1000);
		return () => clearInterval(interval);
	});

	function formatNumber(n: number): string {
		if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
		return n.toLocaleString();
	}

	function formatExactNumber(n: number): string {
		return Math.round(n).toLocaleString();
	}

	function formatCost(n: number): string {
		if (n >= 100) return '$' + n.toFixed(0);
		if (n >= 1) return '$' + n.toFixed(2);
		return '$' + n.toFixed(4);
	}

	function getModelShortName(model: string): string {
		const parts = model.split('/');
		const name = parts[parts.length - 1];
		if (name.length > 20) return name.slice(0, 20) + '...';
		return name;
	}

	function formatDuration(ms: number): string {
		if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
		return ms.toFixed(0) + 'ms';
	}

	function formatPercent(part: number, total: number): string {
		if (total <= 0) return '0%';
		return ((part / total) * 100).toFixed(1) + '%';
	}

	function formatSegmentWidth(part: number, total: number): string {
		if (total <= 0 || part <= 0) return '0%';
		return `${(part / total) * 100}%`;
	}

	// Derived data for charts
	const modelCostLimit = 8;
	let modelChartData = $derived.by(() => {
		const items = costByModel ?? [];
		const topItems = items.slice(0, modelCostLimit);
		const getTotalTokens = (d: CostByModelItem) =>
			d.tokens_input + d.tokens_output + d.tokens_reasoning + d.tokens_cache_read + d.tokens_cache_write;
		const getValue = (d: CostByModelItem) =>
			modelViewMode === 'cost' ? d.cost_usd : getTotalTokens(d);
		const topData = topItems.map((d) => ({
			label: d.display_name,
			value: getValue(d)
		}));
		const totalValue = items.reduce((sum, d) => sum + getValue(d), 0);
		const topValue = topItems.reduce((sum, d) => sum + getValue(d), 0);
		const otherValue = totalValue - topValue;
		return otherValue > 0 ? [...topData, { label: 'other', value: otherValue }] : topData;
	});
	let totalPrompt = $derived((totals?.total_input ?? 0) + (totals?.total_cache_read ?? 0));
	let totalResponse = $derived((totals?.total_output ?? 0) + (totals?.total_reasoning ?? 0));
	let totalTokens = $derived(
		(totals?.total_input ?? 0) +
			(totals?.total_output ?? 0) +
			(totals?.total_reasoning ?? 0) +
			(totals?.total_cache_read ?? 0) +
			(totals?.total_cache_write ?? 0)
	);
	let costPer1MTokens = $derived.by(() => {
		if (!totals || totalTokens <= 0) return 0;
		return totals.total_cost / (totalTokens / 1_000_000);
	});
	let topModelShare = $derived.by(() => {
		if (!costByModel || costByModel.length === 0) return 0;
		const totalCost = costByModel.reduce((sum, m) => sum + m.cost_usd, 0);
		if (totalCost <= 0) return 0;
		return costByModel[0].cost_usd / totalCost;
	});
	let toolSuccessRate = $derived.by(() => toolSuccessSummary?.success_rate ?? 0);
	let tokenEfficiency = $derived.by(() => {
		if (!totals || totals.total_input <= 0) return 0;
		return totals.total_output / totals.total_input;
	});
	let trendArrow = $derived.by(() => {
		if (!costTrend) return '';
		if (costTrend.trend === 'up') return '↑';
		if (costTrend.trend === 'down') return '↓';
		return '→';
	});
	let trendColor = $derived.by(() => {
		if (!costTrend) return 'inherit';
		if (costTrend.trend === 'up') return '#ef4444';
		if (costTrend.trend === 'down') return '#22c55e';
		return 'var(--color-text-secondary)';
	});

	function formatSessionDuration(ms: number): string {
		if (ms >= 3600000) return (ms / 3600000).toFixed(1) + 'h';
		if (ms >= 60000) return (ms / 60000).toFixed(0) + 'm';
		if (ms >= 1000) return (ms / 1000).toFixed(0) + 's';
		return ms.toFixed(0) + 'ms';
	}

	const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
</script>

{#snippet loadingState()}
	<div class="loading-skeleton">
		<div class="skeleton-line"></div>
		<div class="skeleton-line short"></div>
	</div>
{/snippet}

{#snippet errorState(error: Error | null, retry: () => void)}
	<div class="error-state">
		<span class="text-sm">Failed to load</span>
		<button onclick={retry} class="retry-btn">Retry</button>
	</div>
{/snippet}

<div class="page-container">
	<!-- Header -->
	<header class="header reveal" style="animation-delay: 40ms;">
		<div class="header-left">
			<div class="header-breadcrumb">telemetry / tokens / cost</div>
			<h1 class="header-title">
				Agent <span class="accent">Observatory</span>
			</h1>
			<div class="header-subtitle">Your agents, under the microscope.</div>
		</div>

		<div class="header-right">
			<div class="time-display">
				<div class="time-label">local time</div>
				<div class="time-value">{currentTime}</div>
			</div>
			<button onclick={refreshAll} class="btn">
				<span>↻</span> <span class="hidden xs:inline">refresh</span>
			</button>
		</div>
	</header>

	<nav class="tab-nav">
		<button
			class="tab-btn {activeTab === 'overview' ? 'active' : ''}"
			onclick={() => activeTab = 'overview'}
		>
			Overview
		</button>
		<button
			class="tab-btn {activeTab === 'models' ? 'active' : ''}"
			onclick={() => activeTab = 'models'}
		>
			Models
		</button>
		<button
			class="tab-btn {activeTab === 'activity' ? 'active' : ''}"
			onclick={() => activeTab = 'activity'}
		>
			Activity
		</button>
		<button
			class="tab-btn {activeTab === 'code' ? 'active' : ''}"
			onclick={() => activeTab = 'code'}
		>
			Code
		</button>
		<button
			class="tab-btn {activeTab === 'tools' ? 'active' : ''}"
			onclick={() => activeTab = 'tools'}
		>
			Tools
		</button>
	</nav>

	{#if activeTab === 'overview'}
	<!-- TIER 1: HERO METRICS -->
	<section class="hero-grid" aria-label="Key metrics">
		{#if totalsLoading}
			<div class="hero-card primary reveal" style="animation-delay: 80ms;">
				<div class="hero-label">Total Spent</div>
				<div class="hero-value pulse">--</div>
			</div>
			<div class="hero-card reveal" style="animation-delay: 110ms;">
				<div class="hero-label">Total Requests</div>
				<div class="hero-value pulse">--</div>
			</div>
			<div class="hero-card reveal" style="animation-delay: 140ms;">
				<div class="hero-label">Prompt Tokens</div>
				<div class="hero-value white pulse">--</div>
			</div>
			<div class="hero-card reveal" style="animation-delay: 170ms;">
				<div class="hero-label">Response Tokens</div>
				<div class="hero-value muted pulse">--</div>
			</div>
			<div class="hero-card reveal" style="animation-delay: 200ms;">
				<div class="hero-label">Request Velocity</div>
				<div class="hero-value pulse">--</div>
			</div>
		{:else if totalsError}
			<div class="hero-card primary reveal"><div class="hero-value" style="color: #ef4444;">!</div></div>
		{:else if totals}
			<div class="hero-card primary reveal" style="animation-delay: 80ms;">
				<div class="hero-label">Total Spent</div>
				<div class="hero-value">{formatCost(totals.total_cost)}</div>
				<div class="hero-sublabel">Peak day: <span class="accent">{formatCost(peakDays?.peak_cost_day?.cost_usd ?? 0)}</span></div>
			</div>
			<div class="hero-card reveal" style="animation-delay: 110ms;">
				<div class="hero-label">Total Requests</div>
				<div class="hero-value">{formatNumber(totals.total_requests)}</div>
				<div class="hero-sublabel">{velocity?.requests_per_day ?? 0}/day · {velocity?.requests_per_hour ?? 0}/hr</div>
			</div>
			<div
				class="hero-card hero-card-token reveal"
				style="animation-delay: 140ms;"
			>
				<div class="hero-label">Prompt Tokens</div>
				<div class="hero-value white">{formatNumber(totalPrompt)}</div>
				<div class="hero-token-default">
					<div class="hero-sublabel">Fresh + cached context</div>
				</div>
				<div class="hero-token-hover">
					<div class="hero-breakdown-bar" aria-label="Prompt token breakdown">
						<div
							class="hero-breakdown-segment hero-breakdown-segment-fresh"
							style={`width: ${formatSegmentWidth(totals.total_input, totalPrompt)}`}
						></div>
						<div
							class="hero-breakdown-segment hero-breakdown-segment-cached"
							style={`width: ${formatSegmentWidth(totals.total_cache_read, totalPrompt)}`}
						></div>
					</div>
					<div class="hero-breakdown-list">
						<div class="hero-breakdown-item">
							<div class="hero-breakdown-key">
								<span class="hero-breakdown-dot hero-breakdown-dot-fresh"></span>
								<span>Fresh</span>
							</div>
							<div class="hero-breakdown-value">{formatNumber(totals.total_input)}</div>
							<div class="hero-breakdown-share">{formatPercent(totals.total_input, totalPrompt)}</div>
						</div>
						<div class="hero-breakdown-item">
							<div class="hero-breakdown-key">
								<span class="hero-breakdown-dot hero-breakdown-dot-cached"></span>
								<span>Cached</span>
							</div>
							<div class="hero-breakdown-value">{formatNumber(totals.total_cache_read)}</div>
							<div class="hero-breakdown-share">{formatPercent(totals.total_cache_read, totalPrompt)}</div>
						</div>
					</div>
					<div class="hero-sublabel">Cache write <span class="accent">{formatNumber(totals.total_cache_write)}</span></div>
				</div>
			</div>
			<div
				class="hero-card hero-card-token reveal"
				style="animation-delay: 170ms;"
			>
				<div class="hero-label">Response Tokens</div>
				<div class="hero-value muted">{formatNumber(totalResponse)}</div>
				<div class="hero-token-default">
					<div class="hero-sublabel">Visible + reasoning output</div>
				</div>
				<div class="hero-token-hover">
					<div class="hero-breakdown-bar" aria-label="Response token breakdown">
						<div
							class="hero-breakdown-segment hero-breakdown-segment-output"
							style={`width: ${formatSegmentWidth(totals.total_output, totalResponse)}`}
						></div>
						<div
							class="hero-breakdown-segment hero-breakdown-segment-reasoning"
							style={`width: ${formatSegmentWidth(totals.total_reasoning, totalResponse)}`}
						></div>
					</div>
					<div class="hero-breakdown-list">
						<div class="hero-breakdown-item">
							<div class="hero-breakdown-key">
								<span class="hero-breakdown-dot hero-breakdown-dot-output"></span>
								<span>Visible</span>
							</div>
							<div class="hero-breakdown-value">{formatNumber(totals.total_output)}</div>
							<div class="hero-breakdown-share">{formatPercent(totals.total_output, totalResponse)}</div>
						</div>
						<div class="hero-breakdown-item">
							<div class="hero-breakdown-key">
								<span class="hero-breakdown-dot hero-breakdown-dot-reasoning"></span>
								<span>Reasoning</span>
							</div>
							<div class="hero-breakdown-value">{formatNumber(totals.total_reasoning)}</div>
							<div class="hero-breakdown-share">{formatPercent(totals.total_reasoning, totalResponse)}</div>
						</div>
					</div>
					<div class="hero-sublabel">Visible/raw input <span class="accent">{tokenEfficiency.toFixed(2)}x</span></div>
				</div>
			</div>
			<div class="hero-card reveal" style="animation-delay: 200ms;">
				<div class="hero-label">Request Velocity</div>
				<div class="hero-value">{velocity?.requests_per_hour ?? 0}<span class="hero-unit">/hr</span></div>
				<div class="hero-sublabel">{velocity?.active_days ?? 0} active days · {codingStreak?.current_streak ?? 0}d streak</div>
			</div>
		{/if}
	</section>

	<!-- TIER 2: CHARTS -->
	<section class="charts-grid">
		<div class="panel reveal" style="animation-delay: 210ms;">
			<div class="section-header">
				<h2 class="section-title">{timeExplorerViewMode === 'cost' ? 'Cost' : 'Tokens'} Over Time</h2>
				<div class="range-buttons">
					<button type="button" class="range-btn {timeExplorerViewMode === 'cost' ? 'active' : ''}" onclick={() => (timeExplorerViewMode = 'cost')}>COST</button>
					<button type="button" class="range-btn {timeExplorerViewMode === 'tokens' ? 'active' : ''}" onclick={() => (timeExplorerViewMode = 'tokens')}>TOKENS</button>
					{#each ['day', 'week', 'month', 'all'] as r}
						<button type="button" class="range-btn {timeExplorerRange === (r as TimeExplorerRange) ? 'active' : ''}" onclick={() => (timeExplorerRange = r as TimeExplorerRange)}>
							{r.toUpperCase()}
						</button>
					{/each}
				</div>
			</div>
			{#if timeExplorerLoading}
				{@render loadingState()}
			{:else if timeExplorerError}
				{@render errorState(timeExplorerError, fetchTimeExplorerData)}
			{:else if timeExplorerData && timeExplorerData.length > 0}
				<TimeExplorer data={timeExplorerData} height={220} viewMode={timeExplorerViewMode} />
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No data available</div>
			{/if}
		</div>

		<div class="panel reveal" style="animation-delay: 240ms;">
			<div class="section-header">
				<h2 class="section-title">{modelViewMode === 'cost' ? 'Cost' : 'Tokens'} by Model</h2>
				<div class="range-buttons">
					<button type="button" class="range-btn {modelViewMode === 'cost' ? 'active' : ''}" onclick={() => (modelViewMode = 'cost')}>COST</button>
					<button type="button" class="range-btn {modelViewMode === 'tokens' ? 'active' : ''}" onclick={() => (modelViewMode = 'tokens')}>TOKENS</button>
					{#each ['all', 'day', 'week', 'month'] as r}
						<button type="button" class="range-btn {costByModelRange === (r as TimeRange) ? 'active' : ''}" onclick={() => (costByModelRange = r as TimeRange)}>
							{r.toUpperCase()}
						</button>
					{/each}
				</div>
			</div>
			<div class="section-subtitle">top {modelCostLimit} + other · {costByModelRange === 'all' ? 'all time' : 'last ' + costByModelRange}</div>
			{#if costByModelLoading}
				{@render loadingState()}
			{:else if costByModelError}
				{@render errorState(costByModelError, fetchCostByModel)}
			{:else if modelChartData.length > 0}
				<DonutChart data={modelChartData} height={280} valueType={modelViewMode} />
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No data available</div>
			{/if}
		</div>

		<div class="panel reveal" style="animation-delay: 270ms;">
			<div class="section-header">
				<h2 class="section-title">Latency Distribution</h2>
				<div class="range-buttons">
					{#each ['all', 'day', 'week', 'month'] as r}
						<button type="button" class="range-btn {latencyRange === (r as TimeRange) ? 'active' : ''}" onclick={() => (latencyRange = r as TimeRange)}>
							{r.toUpperCase()}
						</button>
					{/each}
				</div>
			</div>
			{#if latencyOverTimeLoading}
				{@render loadingState()}
			{:else if latencyOverTimeError}
				{@render errorState(latencyOverTimeError, fetchLatencyOverTime)}
			{:else if latencyOverTimeData && latencyOverTimeData.length > 0}
				<MultiLineChart data={latencyOverTimeData} height={220} />
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No latency data available</div>
			{/if}
		</div>
	</section>

	<!-- TIER 3: COST METRICS -->
	<div class="section-header">
		<h3 class="grouped-section-title">Cost Metrics</h3>
		<div class="range-buttons">
			{#each ['all', 'day', 'week', 'month'] as r}
				<button type="button" class="range-btn {costMetricsRange === (r as TimeRange) ? 'active' : ''}" onclick={() => (costMetricsRange = r as TimeRange)}>
					{r.toUpperCase()}
				</button>
			{/each}
		</div>
	</div>
	<section class="stats-grid-4">
		<div class="stat-card reveal" style="animation-delay: 225ms;">
			<div class="stat-label">Cost / 1M Tokens</div>
			{#if totalsLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value accent">{formatCost(costPer1MTokens)}</div>{/if}
			<div class="stat-sublabel">{costMetricsRange === 'all' ? 'all time' : 'last ' + costMetricsRange}</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 250ms;">
			<div class="stat-label">Top Model Share</div>
			{#if costByModelLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{formatPercent(topModelShare, 1)}</div>{/if}
			<div class="stat-sublabel">{costByModel?.[0]?.display_name ?? '—'}</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 275ms;">
			<div class="stat-label">Today vs 7d Avg</div>
			{#if costTrendLoading}<div class="stat-value pulse">--</div>
			{:else}
			<div class="stat-value" style="color: {trendColor};">{trendArrow} {Math.abs(costTrend?.percent_change ?? 0).toFixed(0)}%</div>
			{/if}
			<div class="stat-sublabel">{formatCost(costTrend?.today_cost ?? 0)} today · {formatCost(costTrend?.avg_7day_cost ?? 0)} avg</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 300ms;">
			<div class="stat-label">Monthly Forecast</div>
			{#if costForecastLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value accent">{formatCost(costForecast?.monthly_projection ?? 0)}</div>{/if}
			<div class="stat-sublabel">MTD: {formatCost(costForecast?.mtd_cost ?? 0)} · {formatCost(costForecast?.daily_rate ?? 0)}/day</div>
		</div>
	</section>

	<!-- TIER 3: PERFORMANCE METRICS -->
	<div class="section-header">
		<h3 class="grouped-section-title">Performance Metrics</h3>
		<div class="range-buttons">
			{#each ['all', 'day', 'week', 'month'] as r}
				<button type="button" class="range-btn {performanceMetricsRange === (r as TimeRange) ? 'active' : ''}" onclick={() => (performanceMetricsRange = r as TimeRange)}>
					{r.toUpperCase()}
				</button>
			{/each}
		</div>
	</div>
	<section class="stats-grid-4">
		<div class="stat-card reveal" style="animation-delay: 325ms;">
			<div class="stat-label">Latency P95</div>
			{#if latencyStatsLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{formatDuration(latencyStats?.p95_ms ?? 0)}</div>{/if}
			<div class="stat-sublabel">P50 {formatDuration(latencyStats?.p50_ms ?? 0)} · avg {formatDuration(latencyStats?.avg_ms ?? 0)}</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 350ms;">
			<div class="stat-label">Tool Success</div>
			{#if toolSuccessSummaryLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value" style="color: #22c55e;">{formatPercent(toolSuccessRate, 1)}</div>{/if}
			<div class="stat-sublabel">{toolSuccessSummary?.success_count ?? 0} ok · {toolSuccessSummary?.failure_count ?? 0} fail</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 375ms;">
			<div class="stat-label">Tokens / Request</div>
			{#if avgTokensPerRequestLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{formatNumber(avgTokensPerRequest?.avg_total ?? 0)}</div>{/if}
			<div class="stat-sublabel">in {formatNumber(avgTokensPerRequest?.avg_input ?? 0)} · out {formatNumber(avgTokensPerRequest?.avg_output ?? 0)}</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 400ms;">
			<div class="stat-label">Token Efficiency</div>
			{#if totalsLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{tokenEfficiency.toFixed(2)}x</div>{/if}
			<div class="stat-sublabel">output / input ratio</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 425ms;">
			<div class="stat-label">Cache Hit Rate</div>
			{#if cacheHitRateLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value" style="color: #22c55e;">{((cacheHitRate?.cache_hit_rate ?? 0) * 100).toFixed(1)}%</div>{/if}
			<div class="stat-sublabel">{formatNumber(cacheHitRate?.tokens_cache_read ?? 0)} / {formatNumber(cacheHitRate?.total_tokens ?? 0)} tokens</div>
		</div>
	</section>

	<!-- TIER 3: ACTIVITY METRICS -->
	<h3 class="grouped-section-title">Activity Metrics</h3>
	<section class="stats-grid-4">
		<div class="stat-card reveal" style="animation-delay: 425ms;">
			<div class="stat-label">Peak Cost Day</div>
			{#if peakDaysLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value accent">{formatCost(peakDays?.peak_cost_day?.cost_usd ?? 0)}</div>{/if}
			<div class="stat-sublabel">{peakDays?.peak_cost_day?.date ?? '—'}</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 450ms;">
			<div class="stat-label">Peak Token Day</div>
			{#if peakDaysLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{formatNumber(peakDays?.peak_token_day?.tokens ?? 0)}</div>{/if}
			<div class="stat-sublabel">{peakDays?.peak_token_day?.date ?? '—'}</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 475ms;">
			<div class="stat-label">Avg Session</div>
			{#if sessionStatsLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{formatSessionDuration(sessionStats?.avg_duration_ms ?? 0)}</div>{/if}
			<div class="stat-sublabel">{sessionStats?.total_sessions ?? 0} total sessions</div>
		</div>
	</section>

	<!-- TIER 3: SESSION & STREAK -->
	<h3 class="grouped-section-title">Session & Streak</h3>
	<section class="stats-grid-4">
		<div class="stat-card reveal" style="animation-delay: 525ms;">
			<div class="stat-label">Sessions / Day</div>
			{#if sessionStatsLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{(sessionStats?.sessions_per_day ?? 0).toFixed(1)}</div>{/if}
			<div class="stat-sublabel">—</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 550ms;">
			<div class="stat-label">Current Streak</div>
			{#if codingStreakLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value accent">{codingStreak?.current_streak ?? 0}<span class="hero-unit">d</span></div>{/if}
			<div class="stat-sublabel">{codingStreak?.total_active_days ?? 0} active days</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 575ms;">
			<div class="stat-label">Longest Streak</div>
			{#if codingStreakLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{codingStreak?.longest_streak ?? 0}<span class="hero-unit">d</span></div>{/if}
			<div class="stat-sublabel">—</div>
		</div>
		<div class="stat-card reveal" style="animation-delay: 600ms;">
			<div class="stat-label">Model Diversity</div>
			{#if modelDiversityLoading}<div class="stat-value pulse">--</div>
			{:else}<div class="stat-value">{((modelDiversity?.normalized_entropy ?? 0) * 100).toFixed(0)}%</div>{/if}
			<div class="stat-sublabel">{modelDiversity?.model_count ?? 0} models used</div>
		</div>
	</section>
	{/if}
	{#if activeTab === 'code'}
	<!-- Code by Language -->
	<section class="charts-grid">
		<div class="panel reveal" style="animation-delay: 315ms;">
			<h2 class="section-title">lines of code by language</h2>
			{#if fileTypeSummaryLoading}
				{@render loadingState()}
			{:else if fileTypeSummaryError}
				{@render errorState(fileTypeSummaryError, fetchFileTypeSummary)}
			{:else if fileTypeSummary && fileTypeSummary.length > 0}
				<FileTypeChart data={fileTypeSummary} height={320} />
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No file edit data yet</div>
			{/if}
		</div>
		<div class="panel reveal" style="animation-delay: 330ms;">
			<h2 class="section-title">language stats</h2>
			{#if fileTypeSummaryLoading}
				{@render loadingState()}
			{:else if fileTypeSummaryError}
				{@render errorState(fileTypeSummaryError, fetchFileTypeSummary)}
			{:else if fileTypeSummary && fileTypeSummary.length > 0}
				{@const totalLinesAdded = fileTypeSummary.reduce((sum, d) => sum + d.total_lines_added, 0)}
				{@const totalLinesRemoved = fileTypeSummary.reduce(
					(sum, d) => sum + d.total_lines_removed,
					0
				)}
				{@const totalEdits = fileTypeSummary.reduce(
					(sum, d) => sum + d.edit_count + d.write_count,
					0
				)}
				<div class="language-stats">
					<div class="lang-stat">
						<div class="lang-stat-value text-accent">{formatNumber(totalLinesAdded)}</div>
						<div class="lang-stat-label">total lines added</div>
					</div>
					<div class="lang-stat">
						<div class="lang-stat-value" style="color: #ef4444;">
							{formatNumber(totalLinesRemoved)}
						</div>
						<div class="lang-stat-label">total lines removed</div>
					</div>
					<div class="lang-stat">
						<div class="lang-stat-value" style="color: #22c55e;">
							{formatNumber(totalLinesAdded - totalLinesRemoved)}
						</div>
						<div class="lang-stat-label">net lines</div>
					</div>
					<div class="lang-stat">
						<div class="lang-stat-value text-secondary">{formatNumber(totalEdits)}</div>
						<div class="lang-stat-label">file edits</div>
					</div>
				</div>
				<div class="lang-table-container">
					<table class="lang-table">
						<thead>
							<tr>
								<th>ext</th>
								<th>added</th>
								<th>removed</th>
								<th>net</th>
								<th>edits</th>
							</tr>
						</thead>
						<tbody>
							{#each fileTypeSummary.slice(0, 8) as item (item.file_extension)}
								<tr>
									<td class="font-mono">.{item.file_extension}</td>
									<td style="color: #22c55e;">+{formatNumber(item.total_lines_added)}</td>
									<td style="color: #ef4444;">-{formatNumber(item.total_lines_removed)}</td>
									<td>{formatNumber(item.net_lines)}</td>
									<td class="text-tertiary">{item.edit_count + item.write_count}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No file edit data yet</div>
			{/if}
		</div>
	</section>
	{/if}

	{#if activeTab === 'models'}
	<!-- Model Performance Table -->
	<section class="panel reveal" style="animation-delay: 360ms; margin-bottom: 1.5rem;">
		<div class="section-header">
			<h2 class="section-title">model performance</h2>
			<div class="range-buttons">
				{#each ['all', 'day', 'week', 'month'] as r}
					<button type="button" class="range-btn {modelPerformanceRange === (r as TimeRange) ? 'active' : ''}" onclick={() => (modelPerformanceRange = r as TimeRange)}>
						{r.toUpperCase()}
					</button>
				{/each}
			</div>
		</div>
		<div class="section-subtitle" style="margin-bottom: 1rem;">{modelPerformanceRange === 'all' ? 'all time' : 'last ' + modelPerformanceRange}</div>
		{#if modelsDataLoading || modelPerformanceLoading}
			{@render loadingState()}
		{:else if modelsDataError || modelPerformanceError}
			{@render errorState(modelsDataError || modelPerformanceError, () => {
				fetchModelsData();
				fetchModelPerformance();
			})}
		{:else if modelsData && modelsData.length > 0}
			<div class="table-container">
				<table>
					<thead>
						<tr>
							<th>model</th>
							<th>requests</th>
							<th>input</th>
							<th>output</th>
							<th>avg duration</th>
							<th>cost</th>
						</tr>
					</thead>
					<tbody>
						{#each modelsData as model (model.model_id)}
							{@const avgDuration = modelPerformance?.find((d) => d.model_id === model.model_id)}
							<tr>
								<td class="font-mono text-sm">
									{model.display_name}
								</td>
								<td>{model.request_count.toLocaleString()}</td>
								<td class="text-accent">{formatNumber(model.tokens_input)}</td>
								<td class="text-primary">{formatNumber(model.tokens_output)}</td>
								<td>{avgDuration ? formatDuration(avgDuration.avg_duration_ms) : '-'}</td>
								<td class="text-accent font-medium">{formatCost(model.cost_usd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="text-tertiary text-sm py-8 text-center">No data available</div>
		{/if}
	</section>
	{/if}

	{#if activeTab === 'activity'}
	<!-- Recent Activity -->
	<section class="panel reveal" style="animation-delay: 390ms; margin-bottom: 1.5rem;">
		<h2 class="section-title">recent activity</h2>
		{#if recentRequestsLoading}
			{@render loadingState()}
		{:else if recentRequestsError}
			{@render errorState(recentRequestsError, fetchRecentRequests)}
		{:else if recentRequests && recentRequests.length > 0}
			<div class="table-container scrollable">
				<table>
					<thead>
						<tr>
							<th>time</th>
							<th>model</th>
							<th>input</th>
							<th>output</th>
							<th>cache read</th>
							<th>cache write</th>
							<th>cost</th>
						</tr>
					</thead>
					<tbody>
						{#each recentRequests.slice(0, 15) as req (req.id)}
							<tr>
								<td class="text-tertiary text-sm">
									{new Date(req.created_at).toLocaleString(undefined, {
										month: 'short',
										day: 'numeric',
										hour: '2-digit',
										minute: '2-digit'
									})}
								</td>
								<td class="font-mono text-sm">{req.display_name}</td>
								<td class="text-accent">{formatNumber(req.tokens_input)}</td>
								<td class="text-primary">{formatNumber(req.tokens_output)}</td>
								<td class="text-secondary">{formatNumber(req.tokens_cache_read)}</td>
								<td class="text-secondary">{formatNumber(req.tokens_cache_write)}</td>
								<td class="text-accent font-medium">{formatCost(req.cost_usd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="text-tertiary text-sm py-8 text-center">No data available</div>
		{/if}
	</section>

	<!-- Activity Heatmap & Error Rate -->
	<section class="charts-grid">
		<div class="panel reveal" style="animation-delay: 410ms;">
			<h2 class="section-title">activity heatmap</h2>
			{#if activityHeatmapLoading}
				{@render loadingState()}
			{:else if activityHeatmapError}
				{@render errorState(activityHeatmapError, fetchActivityHeatmap)}
			{:else if activityHeatmap && activityHeatmap.length > 0}
				{@const maxCount = Math.max(...activityHeatmap.map((d) => d.request_count))}
				<div class="heatmap-container">
					<div class="heatmap-labels">
						<div class="heatmap-label"></div>
						{#each Array(24) as _, h}
							{#if h % 3 === 0}
								<div class="heatmap-hour-label">{h}</div>
							{:else}
								<div class="heatmap-hour-label"></div>
							{/if}
						{/each}
					</div>
					{#each dayNames as day, dayIdx}
						<div class="heatmap-row">
							<div class="heatmap-day-label">{day}</div>
							{#each Array(24) as _, hour}
								{@const cell = activityHeatmap.find((d) => d.day_of_week === dayIdx && d.hour === hour)}
								{@const intensity = cell ? cell.request_count / maxCount : 0}
								<div
									class="heatmap-cell"
									style="background-color: rgba(59, 130, 246, {intensity * 0.9 + 0.1});"
									title="{day} {hour}:00 - {cell?.request_count ?? 0} requests"
								></div>
							{/each}
						</div>
					{/each}
				</div>
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No activity data yet</div>
			{/if}
		</div>

		<div class="panel reveal" style="animation-delay: 420ms;">
			<h2 class="section-title">error rate by model</h2>
			{#if errorRateByModelLoading}
				{@render loadingState()}
			{:else if errorRateByModelError}
				{@render errorState(errorRateByModelError, fetchErrorRateByModel)}
			{:else if errorRateByModel && errorRateByModel.length > 0}
				{@const modelsWithErrors = errorRateByModel.filter((m) => m.failed_tool_calls > 0).sort((a, b) => b.error_rate - a.error_rate).slice(0, 8)}
				{#if modelsWithErrors.length > 0}
					<div class="error-rate-list">
						{#each modelsWithErrors as model (model.model_id)}
							<div class="error-rate-item">
								<div class="error-rate-model">{model.display_name}</div>
								<div class="error-rate-bar-container">
									<div
										class="error-rate-bar"
										style="width: {Math.min(model.error_rate * 100, 100)}%;"
									></div>
								</div>
								<div class="error-rate-value">{(model.error_rate * 100).toFixed(1)}%</div>
								<div class="error-rate-count">{model.failed_tool_calls} fails</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-tertiary text-sm py-8 text-center">No errors recorded</div>
				{/if}
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No data available</div>
			{/if}
		</div>
	</section>

	<!-- Session Depth Distribution -->
	<section class="panel reveal" style="animation-delay: 430ms; margin-bottom: 1.5rem;">
		<h2 class="section-title">session depth distribution</h2>
		{#if sessionDepthLoading}
			{@render loadingState()}
		{:else if sessionDepthError}
			{@render errorState(sessionDepthError, fetchSessionDepthStats)}
		{:else if sessionDepthStats}
			<div class="depth-stats-summary">
				<div class="depth-stat">
					<span class="depth-stat-value">{sessionDepthStats.total_sessions.toLocaleString()}</span>
					<span class="depth-stat-label">sessions</span>
				</div>
				<div class="depth-stat">
					<span class="depth-stat-value">{sessionDepthStats.avg_turns}</span>
					<span class="depth-stat-label">avg turns</span>
				</div>
				<div class="depth-stat">
					<span class="depth-stat-value">{sessionDepthStats.median_turns}</span>
					<span class="depth-stat-label">median</span>
				</div>
				<div class="depth-stat">
					<span class="depth-stat-value">{sessionDepthStats.max_turns}</span>
					<span class="depth-stat-label">max</span>
				</div>
			</div>
			<div class="depth-insight">
				{#if sessionDepthStats.single_turn_percent > 0.5}
					{(sessionDepthStats.single_turn_percent * 100).toFixed(0)}% of sessions are single-turn — you prefer quick answers
				{:else if sessionDepthStats.single_turn_percent > 0.3}
					Sessions are fairly split between quick queries and deeper work
				{:else}
					Most sessions involve multiple turns — you engage in extended conversations
				{/if}
			</div>
			<div class="depth-distribution">
				{#each sessionDepthStats.distribution as bucket}
					<div class="depth-row">
						<span class="depth-label">{bucket.label}</span>
						<div class="depth-bar-container">
							<div class="depth-bar" style="width: {bucket.percent * 100}%;"></div>
						</div>
						<span class="depth-count">{bucket.count.toLocaleString()}</span>
						<span class="depth-percent">{(bucket.percent * 100).toFixed(0)}%</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="text-tertiary text-sm py-8 text-center">No session data available</div>
		{/if}
	</section>
	{/if}

	{#if activeTab === 'tools'}
	{@const displayedTools = toolStats ? toolStats.slice(0, 12) : []}
	{@const maxToolCalls = displayedTools.length > 0 ? Math.max(...displayedTools.map(t => t.call_count), 1) : 1}
	<!-- Tool Success Overview -->
	<section class="panel reveal" style="animation-delay: 450ms; margin-bottom: 1.5rem;">
		<h2 class="section-title">tool success rate</h2>
		{#if toolSuccessSummaryLoading}
			{@render loadingState()}
		{:else if toolSuccessSummaryError}
			{@render errorState(toolSuccessSummaryError, fetchToolSuccessSummary)}
		{:else if toolSuccessSummary}
			<div class="success-overview">
				<div class="success-bar-container">
					<div 
						class="success-bar-segment success" 
						style="width: {toolSuccessSummary.success_rate * 100}%;"
					>
						<span class="bar-label">success</span>
						<span class="bar-value">{toolSuccessSummary.success_count.toLocaleString()}</span>
					</div>
					<div 
						class="success-bar-segment fail" 
						style="width: {(1 - toolSuccessSummary.success_rate) * 100}%;"
					>
						<span class="bar-label">fail</span>
						<span class="bar-value">{toolSuccessSummary.failure_count.toLocaleString()}</span>
					</div>
				</div>
				<div class="success-stats">
					<div class="success-stat">
						<span class="stat-value">{toolSuccessSummary.total.toLocaleString()}</span>
						<span class="stat-label">total calls</span>
					</div>
					<div class="success-stat primary">
						<span class="stat-value">{(toolSuccessSummary.success_rate * 100).toFixed(1)}%</span>
						<span class="stat-label">success rate</span>
					</div>
					<div class="success-stat">
						<span class="stat-value">{toolSuccessSummary.failure_count.toLocaleString()}</span>
						<span class="stat-label">failures</span>
					</div>
				</div>
			</div>
		{:else}
			<div class="text-tertiary text-sm py-8 text-center">No tool data available</div>
		{/if}
	</section>

	<!-- Tool Breakdown -->
	<section class="panel reveal" style="animation-delay: 470ms; margin-bottom: 1.5rem;">
		<h2 class="section-title">tool breakdown by usage</h2>
		{#if toolSuccessSummaryLoading}
			{@render loadingState()}
		{:else if displayedTools.length > 0}
			<div class="tool-list">
				{#each displayedTools as tool (tool.tool)}
					<div class="tool-item">
						<div class="tool-name">{tool.tool}</div>
						<div class="tool-bar-container">
							<div 
								class="tool-bar" 
								style="width: {(tool.call_count / maxToolCalls) * 100}%;"
							></div>
						</div>
						<div class="tool-stats">
							<span class="tool-count">{tool.call_count.toLocaleString()}</span>
							<span class="tool-status" style="color: {tool.success_rate > 0.9 ? 'var(--color-text-tertiary)' : tool.success_rate > 0.7 ? '#f59e0b' : '#ef4444'};">
								{tool.success_rate > 0.9 ? '✓' : tool.success_rate > 0.7 ? '△' : '✗'}
							</span>
						</div>
					</div>
				{/each}
			</div>
			<div class="tool-legend">
				<span>✓ high success</span>
				<span>△ some issues</span>
				<span style="color: #ef4444;">✗ needs attention</span>
			</div>
		{:else}
			<div class="text-tertiary text-sm py-8 text-center">No tool data available</div>
		{/if}
	</section>

	{@const maxBashCount = bashBreakdown && bashBreakdown.length > 0 ? Math.max(...bashBreakdown.map(b => b.count), 1) : 1}
	<section class="panel reveal" style="animation-delay: 490ms; margin-bottom: 1.5rem;">
		<h2 class="section-title">bash commands by category</h2>
		{#if bashBreakdownLoading}
			{@render loadingState()}
		{:else if bashBreakdown && bashBreakdown.length > 0}
			<div class="tool-list">
				{#each bashBreakdown as item (item.category)}
					<div class="tool-item bash-item">
						<div class="tool-name">{item.category}</div>
						<div class="tool-bar-container">
							<div 
								class="tool-bar" 
								style="width: {(item.count / maxBashCount) * 100}%;"
							></div>
						</div>
						<div class="tool-stats">
							<span class="tool-count">{item.count.toLocaleString()}</span>
							<span class="tool-status" style="color: {item.success_rate > 0.9 ? 'var(--color-text-tertiary)' : item.success_rate > 0.7 ? '#f59e0b' : '#ef4444'};">
								{item.success_rate > 0.9 ? '✓' : item.success_rate > 0.7 ? '△' : '✗'}
							</span>
						</div>
						{#if item.category === 'other' && item.samples.length > 0}
							<div class="tool-samples">e.g., {item.samples.join(', ')}</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="text-tertiary text-sm py-8 text-center">No bash command data available</div>
		{/if}
	</section>
	{/if}

	<!-- Footer -->
	<footer class="footer reveal" style="animation-delay: 420ms;">
		{#if totalsLoading}
			<div class="footer-stats">
				<span>Cache Read: --</span>
				<span class="text-accent-dim">|</span>
				<span>Cache Write: --</span>
				<span class="text-accent-dim">|</span>
				<span>Reasoning: --</span>
			</div>
		{:else if totals}
			<div class="footer-stats">
				<span>Cache Read: {formatNumber(totals.total_cache_read)}</span>
				<span class="text-accent-dim">|</span>
				<span>Cache Write: {formatNumber(totals.total_cache_write)}</span>
				<span class="text-accent-dim">|</span>
				<span>Reasoning: {formatNumber(totals.total_reasoning)}</span>
			</div>
		{:else}
			<div class="footer-stats">
				<span>Cache Read: --</span>
				<span class="text-accent-dim">|</span>
				<span>Cache Write: --</span>
				<span class="text-accent-dim">|</span>
				<span>Reasoning: --</span>
			</div>
		{/if}
		<div class="footer-version">OpenCode Stats v1.0</div>
	</footer>
</div>
