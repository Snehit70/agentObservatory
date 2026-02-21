<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import * as d3 from 'd3';

	type TimeDataPoint = {
		label: string;
		cost_usd: number;
		tokens_input: number;
		tokens_output: number;
		tokens_reasoning: number;
		tokens_cache_read: number;
		tokens_cache_write: number;
	};

	interface Props {
		data: TimeDataPoint[];
		height?: number;
		viewMode?: 'cost' | 'tokens';
		color?: string;
	}

	let { data, height = 220, viewMode = 'cost', color = 'var(--color-accent)' }: Props = $props();

	let svgElement: SVGSVGElement | undefined = $state();
	let actualWidth = $state(0);

	type TooltipState = {
		x: number;
		y: number;
		title: string;
		lines: { label: string; value: string }[];
	};

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

	function formatUsd(n: number) {
		if (n >= 100) return `$${n.toFixed(0)}`;
		if (n >= 1) return `$${n.toFixed(2)}`;
		return `$${n.toFixed(4)}`;
	}

	function formatTokens(n: number) {
		return `${(n / 1_000_000_000).toFixed(2)}B`;
	}

	function getTotalTokens(d: TimeDataPoint) {
		return d.tokens_input + d.tokens_output + d.tokens_reasoning + d.tokens_cache_read + d.tokens_cache_write;
	}

	function getValue(d: TimeDataPoint) {
		return viewMode === 'cost' ? d.cost_usd : getTotalTokens(d);
	}

	function formatValue(n: number) {
		return viewMode === 'cost' ? formatUsd(n) : formatTokens(n);
	}

	let valueLabel = $derived(viewMode === 'cost' ? 'Cost' : 'Tokens');

	function renderChart(containerEl: HTMLDivElement) {
		if (!svgElement || !data || data.length === 0) return;

		const svg = d3.select(svgElement);
		svg.selectAll('*').remove();

		const resolvedColor = resolveCssColor(color);

		const margin = { top: 35, right: 20, bottom: 30, left: 70 };
		const innerWidth = actualWidth - margin.left - margin.right;
		const innerHeight = height - margin.top - margin.bottom;

		const g = svg
			.attr('width', actualWidth)
			.attr('height', height)
			.append('g')
			.attr('transform', `translate(${margin.left},${margin.top})`);

		const gradientId = `timeExplorerGrad-${viewMode}`;
		const defs = svg.append('defs');
		const gradient = defs
			.append('linearGradient')
			.attr('id', gradientId)
			.attr('x1', '0%')
			.attr('y1', '0%')
			.attr('x2', '0%')
			.attr('y2', '100%');
		gradient
			.append('stop')
			.attr('offset', '0%')
			.attr('stop-color', resolvedColor)
			.attr('stop-opacity', 0.4);
		gradient
			.append('stop')
			.attr('offset', '100%')
			.attr('stop-color', resolvedColor)
			.attr('stop-opacity', 0);

		const parsedData = data.map((d, i) => ({
			...d,
			index: i,
			value: getValue(d)
		}));

		const y = d3
			.scaleLinear()
			.domain([0, d3.max(parsedData, (d) => d.value) || 0])
			.nice()
			.range([innerHeight, 0]);

		g.append('g')
			.attr('class', 'grid')
			.call(
				d3
					.axisLeft(y)
					.tickSize(-innerWidth)
					.tickFormat(() => '')
			)
			.selectAll('line')
			.attr('stroke', 'rgba(255, 255, 255, 0.06)');

		if (parsedData.length === 1) {
			const d = parsedData[0];
			const barWidth = Math.min(100, innerWidth / 3);
			const centerX = innerWidth / 2;

			const bar = g
				.append('rect')
				.attr('x', centerX - barWidth / 2)
				.attr('y', innerHeight)
				.attr('width', barWidth)
				.attr('height', 0)
				.attr('fill', `url(#${gradientId})`)
				.attr('stroke', resolvedColor)
				.attr('stroke-width', 2)
				.attr('rx', 0)
				.style('cursor', 'pointer')
				.on('pointermove', (event) => {
					const [px, py] = d3.pointer(event, containerEl);
					tooltip = {
						x: clamp(px + 12, 8, actualWidth - 170),
						y: clamp(py - 12, 8, height - 70),
						title: d.label,
						lines: [{ label: valueLabel, value: formatValue(d.value) }]
					};
				})
				.on('pointerleave', () => {
					tooltip = null;
				});

			bar.transition().duration(800).attr('y', y(d.value)).attr('height', innerHeight - y(d.value));

			g.append('text')
				.attr('x', centerX)
				.attr('y', y(d.value) - 15)
				.attr('text-anchor', 'middle')
				.attr('fill', resolvedColor)
				.attr('font-size', '16px')
				.attr('font-weight', '600')
				.attr('font-family', 'JetBrains Mono, monospace')
				.attr('opacity', 0)
				.text(formatValue(d.value))
				.transition()
				.duration(800)
				.attr('opacity', 1);

			g.append('text')
				.attr('x', centerX)
				.attr('y', innerHeight + 20)
				.attr('text-anchor', 'middle')
				.attr('fill', 'rgba(255, 255, 255, 0.50)')
				.attr('font-size', '10px')
				.text(d.label);

			g.append('g')
				.attr('class', 'axis')
				.call(d3.axisLeft(y).ticks(5).tickFormat((v) => (viewMode === 'cost' ? d3.format('$.2s')(v as number) : d3.format('.2s')(v as number))))
				.selectAll('text')
				.attr('fill', 'rgba(255, 255, 255, 0.50)')
				.attr('font-size', '10px');

			g.selectAll('.domain').attr('stroke', 'rgba(255, 255, 255, 0.10)');
			return;
		}

		const x = d3.scalePoint<string>().domain(parsedData.map((d) => d.label)).range([0, innerWidth]);

		g.append('g')
			.attr('class', 'grid')
			.attr('transform', `translate(0,${innerHeight})`)
			.call(
				d3
					.axisBottom(x)
					.tickSize(-innerHeight)
					.tickFormat(() => '')
			)
			.selectAll('line')
			.attr('stroke', 'rgba(255, 255, 255, 0.06)');

		const line = d3
			.line<typeof parsedData[0]>()
			.x((d) => x(d.label) ?? 0)
			.y((d) => y(d.value))
			.curve(d3.curveMonotoneX);

		const area = d3
			.area<typeof parsedData[0]>()
			.x((d) => x(d.label) ?? 0)
			.y0(innerHeight)
			.y1((d) => y(d.value))
			.curve(d3.curveMonotoneX);

		g.append('path')
			.datum(parsedData)
			.attr('fill', `url(#${gradientId})`)
			.attr('d', area)
			.attr('opacity', 0)
			.transition()
			.duration(800)
			.attr('opacity', 1);

		const path = g
			.append('path')
			.datum(parsedData)
			.attr('fill', 'none')
			.attr('stroke', resolvedColor)
			.attr('stroke-width', 2)
			.attr('d', line);

		const totalLength = path.node()?.getTotalLength() || 0;
		path.attr('stroke-dasharray', `${totalLength} ${totalLength}`)
			.attr('stroke-dashoffset', totalLength)
			.transition()
			.duration(1000)
			.ease(d3.easeQuadOut)
			.attr('stroke-dashoffset', 0);

		const tickValues = parsedData.length <= 7 ? parsedData.map((d) => d.label) : parsedData.filter((_, i) => i % Math.ceil(parsedData.length / 7) === 0).map((d) => d.label);

		g.append('g')
			.attr('class', 'axis')
			.attr('transform', `translate(0,${innerHeight})`)
			.call(d3.axisBottom(x).tickValues(tickValues))
			.selectAll('text')
			.attr('fill', 'rgba(255, 255, 255, 0.50)')
			.attr('font-size', '10px');

		g.append('g')
			.attr('class', 'axis')
			.call(d3.axisLeft(y).ticks(5).tickFormat((v) => (viewMode === 'cost' ? d3.format('$.2s')(v as number) : d3.format('.2s')(v as number))))
			.selectAll('text')
			.attr('fill', 'rgba(255, 255, 255, 0.50)')
			.attr('font-size', '10px');

		g.selectAll('.domain').attr('stroke', 'rgba(255, 255, 255, 0.10)');

		g.selectAll('.dot')
			.data(parsedData)
			.enter()
			.append('circle')
			.attr('class', 'dot')
			.attr('cx', (d) => x(d.label) ?? 0)
			.attr('cy', (d) => y(d.value))
			.attr('r', 0)
			.attr('fill', resolvedColor)
			.style('pointer-events', 'none')
			.transition()
			.delay((_, i) => i * 30)
			.duration(300)
			.attr('r', 3);

		const focus = g.append('g').style('display', 'none');

		const focusLine = focus
			.append('line')
			.attr('y1', 0)
			.attr('y2', innerHeight)
			.attr('stroke', 'rgba(255, 255, 255, 0.18)')
			.attr('stroke-dasharray', '3,3');

		const focusOuter = focus
			.append('circle')
			.attr('r', 7)
			.attr('fill', 'rgba(0, 0, 0, 0.85)')
			.attr('stroke', resolvedColor)
			.attr('stroke-width', 1.5);

		const focusDot = focus.append('circle').attr('r', 3).attr('fill', resolvedColor);

		g.append('rect')
			.attr('width', innerWidth)
			.attr('height', innerHeight)
			.attr('fill', 'transparent')
			.style('cursor', 'crosshair')
			.on('pointerenter', () => {
				focus.style('display', null);
			})
			.on('pointerleave', () => {
				focus.style('display', 'none');
				tooltip = null;
			})
			.on('pointermove', (event) => {
				const [mx] = d3.pointer(event, g.node() as SVGGElement);
				const positions = parsedData.map((d) => ({ d, x: x(d.label) ?? 0 }));
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
				const cy = y(d.value);

				focus.attr('transform', `translate(${cx},0)`);
				focusLine.attr('x1', 0).attr('x2', 0);
				focusOuter.attr('cx', 0).attr('cy', cy);
				focusDot.attr('cx', 0).attr('cy', cy);

				const [px, py] = d3.pointer(event, containerEl);
				tooltip = {
					x: clamp(px + 12, 8, actualWidth - 170),
					y: clamp(py - 12, 8, height - 70),
					title: d.label,
					lines: [{ label: valueLabel, value: formatValue(d.value) }]
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
			void viewMode;
			if (data && actualWidth) {
				renderChart(el);
			}
		});

		return () => resizeObserver.disconnect();
	};
</script>

<div {@attach chartAttachment} class="chart-container" style="width: 100%;">
	<svg bind:this={svgElement}></svg>
	{#if tooltip}
		<div class="tooltip" style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
			<div class="tooltip-title">{tooltip.title}</div>
			{#each tooltip.lines as line}
				<div class="tooltip-row">
					<span class="muted">{line.label}</span>
					<span class="value">{line.value}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
