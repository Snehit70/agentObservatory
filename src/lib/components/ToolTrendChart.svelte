<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import * as d3 from 'd3';

	type TrendPoint = {
		label: string;
		total: number;
		successes: number;
		failures: number;
	};

	interface Props {
		data: TrendPoint[];
		height?: number;
	}

	let { data, height = 200 }: Props = $props();
	let svgElement: SVGSVGElement | undefined = $state();
	let actualWidth = $state(0);

	type TooltipState = {
		x: number;
		y: number;
		title: string;
		lines: { label: string; value: string; color: string }[];
	};

	let tooltip = $state<TooltipState | null>(null);

	function clamp(n: number, min: number, max: number) {
		return Math.max(min, Math.min(max, n));
	}

	function renderChart(containerEl: HTMLDivElement) {
		if (!svgElement || !data || data.length === 0) return;

		const svg = d3.select(svgElement);
		svg.selectAll('*').remove();

		const margin = { top: 16, right: 16, bottom: 28, left: 52 };
		const innerWidth = actualWidth - margin.left - margin.right;
		const innerHeight = height - margin.top - margin.bottom;

		const g = svg
			.attr('width', actualWidth)
			.attr('height', height)
			.append('g')
			.attr('transform', `translate(${margin.left},${margin.top})`);

		const x = d3
			.scalePoint<string>()
			.domain(data.map((d) => d.label))
			.range([0, innerWidth]);

		const maxValue = d3.max(data, (d) => d.total) ?? 1;
		const y = d3.scaleLinear().domain([0, maxValue]).nice().range([innerHeight, 0]);

		g.append('g')
			.call(d3.axisLeft(y).tickSize(-innerWidth).tickFormat(() => ''))
			.selectAll('line')
			.attr('stroke', 'rgba(255,255,255,0.06)');

		const area = d3
			.area<TrendPoint>()
			.x((d) => x(d.label) ?? 0)
			.y0(innerHeight)
			.y1((d) => y(d.total))
			.curve(d3.curveMonotoneX);

		const totalLine = d3
			.line<TrendPoint>()
			.x((d) => x(d.label) ?? 0)
			.y((d) => y(d.total))
			.curve(d3.curveMonotoneX);

		const failLine = d3
			.line<TrendPoint>()
			.x((d) => x(d.label) ?? 0)
			.y((d) => y(d.failures))
			.curve(d3.curveMonotoneX);

		const defs = svg.append('defs');
		const gradient = defs
			.append('linearGradient')
			.attr('id', 'toolTrendGradient')
			.attr('x1', '0%')
			.attr('y1', '0%')
			.attr('x2', '0%')
			.attr('y2', '100%');
		gradient.append('stop').attr('offset', '0%').attr('stop-color', 'var(--color-accent)').attr('stop-opacity', 0.35);
		gradient.append('stop').attr('offset', '100%').attr('stop-color', 'var(--color-accent)').attr('stop-opacity', 0);

		g.append('path').datum(data).attr('fill', 'url(#toolTrendGradient)').attr('d', area);

		g.append('path')
			.datum(data)
			.attr('fill', 'none')
			.attr('stroke', 'var(--color-accent)')
			.attr('stroke-width', 2)
			.attr('d', totalLine);

		g.append('path')
			.datum(data)
			.attr('fill', 'none')
			.attr('stroke', '#ef4444')
			.attr('stroke-width', 1.5)
			.attr('stroke-dasharray', '4,3')
			.attr('opacity', 0.75)
			.attr('d', failLine);

		const tickValues =
			data.length <= 8
				? data.map((d) => d.label)
				: data.filter((_, i) => i % Math.ceil(data.length / 8) === 0).map((d) => d.label);

		g.append('g')
			.attr('transform', `translate(0,${innerHeight})`)
			.call(d3.axisBottom(x).tickValues(tickValues))
			.selectAll('text')
			.attr('fill', 'rgba(255,255,255,0.45)')
			.attr('font-size', '9px');

		g.append('g')
			.call(d3.axisLeft(y).ticks(4).tickFormat((v) => d3.format('.2s')(v as number)))
			.selectAll('text')
			.attr('fill', 'rgba(255,255,255,0.45)')
			.attr('font-size', '9px');

		const focus = g.append('g').style('display', 'none');
		focus
			.append('line')
			.attr('y1', 0)
			.attr('y2', innerHeight)
			.attr('stroke', 'rgba(255,255,255,0.15)')
			.attr('stroke-dasharray', '3,3');
		focus
			.append('circle')
			.attr('r', 7)
			.attr('fill', 'rgba(0,0,0,0.85)')
			.attr('stroke', 'var(--color-accent)')
			.attr('stroke-width', 1.5);
		focus.append('circle').attr('r', 3).attr('fill', 'var(--color-accent)');

		g.append('rect')
			.attr('width', innerWidth)
			.attr('height', innerHeight)
			.attr('fill', 'transparent')
			.style('cursor', 'crosshair')
			.on('pointerenter', () => focus.style('display', null))
			.on('pointerleave', () => {
				focus.style('display', 'none');
				tooltip = null;
			})
			.on('pointermove', (event) => {
				const [mx] = d3.pointer(event, g.node() as SVGGElement);
				const positions = data.map((d) => ({ d, xValue: x(d.label) ?? 0 }));
				let closest = positions[0];
				let minDist = Math.abs(mx - closest.xValue);
				for (const p of positions) {
					const dist = Math.abs(mx - p.xValue);
					if (dist < minDist) {
						minDist = dist;
						closest = p;
					}
				}

				const d = closest.d;
				const cx = closest.xValue;
				const cy = y(d.total);

				focus.attr('transform', `translate(${cx},0)`);
				focus.select('line').attr('x1', 0).attr('x2', 0);
				focus.selectAll('circle').attr('cx', 0).attr('cy', cy);

				const [px, py] = d3.pointer(event, containerEl);
				const successRate = d.total > 0 ? ((d.successes / d.total) * 100).toFixed(1) : '0.0';
				tooltip = {
					x: clamp(px + 12, 8, actualWidth - 170),
					y: clamp(py - 12, 8, height - 90),
					title: d.label,
					lines: [
						{ label: 'Total', value: d.total.toLocaleString(), color: 'var(--color-accent)' },
						{ label: 'Success', value: d.successes.toLocaleString(), color: '#22c55e' },
						{ label: 'Failures', value: d.failures.toLocaleString(), color: '#ef4444' },
						{ label: 'Rate', value: `${successRate}%`, color: 'rgba(255,255,255,0.65)' }
					]
				};
			});
	}

	const chartAttachment: Attachment = (container) => {
		const el = container as HTMLDivElement;
		actualWidth = el.clientWidth || 300;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				actualWidth = entry.contentRect.width;
			}
		});
		observer.observe(el);

		$effect(() => {
			void data;
			if (data && actualWidth) {
				renderChart(el);
			}
		});

		return () => observer.disconnect();
	};
</script>

<div {@attach chartAttachment} class="chart-container" style="width: 100%; position: relative;">
	<svg bind:this={svgElement}></svg>
	{#if tooltip}
		<div class="tooltip" style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
			<div class="tooltip-title">{tooltip.title}</div>
			{#each tooltip.lines as line}
				<div class="tooltip-row">
					<span class="muted">{line.label}</span>
					<span class="value" style="color: {line.color};">{line.value}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
