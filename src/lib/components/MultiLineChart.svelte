<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import * as d3 from 'd3';

	type SeriesConfig = {
		key: 'avg_ms' | 'p50_ms' | 'p95_ms';
		label: string;
		color: string;
		dashed?: boolean;
	};

	interface Props {
		data: DataPoint[];
		height?: number;
		series?: SeriesConfig[];
		yFormatter?: (v: number) => string;
	}

	type DataPoint = {
		date: string;
		avg_ms: number;
		p50_ms: number;
		p95_ms: number;
	};

	type TooltipState = {
		x: number;
		y: number;
		title: string;
		lines: { label: string; value: string; color: string }[];
	};

	let {
		data,
		height = 220,
		series = [
			{ key: 'p95_ms' as const, label: 'P95', color: '#ef4444', dashed: true },
			{ key: 'avg_ms' as const, label: 'Avg', color: 'var(--color-accent)' },
			{ key: 'p50_ms' as const, label: 'P50', color: '#22c55e' }
		],
		yFormatter = (v) => {
			if (v >= 60000) return `${(v / 60000).toFixed(1)}m`;
			if (v >= 1000) return `${(v / 1000).toFixed(0)}s`;
			return `${v.toFixed(0)}ms`;
		}
	}: Props = $props();

	let svgElement: SVGSVGElement | undefined = $state();
	let actualWidth = $state(0);
	let tooltip = $state<TooltipState | null>(null);

	function clamp(n: number, min: number, max: number) {
		return Math.max(min, Math.min(max, n));
	}

	function resolveCssColor(value: string) {
		if (typeof window === 'undefined') return value;
		const match = value.match(/^var\((--[^)]+)\)$/);
		if (!match) return value;
		return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || value;
	}

	function renderChart(containerEl: HTMLDivElement) {
		if (!svgElement || !data || data.length === 0) return;

		const svg = d3.select(svgElement);
		svg.selectAll('*').remove();

		const margin = { top: 10, right: 20, bottom: 30, left: 60 };
		const innerWidth = actualWidth - margin.left - margin.right;
		const innerHeight = height - margin.top - margin.bottom;

		const g = svg
			.attr('width', actualWidth)
			.attr('height', height)
			.append('g')
			.attr('transform', `translate(${margin.left},${margin.top})`);

		const x = d3.scalePoint<string>()
			.domain(data.map((d) => d.date))
			.range([0, innerWidth]);

		const maxVal = d3.max(data, (d) => Math.max(d.avg_ms, d.p50_ms, d.p95_ms)) || 0;

		const y = d3.scaleLinear()
			.domain([0, maxVal > 0 ? maxVal * 1.1 : 1000])
			.nice()
			.range([innerHeight, 0]);

		// Y-axis grid
		g.append('g')
			.attr('class', 'grid')
			.call(
				d3.axisLeft(y)
					.tickSize(-innerWidth)
					.tickFormat(() => '')
			)
			.selectAll('line')
			.attr('stroke', 'rgba(255, 255, 255, 0.06)');

		// X-axis grid
		g.append('g')
			.attr('class', 'grid')
			.attr('transform', `translate(0,${innerHeight})`)
			.call(
				d3.axisBottom(x)
					.tickSize(-innerHeight)
					.tickFormat(() => '')
			)
			.selectAll('line')
			.attr('stroke', 'rgba(255, 255, 255, 0.06)');

		// X axis labels
		const tickInterval = Math.max(1, Math.ceil(data.length / 7));
		const tickValues = data.filter((_, i) => i % tickInterval === 0).map((d) => d.date);

		g.append('g')
			.attr('class', 'axis')
			.attr('transform', `translate(0,${innerHeight})`)
			.call(
				d3.axisBottom(x)
					.tickValues(tickValues)
					.tickFormat((d: string) => {
						const [year, month, day] = d.split('-').map(Number);
						return new Date(year, month - 1, day)
							.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
					})
			)
			.selectAll('text')
			.attr('fill', 'rgba(255, 255, 255, 0.50)')
			.attr('font-size', '10px');

		// Y axis labels
		g.append('g')
			.attr('class', 'axis')
			.call(d3.axisLeft(y).ticks(5).tickFormat((v) => yFormatter(v as number)))
			.selectAll('text')
			.attr('fill', 'rgba(255, 255, 255, 0.50)')
			.attr('font-size', '10px');

		g.selectAll('.domain').attr('stroke', 'rgba(255, 255, 255, 0.10)');

		// Draw series lines with stroke-dasharray draw animation (matches TimeExplorer)
		for (const s of series) {
			const color = resolveCssColor(s.color);

			const lineFn = d3
				.line<DataPoint>()
				.x((d) => x(d.date) ?? 0)
				.y((d) => y(d[s.key]))
				.curve(d3.curveMonotoneX);

			const path = g
				.append('path')
				.datum(data)
				.attr('fill', 'none')
				.attr('stroke', color)
				.attr('stroke-width', s.dashed ? 1.5 : 2)
				.attr('stroke-dasharray', s.dashed ? '6,4' : 'none')
				.attr('d', lineFn);

			if (!s.dashed) {
				// Draw animation: stroke-dashoffset unwind (same as AreaChart/TimeExplorer)
				const totalLength = path.node()?.getTotalLength() || 0;
				path
					.attr('stroke-dasharray', `${totalLength} ${totalLength}`)
					.attr('stroke-dashoffset', totalLength)
					.transition()
					.duration(1000)
					.ease(d3.easeQuadOut)
					.attr('stroke-dashoffset', 0);
			} else {
				// Dashed lines: fade in
				path
					.attr('opacity', 0)
					.transition()
					.duration(800)
					.attr('opacity', 0.75);
			}

			// Dots: r 0 → 3 (same as AreaChart)
			g.selectAll(`.dot-${s.key}`)
				.data(data)
				.enter()
				.append('circle')
				.attr('class', `dot dot-${s.key}`)
				.attr('cx', (d) => x(d.date) ?? 0)
				.attr('cy', (d) => y(d[s.key]))
				.attr('r', 0)
				.attr('fill', color)
				.style('pointer-events', 'none')
				.transition()
				.delay((_, i) => i * 30)
				.duration(300)
				.attr('r', s.dashed ? 2 : 3);
		}

		// Hover: one focus group per series with focusOuter ring + focusDot (matches AreaChart)
		const focusGroups = series.map((s) => {
			const color = resolveCssColor(s.color);
			const focus = g.append('g').style('display', 'none');

			focus.append('circle')
				.attr('class', 'focus-outer')
				.attr('r', 7)
				.attr('fill', 'rgba(0, 0, 0, 0.85)')
				.attr('stroke', color)
				.attr('stroke-width', 1.5);

			focus.append('circle')
				.attr('class', 'focus-dot')
				.attr('r', 3)
				.attr('fill', color);

			return focus;
		});

		// Shared vertical crosshair line
		const crosshair = g
			.append('line')
			.attr('y1', 0)
			.attr('y2', innerHeight)
			.attr('stroke', 'rgba(255, 255, 255, 0.18)')
			.attr('stroke-dasharray', '3,3')
			.style('display', 'none');

		// Interaction overlay
		g.append('rect')
			.attr('width', innerWidth)
			.attr('height', innerHeight)
			.attr('fill', 'transparent')
			.style('cursor', 'crosshair')
			.on('pointerenter', () => {
				focusGroups.forEach((f) => f.style('display', null));
				crosshair.style('display', null);
			})
			.on('pointerleave', () => {
				focusGroups.forEach((f) => f.style('display', 'none'));
				crosshair.style('display', 'none');
				tooltip = null;
			})
			.on('pointermove', (event) => {
				const [mx] = d3.pointer(event, g.node() as SVGGElement);
				const positions = data.map((d) => ({ d, x: x(d.date) ?? 0 }));
				let closest = positions[0];
				let minDist = Math.abs(mx - closest.x);
				for (const p of positions) {
					const dist = Math.abs(mx - p.x);
					if (dist < minDist) {
						minDist = dist;
						closest = p;
					}
				}

				const d = closest.d;
				const cx = closest.x;

				crosshair.attr('x1', cx).attr('x2', cx);

				focusGroups.forEach((focus, i) => {
					const cy = y(d[series[i].key]);
					focus.select('.focus-outer').attr('cx', cx).attr('cy', cy);
					focus.select('.focus-dot').attr('cx', cx).attr('cy', cy);
				});

				const [px, py] = d3.pointer(event, containerEl);
				const [year, month, day] = d.date.split('-').map(Number);
				const dateLabel = new Date(year, month - 1, day)
					.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

				tooltip = {
					x: clamp(px + 12, 8, actualWidth - 180),
					y: clamp(py - 12, 8, height - 100),
					title: dateLabel,
					lines: series.map((s) => ({
						label: s.label,
						value: yFormatter(d[s.key]),
						color: resolveCssColor(s.color)
					}))
				};
			});
	}

	const chartAttachment: Attachment = (container) => {
		const el = container as HTMLDivElement;
		actualWidth = el.clientWidth || 300;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				actualWidth = entry.contentRect.width;
			}
		});
		resizeObserver.observe(el);

		$effect(() => {
			if (data && actualWidth) {
				renderChart(el);
			}
		});

		return () => resizeObserver.disconnect();
	};
