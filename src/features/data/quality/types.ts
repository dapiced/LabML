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
  /** 0–100; deterministic function of the ratios above. */
  score: number;
}

/** Forceable column types — they steer the cleaning, not the "before" report. */
export type ForcedType = 'numeric' | 'categorical' | 'text' | 'date';

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
};

const FORCED_TYPES: ForcedType[] = ['numeric', 'categorical', 'text', 'date'];
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

  const options: RecipeOptions = { ...DEFAULT_RECIPE, types: {} };
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
  return {
    options,
    source: typeof record.source === 'string' ? record.source : undefined,
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : undefined,
  };
}
