import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductionCheckView } from '@/features/ml/components/ProductionCheckView';
import type { ProductionCheck } from '@/features/ml/train/production-check';
import i18n from '@/lib/i18n';

// V61: one verdict, then the three signals behind it, each one read or named
// as unreadable. Never a verdict with nothing under it.

const quiet: ProductionCheck = {
  verdict: 'stable',
  rows: 300,
  hasReference: true,
  columns: [
    { column: 'amount', psi: 0.04, ceiling: 0.11, drifted: false, rows: 300 },
    { column: 'channel', psi: 0.01, ceiling: 0.05, drifted: false, rows: 300 },
  ],
  driftedColumns: 0,
  predictions: { psi: 0.02, ceiling: 0.06, drifted: false, rows: 300 },
  performance: { status: 'no-labels' },
};

const measured = (
  reading: 'drop' | 'gain' | 'noise',
  delta: number,
  lo: number,
  hi: number,
): ProductionCheck['performance'] => ({
  status: 'measured',
  metric: 'accuracy',
  rows: 189,
  reference: 0.82,
  batch: 0.82 + delta,
  delta,
  lo,
  hi,
  reading,
});

const moved: ProductionCheck = {
  ...quiet,
  verdict: 'watch',
  columns: [
    {
      column: 'amount',
      psi: 1.07,
      ceiling: 0.17,
      drifted: true,
      rows: 189,
      refMean: 32.2,
      newMean: 13.68,
    },
    { column: 'channel', psi: 0.01, ceiling: 0.05, drifted: false, rows: 189 },
  ],
  driftedColumns: 1,
  predictions: { psi: 0.08, ceiling: 0.06, drifted: true, rows: 189 },
};

describe('ProductionCheckView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('says stable without labels, and that the performance was not measured', () => {
    render(<ProductionCheckView check={quiet} />);
    expect(screen.getByTestId('production-check')).toHaveAttribute('data-verdict', 'stable');
    expect(screen.getByTestId('production-verdict')).toHaveTextContent('Stable');
    expect(screen.getByTestId('production-why')).toHaveTextContent(
      'the performance itself was not measured',
    );
    expect(screen.getByTestId('production-columns')).toHaveTextContent(
      'None of the 2 columns the model uses has moved beyond its noise ceiling',
    );
    expect(screen.getByTestId('production-answers')).toHaveTextContent(
      'PSI 0.02, under its ceiling of 0.06',
    );
    expect(screen.getByTestId('production-performance')).toHaveTextContent('Not measured');
  });

  it('says watch on a drift without labels, names the column and asks for labels', () => {
    render(<ProductionCheckView check={moved} />);
    expect(screen.getByTestId('production-verdict')).toHaveTextContent('Watch');
    expect(screen.getByTestId('production-why')).toHaveTextContent(
      'Label part of this batch to settle it',
    );
    const columns = screen.getByTestId('production-columns');
    expect(columns).toHaveTextContent('1 of the 2 columns the model uses has moved');
    expect(columns).toHaveTextContent('amount: PSI 1.07, ceiling 0.17 (mean 32.20 → 13.68)');
    // A column inside its noise is counted, not listed.
    expect(columns).not.toHaveTextContent('channel:');
    expect(screen.getByTestId('production-answers')).toHaveTextContent(
      'no longer answers the way it did',
    );
  });

  it('says watch, not retrain, when the batch moved and the performance held', () => {
    render(
      <ProductionCheckView
        check={{ ...moved, performance: measured('noise', -0.032, -0.112, 0.05) }}
      />,
    );
    expect(screen.getByTestId('production-verdict')).toHaveTextContent('Watch');
    expect(screen.getByTestId('production-why')).toHaveTextContent(
      'A drift is a reason to look, not a reason to retrain',
    );
    expect(screen.getByTestId('production-performance')).toHaveTextContent(
      'Accuracy 82.0 % on the test set, 78.8 % on this batch: -3.2 points, interval -11.2 to +5.0. The interval contains zero',
    );
  });

  it('says retrain on a measured drop, with its interval', () => {
    render(
      <ProductionCheckView
        check={{ ...quiet, verdict: 'retrain', performance: measured('drop', -0.2, -0.28, -0.11) }}
      />,
    );
    expect(screen.getByTestId('production-check')).toHaveAttribute('data-verdict', 'retrain');
    expect(screen.getByTestId('production-why')).toHaveTextContent(
      'On 189 labelled rows the model is measurably worse than on its test set',
    );
    expect(screen.getByTestId('production-performance')).toHaveTextContent('the drop is real');
  });

  it('gives an error in its own unit', () => {
    render(
      <ProductionCheckView
        check={{
          ...quiet,
          verdict: 'retrain',
          performance: {
            status: 'measured',
            metric: 'rmse',
            rows: 41,
            reference: 2.611,
            batch: 3.46,
            delta: 5.157,
            lo: 0.534,
            hi: 9.78,
            reading: 'drop',
          },
        }}
      />,
    );
    expect(screen.getByTestId('production-performance')).toHaveTextContent(
      'RMSE 2.61 on the test set, 3.46 on this batch. Difference of the mean squared errors: +5.16, interval +0.53 to +9.78.',
    );
  });

  it('names what could not be measured instead of leaving a blank', () => {
    const { rerender } = render(
      <ProductionCheckView
        check={{ ...quiet, performance: { status: 'too-few', rows: 12, min: 30 } }}
      />,
    );
    expect(screen.getByTestId('production-performance')).toHaveTextContent(
      '12 labelled rows, and an error needs at least 30',
    );
    rerender(
      <ProductionCheckView check={{ ...quiet, performance: { status: 'no-spread', rows: 80 } }} />,
    );
    expect(screen.getByTestId('production-performance')).toHaveTextContent(
      'this export does not carry what an interval needs',
    );
  });

  it('says an older export carries no reference, and reads the labels all the same', () => {
    render(
      <ProductionCheckView
        check={{
          ...quiet,
          hasReference: false,
          columns: [],
          predictions: null,
          performance: measured('noise', -0.01, -0.08, 0.06),
        }}
      />,
    );
    expect(screen.getByTestId('production-no-reference')).toHaveTextContent(
      'written before format 5',
    );
    expect(screen.queryByTestId('production-columns')).toBeNull();
    expect(screen.queryByTestId('production-answers')).toBeNull();
    expect(screen.getByTestId('production-why')).toHaveTextContent(
      'Columns and answers could not be read',
    );
  });

  it('admits it when nothing at all could be read', () => {
    render(
      <ProductionCheckView
        check={{ ...quiet, hasReference: false, columns: [], predictions: null }}
      />,
    );
    expect(screen.getByTestId('production-why')).toHaveTextContent('Nothing could be read');
  });

  it('says it in French too', async () => {
    await i18n.changeLanguage('fr');
    render(
      <ProductionCheckView
        check={{ ...moved, performance: measured('noise', -0.032, -0.112, 0.05) }}
      />,
    );
    expect(screen.getByTestId('production-verdict')).toHaveTextContent('Surveiller');
    expect(screen.getByTestId('production-columns')).toHaveTextContent(
      'amount : PSI 1,07, plafond 0,17 (moyenne 32,20 → 13,68)',
    );
    expect(screen.getByTestId('production-performance')).toHaveTextContent(
      'Exactitude 82,0 % sur le jeu de test, 78,8 % sur ce lot : -3,2 points',
    );
  });
});
