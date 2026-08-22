import { describe, expect, it } from 'vitest';
import { auditRequests } from '@/features/privacy/audit';

const ORIGIN = 'https://app.dominicdapice.com';

describe('auditRequests', () => {
  it('counts the page own requests and finds no third party in a clean run', () => {
    const audit = auditRequests(
      [
        `${ORIGIN}/assets/main-abc.js`,
        `${ORIGIN}/assets/ChatPage-def.js`,
        '/datasets/titanic.csv',
        `${ORIGIN}/llm/manifest.json`,
      ],
      ORIGIN,
    );
    expect(audit).toEqual({ total: 4, sameOrigin: 4, thirdParty: [], inline: 0 });
  });

  it('names every foreign origin, worst case first', () => {
    const audit = auditRequests(
      [
        `${ORIGIN}/assets/main-abc.js`,
        'https://cdn.example.com/a.js',
        'https://cdn.example.com/b.js',
        'https://analytics.example.net/collect',
      ],
      ORIGIN,
    );
    expect(audit.sameOrigin).toBe(1);
    expect(audit.thirdParty).toEqual([
      { origin: 'https://cdn.example.com', count: 2 },
      { origin: 'https://analytics.example.net', count: 1 },
    ]);
    expect(audit.total).toBe(4);
  });

  it('does not count what never crossed the network', () => {
    // A blob: worker script and a data: image resolve inside the tab.
    const audit = auditRequests(
      ['blob:https://app.dominicdapice.com/1234', 'data:image/svg+xml,<svg/>'],
      ORIGIN,
    );
    expect(audit).toEqual({ total: 0, sameOrigin: 0, thirdParty: [], inline: 2 });
  });

  it('resolves a relative entry against the page origin', () => {
    // Resource timings can be recorded relative; `/datasets/titanic.csv` is
    // ours, and counting it as foreign would cry wolf on the one page whose
    // whole point is not to.
    expect(auditRequests(['/datasets/titanic.csv'], ORIGIN).sameOrigin).toBe(1);
  });
});
