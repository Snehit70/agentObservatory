<script lang="ts">
	import { getConversations } from '$lib/remote/conversations.remote';

	type Conversation = {
		session_id: string;
		title: string | null;
		agent: string | null;
		project_dir: string | null;
		first_request_at: string | null;
		last_request_at: string | null;
		total_requests: number;
		total_cost_usd: number;
		total_tokens_input: number;
		total_tokens_output: number;
	};

	type AgentContribution = {
		agent: string;
		requests: number;
		tokens: number;
		requestShare: number;
		tokenShare: number;
	};

	let conversations = $state<Conversation[] | null>(null);
	let error = $state<string | null>(null);

	function fmt(iso: string | null): string {
		if (!iso) return '-';
		const d = new Date(iso);
		return Number.isNaN(d.valueOf())
			? '-'
			: d.toLocaleString(undefined, {
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				});
	}

	function normalizedAgent(agent: string | null): string {
		if (!agent) return 'unknown';
		return agent.toLowerCase();
	}

	const contribution = $derived.by(() => {
		if (!conversations || conversations.length === 0) {
			return {
				totalRequests: 0,
				totalTokens: 0,
				hermesRequests: 0,
				hermesTokens: 0,
				rows: [] as AgentContribution[]
			};
		}

		const byAgent = new Map<string, { requests: number; tokens: number }>();
		for (const c of conversations) {
			const agent = normalizedAgent(c.agent);
			const tokens = c.total_tokens_input + c.total_tokens_output;
			const prev = byAgent.get(agent) ?? { requests: 0, tokens: 0 };
			byAgent.set(agent, {
				requests: prev.requests + c.total_requests,
				tokens: prev.tokens + tokens
			});
		}

		const totalRequests = Array.from(byAgent.values()).reduce((sum, row) => sum + row.requests, 0);
		const totalTokens = Array.from(byAgent.values()).reduce((sum, row) => sum + row.tokens, 0);
		const hermes = byAgent.get('hermes') ?? { requests: 0, tokens: 0 };

		const rows = Array.from(byAgent.entries())
			.map(([agent, value]) => ({
				agent,
				requests: value.requests,
				tokens: value.tokens,
				requestShare: totalRequests > 0 ? value.requests / totalRequests : 0,
				tokenShare: totalTokens > 0 ? value.tokens / totalTokens : 0
			}))
			.sort((a, b) => b.tokens - a.tokens);

		return {
			totalRequests,
			totalTokens,
			hermesRequests: hermes.requests,
			hermesTokens: hermes.tokens,
			rows
		};
	});

	$effect(() => {
		getConversations()
			.then((result) => {
				conversations = result;
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : 'Failed to load';
			});
	});
</script>

<div class="page-container">
	<header class="header">
		<div class="header-left">
			<div class="header-breadcrumb">telemetry / conversations</div>
			<h1 class="header-title">Conversation <span class="accent">History</span></h1>
			<div class="header-subtitle">Sessions grouped by agent conversation (session).</div>
		</div>
	</header>

	{#if conversations && conversations.length > 0}
		<section
			class="panel"
			style="margin-bottom: 1rem; border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-grid-line-bright));"
		>
			<h2 class="section-title">Agent Contribution Overlay</h2>
			<div class="text-sm text-tertiary" style="margin-bottom: 0.75rem;">
				Hermes share across the visible conversation set.
			</div>
			<div
				style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem;"
			>
				<div class="panel" style="padding: 0.75rem;">
					<div class="text-xs text-tertiary">Hermes Requests</div>
					<div class="text-lg" style="font-family: var(--font-mono); color: #f59e0b;">
						{contribution.hermesRequests.toLocaleString()} / {contribution.totalRequests.toLocaleString()}
					</div>
					<div class="text-sm text-tertiary">
						{contribution.totalRequests > 0
							? ((contribution.hermesRequests / contribution.totalRequests) * 100).toFixed(1)
							: '0.0'}%
					</div>
				</div>
				<div class="panel" style="padding: 0.75rem;">
					<div class="text-xs text-tertiary">Hermes Tokens</div>
					<div class="text-lg" style="font-family: var(--font-mono); color: #f59e0b;">
						{contribution.hermesTokens.toLocaleString()} / {contribution.totalTokens.toLocaleString()}
					</div>
					<div class="text-sm text-tertiary">
						{contribution.totalTokens > 0
							? ((contribution.hermesTokens / contribution.totalTokens) * 100).toFixed(1)
							: '0.0'}%
					</div>
				</div>
			</div>

			<div style="display: grid; gap: 0.4rem;">
				{#each contribution.rows as row (row.agent)}
					<div
						style="display: grid; grid-template-columns: 120px 1fr auto; gap: 0.5rem; align-items: center;"
					>
						<div class="font-mono text-sm" style="color: {row.agent === 'hermes' ? '#f59e0b' : 'var(--color-text-secondary)'};">
							{row.agent}
						</div>
						<div
							style="height: 8px; background: var(--color-bg-elevated); border: 1px solid var(--color-grid-line); position: relative;"
						>
							<div
								style="position: absolute; inset: 0 auto 0 0; width: {(row.tokenShare * 100).toFixed(2)}%; background: {row.agent === 'hermes' ? '#f59e0b' : 'var(--color-accent)'};"
							></div>
						</div>
						<div class="text-xs text-tertiary" style="font-family: var(--font-mono);">
							{(row.tokenShare * 100).toFixed(1)}% tok · {(row.requestShare * 100).toFixed(1)}% req
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section class="panel">
		<h2 class="section-title">conversations</h2>
		{#if error}
			<div class="text-tertiary text-sm py-8 text-center">{error}</div>
		{:else if !conversations}
			<div class="loading-skeleton">
				<div class="skeleton-line"></div>
				<div class="skeleton-line short"></div>
			</div>
		{:else if conversations.length === 0}
			<div class="text-tertiary text-sm py-8 text-center">No sessions yet</div>
		{:else}
			<div class="table-container scrollable">
				<table>
					<thead>
						<tr>
							<th>last</th>
							<th>title</th>
							<th>requests</th>
							<th>tokens</th>
							<th>cost</th>
						</tr>
					</thead>
					<tbody>
						{#each conversations as c (c.session_id)}
							<tr>
								<td class="text-tertiary text-sm">{fmt(c.last_request_at)}</td>
								<td>
									<a
										href={`/conversations/${encodeURIComponent(c.session_id)}`}
										style="color: var(--color-accent); text-decoration: none;"
									>
										<span class="font-mono text-sm">{c.session_id.slice(0, 12)}…</span>
										<span class="text-tertiary text-sm"> — {c.title ?? '(no title yet)'}</span>
									</a>
								</td>
								<td>{c.total_requests.toLocaleString()}</td>
								<td class="text-sm"
									>{c.total_tokens_input.toLocaleString()}/{c.total_tokens_output.toLocaleString()}</td
								>
								<td class="text-sm">${c.total_cost_usd.toFixed(4)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
