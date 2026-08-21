import type { DatasetMeta } from '@/features/ml/data/types';
import type { CleanStats, QualityReport, RecipeOptions } from '@/features/data/quality/types';
import type { DriftReport } from '@/features/data/quality/drift';
import type { JoinStats } from '@/features/data/quality/join';

export type DataWorkerRequest =
  | { kind: 'parse-file'; file: File }
  | { kind: 'parse-url'; url: string; name: string }
  | { kind: 'apply'; options: RecipeOptions }
  | { kind: 'export-csv'; purpose: 'download' | 'lab' }
  | { kind: 'parse-compare-file'; file: File }
  | { kind: 'parse-compare-url'; url: string; name: string }
  | { kind: 'parse-join-file'; file: File }
  | { kind: 'parse-join-url'; url: string; name: string }
  | { kind: 'apply-join'; key: string };

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
  | { kind: 'drift'; meta: DatasetMeta; payload: DriftReport }
  // The second file is parsed; the UI can now offer the candidate keys.
  | { kind: 'join-ready'; name: string; rows: number; candidates: string[] }
  // The merge happened: the joined data IS the dataset now.
  | { kind: 'joined'; stats: JoinStats; payload: DataParsePayload }
  | { kind: 'error'; message: string };
