import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TestLedgerPanel } from '@/features/ml/components/TestLedgerPanel';
import { useLabStore } from '@/features/ml/lab-store';
import { fileKey, testSetKey, type LedgerEntry } from '@/features/ml/train/ledger';
import type { DatasetMeta } from '@/features/ml/data/types';
import type { TrainSummary } from '@/features/ml/train/types';
import i18n from '@/lib/i18n';

// V60: the panel counts the distinct runs a test set has scored, and offers a
// fresh split only once that count has reached the first mark.

const meta = { name: 'titanic.csv', rowCount: 891, columnCount: 15, bytes: 1 } as DatasetMeta;
const file = fileKey(meta, 'survived');

function entries(count: number, seed = 42, split: Parameters<typeof testSetKey>[3] = null) {
  const list: LedgerEntry[] = [];
  for (let i = 0; i < count; i++) {
    list.push({
      file,
      testSet: testSetKey(meta, 'survived', seed, split),
      seed,
      config: `c${i}`,
      at: seed * 100 + i,
    });
  }
  return list;
}

const summary = (seed: number, split?: TrainSummary['split']) =>
  ({ seed, ...(split && { split }) }) as TrainSummary;

describe('TestLedgerPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useLabStore.setState({
      meta,
      target: 'survived',
      seed: 42,
      splitChoice: null,
      ledgerEntries: [],
      trainStatus: 'idle',
      tuneStatus: 'idle',
      curveStatus: 'idle',
      robustStatus: 'idle',
      batchStatus: 'idle',
      summary: null,
    });
  });

  it('says nothing while the test set has scored no run', () => {
    const { container } = render(<TestLedgerPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls one run a measurement, and offers no other split', () => {
    useLabStore.setState({ ledgerEntries: entries(1), trainStatus: 'done', summary: summary(42) });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-panel')).toHaveAttribute('data-level', 'first');
    expect(screen.getByTestId('ledger-reads')).toHaveTextContent('1 run scored');
    expect(screen.getByTestId('ledger-verdict')).toHaveTextContent('nothing was chosen with it');
    expect(screen.queryByTestId('ledger-fresh')).toBeNull();
  });

  it('says that comparing a few runs already chooses, without offering a split to shop with', () => {
    useLabStore.setState({ ledgerEntries: entries(3), trainStatus: 'done', summary: summary(42) });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-panel')).toHaveAttribute('data-level', 'reused');
    expect(screen.getByTestId('ledger-reads')).toHaveTextContent('3 distinct runs scored');
    expect(screen.getByTestId('ledger-verdict')).toHaveTextContent(
      'Keeping the better of them is choosing with the test set',
    );
    expect(screen.queryByTestId('ledger-fresh')).toBeNull();
  });

  it('shows the count before training too: the ledger outlives the session', () => {
    useLabStore.setState({ ledgerEntries: entries(4) });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-reads')).toHaveTextContent('4 distinct runs scored');
    expect(screen.getByTestId('ledger-panel')).toHaveTextContent('Counted before this training');
  });

  it('gives the measured optimism from five runs, and draws a fresh split on request', () => {
    useLabStore.setState({ ledgerEntries: entries(5), trainStatus: 'done', summary: summary(42) });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-panel')).toHaveAttribute('data-level', 'worn');
    expect(screen.getByTestId('ledger-verdict')).toHaveTextContent(
      'Read the best score as optimistic',
    );
    const fresh = screen.getByTestId('ledger-fresh');
    expect(fresh).toHaveTextContent('Draw a fresh split (seed 43)');
    fireEvent.click(fresh);
    expect(useLabStore.getState().seed).toBe(43);
    // The run that was on screen belonged to the old split.
    expect(useLabStore.getState().trainStatus).toBe('idle');
  });

  it('says a spent test set no longer tells better from luckier', () => {
    useLabStore.setState({ ledgerEntries: entries(10), trainStatus: 'done', summary: summary(42) });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-panel')).toHaveAttribute('data-level', 'spent');
    expect(screen.getByTestId('ledger-verdict')).toHaveTextContent(
      'no longer tells a better configuration from a luckier one',
    );
  });

  it('says a second split is the same rows redealt, and skips the seeds already dealt', () => {
    useLabStore.setState({
      ledgerEntries: [...entries(9), ...entries(7, 43)],
      seed: 43,
      trainStatus: 'done',
      summary: summary(43),
    });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-reads')).toHaveTextContent('7 distinct runs scored');
    expect(screen.getByTestId('ledger-split')).toHaveTextContent('split 2 of this file · seed 43');
    expect(screen.getByTestId('ledger-redeal')).toHaveTextContent('It is not new data');
    expect(screen.getByTestId('ledger-fresh')).toHaveTextContent('seed 44');
  });

  it('refuses another draw of a chronological split: it has one test set', () => {
    const dated = { mode: 'chronological' as const, column: 'date' };
    useLabStore.setState({
      ledgerEntries: entries(8, 42, dated),
      splitChoice: dated,
      trainStatus: 'done',
      summary: summary(42, dated),
    });
    render(<TestLedgerPanel />);
    expect(screen.queryByTestId('ledger-fresh')).toBeNull();
    expect(screen.getByTestId('ledger-chronological')).toHaveTextContent(
      'Only newer data can replace it',
    );
  });

  it('reads a finished run on the split it was trained with, not on the one selected since', () => {
    useLabStore.setState({
      ledgerEntries: entries(2),
      trainStatus: 'done',
      summary: summary(42),
      splitChoice: { mode: 'group', column: 'ticket' },
    });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-reads')).toHaveTextContent('2 distinct runs scored');
  });

  it('holds the fresh split while something is running', () => {
    useLabStore.setState({
      ledgerEntries: entries(7),
      trainStatus: 'done',
      summary: summary(42),
      tuneStatus: 'running',
    });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-fresh')).toBeDisabled();
  });

  it('says it in French too', async () => {
    await i18n.changeLanguage('fr');
    useLabStore.setState({ ledgerEntries: entries(7), trainStatus: 'done', summary: summary(42) });
    render(<TestLedgerPanel />);
    expect(screen.getByTestId('ledger-reads')).toHaveTextContent('7 runs distincts notés');
    expect(screen.getByTestId('ledger-verdict')).toHaveTextContent('0,2 à 0,8 fois le bruit');
    expect(screen.getByTestId('ledger-fresh')).toHaveTextContent(
      'Tirer une nouvelle découpe (graine 43)',
    );
  });
});
