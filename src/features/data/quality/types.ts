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
}

export interface CleanStats {
  trimmedCells: number;
  mergedCells: number;
  droppedDuplicateRows: number;
  droppedColumns: string[];
  imputedCells: number;
  droppedMissingRows: number;
  clippedCells: number;
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
};
