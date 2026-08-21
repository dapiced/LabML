import type { DatasetMeta } from '@/features/ml/data/types';
import type { CleanStats, QualityReport, RecipeOptions } from '@/features/data/quality/types';

export type DataWorkerRequest =
  | { kind: 'parse-file'; file: File }
  | { kind: 'parse-url'; url: string; name: string }
  | { kind: 'apply'; options: RecipeOptions }
  | { kind: 'export-csv'; purpose: 'download' | 'lab' };

export interface DataParsePayload {
  meta: DatasetMeta;
  preview: Record<string, string>[];
  report: QualityReport;
  /** Inferred type per column — the baseline the user can override. */
  columnTypes: Record<string, string>;
}

export interface DataApplyPayload {
  report: QualityReport;
  preview: Record<string, string>[];
  stats: CleanStats;
}

export type DataWorkerResponse =
  | { kind: 'progress'; rows: number }
  | { kind: 'parsed'; payload: DataParsePayload }
  | { kind: 'applied'; payload: DataApplyPayload }
  | { kind: 'csv'; purpose: 'download' | 'lab'; name: string; content: string }
  | { kind: 'error'; message: string };
