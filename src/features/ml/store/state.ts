/**
 * V51 — the ML Lab store's shape and starting values, split out of
 * `lab-store.ts` so the store file holds the actions and nothing else.
 */
import type { GroupAuditOutcome } from '@/features/ml/train/group-audit';
import type { ReadFormat } from '@/features/ml/data/locale';
import type { RunRecord } from '@/features/ml/projects/types';
import type {
  ColumnSuggestion,
  DatasetMeta,
  ColumnProfile,
  TaskInfo,
} from '@/features/ml/data/types';
import type { BatchScore } from '@/features/ml/train/score';
import type { Submission, SubmissionForm } from '@/features/ml/train/submission';
import type { ImportedManifest } from '@/features/ml/train/deserialize';
import type { SegmentAnalysis } from '@/features/ml/train/segments';
import type { ThresholdAnalysis } from '@/features/ml/train/threshold-analysis';
import { DEFAULT_ALPHA } from '@/features/ml/train/conformal';
import type { CardField } from '@/features/ml/projects/model-card';
import type { ConformalOutcome } from '@/features/ml/train/conformal-analysis';
import type { UncertaintyAnalysis } from '@/features/ml/train/uncertainty';
import type { TunableKey, TuneOutcome } from '@/features/ml/train/search';
import type { LearningCurveOutcome } from '@/features/ml/train/learning-curve';
import type { RobustRankResult } from '@/features/ml/train/robust';
import type { RankingMetric, SplitChoice } from '@/features/ml/train/types';
import type { LedgerEntry } from '@/features/ml/train/ledger';
import type { ExplorationPayload } from '@/features/ml/unsupervised/explore';
import type { ForecastPayload } from '@/features/ml/timeseries/run';
import type { ShapleyExplanation } from '@/features/ml/train/shapley';
import type {
  InsightsPayload,
  ModelKey,
  ModelResult,
  TrainSummary,
  WhatIfResult,
} from '@/features/ml/train/types';
import type { MulticlassDecisionAnalysis } from '@/features/ml/train/multiclass-decision-analysis';
import type { MulticlassDecisionEditorState } from '@/features/ml/train/multiclass-decision-state';

export type LabStatus = 'idle' | 'parsing' | 'ready' | 'error';
export type TrainStatus = 'idle' | 'training' | 'done';

export const TRAIN_SEED = 42;
export const TEST_RATIO = 0.2;

