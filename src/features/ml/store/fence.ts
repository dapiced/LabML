import type { WorkerResponse } from '@/features/ml/worker-protocol';
import type { LabState, TrainStatus } from '@/features/ml/store/state';

/** V47: the worker answers that belong to one training stream. */
const TRAINING_STREAM = new Set<WorkerResponse['kind']>([
  'model-start',
  'model-result',
  'train-complete',
  'train-cancelled',
]);

/**
 * V47: the answers computed FROM a finished run — insights, analyses, tuning,
 * exports. They are only meaningful while that run is the one on screen.
 */
const RUN_DERIVED = new Set<WorkerResponse['kind']>([
  'insights',
  'what-if-result',
  'explanation',
  'tune-progress',
  'tune-complete',
  'tune-cancelled',
  'curve-progress',
  'curve-complete',
  'curve-cancelled',
  'robust-progress',
  'robust-complete',
  'robust-cancelled',
  'batch-scored',
  'batch-error',
  'threshold-result',
  'multiclass-decision-result',
  'multiclass-decision-tested',
  'segments-result',
  'uncertainty-result',
  'model-json',
  'predictions-csv',
]);

/**
 * V47: a worker answer that no longer matches what the page shows. Changing
 * the target or the feature set resets the training state, but the worker
 * keeps answering requests sent before the reset; without this fence a late
 * `model-result` joined the new leaderboard and the auto-save recorded the
 * NEW target beside the OLD scores. Messages arrive in the order the worker
 * sends them, so the training status alone is enough to tell them apart: a
 * training message outside a run, or a run-derived answer when no run is
 * done, belongs to a state that was already thrown away.
 */
export function isStaleResponse(kind: WorkerResponse['kind'], trainStatus: TrainStatus): boolean {
  if (TRAINING_STREAM.has(kind)) return trainStatus !== 'training';
  if (RUN_DERIVED.has(kind)) return trainStatus !== 'done';
  return false;
}

/**
 * V47: true while the worker is computing something tied to the current
 * target and feature set. Changing either is refused until it ends or is
 * cancelled, so a result can never be filed under a question it did not answer.
 */
export function isTrainingBusy(
  state: Pick<
    LabState,
    'trainStatus' | 'tuneStatus' | 'curveStatus' | 'robustStatus' | 'batchStatus'
  >,
): boolean {
  return (
    state.trainStatus === 'training' ||
    state.tuneStatus === 'running' ||
    state.curveStatus === 'running' ||
    state.robustStatus === 'running' ||
    state.batchStatus === 'scoring'
  );
}
