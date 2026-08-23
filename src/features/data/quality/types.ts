import type { ValidityFinding } from '@/features/data/quality/validity';
import type { ConsistencyFinding } from '@/features/data/quality/consistency';
import type { ScoreBreakdown } from '@/features/data/quality/checks';
/** Issue report and cleaning recipe types for the Data Studio. */

export interface MissingColumn {
  column: string;
  count: number;
  /** count / rowCount. */
  ratio: number;
}

export interface OutlierColumn {
  column: string;
  count: number;
  /** Tukey fences: values outside [low, high] are flagged. */
  low: number;
  high: number;
}

export interface MessyGroup {
  /** The most frequent raw spelling — variants are rewritten to it. */
  canonical: string;
  /** Distinct raw spellings observed (canonical included), capped for display. */
  variants: string[];
  /** Cells that are not already the canonical spelling. */
  cellCount: number;
}

export interface MessyColumn {
  column: string;
  groups: MessyGroup[];
  cellCount: number;
}

export type StructuralKind = 'constant' | 'nearEmpty' | 'id';

export interface StructuralIssue {
  column: string;
  kind: StructuralKind;
}

export interface QualityReport {
  rowCount: number;
  columnCount: number;
  cellCount: number;
  missingCells: number;
  /** Columns with at least one missing cell, worst first. */
  missingColumns: MissingColumn[];
  /** Rows identical to an earlier row (the first occurrence is not counted). */
  duplicateRows: number;
  messyColumns: MessyColumn[];
  messyCells: number;
  outlierColumns: OutlierColumn[];
  outlierCells: number;
  structural: StructuralIssue[];
  /**
   * V40: values that are present, correctly typed and still impossible —
   * an age of 200, a date in the future. Reported, never repaired.
   */
  validity: ValidityFinding[];
  invalidCells: number;
  /** V40: rows where two columns contradict each other. */
  consistency: ConsistencyFinding[];
  inconsistentRows: number;
  /** 0–100; deterministic function of the ratios above. */
  score: number;
  /** V40: the score, explained by its parts instead of asserted. */
  breakdown: ScoreBreakdown[];
}

/** Forceable column types — they steer the cleaning, not the "before" report. */
export type ForcedType = 'numeric' | 'categorical' | 'text' | 'date';

/**
 * V39: what to do with the blanks in ONE column.
 *
 * `keep` and `dropRows` were the only whole-file choices before; the rest are
 * new, and they exist because a single global strategy is the kind of default
 * that looks tidy and quietly makes the data worse — a median is right for an
 * age and meaningless for a postcode.
 */
export type MissingStrategy =
  | 'keep'
  /** Drop every row where THIS column is blank. */
  | 'dropRows'
  | 'median'
  | 'mean'
  /** The most frequent value — the only sensible fill for a category. */
  | 'mode'
  /** A value the user typed, used verbatim. */
  | 'constant'
  /** A « MANQUANT » level: absence becomes a category of its own. */
  | 'category';

/** V39: the label `category` fills in with — a level, not a guess. */
export const MISSING_CATEGORY = 'MANQUANT';

/**
 * V39: one column's overrides. Every field is optional: an absent field means
 * « follow the global setting », so the file-wide options become defaults
 * rather than commands, and an untouched column behaves exactly as before.
 */
export interface ColumnStep {
  /** Overrides `missing` for this column. */
  missing?: MissingStrategy;
  /** The value used when `missing` is `constant`. */
  constant?: string;
  /**
   * Add a `<column>_absent` column recording where the blanks were, BEFORE
   * filling them. Imputing without marking destroys information: a blank
   * field is rarely blank at random, and the fact of the blank is frequently
   * predictive in its own right.
   */
  indicator?: boolean;
  /** Overrides `clipOutliers` for this column. */
  clipOutliers?: boolean;
}

export interface RecipeOptions {
  /** Trim leading/trailing whitespace in every cell. */
  trimWhitespace: boolean;
  /** Rewrite case/whitespace variants of a category to the most frequent spelling. */
  mergeVariants: boolean;
  /** Drop rows identical to an earlier row. */
  dropDuplicates: boolean;
  /** Drop constant and near-empty columns (identifiers are kept). */
  dropStructural: boolean;
  missing: 'keep' | 'impute' | 'dropRows';
  /** Clamp numeric values to the Tukey fences of their column. */
  clipOutliers: boolean;
  /** Expand every date column into `_year`, `_month` and `_weekday` columns. */
  deriveDates: boolean;
  /** Drop rows the seeded isolation forest flags as multivariate anomalies. */
  dropAnomalies: boolean;
  /** Per-column type overrides; absent columns keep their inferred type. */
  types: Record<string, ForcedType>;
  /**
   * V39: per-column steps. The global settings above are the defaults a column
   * may override; a column with no entry here is treated exactly as it was
   * before V39, which is what keeps every previously exported recipe valid.
   */
  columns: Record<string, ColumnStep>;
}

