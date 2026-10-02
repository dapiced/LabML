import { describe, expect, it } from 'vitest';
import {
  editMulticlassThreshold,
  isExploratoryTestRequest,
  receiveMulticlassDecisionTest,
  type MulticlassDecisionEditorState,
} from '@/features/ml/train/multiclass-decision-state';
import type { MulticlassDecisionTestResult } from '@/features/ml/train/multiclass-decision-analysis';

const metrics = {
  rows: 2,
  decided: 2,
  abstained: 0,
  coverage: 1,
  accuracy: 1,
  decidedAccuracy: 1,
  macroPrecision: 1,
  macroRecall: 1,
  macroF1: 1,
  perClass: [],
};
const firstResult: MulticlassDecisionTestResult = {
  policy: { thresholds: [0, 0, 0] },
  metrics,
  exploratory: false,
};
const revisedResult: MulticlassDecisionTestResult = {
  policy: { thresholds: [0, 0.7, 0] },
  metrics,
  exploratory: true,
};
const draft: MulticlassDecisionEditorState = {
  policy: { thresholds: [0, 0, 0] },
  phase: 'draft',
  test: null,
};

describe('multiclass decision editor state', () => {
  it('freezes the first honest test result', () => {
    expect(isExploratoryTestRequest(draft)).toBe(false);
    expect(receiveMulticlassDecisionTest(draft, firstResult)).toMatchObject({
      phase: 'frozen',
      test: firstResult,
    });
  });

  it('marks edits after test reveal as exploratory', () => {
    const frozen = receiveMulticlassDecisionTest(draft, firstResult);
    const exploratory = editMulticlassThreshold(frozen, 1, 0.7);

    expect(exploratory.phase).toBe('exploratory');
    expect(exploratory.policy.thresholds).toEqual([0, 0.7, 0]);
    expect(isExploratoryTestRequest(exploratory)).toBe(true);
    expect(receiveMulticlassDecisionTest(exploratory, revisedResult).phase).toBe('exploratory');
  });

  it('keeps validation-only edits in draft', () => {
    expect(editMulticlassThreshold(draft, 2, 0.6)).toMatchObject({
      phase: 'draft',
      policy: { thresholds: [0, 0, 0.6] },
      test: null,
    });
  });
});
