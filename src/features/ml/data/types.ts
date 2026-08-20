/** Raw cell as read from the file; null = missing. */
export type Cell = string | null;

export type ColumnType = 'numeric' | 'categorical' | 'boolean' | 'date' | 'text' | 'id';

export type TaskType = 'binary' | 'multiclass' | 'regression';

export interface NumericStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  std: number;
  /** Histogram over [min, max]; counts.length bins of equal width. */
  histogram: { counts: number[]; min: number; max: number };
}

export interface CategoryCount {
  value: string;
  count: number;
}

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  /** Total rows (including missing). */
  rowCount: number;
  missingCount: number;
  /** Distinct non-missing values. */
  cardinality: number;
  numeric?: NumericStats;
  /** Top categories by count (categorical/boolean/id/text), capped. */
  topValues?: CategoryCount[];
}

export interface DatasetMeta {
  name: string;
  rowCount: number;
  columnCount: number;
  /** Approximate size in bytes of the source. */
  bytes: number;
}

export type ExclusionReason = 'id' | 'constant' | 'nearEmpty' | 'leak' | 'unsupported';

export interface ColumnSuggestion {
  column: string;
  reason: ExclusionReason;
}

export interface TaskInfo {
  type: TaskType;
  /** Class labels for classification tasks (capped for display). */
  classes?: string[];
}

export interface TargetAnalysis {
  task: TaskInfo | null;
  /** Set when the chosen target cannot be used (type date/text/id or too many classes). */
  unsupportedReason?: 'type' | 'tooManyClasses' | 'empty';
  suggestions: ColumnSuggestion[];
}

export interface ParseResultPayload {
  meta: DatasetMeta;
  profiles: ColumnProfile[];
  /** First rows for the preview table, as displayed strings. */
  preview: Record<string, string>[];
  /** Columns suggested for exclusion independently of the target. */
  suggestions: ColumnSuggestion[];
}

/** Messages accepted by the data worker. */
export type WorkerRequest =
  | { kind: 'parse-file'; file: File }
  | { kind: 'parse-url'; url: string; name: string }
  | { kind: 'analyze-target'; target: string };

/** Messages emitted by the data worker. */
export type WorkerResponse =
  | { kind: 'progress'; rows: number }
  | { kind: 'parsed'; payload: ParseResultPayload }
  | { kind: 'target-analyzed'; payload: TargetAnalysis }
  | { kind: 'error'; message: string };
