import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GlassBoxView, isReplayable } from '@/features/ml/components/insights/GlassBoxView';
import type { GlassBoxPayload, Replay } from '@/features/ml/train/glass-box';
import i18n from '@/lib/i18n';

// V66: the view tells each family in its own steps, in the units of the file,
// and ends on the model's answer.

const payload = (replay: Replay, over: Partial<GlassBoxPayload> = {}): GlassBoxPayload => ({
  model: 'tree',
  isClassification: true,
  classes: ['no', 'yes'],
  replay,
  ...over,
});

const tree: Replay = {
  kind: 'tree',
  prediction: 1,
  leafShares: [0.12, 0.88],
  steps: [
    {
      feature: 'sex=male',
      column: 'sex',
      kind: 'category',
      operator: 'is',
      category: 'male',
      passed: false,
      rows: 428,
    },
    {
      feature: 'age',
      column: 'age',
      kind: 'numeric',
      operator: '<',
      threshold: 9.5,
      value: 22,
      passed: false,
      rows: 151,
    },
    {
      feature: 'review:great',
      column: 'review',
      kind: 'word',
      operator: '<',
      threshold: 0.12,
      value: 0,
      passed: true,
      rows: 1,
    },
  ],
  leaf: { rows: 41, counts: [5, 36] },
};

const boosting: Replay = {
  kind: 'gbdt',
  rounds: 120,
  prediction: 1,
  shares: [0.09, 0.91],
  curve: Array.from({ length: 121 }, (_, i) => 0.38 + (0.53 * Math.min(i, 40)) / 40),
  settledAt: 37,
  told: [
    {
      round: 3,
      from: 0.41,
      to: 0.47,
      sameQuestions: 14,
      steps: [
        {
          feature: 'fare',
          column: 'fare',
          kind: 'numeric',
          operator: '<=',
          threshold: 15.2,
          value: 71.3,
          passed: false,
        },
      ],
    },
  ],
  validation: {
    metric: 'logLoss',
    curve: Array.from({ length: 121 }, (_, i) =>
      i <= 22 ? 0.666 - i * 0.0106 : 0.4328 + (i - 22) * 0.00017,
    ),
    bestRound: 22,
    rows: 143,
  },
};

