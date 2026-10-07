// Shared conversion helpers so every score input widget can speak its own "native"
// scale internally while always reporting/accepting a plain 0-100 integer externally.

export const SCORE_WIDGET_TYPES = ['numeric', 'stars', 'slider', 'picker', 'emotion'] as const;
export type ScoreWidgetType = (typeof SCORE_WIDGET_TYPES)[number];

export const SCORE_WIDGET_LABELS: Record<ScoreWidgetType, string> = {
    numeric: 'Numeric Input (0-100)',
    stars: 'Star Rating (half-stars)',
    slider: 'Slider',
    picker: 'Picker / Dropdown',
    emotion: 'Emotion Scale',
};

export const DEFAULT_SCORE_WIDGET_TYPE: ScoreWidgetType = 'numeric';

// Persisted (MMKV) key the Dev Menu uses to control which widget the Validation Wizard renders.
export const SCORE_WIDGET_TYPE_STORAGE_KEY = 'DEV_SCORE_WIDGET_TYPE';

export const clampScore = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, value));

// --- Star rating: 1-5 stars, half-star steps <-> 0-100 ---
const MAX_STARS = 5;

export const scoreToStars = (score: number | null | undefined): number => {
    if (score === null || score === undefined || Number.isNaN(score)) return 0;
    const raw = (clampScore(score) / 100) * MAX_STARS;
    return Math.round(raw * 2) / 2; // nearest half-star
};

export const starsToScore = (stars: number): number => clampScore(Math.round((stars / MAX_STARS) * 100));

// --- Emotion scale: 5 discrete stages (sad -> happy) <-> 0-100 ---
export const EMOTION_STAGE_COUNT = 5;

export const scoreToEmotionIndex = (score: number | null | undefined): number => {
    if (score === null || score === undefined || Number.isNaN(score)) return 2; // default to neutral
    const clamped = clampScore(score);
    return Math.min(EMOTION_STAGE_COUNT - 1, Math.round(clamped / 25));
};

export const emotionIndexToScore = (index: number): number => clampScore(index * 25);

// --- Picker: fixed set of discrete steps across the 0-100 range ---
export const PICKER_SCORE_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export const nearestPickerStep = (score: number): number =>
    PICKER_SCORE_STEPS.reduce((closest, step) => (Math.abs(step - clampScore(score)) < Math.abs(closest - clampScore(score)) ? step : closest), PICKER_SCORE_STEPS[0]);
