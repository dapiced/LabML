import { cleanup, render, screen } from '@testing-library/react';
import { compressToEncodedURIComponent } from 'lz-string';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import iris from '../../../../tests/share-links/iris.json';
import mpg from '../../../../tests/share-links/mpg.json';
import titanic from '../../../../tests/share-links/titanic.json';
import { SharedRunPage } from '@/features/ml/pages/SharedRunPage';
import i18n from '@/lib/i18n';

/**
 * V48 — a share link is input from a stranger, and the page must end on the
 * run or on a refusal, never on a crash. Before V48, deleting, nulling or
 * retyping single fields of three real links produced 3 660 links the decoder
 * accepted, and 1 020 of them crashed the page on 99 distinct paths.
 */
const LINKS = { titanic, iris, mpg } as const;

type Path = (string | number)[];

const MUTATIONS: [string, unknown][] = [
  ['delete', undefined],
  ['null', null],
  ['string', 'x'],
  ['number', 1],
  ['object', {}],
  ['array', []],
];

/** Every field of the payload, through the first item of each array. */
function paths(node: unknown, prefix: Path = [], out: Path[] = []): Path[] {
  if (prefix.length > 0) out.push(prefix);
  if (Array.isArray(node)) node.slice(0, 1).forEach((v, i) => paths(v, [...prefix, i], out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) paths(value, [...prefix, key], out);
  }
  return out;
}

function mutate(root: unknown, path: Path, kind: string, value: unknown): unknown {
  const copy = structuredClone(root);
  let node = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1];
  if (kind !== 'delete') node[last] = value;
  else if (Array.isArray(node)) node.splice(last as number, 1);
  else delete node[last];
  return copy;
}

function openLink(payload: unknown) {
  window.location.hash = compressToEncodedURIComponent(JSON.stringify(payload));
  return render(
    <MemoryRouter>
      <SharedRunPage />
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  // React reports every error a boundary catches; hundreds are expected here.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SharedRunPage', () => {
  it.each(Object.entries(LINKS))('renders the real %s link', (_name, payload) => {
    openLink(payload);
    expect(screen.getByTestId('run-view')).toBeInTheDocument();
  });

  it('refuses, with its own explanation, a link that decodes but cannot be drawn', () => {
    // The audit's example: `insights: {}` passed the decoder, then
    // `importance.slice` crashed the page.
    openLink({ ...titanic, insights: {} });
    expect(screen.queryByTestId('run-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('share-refused')).toHaveTextContent(
      'does not have the shape LabML writes',
    );
  });

  it('ends every damaged link on the run or on a refusal, never on a crash', () => {
    // Each field shape is damaged once, in the first link that carries it:
    // the three links share most of their structure, and rendering the same
    // damage three times tests nothing new.
    const seen = new Set<string>();
    const crashes: string[] = [];
    for (const [name, payload] of Object.entries(LINKS)) {
      for (const path of paths(payload)) {
        const shape = path.map((key) => (typeof key === 'number' ? '[]' : key)).join('.');
        if (seen.has(shape)) continue;
        seen.add(shape);
        for (const [kind, value] of MUTATIONS) {
          try {
            openLink(mutate(payload, path, kind, value));
            const shown =
              screen.queryByTestId('run-view') !== null ||
              screen.queryByTestId('share-refused') !== null;
            if (!shown) crashes.push(`${name}: ${shape} (${kind}): blank page`);
          } catch (error) {
            crashes.push(`${name}: ${shape} (${kind}): ${(error as Error).message}`);
          } finally {
            cleanup();
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(100);
    expect(crashes).toEqual([]);
  }, 120_000);
});