describe('GlassBoxView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('knows which families have steps to tell', () => {
    expect(['tree', 'forest', 'knn', 'gbdt'].every((key) => isReplayable(key as never))).toBe(true);
    expect(
      ['linear', 'logistic', 'naiveBayes', 'mlp', 'ensemble', 'baseline'].some((key) =>
        isReplayable(key as never),
      ),
    ).toBe(false);
  });

  it('shows nothing for a family with no steps', () => {
    const { container } = render(<GlassBoxView payload={payload({ kind: 'none' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells the path of a tree as questions, in the units of the file', () => {
    render(<GlassBoxView payload={payload(tree)} />);
    const box = screen.getByTestId('glass-box');
    expect(box).toHaveAttribute('data-kind', 'tree');
    expect(box).toHaveTextContent('sex is "male"? no · 428 training rows were asked');
    expect(box).toHaveTextContent('age < 9.5? no (this row: 22)');
    expect(box).toHaveTextContent(
      'weight of review:great < 0.12? yes (this row: 0) · 1 training row was asked',
    );
    expect(screen.getByTestId('glass-answer')).toHaveTextContent(
      '41 training rows end in the same leaf (no: 5 · yes: 36). The tree answers yes.',
    );
    expect(box).toHaveTextContent('A trace is not a cause');
  });

  it('tells a tree that asks nothing, and a regression leaf', () => {
    render(
      <GlassBoxView
        payload={payload(
          { kind: 'tree', prediction: 23.4567, steps: [], leaf: { rows: 12, mean: 23.4567 } },
          { isClassification: false, classes: [] },
        )}
      />,
    );
    expect(screen.getByTestId('glass-box')).toHaveTextContent('The tree asks no question');
    expect(screen.getByTestId('glass-answer')).toHaveTextContent(
      '12 training rows end in the same leaf. The tree answers their mean: 23.457.',
    );
  });

  it('counts the trees of a forest, and says when two classes tie', () => {
    render(
      <GlassBoxView
        payload={payload(
          { kind: 'forest', trees: 40, prediction: 0, votes: [20, 20], tiedVote: true },
          { model: 'forest' },
        )}
      />,
    );
    expect(screen.getByTestId('glass-answer')).toHaveTextContent(
      '40 trees voted (no: 20 · yes: 20). The forest answers no.',
    );
    expect(screen.getByTestId('glass-box')).toHaveTextContent(
      'Two classes got the same number of trees',
    );
  });

  it('gives the spread of a regression forest', () => {
    render(
      <GlassBoxView
        payload={payload(
          {
            kind: 'forest',
            trees: 40,
            prediction: 21.5,
            spread: { min: 18, max: 26.25, mean: 21.5 },
          },
          { model: 'forest', isClassification: false, classes: [] },
        )}
      />,
    );
    expect(screen.getByTestId('glass-answer')).toHaveTextContent(
      '40 trees answered between 18 and 26.25. The forest answers their mean: 21.5.',
    );
  });

  it('names the neighbours by their row in the file, and flags a tie at the edge', () => {
    render(
      <GlassBoxView
        payload={payload(
          {
            kind: 'knn',
            prediction: 1,
            votes: [2, 3],
            tieAtTheEdge: true,
            tiedVote: false,
            neighbours: [
              { index: 4, distance: 0.1234, label: 1 },
              { index: 9, distance: 0.5, label: 0 },
            ],
            columns: ['age', 'sex'],
            rows: [
              { row: 1203, target: 'yes', cells: ['22', 'female'] },
              { row: null, target: 'no', cells: ['', ''] },
            ],
          },
          { model: 'knn' },
        )}
      />,
    );
    const table = screen.getByTestId('glass-neighbours');
    expect(table).toHaveTextContent('1,203');
    expect(table).toHaveTextContent('0.123');
    expect(table).toHaveTextContent('female');
    expect(screen.getByTestId('glass-answer')).toHaveTextContent(
      'The 2 nearest rows voted (yes: 3 · no: 2). The model answers yes.',
    );
    expect(screen.getByTestId('glass-edge-tie')).toHaveTextContent(
      'exactly as far as the last one kept',
    );
  });

  it('tells the boosting as a curve, its largest rounds, and the validation error', () => {
    render(<GlassBoxView payload={payload(boosting, { model: 'gbdt' })} />);
    expect(screen.getByTestId('glass-answer')).toHaveTextContent(
      'Every row starts at 0.38, the share of "yes" the model begins with. After 120 rounds this row is at 0.91. 90 % of the way was made by round 37.',
    );
    const box = screen.getByTestId('glass-box');
    expect(box).toHaveTextContent(
      'Round 3: from 0.41 to 0.47. 14 other rounds asked this row the same questions.',
    );
    expect(box).toHaveTextContent('fare ≤ 15.2? no (this row: 71.3)');
    expect(screen.getByTestId('glass-validation')).toHaveTextContent(
      'On the 143 validation rows, the log loss was lowest at round 22 (0.433) and is 0.449 after round 120',
    );
    expect(screen.getByTestId('glass-validation')).toHaveTextContent(
      'never on the test set, and it sets nothing',
    );
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('says when the boosting never beat its starting point, or kept helping', () => {
    const base = boosting as Extract<Replay, { kind: 'gbdt' }>;
    const { unmount } = render(
      <GlassBoxView
        payload={payload(
          {
            ...base,
            validation: { metric: 'rmse', curve: [16.2, 16.9, 17.8], bestRound: 0, rows: 29 },
          },
          { model: 'gbdt' },
        )}
      />,
    );
    expect(screen.getByTestId('glass-validation')).toHaveTextContent(
      'never beat its starting point',
    );
    unmount();
    render(
      <GlassBoxView
        payload={payload(
          { ...base, validation: { metric: 'rmse', curve: [7.7, 3, 2.1], bestRound: 2, rows: 48 } },
          { model: 'gbdt' },
        )}
      />,
    );
    expect(screen.getByTestId('glass-validation')).toHaveTextContent('the rounds kept helping');
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    render(<GlassBoxView payload={payload(tree)} />);
    const box = screen.getByTestId('glass-box');
    expect(box).toHaveTextContent(
      "sex vaut « male » ? non · question posée à 428 lignes d'entraînement",
    );
    expect(box).toHaveTextContent('age < 9,5 ? non (cette ligne : 22)');
    expect(screen.getByTestId('glass-answer')).toHaveTextContent(
      "41 lignes d'entraînement finissent dans la même feuille (no: 5 · yes: 36). L'arbre répond yes.",
    );
    expect(box).toHaveTextContent("Une trace n'est pas une cause");
  });
});