export interface LabState {
  status: LabStatus;
  error: string | null;
  rowsParsed: number;
  meta: DatasetMeta | null;
  profiles: ColumnProfile[];
  preview: Record<string, string>[];
  /** V38: how the file was read — null until a file has been parsed. */
  readFormat: ReadFormat | null;
  /** Target-independent suggestions computed at parse time. */
  baseline: ColumnSuggestion[];
  target: string | null;
  task: TaskInfo | null;
  targetUnsupported: 'type' | 'tooManyClasses' | 'empty' | null;
  /** Target-dependent leak suggestions. */
  leaks: ColumnSuggestion[];
  /** Manual include/exclude decisions that override the suggestions. */
  overrides: Record<string, 'include' | 'exclude'>;
  /** V35: announced non-random split, chosen in the UI. Null = seeded random. */
  splitChoice: SplitChoice | null;
  /**
   * V60: the seed that deals the split. 42 until the user draws a fresh split
   * because the test set is worn; a returning user resumes on the last one.
   */
  seed: number;
  /** V60: every test-set reading recorded for this file and target, all splits. */
  ledgerEntries: LedgerEntry[];
  /** V36: class weighting, off by default — a knob that does nothing is worse than none. */
  classWeighting: boolean;
  /** V36: which metric the leaderboard ranks on. Null = the task's default. */
  rankMetric: RankingMetric | null;
  /** V36: which class the threshold panel reads one-vs-rest (multiclass only). */
  thresholdClass: number;
  trainStatus: TrainStatus;
  modelProgress: { key: ModelKey; index: number; total: number } | null;
  results: ModelResult[];
  summary: TrainSummary | null;
  /** Insights bundle for the currently inspected model (defaults to the best). */
  insights: InsightsPayload | null;
  whatIf: WhatIfResult | null;
  /** Shapley explanation of the latest what-if row (cleared with it). */
  explanation: ShapleyExplanation | null;
  tuneStatus: 'idle' | 'running' | 'done';
  tuneProgress: { done: number; total: number; bestCv: number | null } | null;
  tuneOutcome: TuneOutcome | null;
  curveStatus: 'idle' | 'running' | 'done';
  curveProgress: { done: number; total: number } | null;
  robustStatus: 'idle' | 'running' | 'done';
  robustProgress: { done: number; total: number } | null;
  robustOutcome: RobustRankResult | null;
  /** null after a run = the worker refused (named): no curve theater. */
  curveOutcome: LearningCurveOutcome | null;
  exploreStatus: 'idle' | 'running' | 'done';
  exploration: ExplorationPayload | null;
  forecastStatus: 'idle' | 'running' | 'done' | 'error';
  forecastPayload: ForecastPayload | null;
  batchStatus: 'idle' | 'scoring' | 'done' | 'error';
  batchResult: BatchScore | null;
  batchError: string | null;
  /** V65: the submission built from the last scored file. */
  submissionStatus: 'idle' | 'building' | 'done' | 'error';
  submission: Submission | null;
  submissionError: string | null;
  /** Binary + probabilistic models only — null otherwise. */
  thresholdAnalysis: ThresholdAnalysis | null;
  thresholdChoice: { threshold: number; costFp: number; costFn: number };
  /** Validation-only editor for abstaining multiclass decisions. */
  multiclassDecision: {
    analysis: MulticlassDecisionAnalysis;
    editor: MulticlassDecisionEditorState;
  } | null;
  multiclassDecisionTestPending: boolean;
  multiclassDecisionUnavailable: boolean;
  /** Per-segment metrics of the inspected model — null when nothing sliceable. */
  segmentAnalysis: SegmentAnalysis | null;
  /** Leaderboard-wide 95% intervals — belongs to the run, not the inspected model. */
  uncertaintyAnalysis: UncertaintyAnalysis | null;
  /** V57: prediction sets or intervals of the inspected model, or the refusal. */
  conformalAnalysis: ConformalOutcome | null;
  /** V57: the miscoverage rate the user asked for (0.1 = a 90 % target). */
  conformalAlpha: number;
  /** V59: the audit of the column the user designated, or the refusal. */
  groupAudit: GroupAuditOutcome | null;
  /** V59: the designated column; null until the user picks one. */
  groupAuditColumn: string | null;
  groupAuditPending: boolean;
  /** The auto-saved record of the current run (id set once stored). */
  currentRun: RunRecord | null;
  /** Local id of the stored copy of the CURRENT dataset — null if not kept. */
  savedDatasetId: number | null;
  datasetSaving: boolean;
  /** Refusal detail when a save does not fit the quota — named, never silent. */
  datasetQuotaError: { usedBytes: number; neededBytes: number; quotaBytes: number } | null;
  /** v22: the manifest of a re-imported exported model — null when none. */
  importedManifest: ImportedManifest | null;
  importedStatus: 'idle' | 'loading' | 'scoring';
  importedResult: BatchScore | null;
  importedError: string | null;
  /** File produced by an export action, consumed once by the UI download effect. */
  exportedFile: { name: string; mime: string; content: string } | null;
  loadFile: (file: File) => void;
  loadDemo: (fileName: string) => void;
  saveDataset: () => void;
  openDataset: (id: number) => void;
  forgetDataset: (id: number) => void;
  importModelFile: (file: File) => void;
  importedScoreFile: (file: File) => void;
  importedScoreDemo: (fileName: string) => void;
  clearImported: () => void;
  setTarget: (column: string | null) => void;
  toggleColumn: (column: string) => void;
  train: () => void;
  cancelTrain: () => void;
  selectInsightModel: (model: ModelKey) => void;
  requestWhatIf: (values: Record<string, string>) => void;
  requestExplanation: (values: Record<string, string>) => void;
  tune: (model: TunableKey) => void;
  cancelTune: () => void;
  learningCurve: (model: ModelKey) => void;
  robustRank: () => void;
  cancelRobust: () => void;
  setSplitChoice: (choice: SplitChoice | null) => void;
  /** V60: deal a test set this file and target never had. Resets the run. */
  drawFreshSplit: () => void;
  setClassWeighting: (on: boolean) => void;
  setRankMetric: (metric: RankingMetric | null) => void;
  setThresholdClass: (index: number) => void;
  setConformalLevel: (alpha: number) => void;
  /** V59: audit the inspected model on one column; null clears the audit. */
  auditGroups: (column: string | null) => void;
  /** V58: one typed field of the model card, kept with the run. */
  setCardField: (field: CardField, value: string) => void;
  cancelCurve: () => void;
  explore: () => void;
  forecast: (dateColumn: string, valueColumn: string) => void;
  scoreBatch: (file: File) => void;
  scoreBatchDemo: (fileName: string) => void;
  chooseThreshold: (
    partial: Partial<{ threshold: number; costFp: number; costFn: number }>,
  ) => void;
  setMulticlassThreshold: (classIndex: number, threshold: number) => void;
  testMulticlassDecision: () => void;
  exportModel: () => void;
  exportPredictions: () => void;
  /** V64: the run as a scikit-learn script. */
  exportPython: () => void;
  /** V65: `idColumn` null numbers the rows from 1. */
  buildSubmission: (request: {
    idColumn: string | null;
    idName: string;
    predictionName: string;
    form: SubmissionForm;
    refit: boolean;
  }) => void;
  clearExportedFile: () => void;
  reset: () => void;
}

