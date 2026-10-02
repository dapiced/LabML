import type { MulticlassDecisionPolicy } from '@/features/ml/train/multiclass-decision';
import type { MulticlassDecisionTestResult } from '@/features/ml/train/multiclass-decision-analysis';

export type MulticlassDecisionPhase = 'draft' | 'frozen' | 'exploratory';

export interface MulticlassDecisionEditorState {
  policy: MulticlassDecisionPolicy;
  phase: MulticlassDecisionPhase;
  test: MulticlassDecisionTestResult | null;
}

export function editMulticlassThreshold(
  state: MulticlassDecisionEditorState,
  classIndex: number,
  threshold: number,
): MulticlassDecisionEditorState {
  const thresholds = [...state.policy.thresholds];
  thresholds[classIndex] = threshold;
  return {
    ...state,
    policy: { thresholds },
    phase: state.phase === 'draft' ? 'draft' : 'exploratory',
  };
}

export function receiveMulticlassDecisionTest(
  state: MulticlassDecisionEditorState,
  result: MulticlassDecisionTestResult,
): MulticlassDecisionEditorState {
  return {
    policy: result.policy,
    phase: state.phase === 'exploratory' || result.exploratory ? 'exploratory' : 'frozen',
    test: result,
  };
}

export function isExploratoryTestRequest(state: MulticlassDecisionEditorState): boolean {
  return state.phase === 'exploratory';
}
