// Framework-agnostic chart geometry. Each builder turns a number series into
// SVG path strings + axis ticks; a .svelte component renders the <svg> and
// applies colours from the --chart-* CSS variables (see app.css).

export interface GridLine {
	y: number;
	label: string;
}
export interface XLabel {
	x: number;
	label: string;
	anchor: 'start' | 'middle' | 'end';
}

function niceMax(v: number): number {
	if (v <= 0) return 1;
	const pw = Math.pow(10, Math.floor(Math.log10(v)));
	const n = v / pw;
	const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
	let m = 10;
	for (const s of steps) {
		if (n <= s) {
			m = s;
			break;
		}
	}
	return m * pw;
}

function linePath(pts: Array<[number, number]>): string {
	return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}

interface AxisOpts {
	W: number;
	H: number;
	labels: string[];
	fmt?: (v: number) => string;
	yMax?: number;
	margin?: { t: number; r: number; b: number; l: number };
}
interface Axis {
	X: (i: number) => number;
	Y: (v: number) => number;
	gridlines: GridLine[];
	xLabels: XLabel[];
	top: number; // plot-area top edge (crosshair extent)
	baseline: number;
	max: number;
	left: number; // plot-area left edge (for hover → nearest-index mapping)
	right: number; // plot-area right edge
}
function makeAxis(max: number, o: AxisOpts): Axis {
	const m = o.margin ?? { t: 10, r: 16, b: 22, l: 42 };
	const n = o.labels.length;
	const iw = o.W - m.l - m.r,
		ih = o.H - m.t - m.b;
	const X = (i: number) => (n <= 1 ? m.l + iw / 2 : m.l + (i / (n - 1)) * iw);
	const Y = (v: number) => m.t + ih - (Math.max(0, Math.min(v, max)) / max) * ih;

	const gridlines: GridLine[] = [];
	const T = 4;
	for (let t = 0; t <= T; t++) {
		const val = (max * t) / T;
		gridlines.push({ y: Y(val), label: o.fmt ? o.fmt(val) : String(Math.round(val)) });
	}

	const step = n <= 1 ? 1 : Math.max(1, Math.round(n / 6));
	const idx: number[] = [];
	for (let i = 0; i < n; i += step) idx.push(i);
	if (n > 1 && idx[idx.length - 1] !== n - 1) idx.push(n - 1);
	const xLabels: XLabel[] = idx.map((i) => ({
		x: X(i),
		label: o.labels[i],
		anchor: i === 0 ? 'start' : i >= n - 1 ? 'end' : 'middle'
	}));

	return { X, Y, gridlines, xLabels, top: m.t, baseline: m.t + ih, max, left: m.l, right: o.W - m.r };
}

// A hover point per data index — x position + the axis label + the raw values, so a
// chart component can map a mouse position to the nearest index and show a tooltip.
export interface HoverPoint {
	x: number;
	label: string;
}
export interface Plot {
	left: number;
	right: number;
	viewW: number;
}

// Build line (and optional area) paths that BREAK at null points, so a "no data"
// day leaves a gap instead of being plotted as a real 0 (which reads as a value).
// `bridges` connects the ends across each gap — rendered as a faint DASHED stroke
// (dash = "no data here"), it keeps the eye on the series through idle stretches
// instead of leaving stranded segments and orphan dots.
function gappedPaths(
	pts: Array<[number, number] | null>,
	baseline: number,
	wantArea: boolean
): { line: string; area: string; bridges: string; dots: Array<{ x: number; y: number }> } {
	let line = '';
	let area = '';
	let bridges = '';
	const dots: Array<{ x: number; y: number }> = [];
	let run: Array<[number, number]> = [];
	let lastEnd: [number, number] | null = null; // end of the previous run (bridge start)
	const flush = () => {
		if (run.length === 0) return;
		if (lastEnd) {
			bridges +=
				(bridges ? ' ' : '') +
				`M${lastEnd[0].toFixed(1)} ${lastEnd[1].toFixed(1)} L${run[0][0].toFixed(1)} ${run[0][1].toFixed(1)}`;
		}
		if (run.length === 1) {
			// A lone point between gaps has no line/area to stroke — mark it with a dot
			// so a real isolated data day stays visible instead of vanishing.
			dots.push({ x: run[0][0], y: run[0][1] });
		} else {
			const seg = run.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
			line += (line ? ' ' : '') + seg;
			if (wantArea) {
				const first = run[0];
				const lastp = run[run.length - 1];
				area +=
					(area ? ' ' : '') +
					`${seg} L ${lastp[0].toFixed(1)} ${baseline} L ${first[0].toFixed(1)} ${baseline} Z`;
			}
		}
		lastEnd = run[run.length - 1];
		run = [];
	};
	for (const p of pts) {
		if (p == null) flush();
		else run.push(p);
	}
	flush();
	return { line, area, bridges, dots };
}

function lastPoint(pts: Array<[number, number] | null>): { x: number; y: number } | null {
	for (let i = pts.length - 1; i >= 0; i--) {
		const p = pts[i];
		if (p) return { x: p[0], y: p[1] };
	}
	return null;
}

