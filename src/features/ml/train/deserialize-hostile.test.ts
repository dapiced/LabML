import { describe, expect, it } from 'vitest';
import { deserializeModel } from '@/features/ml/train/deserialize';

/** A manifest that clears the four outer checks, so the body is what is tested. */
const manifest = (overrides: Record<string, unknown>) =>
  JSON.stringify({
    app: 'LabML',
    formatVersion: 3,
    model: 'logistic',
    target: 'y',
    task: 'classification',
    parameters: { kind: 'logistic' },
    pipeline: { specs: [] },
    ...overrides,
  });

/**
 * V35 wave 4. Every refusal in this module is named — `invalid-json`,
 * `not-labml`, `unsupported-version`, `bad-manifest`, `unsupported-kind` —
 * because the import panel maps those names to a sentence a person can act on.
 *
 * Measured before the fix: a `null` inside `pipeline.specs` threw
 * « Cannot read properties of null (reading 'kind') » and a tree whose root
 * had no children threw « Cannot read properties of undefined (reading
 * 'name') ». Neither is a name, so the panel fell back to « the file could not
 * be processed » — true, and useless.
 */
describe('deserializeModel — a broken manifest says which kind of broken', () => {
  it.each([
    ['not JSON at all', 'nope', 'invalid-json'],
    // An array is an object in JS, so it clears the JSON check and is
    // refused one step later, by name, for what it actually is.
    ['a JSON array', '[1,2,3]', 'not-labml'],
    ['JSON that is null', 'null', 'invalid-json'],
    ['an export from somewhere else', JSON.stringify({ app: 'Other' }), 'not-labml'],
  ])('refuses %s with %s', (_label, text, code) => {
    expect(() => deserializeModel(text)).toThrow(code);
  });

  it('names the version it cannot read', () => {
    expect(() => deserializeModel(JSON.stringify({ app: 'LabML', formatVersion: 1 }))).toThrow(
      'unsupported-version:1',
    );
  });

  it.each([
    ['a null spec in the pipeline', { pipeline: { specs: [null] } }],
    ['a spec that is a string', { pipeline: { specs: ['numeric'] } }],
    [
      'a tree whose root has no children',
      { model: 'tree', parameters: { kind: 'tree', root: { feature: 0, threshold: 1 } } },
    ],
    ['parameters that are empty', { parameters: { kind: 'tree' } }],
  ])('refuses %s as bad-manifest rather than crashing', (_label, overrides) => {
    expect(() => deserializeModel(manifest(overrides))).toThrow('bad-manifest');
  });

  it('still names an unknown model family, which is a different problem', () => {
    // The catch must not swallow the more precise refusal underneath it.
    expect(() =>
      deserializeModel(manifest({ parameters: { kind: 'definitely-not-a-model' } })),
    ).toThrow('unsupported-kind:definitely-not-a-model');
  });

  it('never lets a raw TypeError message reach the caller', () => {
    for (const overrides of [
      { pipeline: { specs: [null] } },
      { model: 'tree', parameters: { kind: 'tree', root: {} } },
    ]) {
      try {
        deserializeModel(manifest(overrides));
        expect.unreachable('the manifest should have been refused');
      } catch (error) {
        expect((error as Error).message).not.toContain('Cannot read properties');
      }
    }
  });
});
