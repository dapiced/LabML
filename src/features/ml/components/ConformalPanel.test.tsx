import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConformalPanel } from '@/features/ml/components/ConformalPanel';
import { useLabStore } from '@/features/ml/lab-store';
import { buildReportHtml } from '@/features/ml/projects/report';
import type { RunRecord } from '@/features/ml/projects/types';
import type { ConformalAnalysis, ConformalRefusal } from '@/features/ml/train/conformal-analysis';
import i18n from '@/lib/i18n';

// V57: the panel shows the coverage measured on test beside the target, and
// says so plainly when the promise could not be made or did not hold.

const classification: ConformalAnalysis = {
  model: 'gbdt',
  alpha: 0.1,
  isClassification: true,
  testRows: 178,
  calibrationRows: 89,
  qHat: 0.72,
  coverage: 0.904,
  coverageLo: 0.852,
  coverageHi: 0.939,
  meanSize: 1.31,
  sizeShares: [0.02, 0.67, 0.31],
};

const regression: ConformalAnalysis = {
  model: 'forest',
  alpha: 0.2,
  isClassification: false,
  testRows: 80,
  calibrationRows: 40,
  qHat: 3.25,
  coverage: 0.6,
  coverageLo: 0.49,
  coverageHi: 0.7,
  halfWidth: 3.25,
};

const refusal: ConformalRefusal = {
  model: 'gbdt',
  alpha: 0.05,
  refused: 'calibration-too-small',
  needed: 19,
  available: 15,
};

describe('ConformalPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useLabStore.setState({ conformalAnalysis: null, conformalAlpha: 0.1, trainStatus: 'done' });
  });

  it('renders nothing before an analysis exists', () => {
    const { container } = render(<ConformalPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the measured coverage beside the target, and what a set holds', () => {
    useLabStore.setState({ conformalAnalysis: classification });
    render(<ConformalPanel />);
    expect(screen.getByTestId('conformal-coverage')).toHaveTextContent('90.4 %');
    const summary = screen.getByTestId('conformal-summary');
    expect(summary).toHaveTextContent('90.4 % covered');
    expect(summary).toHaveTextContent('for a target of 90 %');
    expect(summary).toHaveTextContent('1.31 classes on average');
    expect(summary).toHaveTextContent('67 % of rows get a single class');
    expect(summary).toHaveTextContent('probability reaches 0.28');
    expect(summary).toHaveTextContent('89 rows per half');
    expect(screen.getByTestId('conformal-verdict')).toHaveTextContent('the promise held here');
  });

  it('gives a regressor a margin, and says when the promise did not hold', () => {
    useLabStore.setState({ conformalAnalysis: regression, conformalAlpha: 0.2 });
    render(<ConformalPanel />);
    const summary = screen.getByTestId('conformal-summary');
    expect(summary).toHaveTextContent('the prediction ± 3.25');
    // 80 % asked, 60 % measured, interval 49 to 70: the target is outside.
    expect(screen.getByTestId('conformal-verdict')).toHaveTextContent('the promise did not hold');
  });

  it('does not call a coverage above the target a broken promise (V57.1)', () => {
    // 90 % asked, 96.1 % measured, interval 92.1 to 98.1: above, and kept.
    useLabStore.setState({
      conformalAnalysis: {
        ...classification,
        coverage: 0.961,
        coverageLo: 0.921,
        coverageHi: 0.981,
      },
    });
    render(<ConformalPanel />);
    const verdict = screen.getByTestId('conformal-verdict');
    expect(verdict).toHaveTextContent('the promise held, with room to spare');
    expect(verdict).not.toHaveTextContent('did not hold');
  });

  it('refuses with the numbers when the test split is too small for the level', () => {
    useLabStore.setState({ conformalAnalysis: refusal, conformalAlpha: 0.05 });
    render(<ConformalPanel />);
    expect(screen.getByTestId('conformal-summary')).toHaveTextContent(
      'No coverage can be promised at 95 %',
    );
    expect(screen.getByTestId('conformal-summary')).toHaveTextContent(
      'at least 19 rows and has 15',
    );
    expect(screen.queryByTestId('conformal-coverage')).toBeNull();
    expect(screen.queryByTestId('conformal-verdict')).toBeNull();
  });

  it('asks again when another target is picked', () => {
    useLabStore.setState({ conformalAnalysis: classification });
    render(<ConformalPanel />);
    fireEvent.change(screen.getByTestId('conformal-level'), { target: { value: '0.05' } });
    expect(useLabStore.getState().conformalAlpha).toBe(0.05);
    // The previous answer is dropped until the worker replies.
    expect(useLabStore.getState().conformalAnalysis).toBeNull();
  });

  it('says it in French too', async () => {
    await i18n.changeLanguage('fr');
    useLabStore.setState({ conformalAnalysis: classification });
    render(<ConformalPanel />);
    expect(screen.getByTestId('conformal-summary')).toHaveTextContent('pour une cible de 90 %');
    expect(screen.getByTestId('conformal-summary')).toHaveTextContent('90,4 % couvertes');
  });
});

describe('the HTML report (V57)', () => {
  const record = JSON.parse(readFileSync('tests/share-links/titanic.json', 'utf8')) as RunRecord;
  const t = i18n.getFixedT('en');

  it('carries the conformal analysis of a run that has one', () => {
    const html = buildReportHtml(
      { ...record, artifacts: { ...record.artifacts, conformal: classification } },
      t,
      'en',
    );
    expect(html).toContain('Prediction sets with a coverage target');
    expect(html).toContain('90.4 % covered');
  });

  it('carries the refusal too', () => {
    const html = buildReportHtml(
      { ...record, artifacts: { ...record.artifacts, conformal: refusal } },
      t,
      'en',
    );
    expect(html).toContain('No coverage can be promised at 95 %');
  });

  it('is unchanged for a run with no conformal analysis', () => {
    expect(buildReportHtml(record, t, 'en')).not.toContain('Prediction sets');
  });
});