export interface LineChart {
	viewBox: string;
	gridlines: GridLine[];
	xLabels: XLabel[];
	linePath: string;
	areaPath: string | null;
	bridgePath: string; // dashed connectors across null gaps ("no data here")
	dots: Array<{ x: number; y: number }>;
	last: { x: number; y: number } | null;
	points: Array<HoverPoint & { y: number | null; value: number | null }>;
	plot: Plot;
}
/** Single line, optional area fill; null points create gaps (missing data ≠ 0). */
export function buildLineChart(
	series: Array<number | null>,
	opts: AxisOpts & { area?: boolean }
): LineChart {
	const nonNull = series.filter((v): v is number => v != null);
	const max = opts.yMax != null ? opts.yMax : niceMax(Math.max(1, ...nonNull));
	const ax = makeAxis(max, opts);
	const pts = series.map((v, i) => (v == null ? null : ([ax.X(i), ax.Y(v)] as [number, number])));
	const { line, area, bridges, dots } = gappedPaths(pts, ax.baseline, !!opts.area);

	return {
		viewBox: `0 0 ${opts.W} ${opts.H}`,
		gridlines: ax.gridlines,
		xLabels: ax.xLabels,
		linePath: line,
		areaPath: opts.area ? area : null,
		bridgePath: bridges,
		dots,
		last: lastPoint(pts),
		points: series.map((v, i) => ({
			x: ax.X(i),
			y: v == null ? null : ax.Y(v),
			label: opts.labels[i] ?? '',
			value: v
		})),
		plot: { left: ax.left, right: ax.right, viewW: opts.W }
	};
}

export interface CallsChart {
	viewBox: string;
	gridlines: GridLine[];
	xLabels: XLabel[];
	answeredArea: string;
	notAnsweredBand: string;
	receivedLine: string;
	answeredLine: string;
	answeredDot: { x: number; y: number };
	points: Array<
		HoverPoint & { ansY: number; recY: number; answered: number; received: number; notAnswered: number }
	>;
	plot: Plot;
}
/** Stacked "calls received vs answered": answered area + not-answered band up to the
 *  received total + received line. */
export function buildStackedCallsChart(
	answered: number[],
	received: number[],
	labels: string[],
	opts: { W: number; H: number }
): CallsChart {
	const n = answered.length;
	const max = niceMax(Math.max(1, ...received));
	const ax = makeAxis(max, { W: opts.W, H: opts.H, labels, fmt: (v) => String(Math.round(v)) });
	const ansPts = answered.map((v, i) => [ax.X(i), ax.Y(v)] as [number, number]);
	const recPts = received.map((v, i) => [ax.X(i), ax.Y(v)] as [number, number]);
	const ansLp = linePath(ansPts),
		recLp = linePath(recPts);
	const ansArea =
		n > 1
			? `${ansLp} L ${ansPts[n - 1][0].toFixed(1)} ${ax.baseline} L ${ansPts[0][0].toFixed(1)} ${ax.baseline} Z`
			: '';
	const ansRev = ansPts
		.slice()
		.reverse()
		.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
		.join(' ');
	const band = n > 1 ? `${recLp} ${ansRev} Z` : '';

	return {
		viewBox: `0 0 ${opts.W} ${opts.H}`,
		gridlines: ax.gridlines,
		xLabels: ax.xLabels,
		answeredArea: ansArea,
		notAnsweredBand: band,
		receivedLine: n > 1 ? recLp : '',
		answeredLine: n > 1 ? ansLp : '',
		answeredDot: { x: ansPts[n - 1][0], y: ansPts[n - 1][1] },
		points: answered.map((a, i) => ({
			x: ansPts[i][0],
			ansY: ansPts[i][1],
			recY: recPts[i][1],
			label: labels[i] ?? '',
			answered: a,
			received: received[i],
			notAnswered: Math.max(0, received[i] - a)
		})),
		plot: { left: ax.left, right: ax.right, viewW: opts.W }
	};
}

export interface Sparkline {
	viewBox: string;
	linePath: string;
	areaPath: string;
	dots: Array<{ x: number; y: number }>;
	last: { x: number; y: number } | null;
}
/** Tiny KPI sparkline (no axes); null points create gaps. Render width:100%;height:34;preserveAspectRatio:none. */
export function buildSparkline(series: Array<number | null>, opts?: { yMax?: number }): Sparkline {
	const W = 220,
		H = 34,
		m = { t: 5, r: 4, b: 5, l: 4 };
	const nonNull = series.filter((v): v is number => v != null);
	const max = opts?.yMax != null ? opts.yMax : Math.max(1, ...nonNull);
	const iw = W - m.l - m.r,
		ih = H - m.t - m.b;
	const n = series.length;
	const X = (i: number) => (n <= 1 ? W / 2 : m.l + (i / (n - 1)) * iw);
	const Y = (v: number) => m.t + ih - (Math.max(0, Math.min(v, max)) / max) * ih;
	const pts = series.map((v, i) => (v == null ? null : ([X(i), Y(v)] as [number, number])));
	const base = m.t + ih;
	const { line, area, dots } = gappedPaths(pts, base, true);

	return { viewBox: `0 0 ${W} ${H}`, linePath: line, areaPath: area, dots, last: lastPoint(pts) };
}
