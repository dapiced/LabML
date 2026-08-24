import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { decodeShareFragment } from '@/features/ml/projects/share';

/** A fragment carrying exactly the payload given, however malformed. */
const frag = (payload: unknown) => compressToEncodedURIComponent(JSON.stringify(payload));

/**
 * V35 wave 4. A share link is the one piece of input that reaches LabML from
 * outside the browser it runs in, and it used to be checked for three fields.
 *
 * Measured before the fix: each payload below passed `decodeShareFragment`,
 * reached `RunView`, and threw « Cannot read properties of undefined » — a
 * white page instead of the « invalid link » message the page already has.
 * The common case is not an attacker: it is a real share URL that a chat
 * client truncated.
 */
describe('decodeShareFragment — a link that is not a run is refused, not rendered', () => {
  const HOSTILE: [string, unknown][] = [
    ['nothing but a version', { v: 2 }],
    ['the three fields the old check looked at', { v: 2, results: [], summary: 'x' }],
    ['a summary that is a string, not a summary', { v: 2, results: [], summary: 'x', name: 'r' }],
    [
      'no dataset block',
      {
        v: 2,
        results: [],
        summary: {},
        insights: {},
        name: 'r',
        target: 't',
        taskType: 'binary',
        createdAt: 1,
        seed: 42,
      },
    ],
    [
      'a dataset whose rowCount is a string',
      {
        v: 2,
        results: [],
        summary: {},
        insights: {},
        name: 'r',
        target: 't',
        taskType: 'binary',
        createdAt: 1,
        seed: 42,
        dataset: { name: 'd', rowCount: '10', columnCount: 3 },
      },
    ],
    [
      'a result row that is not a result',
      {
        v: 2,
        results: [{ key: null, metrics: null }],
        summary: {},
        insights: {},
        name: 'r',
        target: 't',
        taskType: 'binary',
        createdAt: 1,
        seed: 42,
        dataset: { name: 'd', rowCount: 10, columnCount: 3 },
      },
    ],
    ['results that are not an array', { v: 2, results: 'nope', summary: {} }],
    ['an unknown version', { v: 3 }],
  ];

  it.each(HOSTILE)('refuses %s', (_label, payload) => {
    expect(decodeShareFragment(frag(payload))).toBeNull();
  });

  it('refuses junk that is not even a compressed payload', () => {
    expect(decodeShareFragment('definitely-not-a-payload')).toBeNull();
    expect(decodeShareFragment('')).toBeNull();
    expect(decodeShareFragment(compressToEncodedURIComponent('not json at all'))).toBeNull();
    expect(decodeShareFragment(compressToEncodedURIComponent('[1,2,3]'))).toBeNull();
    expect(decodeShareFragment(compressToEncodedURIComponent('null'))).toBeNull();
  });

  it('never pollutes Object.prototype', () => {
    // `JSON.parse` puts `__proto__` on the object as an ordinary own key rather
    // than on the prototype. This asserts that rather than assuming it.
    decodeShareFragment(
      compressToEncodedURIComponent('{"v":2,"results":[],"summary":{},"__proto__":{"pwned":1}}'),
    );
    expect(({} as Record<string, unknown>).pwned).toBeUndefined();
  });
});
