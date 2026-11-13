import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlEngine } from '@/features/data/sql/engine';
import { useDataStore } from '@/features/data/data-store';
import i18n from '@/lib/i18n';

/**
 * V47 — DuckDB lives in its own worker with its own Wasm heap, so an engine
 * that is never closed is a worker that never ends. The real engine needs the
 * Wasm bundle; these tests swap it for one that records `close()`.
 */
const engines: Array<SqlEngine & { closed: boolean }> = [];
let release: (() => void) | null = null;
/** V69: what the fake engine answers, and what it was asked to export. */
const fake = {
  table: { columns: ['a', 'b'], rows: [['1', '2']], totalRows: 1, truncated: false },
  csv: 'a,b\n1,2\n',
  csvAsked: [] as string[],
  parquetAsked: [] as string[],
  failExport: false,
};

vi.mock('@/features/data/sql/engine', () => ({
  BUNDLE_BYTES: { eh: 18_157_568, mvp: 22_167_552 },
  openEngine: () =>
    new Promise<SqlEngine>((resolve) => {
      const engine = {
        flavour: 'eh' as const,
        closed: false,
        register: async () => undefined,
        run: async () => fake.table,
        toParquet: async (sql: string) => {
          fake.parquetAsked.push(sql);
          return new Uint8Array([1, 2, 3]);
        },
        toCsv: async (sql: string) => {
          fake.csvAsked.push(sql);
          if (fake.failExport) throw new Error('Parser Error: syntax error');
          return fake.csv;
        },
        close: async () => {
          engine.closed = true;
        },
      };
      engines.push(engine as unknown as SqlEngine & { closed: boolean });
      release = () => resolve(engine as unknown as SqlEngine);
    }),
}));

const downloads: { name: string; content: unknown }[] = [];
vi.mock('@/lib/download', () => ({
  downloadFile: (name: string, content: unknown) => void downloads.push({ name, content }),
}));

const { SqlPanel } = await import('@/features/data/SqlPanel');

function renderPanel() {
  return render(
    <MemoryRouter>
      <SqlPanel />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  engines.length = 0;
  release = null;
  downloads.length = 0;
  fake.csvAsked.length = 0;
  fake.parquetAsked.length = 0;
  fake.failExport = false;
  fake.table = { columns: ['a', 'b'], rows: [['1', '2']], totalRows: 1, truncated: false };
  useDataStore.setState({ labHandoff: null });
  await i18n.changeLanguage('en');
});

describe('SqlPanel engine lifecycle', () => {
  it('closes the engine when the panel goes away', async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    await user.click(screen.getByTestId('sql-open'));
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => release?.());
    await waitFor(() => expect(screen.queryByTestId('sql-input')).toBeInTheDocument());

    view.unmount();

    expect(engines).toHaveLength(1);
    expect(engines[0].closed).toBe(true);
  });

  it('closes an engine that finishes starting after the panel is gone', async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    await user.click(screen.getByTestId('sql-open'));
    await waitFor(() => expect(release).not.toBeNull());

    view.unmount();
    await act(async () => release?.());

    await waitFor(() => expect(engines[0].closed).toBe(true));
  });
});

/** Opens the console and runs `sql`, leaving a result on screen. */
async function runQuery(sql: string) {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByTestId('sql-open'));
  await waitFor(() => expect(release).not.toBeNull());
  await act(async () => release?.());
  const input = await screen.findByTestId('sql-input');
  await user.clear(input);
  await user.type(input, sql);
  await user.click(screen.getByTestId('sql-run'));
  await screen.findByTestId('sql-result');
  return user;
}

describe('SqlPanel exports (V69)', () => {
  it('hands the lab the whole result written by the engine, not the painted rows', async () => {
    // The console paints 200 rows of 590; the engine writes all of them.
    fake.table = {
      columns: ['a', 'b'],
      rows: Array.from({ length: 200 }, (_, i) => [String(i), 'x']),
      totalRows: 590,
      truncated: true,
    };
    fake.csv = ['a,b', ...Array.from({ length: 590 }, (_, i) => `${i},`)].join('\n') + '\n';
    const user = await runQuery('SELECT * FROM dataset;');
    expect(screen.getByTestId('sql-export-note')).toHaveTextContent(
      'they carry all 590 rows, written by the engine itself',
    );
    await user.click(screen.getByTestId('sql-to-lab'));
    await waitFor(() => expect(useDataStore.getState().labHandoff).not.toBeNull());
    const handoff = useDataStore.getState().labHandoff!;
    // The trailing semicolon is gone: COPY (…) would refuse it.
    expect(fake.csvAsked).toEqual(['SELECT * FROM dataset']);
    expect(handoff.content.trim().split('\n')).toHaveLength(591);
    expect(handoff.content).not.toContain('∅');
    expect(handoff.name).toMatch(/^query-[0-9a-f]{8}\.csv$/);
  });

  it('exports the query behind the result on screen, even after the box was edited', async () => {
    const user = await runQuery('SELECT 1');
    await user.type(screen.getByTestId('sql-input'), ' FROM nowhere');
    await user.click(screen.getByTestId('sql-export-csv'));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(fake.csvAsked).toEqual(['SELECT 1']);
    expect(downloads[0].name).toMatch(/^query-[0-9a-f]{8}\.csv$/);
    expect(downloads[0].content).toBe(fake.csv);
  });

  it('offers the Parquet export the engine always had', async () => {
    const user = await runQuery('SELECT 1');
    await user.click(screen.getByTestId('sql-export-parquet'));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(fake.parquetAsked).toEqual(['SELECT 1']);
    expect(downloads[0].name).toMatch(/^query-[0-9a-f]{8}\.parquet$/);
  });

  it('refuses a result past the lab cell budget before building it', async () => {
    fake.table = {
      columns: ['a', 'b', 'c'],
      rows: [['1', '2', '3']],
      totalRows: 7_000_000,
      truncated: true,
    };
    const user = await runQuery('SELECT 1');
    await user.click(screen.getByTestId('sql-to-lab'));
    expect(await screen.findByTestId('sql-export-error')).toHaveTextContent(
      'This result has 7,000,000 rows and 3 columns: more cells than the 20,000,000 the lab reads',
    );
    expect(fake.csvAsked).toEqual([]);
    expect(useDataStore.getState().labHandoff).toBeNull();
  });

  it('reports an export the engine refuses, in the engine own words', async () => {
    fake.failExport = true;
    const user = await runQuery('SELECT 1');
    await user.click(screen.getByTestId('sql-export-csv'));
    expect(await screen.findByTestId('sql-export-error')).toHaveTextContent(
      'The result could not be exported (Parser Error: syntax error).',
    );
    expect(downloads).toHaveLength(0);
  });
});
