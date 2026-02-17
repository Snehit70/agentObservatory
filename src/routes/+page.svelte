<script lang="ts">
	import { untrack } from 'svelte';
	import AreaChart from '$lib/components/AreaChart.svelte';
	import BarChart from '$lib/components/BarChart.svelte';
	import DonutChart from '$lib/components/DonutChart.svelte';
	import TokensChart from '$lib/components/TokensChart.svelte';
	import TokensZoomChart from '$lib/components/TokensZoomChart.svelte';
	import {
		getTotals,
		getCostByModel,
		getCostOverTime,
		getTokensData,
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
		getCodingStreak
	} from '$lib/remote/stats.remote';
	import FileTypeChart from '$lib/components/FileTypeChart.svelte';

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
		cost_usd: number;
	};
	type TimeRange = 'all' | 'day' | 'week' | 'month';
	type CostOverTimeItem = {
		date: string;
		request_count: number;
		tokens_input: number;
		tokens_output: number;
		cost_usd: number;
	};
	type TokensData = {
		hourly: { hour: number; tokens_input: number; tokens_output: number }[];
		daily: { date: string; tokens_input: number; tokens_output: number }[];
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

	// State for all data
	let totals = $state<Totals | null>(null);
	let costByModel = $state<CostByModelItem[] | null>(null);
	let costOverTime = $state<CostOverTimeItem[] | null>(null);
	let tokensData = $state<TokensData | null>(null);
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
	let costByModelRange = $state<TimeRange>('all');

	// Loading states
	let totalsLoading = $state(true);
	let costByModelLoading = $state(true);
	let costOverTimeLoading = $state(true);
	let tokensDataLoading = $state(true);
	let modelPerformanceLoading = $state(true);
	let recentRequestsLoading = $state(true);
	let fileTypeSummaryLoading = $state(true);
	let velocityLoading = $state(true);
	let toolSuccessSummaryLoading = $state(true);
	let peakDaysLoading = $state(true);
	let latencyStatsLoading = $state(true);
	let costTrendLoading = $state(true);
	let sessionStatsLoading = $state(true);
	let modelDiversityLoading = $state(true);
	let costForecastLoading = $state(true);
	let activityHeatmapLoading = $state(true);
	let errorRateByModelLoading = $state(true);
	let avgTokensPerRequestLoading = $state(true);
	let codingStreakLoading = $state(true);

	// Error states
	let totalsError = $state<Error | null>(null);
	let costByModelError = $state<Error | null>(null);
	let costOverTimeError = $state<Error | null>(null);
	let tokensDataError = $state<Error | null>(null);
	let modelPerformanceError = $state<Error | null>(null);
	let recentRequestsError = $state<Error | null>(null);
	let fileTypeSummaryError = $state<Error | null>(null);
	let velocityError = $state<Error | null>(null);
	let toolSuccessSummaryError = $state<Error | null>(null);
	let peakDaysError = $state<Error | null>(null);
	let latencyStatsError = $state<Error | null>(null);
	let costTrendError = $state<Error | null>(null);
	let sessionStatsError = $state<Error | null>(null);
	let modelDiversityError = $state<Error | null>(null);
	let costForecastError = $state<Error | null>(null);
	let activityHeatmapError = $state<Error | null>(null);
	let errorRateByModelError = $state<Error | null>(null);
	let avgTokensPerRequestError = $state<Error | null>(null);
	let codingStreakError = $state<Error | null>(null);

	let currentTime = $state(new Date().toLocaleTimeString());

	type TabId = 'overview' | 'models' | 'activity' | 'code';
	let activeTab = $state<TabId>('overview');

	// Fetch functions
	async function fetchTotals() {
		totalsLoading = true;
		totalsError = null;
		try {
			totals = await getTotals();
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

	async function fetchCostOverTime() {
		costOverTimeLoading = true;
		costOverTimeError = null;
		try {
			costOverTime = await getCostOverTime();
		} catch (e) {
			costOverTimeError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			costOverTimeLoading = false;
		}
	}

	async function fetchTokensData() {
		tokensDataLoading = true;
		tokensDataError = null;
		try {
			// Pass the user's timezone offset to get hourly data in local time
			const tzOffsetMinutes = new Date().getTimezoneOffset();
			tokensData = await getTokensData(tzOffsetMinutes);
		} catch (e) {
			tokensDataError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			tokensDataLoading = false;
		}
	}

	async function fetchModelPerformance() {
		modelPerformanceLoading = true;
		modelPerformanceError = null;
		try {
			const days =
				costByModelRange === 'day'
					? 1
					: costByModelRange === 'week'
						? 7
						: costByModelRange === 'month'
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
			toolSuccessSummary = await getToolSuccessSummary();
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
			latencyStats = await getLatencyStats();
		} catch (e) {
			latencyStatsError = e instanceof Error ? e : new Error('Failed to load');
		} finally {
			latencyStatsLoading = false;
		}
	}

	async function fetchCostTrend() {
		costTrendLoading = true;
		costTrendError = null;
		try {
			costTrend = await getCostTrend();
		} catch (e) {
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
			costForecast = await getCostForecast();
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
			avgTokensPerRequest = await getAvgTokensPerRequest();
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

	function refreshAll() {
		fetchTotals();
		fetchCostByModel();
		fetchCostOverTime();
		fetchTokensData();
		fetchModelPerformance();
		fetchRecentRequests();
		fetchFileTypeSummary();
		fetchVelocity();
		fetchToolSuccessSummary();
		fetchPeakDays();
		fetchLatencyStats();
		fetchCostTrend();
		fetchSessionStats();
		fetchModelDiversity();
		fetchCostForecast();
		fetchActivityHeatmap();
		fetchErrorRateByModel();
		fetchAvgTokensPerRequest();
		fetchCodingStreak();
	}

	$effect(() => {
		costByModelRange;
		fetchCostByModel();
		fetchModelPerformance();
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

	// Derived data for charts
	let costTimeData = $derived(
		costOverTime?.map((d) => ({ date: d.date, value: d.cost_usd })) ?? []
	);
	const modelCostLimit = 8;
	let modelCostData = $derived.by(() => {
		const items = costByModel ?? [];
		const topItems = items.slice(0, modelCostLimit);
		const topData = topItems.map((d) => ({
			label: d.display_name,
			value: d.cost_usd
		}));
		const totalCost = items.reduce((sum, d) => sum + d.cost_usd, 0);
		const topCost = topItems.reduce((sum, d) => sum + d.cost_usd, 0);
		const otherCost = totalCost - topCost;
		return otherCost > 0 ? [...topData, { label: 'other', value: otherCost }] : topData;
	});
	let tokensTimeData = $derived(
		costOverTime?.map((d) => ({
			date: d.date,
			tokens_input: d.tokens_input,
			tokens_output: d.tokens_output
		})) ?? []
	);
	let totalPrompt = $derived((totals?.total_input ?? 0) + (totals?.total_cache_read ?? 0));
	let totalTokens = $derived(
		(totals?.total_input ?? 0) +
			(totals?.total_output ?? 0) +
			(totals?.total_reasoning ?? 0) +
			(totals?.total_cache_read ?? 0) +
			(totals?.total_cache_write ?? 0)
	);
	let costPer1kTokens = $derived.by(() => {
		if (!totals || totalTokens <= 0) return 0;
		return totals.total_cost / (totalTokens / 1000);
	});
	let topModelShare = $derived.by(() => {
		const top = costByModel?.[0];
		if (!top || !totals || totals.total_cost <= 0) return 0;
		return top.cost_usd / totals.total_cost;
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
			<div class="header-subtitle">A tiny instrument panel for OpenCode's LLM usage.</div>
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
	</nav>

	{#if activeTab === 'overview'}
	<!-- Main Stats Row -->
	<section class="stats-grid" aria-label="Top-level totals">
		{#if totalsLoading}
			<div class="panel reveal" style="animation-delay: 80ms;">
				<div class="stat-value accent pulse">--</div>
				<div class="stat-label">total spent</div>
			</div>
			<div class="panel reveal" style="animation-delay: 110ms;">
				<div class="stat-value accent pulse">--</div>
				<div class="stat-label">total requests</div>
			</div>
			<div class="panel reveal" style="animation-delay: 140ms;">
				<div class="stat-value primary pulse">--</div>
				<div class="stat-label">input tokens</div>
				<div class="stat-sublabel">cached --</div>
			</div>
			<div class="panel reveal" style="animation-delay: 170ms;">
				<div class="stat-value secondary pulse">--</div>
				<div class="stat-label">output tokens</div>
			</div>
		{:else if totalsError}
			<div class="panel flex items-center justify-center">
				{@render errorState(totalsError, fetchTotals)}
			</div>
		{:else if totals}
			<div class="panel reveal" style="animation-delay: 80ms;">
				<div class="stat-value accent">{formatCost(totals.total_cost)}</div>
				<div class="stat-label">total spent</div>
				<div class="panel-glow"></div>
			</div>
			<div class="panel reveal" style="animation-delay: 110ms;">
				<div class="stat-value accent">{formatNumber(totals.total_requests)}</div>
				<div class="stat-label">total requests</div>
			</div>
			<div class="panel reveal" style="animation-delay: 140ms;">
				<div class="stat-value primary">{formatNumber(totalPrompt)}</div>
				<div class="stat-label">input tokens</div>
				<div class="stat-sublabel">
					cached <span class="accent">{formatNumber(totals.total_cache_read)}</span>
					<span class="text-tertiary">({formatPercent(totals.total_cache_read, totalPrompt)})</span>
				</div>
			</div>
			<div class="panel reveal" style="animation-delay: 170ms;">
				<div class="stat-value secondary">{formatNumber(totals.total_output)}</div>
				<div class="stat-label">output tokens</div>
			</div>
		{/if}
		
		{#if velocityLoading}
			<div class="panel reveal" style="animation-delay: 200ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">request velocity</div>
			</div>
		{:else if velocityError}
			<div class="panel reveal" style="animation-delay: 200ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">request velocity</div>
			</div>
		{:else if velocity}
			<div class="panel reveal" style="animation-delay: 200ms;">
				<div class="stat-value">{velocity.requests_per_hour}<span class="stat-unit">/hr</span></div>
				<div class="stat-label">request velocity</div>
				<div class="stat-sublabel">
					{velocity.requests_per_day}/day · {velocity.active_days} active days
				</div>
			</div>
		{/if}
	</section>

	<section class="stats-grid" aria-label="Peak days">
		{#if peakDaysLoading}
			<div class="panel reveal" style="animation-delay: 325ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">peak cost day</div>
			</div>
			<div class="panel reveal" style="animation-delay: 350ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">peak token day</div>
			</div>
		{:else if peakDaysError}
			<div class="panel reveal" style="animation-delay: 325ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">peak cost day</div>
			</div>
			<div class="panel reveal" style="animation-delay: 350ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">peak token day</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 325ms;">
				<div class="stat-value accent">
					{formatCost(peakDays?.peak_cost_day?.cost_usd ?? 0)}
				</div>
				<div class="stat-label">peak cost day</div>
				<div class="stat-sublabel">{peakDays?.peak_cost_day?.date ?? '—'}</div>
			</div>
			<div class="panel reveal" style="animation-delay: 350ms;">
				<div class="stat-value">
					{formatNumber(peakDays?.peak_token_day?.tokens ?? 0)}
				</div>
				<div class="stat-label">peak token day</div>
				<div class="stat-sublabel">{peakDays?.peak_token_day?.date ?? '—'}</div>
			</div>
		{/if}
	</section>

	<!-- Charts Row 1 -->
	<section class="charts-grid">
		<div class="panel reveal" style="animation-delay: 210ms;">
			<div class="section-header">
				<h2 class="section-title">cost over time</h2>
				<div class="section-subtitle">last 30 days</div>
			</div>
			{#if costOverTimeLoading}
				{@render loadingState()}
			{:else if costOverTimeError}
				{@render errorState(costOverTimeError, fetchCostOverTime)}
			{:else if costTimeData.length > 0}
				<AreaChart
					data={costTimeData}
					height={220}
					color="var(--color-accent)"
					gradientId="costGrad"
				/>
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No data available</div>
			{/if}
		</div>

		<div class="panel reveal" style="animation-delay: 240ms;">
			<div class="section-header">
				<h2 class="section-title">cost by model</h2>
				<div class="range-buttons">
					{#each ['all', 'day', 'week', 'month'] as r}
						<button
							type="button"
							class="range-btn {costByModelRange === (r as TimeRange) ? 'active' : ''}"
							onclick={() => (costByModelRange = r as TimeRange)}
						>
							{r.toUpperCase()}
						</button>
					{/each}
				</div>
			</div>
			<div class="section-subtitle">
				top {modelCostLimit} + other • {costByModelRange === 'all' ? 'all time' : `last ${costByModelRange}`}
			</div>
			{#if costByModelLoading}
				{@render loadingState()}
			{:else if costByModelError}
				{@render errorState(costByModelError, fetchCostByModel)}
			{:else if modelCostData.length > 0}
				<DonutChart data={modelCostData} height={280} />
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No data available</div>
			{/if}
		</div>
	</section>

	<section class="stats-grid" aria-label="Derived stats">
		{#if totalsLoading || costByModelLoading}
			<div class="panel reveal" style="animation-delay: 225ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">cost / 1k tokens</div>
			</div>
			<div class="panel reveal" style="animation-delay: 250ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">top model share</div>
			</div>
		{:else if totalsError || costByModelError}
			<div class="panel reveal" style="animation-delay: 225ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">cost / 1k tokens</div>
			</div>
			<div class="panel reveal" style="animation-delay: 250ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">top model share</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 225ms;">
				<div class="stat-value accent">{formatCost(costPer1kTokens)}</div>
				<div class="stat-label">cost / 1k tokens</div>
				<div class="stat-sublabel">all time</div>
			</div>
			<div class="panel reveal" style="animation-delay: 250ms;">
				<div class="stat-value">{formatPercent(topModelShare, 1)}</div>
				<div class="stat-label">top model share</div>
				<div class="stat-sublabel">{costByModel?.[0]?.display_name ?? '—'}</div>
			</div>
		{/if}

		{#if toolSuccessSummaryLoading}
			<div class="panel reveal" style="animation-delay: 275ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">tool success</div>
			</div>
		{:else if toolSuccessSummaryError}
			<div class="panel reveal" style="animation-delay: 275ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">tool success</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 275ms;">
				<div class="stat-value">{formatPercent(toolSuccessRate, 1)}</div>
				<div class="stat-label">tool success</div>
				<div class="stat-sublabel">
					{toolSuccessSummary?.success_count ?? 0} ok · {toolSuccessSummary?.failure_count ?? 0} fail
				</div>
			</div>
		{/if}

		{#if latencyStatsLoading}
			<div class="panel reveal" style="animation-delay: 300ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">latency p95</div>
			</div>
		{:else if latencyStatsError}
			<div class="panel reveal" style="animation-delay: 300ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">latency p95</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 300ms;">
				<div class="stat-value">{formatDuration(latencyStats?.p95_ms ?? 0)}</div>
				<div class="stat-label">latency p95</div>
				<div class="stat-sublabel">avg {formatDuration(latencyStats?.avg_ms ?? 0)}</div>
			</div>
		{/if}
	</section>

	<!-- New Stats Row -->
	<section class="stats-grid" aria-label="Additional stats">
		{#if costTrendLoading}
			<div class="panel reveal" style="animation-delay: 310ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">today vs avg</div>
			</div>
		{:else if costTrendError}
			<div class="panel reveal" style="animation-delay: 310ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">today vs avg</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 310ms;">
				<div class="stat-value">
					<span style="color: {trendColor};">{trendArrow}</span>
					{Math.abs(costTrend?.percent_change ?? 0).toFixed(0)}%
				</div>
				<div class="stat-label">today vs 7d avg</div>
				<div class="stat-sublabel">
					{formatCost(costTrend?.today_cost ?? 0)} today · {formatCost(costTrend?.avg_7day_cost ?? 0)} avg
				</div>
			</div>
		{/if}

		{#if costForecastLoading}
			<div class="panel reveal" style="animation-delay: 320ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">monthly forecast</div>
			</div>
		{:else if costForecastError}
			<div class="panel reveal" style="animation-delay: 320ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">monthly forecast</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 320ms;">
				<div class="stat-value accent">{formatCost(costForecast?.monthly_projection ?? 0)}</div>
				<div class="stat-label">monthly forecast</div>
				<div class="stat-sublabel">
					{formatCost(costForecast?.daily_rate ?? 0)}/day · based on {costForecast?.based_on_days ?? 0}d
				</div>
			</div>
		{/if}

		{#if avgTokensPerRequestLoading}
			<div class="panel reveal" style="animation-delay: 330ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">tokens/request</div>
			</div>
		{:else if avgTokensPerRequestError}
			<div class="panel reveal" style="animation-delay: 330ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">tokens/request</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 330ms;">
				<div class="stat-value">{formatNumber(avgTokensPerRequest?.avg_total ?? 0)}</div>
				<div class="stat-label">tokens/request</div>
				<div class="stat-sublabel">
					in {formatNumber(avgTokensPerRequest?.avg_input ?? 0)} · out {formatNumber(avgTokensPerRequest?.avg_output ?? 0)}
				</div>
			</div>
		{/if}

		{#if totalsLoading}
			<div class="panel reveal" style="animation-delay: 340ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">token efficiency</div>
			</div>
		{:else if totalsError}
			<div class="panel reveal" style="animation-delay: 340ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">token efficiency</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 340ms;">
				<div class="stat-value">{tokenEfficiency.toFixed(2)}x</div>
				<div class="stat-label">token efficiency</div>
				<div class="stat-sublabel">output / input ratio</div>
			</div>
		{/if}

		{#if modelDiversityLoading}
			<div class="panel reveal" style="animation-delay: 350ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">model diversity</div>
			</div>
		{:else if modelDiversityError}
			<div class="panel reveal" style="animation-delay: 350ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">model diversity</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 350ms;">
				<div class="stat-value">{((modelDiversity?.normalized_entropy ?? 0) * 100).toFixed(0)}%</div>
				<div class="stat-label">model diversity</div>
				<div class="stat-sublabel">{modelDiversity?.model_count ?? 0} models used</div>
			</div>
		{/if}
	</section>

	<!-- Session & Streak Stats -->
	<section class="stats-grid" aria-label="Session stats">
		{#if sessionStatsLoading}
			<div class="panel reveal" style="animation-delay: 360ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">avg session</div>
			</div>
			<div class="panel reveal" style="animation-delay: 370ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">longest session</div>
			</div>
			<div class="panel reveal" style="animation-delay: 380ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">sessions/day</div>
			</div>
		{:else if sessionStatsError}
			<div class="panel reveal" style="animation-delay: 360ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">avg session</div>
			</div>
			<div class="panel reveal" style="animation-delay: 370ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">longest session</div>
			</div>
			<div class="panel reveal" style="animation-delay: 380ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">sessions/day</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 360ms;">
				<div class="stat-value">{formatSessionDuration(sessionStats?.avg_duration_ms ?? 0)}</div>
				<div class="stat-label">avg session</div>
				<div class="stat-sublabel">{sessionStats?.total_sessions ?? 0} total sessions</div>
			</div>
			<div class="panel reveal" style="animation-delay: 370ms;">
				<div class="stat-value">{formatSessionDuration(sessionStats?.longest_duration_ms ?? 0)}</div>
				<div class="stat-label">longest session</div>
			</div>
			<div class="panel reveal" style="animation-delay: 380ms;">
				<div class="stat-value">{(sessionStats?.sessions_per_day ?? 0).toFixed(1)}</div>
				<div class="stat-label">sessions/day</div>
			</div>
		{/if}

		{#if codingStreakLoading}
			<div class="panel reveal" style="animation-delay: 390ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">current streak</div>
			</div>
			<div class="panel reveal" style="animation-delay: 400ms;">
				<div class="stat-value pulse">--</div>
				<div class="stat-label">longest streak</div>
			</div>
		{:else if codingStreakError}
			<div class="panel reveal" style="animation-delay: 390ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">current streak</div>
			</div>
			<div class="panel reveal" style="animation-delay: 400ms;">
				<div class="stat-value" style="color: #ef4444;">!</div>
				<div class="stat-label">longest streak</div>
			</div>
		{:else}
			<div class="panel reveal" style="animation-delay: 390ms;">
				<div class="stat-value accent">{codingStreak?.current_streak ?? 0}<span class="stat-unit">d</span></div>
				<div class="stat-label">current streak</div>
				<div class="stat-sublabel">{codingStreak?.total_active_days ?? 0} active days</div>
			</div>
			<div class="panel reveal" style="animation-delay: 400ms;">
				<div class="stat-value">{codingStreak?.longest_streak ?? 0}<span class="stat-unit">d</span></div>
				<div class="stat-label">longest streak</div>
			</div>
		{/if}
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

	<!-- Tokens explorer -->
	<section class="full-width-grid">
		<div class="panel reveal" style="animation-delay: 345ms;">
			<h2 class="section-title">tokens explorer</h2>
			{#if tokensDataLoading}
				{@render loadingState()}
			{:else if tokensDataError}
				{@render errorState(tokensDataError, fetchTokensData)}
			{:else if tokensData}
				<TokensZoomChart hourly={tokensData.hourly} daily={tokensData.daily} height={220} />
			{:else}
				<div class="text-tertiary text-sm py-8 text-center">No data available</div>
			{/if}
		</div>
	</section>
	{/if}

	{#if activeTab === 'models'}
	<!-- Model Performance Table -->
	<section class="panel reveal" style="animation-delay: 360ms; margin-bottom: 1.5rem;">
		<h2 class="section-title">model performance</h2>
		{#if costByModelLoading || modelPerformanceLoading}
			{@render loadingState()}
		{:else if costByModelError || modelPerformanceError}
			{@render errorState(costByModelError || modelPerformanceError, () => {
				fetchCostByModel();
				fetchModelPerformance();
			})}
		{:else if costByModel && costByModel.length > 0}
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
						{#each costByModel as model (model.model_id)}
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
