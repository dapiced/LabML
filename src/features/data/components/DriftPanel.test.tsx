import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DriftPanel } from '@/features/data/components/DriftPanel';
import { useDataStore } from '@/features/data/data-store';
import type { DriftReport } from '@/features/data/quality/drift';
import type { DatasetMeta } from '@/features/ml/data/types';
import i18n from '@/lib/i18n';

// V62: the panel tells a drift from a PSI the size of the files explains.

const report: DriftReport = {
  refRows: 59,
  newRows: 59,
  schema: { added: [], removed: [], typeChanged: [] },
  columns: [
    {
      column: 'unit_price',
      kind: 'numeric',
      psi: 7.148,
      severity: 'strong',
      ceiling: 0.598,
      refMissingRatio: 0,
      newMissingRatio: 0,
      refMean: 4.8,
      newMean: 6.1,
    },
    {
      column: 'quantity',
      kind: 'numeric',
      psi: 0.329,
      severity: 'stable',
      ceiling: 0.466,
      noise: true,
      refMissingRatio: 0,
      newMissingRatio: 0,
      refMean: 2.1,
      newMean: 2.3,
    },
    {
      column: 'currency',
      kind: 'categorical',
      psi: 0,
      severity: 'stable',
      refMissingRatio: 0,
      newMissingRatio: 0,
    },
  ],
  driftedColumns: 1,
  severity: 'strong',
};

const meta = (name: string) => ({ name, rowCount: 59, columnCount: 3, bytes: 1 }) as DatasetMeta;

describe('DriftPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useDataStore.setState({
      status: 'ready',
      meta: meta('cafe-sales.csv'),
      driftStatus: 'done',
      driftReport: report,
      compareMeta: meta('cafe-sales-june.csv'),
    });
  });

  it('grades a real move, and shows the ceiling it cleared', () => {
    render(<DriftPanel />);
    const row = screen.getByRole('row', { name: /unit_price/ });
    expect(row).toHaveTextContent('7.148');
    expect(row).toHaveTextContent('noise ceiling 0.598');
    expect(row).toHaveTextContent('strong drift');
  });

  it('says « inside the noise » of a high PSI its ceiling explains, not « drift »', () => {
    render(<DriftPanel />);
    const row = screen.getByRole('row', { name: /quantity/ });
    expect(row).toHaveTextContent('0.329');
    expect(row).toHaveTextContent('noise ceiling 0.466');
    expect(row).toHaveTextContent('inside the noise');
    expect(row).not.toHaveTextContent('drift');
    expect(screen.getByTestId('drift-noise')).toHaveTextContent(
      '1 column has a PSI of 0.1 or above that the size of the two files explains',
    );
  });

  it('shows no ceiling where none was needed', () => {
    render(<DriftPanel />);
    const row = screen.getByRole('row', { name: /currency/ });
    expect(row).toHaveTextContent('stable');
    expect(row).not.toHaveTextContent('noise ceiling');
  });

  it('counts only the columns that drifted', () => {
    render(<DriftPanel />);
    expect(screen.getByTestId('drift-result')).toHaveTextContent('1 of 3 columns drifted');
  });

  it('says nothing of noise when no column is in that case', () => {
    useDataStore.setState({
      driftReport: { ...report, columns: report.columns.filter((column) => !column.noise) },
    });
    render(<DriftPanel />);
    expect(screen.queryByTestId('drift-noise')).toBeNull();
  });

  it('says it in French too', async () => {
    await i18n.changeLanguage('fr');
    render(<DriftPanel />);
    const row = screen.getByRole('row', { name: /quantity/ });
    expect(row).toHaveTextContent('dans le bruit');
    expect(row).toHaveTextContent('plafond de bruit 0,466');
  });
});
