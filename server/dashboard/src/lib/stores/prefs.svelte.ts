// View preferences: answer-rate target (drives below-target flags), density, and
// chart area-fill. Svelte 5 runes module. answerTarget persists to localStorage.

export type Density = 'comfortable' | 'dense';

const TARGET_KEY = 'cc_answer_target';
const DEFAULT_TARGET = 0.85; // 85% answer-rate target (design brief default)

function initialTarget(): number {
	if (typeof localStorage === 'undefined') return DEFAULT_TARGET;
	const raw = Number(localStorage.getItem(TARGET_KEY));
	return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_TARGET;
}

let answerTarget = $state<number>(initialTarget());
let density = $state<Density>('comfortable');
let chartFill = $state<boolean>(true);

export const prefs = {
	get answerTarget(): number {
		return answerTarget;
	},
	setAnswerTarget(v: number): void {
		answerTarget = Math.max(0, Math.min(1, v));
		if (typeof localStorage !== 'undefined') localStorage.setItem(TARGET_KEY, String(answerTarget));
	},
	get density(): Density {
		return density;
	},
	toggleDensity(): void {
		density = density === 'dense' ? 'comfortable' : 'dense';
	},
	get chartFill(): boolean {
		return chartFill;
	},
	setChartFill(v: boolean): void {
		chartFill = v;
	}
};
