import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GroupAuditPanel } from '@/features/ml/components/GroupAuditPanel';
import { useLabStore } from '@/features/ml/lab-store';
import type { ColumnProfile } from '@/features/ml/data/types';
import type { GroupAudit, GroupAuditRefusal } from '@/features/ml/train/group-audit';
import type { InsightsPayload } from '@/features/ml/train/types';
import i18n from '@/lib/i18n';

// V59: the panel waits for the user to name a column, then says of each gap
// whether it can be told from the draw.

const profile = (name: string, type: ColumnProfile['type'], cardinality = 2): ColumnProfile => ({
  name,
  type,
  rowCount: 891,
  missingCount: 0,
  cardinality,
});

const audit: GroupAudit = {
  model: 'gbdt',
  column: 'sex',
  inFeatures: false,
  kind: 'binary',
  positiveClass: 'yes',
  threshold: 0.35,
  testRows: 200,
  minRows: 20,
  minCases: 10,
  rates: ['selection', 'recall', 'falseAlarm', 'accuracy'],
  reference: 'men',
  groups: [
    {
      value: 'men',
      rows: 100,
      rates: {
        selection: { value: 0.35, lo: 0.264, hi: 0.447, cases: 100 },
        recall: { value: 0.5, lo: 0.33, hi: 0.67, cases: 30 },
        falseAlarm: { value: 0.286, lo: 0.19, hi: 0.4, cases: 70 },
        accuracy: { value: 0.65, lo: 0.55, hi: 0.74, cases: 100 },
      },
    },
    {
      value: 'women',
      rows: 100,
      rates: {
        selection: { value: 0.6, lo: 0.502, hi: 0.691, cases: 100 },
        recall: null,
        falseAlarm: { value: 0.4, lo: 0.29, hi: 0.53, cases: 60 },
        accuracy: { value: 0.72, lo: 0.63, hi: 0.8, cases: 100 },
      },
    },
  ],
  gaps: [
    { rate: 'selection', group: 'women', delta: 0.25, lo: 0.112, hi: 0.375, real: true },
    { rate: 'accuracy', group: 'women', delta: 0.07, lo: -0.06, hi: 0.2, real: false },
  ],
  small: [{ value: 'other', rows: 6 }],
  beyondCap: 0,
  missingRows: 3,
};

const refusal: GroupAuditRefusal = {
  model: 'gbdt',
  column: 'deck',
  refused: 'too-few-groups',
  minRows: 20,
  groups: [
    { value: 'C', rows: 16 },
    { value: 'D', rows: 9 },
  ],
};

describe('GroupAuditPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useLabStore.setState({
      trainStatus: 'done',
      target: 'survived',
      insights: { model: 'gbdt' } as InsightsPayload,
      profiles: [
        profile('survived', 'boolean'),
        profile('sex', 'categorical'),
        profile('alone', 'boolean'),
        profile('age', 'numeric', 80),
        profile('name', 'text', 891),
        profile('constant', 'categorical', 1),
      ],
      groupAudit: null,
      groupAuditColumn: null,
      groupAuditPending: false,
    });
  });

  it('renders nothing before a run is done', () => {
    useLabStore.setState({ trainStatus: 'idle' });
    const { container } = render(<GroupAuditPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the columns that form groups, and never picks one itself', () => {
    render(<GroupAuditPanel />);
    const select = screen.getByTestId<HTMLSelectElement>('group-audit-column');
    expect(select.value).toBe('');
    const options = [...select.options].map((option) => option.value);
    // Not the target, not a number, not free text, not a column with one value.
    expect(options).toEqual(['', 'sex', 'alone']);
    expect(screen.queryByTestId('group-audit-table')).toBeNull();
  });

  it('asks for the audit of the column that is picked, and clears it when unpicked', () => {
    render(<GroupAuditPanel />);
    const select = screen.getByTestId('group-audit-column');
    fireEvent.change(select, { target: { value: 'sex' } });
    expect(useLabStore.getState().groupAuditColumn).toBe('sex');
    expect(useLabStore.getState().groupAuditPending).toBe(true);
    fireEvent.change(select, { target: { value: '' } });
    expect(useLabStore.getState().groupAuditColumn).toBeNull();
    expect(useLabStore.getState().groupAuditPending).toBe(false);
  });

  it('shows each group with its rates, and marks the real gap apart from the noise', () => {
    useLabStore.setState({ groupAudit: audit, groupAuditColumn: 'sex' });
    render(<GroupAuditPanel />);
    const table = screen.getByTestId('group-audit-table');
    expect(table).toHaveTextContent('men');
    expect(table).toHaveTextContent('reference');
    expect(table).toHaveTextContent('60 %');
    expect(table).toHaveTextContent('50.2 % → 69.1 %');
    expect(table).toHaveTextContent('+25 points: real');
    expect(table).toHaveTextContent('+7 points: inside the noise');
    // A rate resting on too few cases is not given a number.
    expect(table).toHaveTextContent('too few cases');
  });

  it('says what was audited, at which threshold, and through what', () => {
    useLabStore.setState({ groupAudit: audit, groupAuditColumn: 'sex' });
    render(<GroupAuditPanel />);
    const scope = screen.getByTestId('group-audit-scope');
    expect(scope).toHaveTextContent('a column the model does not use');
    expect(scope).toHaveTextContent('read against « men », the largest group');
    expect(scope).toHaveTextContent('from a probability of 0.35');
    const findings = screen.getByTestId('group-audit-findings');
    expect(findings).toHaveTextContent('« women » is +25 points against « men »');
    expect(findings).toHaveTextContent('interval +11.2 to +37.5');
    expect(findings).toHaveTextContent('1 other gap(s) are inside the noise');
    expect(findings).toHaveTextContent('fewer than 20 test rows: other (6)');
    expect(findings).toHaveTextContent('3 test rows have no value in this column');
  });

  it('does not read an absence of real gaps as equal treatment', () => {
    useLabStore.setState({
      groupAudit: { ...audit, gaps: audit.gaps.map((gap) => ({ ...gap, real: false })) },
      groupAuditColumn: 'sex',
    });
    render(<GroupAuditPanel />);
    expect(screen.getByTestId('group-audit-findings')).toHaveTextContent(
      'That is not proof of equal treatment',
    );
  });

  it('refuses with the sizes when fewer than two groups can be compared', () => {
    useLabStore.setState({ groupAudit: refusal, groupAuditColumn: 'deck' });
    render(<GroupAuditPanel />);
    expect(screen.getByTestId('group-audit-refusal')).toHaveTextContent(
      'Nothing to compare on « deck »: fewer than two groups have 20 test rows. Sizes: C (16), D (9).',
    );
    expect(screen.queryByTestId('group-audit-table')).toBeNull();
  });

  it('says it in French too', async () => {
    await i18n.changeLanguage('fr');
    useLabStore.setState({ groupAudit: audit, groupAuditColumn: 'sex' });
    render(<GroupAuditPanel />);
    expect(screen.getByTestId('group-audit-table')).toHaveTextContent('+25 points : réel');
    expect(screen.getByTestId('group-audit-findings')).toHaveTextContent(
      '« women » est à +25 points par rapport à « men »',
    );
    expect(screen.getByTestId('group-audit-panel')).toHaveTextContent('pas un verdict');
  });
});
