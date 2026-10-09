import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlEngine } from '@/features/data/sql/engine';
import i18n from '@/lib/i18n';

/**
 * V47 — DuckDB lives in its own worker with its own Wasm heap, so an engine
 * that is never closed is a worker that never ends. The real engine needs the
 * Wasm bundle; these tests swap it for one that records `close()`.
 */
const engines: Array<SqlEngine & { closed: boolean }> = [];
let release: (() => void) | null = null;

vi.mock('@/features/data/sql/engine', () => ({
  BUNDLE_BYTES: { eh: 18_157_568, mvp: 22_167_552 },
  openEngine: () =>
    new Promise<SqlEngine>((resolve) => {
      const engine = {
        flavour: 'eh' as const,
        closed: false,
        register: async () => undefined,
        run: async () => ({ columns: [], rows: [], total: 0, truncated: false }),
        toParquet: async () => new Uint8Array(),
        close: async () => {
          engine.closed = true;
        },
      };
      engines.push(engine as unknown as SqlEngine & { closed: boolean });
      release = () => resolve(engine as unknown as SqlEngine);
    }),
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