</script>

<div class="chart-legend">
	{#each series as s}
		<span class="legend-item">
			<svg width="20" height="10" style="vertical-align: middle; margin-right: 4px;">
				{#if s.dashed}
					<line x1="0" y1="5" x2="20" y2="5" stroke={s.color.startsWith('var') ? 'currentColor' : s.color} stroke-width="1.5" stroke-dasharray="4,3" style={s.color.startsWith('var') ? `color: ${s.color}` : ''} />
				{:else}
					<line x1="0" y1="5" x2="20" y2="5" stroke={s.color.startsWith('var') ? 'currentColor' : s.color} stroke-width="2" style={s.color.startsWith('var') ? `color: ${s.color}` : ''} />
				{/if}
				<circle cx="10" cy="5" r="2.5" fill={s.color.startsWith('var') ? 'currentColor' : s.color} style={s.color.startsWith('var') ? `color: ${s.color}` : ''} />
			</svg>{s.label}
		</span>
	{/each}
</div>

<div {@attach chartAttachment} class="chart-container" style="width: 100%;">
	<svg bind:this={svgElement}></svg>
	{#if tooltip}
		<div class="tooltip" style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
			<div class="tooltip-title">{tooltip.title}</div>
			{#each tooltip.lines as line}
				<div class="tooltip-row">
					<span class="muted" style="display: inline-flex; align-items: center; gap: 4px;">
						<span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: {line.color}; flex-shrink: 0;"></span>
						{line.label}
					</span>
					<span class="value">{line.value}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
