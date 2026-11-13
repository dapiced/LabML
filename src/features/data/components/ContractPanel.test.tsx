import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContractPanel } from '@/features/data/components/ContractPanel';
import { useDataStore } from '@/features/data/data-store';
import type { ContractCheck } from '@/features/data/quality/contract';
import type { DatasetMeta } from '@/features/ml/data/types';
import i18n from '@/lib/i18n';

// V63: the clauses that did not hold are spelled out, the ones that held are counted.

const broken: ContractCheck = {
  verdict: 'broken',
  rows: 200,
  counts: { kept: 12, warning: 2, broken: 4 },
  extraColumns: ['loyalty'],
  clauses: [
    { family: 'schema', kind: 'present', column: 'city', outcome: 'broken' },
    { family: 'schema', kind: 'present', column: 'age', outcome: 'kept' },
    {
      family: 'schema',
      kind: 'reading',
      column: 'amount',
      expected: 'number',
      found: 'words',
      outcome: 'broken',
    },
    {
      family: 'missing',
      column: 'date',
      reference: 0.01,
      found: 0.2,
      lo: 0.112,
      hi: 0.27,
      outcome: 'broken',
    },
    {
      family: 'rule',
      rule: 'ageRange',
      columns: ['age'],
      bound: { min: 0, max: 120 },
      referenceFailures: 0,
      referenceTested: 300,
      failures: 60,
      tested: 200,
      rows: [0, 1],
      examples: ['999', '999'],
      outcome: 'broken',
    },
    {
      family: 'rule',
      rule: 'futureDate',
      columns: ['date'],
      referenceFailures: 0,
      referenceTested: 300,
      failures: 0,
      tested: 0,
      rows: [],
      examples: [],
      unreadable: true,
      outcome: 'warning',
    },
    { family: 'distribution', column: 'age', psi: 1.4, ceiling: 0.31, outcome: 'warning' },
    { family: 'distribution', column: 'amount', psi: 0.02, outcome: 'kept' },
  ],
};

const meta = { name: 'june.csv', rowCount: 200, columnCount: 5, bytes: 1 } as DatasetMeta;
const info = { name: 'ref.contract.json', source: 'ref.csv', createdAt: '2026-06-01T00:00:00Z' };

describe('ContractPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useDataStore.setState({
      status: 'ready',
      meta,
      contractStatus: 'done',
      contractCheck: broken,
      contractInfo: info,
    });
  });

  it('offers both gestures before any check', () => {
    useDataStore.setState({ contractStatus: 'idle', contractCheck: null, contractInfo: null });
    render(<ContractPanel />);
    expect(screen.getByTestId('contract-export')).toHaveTextContent('Export the contract');
    expect(screen.getByTestId('contract-browse')).toHaveTextContent('Check this file against');
    expect(screen.queryByTestId('contract-result')).toBeNull();
  });

  it('gives the verdict, the contract it came from and the counts', () => {
    render(<ContractPanel />);
    expect(screen.getByTestId('contract-result')).toHaveAttribute('data-verdict', 'broken');
    expect(screen.getByTestId('contract-verdict')).toHaveTextContent('contract broken');
    expect(screen.getByTestId('contract-result')).toHaveTextContent(
      'june.csv read against the contract drawn from ref.csv',
    );
    expect(screen.getByTestId('contract-result')).toHaveTextContent(
      '4 broken, 2 warnings, 12 kept, over 200 rows',
    );
  });

  it('spells out each clause that did not hold, in its family', () => {
    render(<ContractPanel />);
    const schema = screen.getByTestId('contract-schema');
    expect(schema).toHaveTextContent('« city » is absent from this file');
    expect(schema).toHaveTextContent(
      '« amount » read as numbers at the reference; it reads as words here',
    );
    // A clause that held is counted, not listed.
    expect(schema).not.toHaveTextContent('« age »');
    expect(screen.getByTestId('contract-missing')).toHaveTextContent(
      '« date »: 20.0 % missing, against 1.0 % at the reference. The difference is at least 11.2 points',
    );
    expect(screen.getByTestId('contract-distribution')).toHaveTextContent(
      '« age » has moved: PSI 1.40, above its noise ceiling of 0.31',
    );
    expect(screen.getByTestId('contract-kept')).toHaveTextContent('12 clauses kept');
  });

  it('gives a broken rule its counts and its rows, numbered as a spreadsheet does', () => {
    render(<ContractPanel />);
    const rules = screen.getByTestId('contract-rule');
    expect(rules).toHaveTextContent(
      'age between 0 and 120, on « age »: 60 of 200 values fail, against 0 of 300 at the reference. Rows 2, 3: 999 · 999.',
    );
    expect(rules).toHaveTextContent(
      'no date in the future, on « date »: this rule found nothing it can read in this file',
    );
  });

  it('notes the columns the contract does not describe', () => {
    render(<ContractPanel />);
    expect(screen.getByTestId('contract-extra')).toHaveTextContent('noted and not broken: loyalty');
  });

  it('says so when nothing is broken', () => {
    useDataStore.setState({
      contractCheck: {
        verdict: 'kept',
        rows: 200,
        counts: { kept: 18, warning: 0, broken: 0 },
        extraColumns: [],
        clauses: [{ family: 'schema', kind: 'present', column: 'age', outcome: 'kept' }],
      },
    });
    render(<ContractPanel />);
    expect(screen.getByTestId('contract-verdict')).toHaveTextContent('contract kept');
    expect(screen.queryByTestId('contract-schema')).toBeNull();
    expect(screen.queryByTestId('contract-extra')).toBeNull();
  });

  it('refuses by name a file that is not a contract, and checks nothing', () => {
    useDataStore.setState({
      contractStatus: 'refused',
      contractCheck: null,
      contractInfo: { name: 'recipe.json', source: '', createdAt: '' },
    });
    render(<ContractPanel />);
    expect(screen.getByTestId('contract-refused')).toHaveTextContent(
      'recipe.json is not a LabML data contract',
    );
    expect(screen.queryByTestId('contract-result')).toBeNull();
  });

  it('says it in French too', async () => {
    await i18n.changeLanguage('fr');
    render(<ContractPanel />);
    expect(screen.getByTestId('contract-verdict')).toHaveTextContent('contrat rompu');
    expect(screen.getByTestId('contract-rule')).toHaveTextContent(
      'âge entre 0 et 120, sur « age » : 60 valeurs sur 200 échouent',
    );
    expect(screen.getByTestId('contract-schema')).toHaveTextContent(
      '« amount » se lisait comme des nombres à la référence ; elle se lit comme des mots ici',
    );
  });
});