export const initialTraining = {
  trainStatus: 'idle' as TrainStatus,
  modelProgress: null,
  results: [],
  summary: null,
  insights: null,
  whatIf: null,
  explanation: null,
  tuneStatus: 'idle' as const,
  tuneProgress: null,
  tuneOutcome: null,
  curveStatus: 'idle' as const,
  curveProgress: null,
  curveOutcome: null as LearningCurveOutcome | null,
  robustStatus: 'idle' as const,
  robustProgress: null,
  robustOutcome: null as RobustRankResult | null,
  exploreStatus: 'idle' as const,
  exploration: null,
  forecastStatus: 'idle' as const,
  forecastPayload: null,
  batchStatus: 'idle' as const,
  batchResult: null,
  batchError: null,
  submissionStatus: 'idle' as const,
  submission: null as Submission | null,
  submissionError: null as string | null,
  thresholdAnalysis: null as ThresholdAnalysis | null,
  thresholdChoice: { threshold: 0.5, costFp: 1, costFn: 1 },
  multiclassDecision: null as LabState['multiclassDecision'],
  multiclassDecisionTestPending: false,
  multiclassDecisionUnavailable: false,
  segmentAnalysis: null as SegmentAnalysis | null,
  uncertaintyAnalysis: null as UncertaintyAnalysis | null,
  conformalAnalysis: null as ConformalOutcome | null,
  conformalAlpha: DEFAULT_ALPHA,
  groupAudit: null as GroupAuditOutcome | null,
  groupAuditColumn: null as string | null,
  groupAuditPending: false,
  currentRun: null,
  exportedFile: null,
};

export const initialData = {
  status: 'idle' as LabStatus,
  splitChoice: null as SplitChoice | null,
  seed: TRAIN_SEED,
  ledgerEntries: [] as LedgerEntry[],
  classWeighting: false,
  rankMetric: null as RankingMetric | null,
  thresholdClass: 0,
  error: null,
  rowsParsed: 0,
  meta: null,
  profiles: [],
  preview: [],
  readFormat: null,
  baseline: [],
  target: null,
  task: null,
  targetUnsupported: null,
  leaks: [],
  overrides: {},
  savedDatasetId: null as number | null,
  datasetSaving: false,
  datasetQuotaError: null as LabState['datasetQuotaError'],
  importedManifest: null as ImportedManifest | null,
  importedStatus: 'idle' as const,
  importedResult: null as BatchScore | null,
  importedError: null as string | null,
  ...initialTraining,
};