export interface CleanStats {
  trimmedCells: number;
  mergedCells: number;
  droppedDuplicateRows: number;
  droppedColumns: string[];
  imputedCells: number;
  droppedMissingRows: number;
  clippedCells: number;
  derivedColumns: string[];
  /** V39: `<column>_absent` columns added, in the order they were added. */
  indicatorColumns: string[];
  /**
   * V39: columns that were imputed WITHOUT an indicator. Not an error — just
   * the thing the UI must say out loud, because filling a blank silently
   * erases the fact that it was blank.
   */
  imputedWithoutIndicator: string[];
  /** V39: how many rows each per-column `dropRows` removed, by column. */
  droppedByColumn: Record<string, number>;
  droppedAnomalyRows: number;
  /** Shape after cleaning. */
  rowCount: number;
  columnCount: number;
}

export const DEFAULT_RECIPE: RecipeOptions = {
  trimWhitespace: true,
  mergeVariants: true,
  dropDuplicates: true,
  dropStructural: false,
  missing: 'impute',
  clipOutliers: false,
  deriveDates: false,
  dropAnomalies: false,
  types: {},
  columns: {},
};

const FORCED_TYPES: ForcedType[] = ['numeric', 'categorical', 'text', 'date'];
const MISSING_STRATEGIES: MissingStrategy[] = [
  'keep',
  'dropRows',
  'median',
  'mean',
  'mode',
  'constant',
  'category',
];
const MISSING_MODES = ['keep', 'impute', 'dropRows'] as const;
const BOOLEAN_KEYS = [
  'trimWhitespace',
  'mergeVariants',
  'dropDuplicates',
  'dropStructural',
  'clipOutliers',
  'deriveDates',
  'dropAnomalies',
] as const;

/**
 * Parses an exported recipe file back into options: strict on the fields it
 * knows, silent on the ones it does not — a recipe exported by a future
 * version still replays what this version understands. Returns null when the
 * payload is not a LabML recipe at all.
 */
export function parseRecipeFile(
  json: string,
): { options: RecipeOptions; source?: string; exportedAt?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.options !== 'object' || record.options === null) return null;
  const raw = record.options as Record<string, unknown>;

  const options: RecipeOptions = { ...DEFAULT_RECIPE, types: {}, columns: {} };
  const flags = options as Record<(typeof BOOLEAN_KEYS)[number], boolean>;
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') flags[key] = raw[key];
  }
  if (MISSING_MODES.includes(raw.missing as (typeof MISSING_MODES)[number])) {
    options.missing = raw.missing as RecipeOptions['missing'];
  }
  if (typeof raw.types === 'object' && raw.types !== null) {
    for (const [column, type] of Object.entries(raw.types as Record<string, unknown>)) {
      if (FORCED_TYPES.includes(type as ForcedType)) options.types[column] = type as ForcedType;
    }
  }
  // V39: per-column steps. Same contract as everything above — a step whose
  // strategy this version does not know is skipped rather than guessed at, and
  // a recipe exported before V39 simply has no `columns` key and replays as it
  // always did.
  if (typeof raw.columns === 'object' && raw.columns !== null) {
    for (const [column, value] of Object.entries(raw.columns as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const entry = value as Record<string, unknown>;
      const step: ColumnStep = {};
      if (MISSING_STRATEGIES.includes(entry.missing as MissingStrategy)) {
        step.missing = entry.missing as MissingStrategy;
      }
      if (typeof entry.constant === 'string') step.constant = entry.constant;
      if (typeof entry.indicator === 'boolean') step.indicator = entry.indicator;
      if (typeof entry.clipOutliers === 'boolean') step.clipOutliers = entry.clipOutliers;
      // A step that survived nothing is not a step: keeping it would put an
      // empty override in the recipe and make the list of decisions lie.
      if (Object.keys(step).length > 0) options.columns[column] = step;
    }
  }
  return {
    options,
    source: typeof record.source === 'string' ? record.source : undefined,
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : undefined,
  };
}
