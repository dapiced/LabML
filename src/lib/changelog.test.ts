import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractWaves,
  packageVersionFor,
  renderChangelog,
  syncLockVersion,
  syncPackageVersion,
} from '../../scripts/changelog.mjs';

/**
 * V41 — the CHANGELOG is extracted from `PLAN.md`, never written by hand, on
 * the rule V34 set for `/docs/limites`: a record recalled from memory flatters.
 * The plan's roadmap tables are the one place every wave is recorded, so the
 * changelog reads them and a drift in either direction fails here.
 */
const SAMPLE = `
| Wave                | Content                                                                 | Why                            |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| **V7** | **Unsupervised exploration** in the ML Lab: hand-written k-means (seeded). Fills a gap. | Fills the real gap |
| V8     | **Time series**: date + numeric target detection → Holt-Winters forecasting | Opens up an entire class of problems |
| —      | **Generative chat** (optional, outside the cap): requires a server proxy | A product decision to make separately |
| **V11 — delivered** | **Data drift** in the Data Studio: a reference file, thresholds 0.1/0.25, overall verdict | The MLOps gesture par excellence |
| V12 — pending       | **Consented generative chat**: a Cloudflare Pages Function | Owner's product decision: postponed |
| **V27.1 — delivered** | **The model earns its place, it does not take it**: the V27 order was wrong. With the local model selected it read EVERY question. | Measured, not assumed. |
| **V35 — delivered**   | **ML Lab: the number stops flattering itself.** Two method defects in shipped code, fixed. **(1) The winner** was picked on test. | Owner request (22/08/2026). |
| **V25 — delivered**   | **Scale**: the lab now takes 100k–1M-row files without dying. Before: a stack overflow. |
| **V39 — delivered**   | **Recipe.** \`RecipeOptions\` applied one strategy to the whole file. A median makes sense for an age. | Tidy defaults lie. |
`;

describe('extractWaves', () => {
  const waves = extractWaves(SAMPLE);

  it('keeps every wave row that is not pending, newest first', () => {
    expect(waves.map((wave) => wave.version)).toEqual(['39', '35', '27.1', '25', '11', '8', '7']);
  });

  it('accepts a row whose why column is missing, with an empty why', () => {
    const scale = waves.find((wave) => wave.version === '25');
    expect(scale?.title).toBe('Scale');
    expect(scale?.summary).toBe('**Scale**: the lab now takes 100k–1M-row files without dying.');
    expect(scale?.why).toBe('');
  });

  it('skips the header, the separator, the dash row and the pending row', () => {
    const versions = waves.map((wave) => wave.version);
    expect(versions).not.toContain('12');
    expect(waves.some((wave) => wave.title.includes('Generative chat'))).toBe(false);
  });

  it('takes the first bold run as the title, without its trailing punctuation', () => {
    expect(waves.find((wave) => wave.version === '11')?.title).toBe('Data drift');
    expect(waves.find((wave) => wave.version === '35')?.title).toBe(
      'ML Lab: the number stops flattering itself',
    );
  });

  it('keeps the first sentence of the content as the summary, markdown intact', () => {
    expect(waves.find((wave) => wave.version === '7')?.summary).toBe(
      '**Unsupervised exploration** in the ML Lab: hand-written k-means (seeded).',
    );
    // No sentence-ending period: the whole cell is the summary.
    expect(waves.find((wave) => wave.version === '8')?.summary).toBe(
      '**Time series**: date + numeric target detection → Holt-Winters forecasting',
    );
  });

  it('skips to the next sentence when the bold title is a whole sentence by itself', () => {
    // Repeating the heading as the summary would say nothing twice.
    expect(waves.find((wave) => wave.version === '35')?.summary).toBe(
      'Two method defects in shipped code, fixed.',
    );
    // The sentence after the title may open with inline code.
    expect(waves.find((wave) => wave.version === '39')?.summary).toBe(
      '`RecipeOptions` applied one strategy to the whole file.',
    );
  });

  it('does not cut a sentence on a decimal or an inline sub-version', () => {
    expect(waves.find((wave) => wave.version === '11')?.summary).toContain('0.1/0.25');
    expect(waves.find((wave) => wave.version === '27.1')?.summary).toBe(
      '**The model earns its place, it does not take it**: the V27 order was wrong.',
    );
  });

  it('carries the why column verbatim', () => {
    expect(waves.find((wave) => wave.version === '8')?.why).toBe(
      'Opens up an entire class of problems',
    );
  });
});

describe('renderChangelog', () => {
  const text = renderChangelog(extractWaves(SAMPLE));

  it('writes one heading per wave, newest first, with summary and rationale', () => {
    const headings = text.split('\n').filter((line) => line.startsWith('## '));
    expect(headings[0]).toBe('## V39 — Recipe');
    expect(headings.at(-1)).toBe('## V7 — Unsupervised exploration');
    expect(text).toContain('\n_Why:_ Opens up an entire class of problems\n');
  });

  it('leaves out the rationale line when the plan gave none', () => {
    const entry = text.slice(text.indexOf('## V25 — Scale'), text.indexOf('## V11 — Data drift'));
    expect(entry).not.toContain('_Why:_');
    expect(entry).toBe(
      '## V25 — Scale\n\n**Scale**: the lab now takes 100k–1M-row files without dying.\n\n',
    );
  });

  it('says where it comes from and that it is not edited by hand', () => {
    expect(text.startsWith('# Changelog\n')).toBe(true);
    expect(text).toMatch(/npm run changelog/);
    expect(text).toMatch(/V1–V6/);
  });
});

describe('packageVersionFor', () => {
  it('maps the latest integer wave to 1.<wave>.0, ignoring sub-versions', () => {
    expect(packageVersionFor(extractWaves(SAMPLE))).toBe('1.39.0');
    expect(packageVersionFor([{ version: '27.3', title: '', summary: '', why: '' }])).toBe(
      '1.27.0',
    );
  });
});

describe('syncPackageVersion', () => {
  it('rewrites only the version field and leaves the rest of the file byte for byte', () => {
    const before =
      '{\n  "name": "labml",\n  "private": true,\n  "version": "1.0.0",\n  "x": 1\n}\n';
    expect(syncPackageVersion(before, '1.35.0')).toBe(
      '{\n  "name": "labml",\n  "private": true,\n  "version": "1.35.0",\n  "x": 1\n}\n',
    );
  });
});

describe('syncLockVersion', () => {
  it('rewrites the two root entries of the lockfile and no dependency', () => {
    const before = [
      '{',
      '  "name": "labml",',
      '  "version": "0.1.0",',
      '  "packages": {',
      '    "": {',
      '      "name": "labml",',
      '      "version": "0.1.0",',
      '      "dependencies": {}',
      '    },',
      '    "node_modules/dexie": {',
      '      "version": "4.4.5"',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n');
    const after = syncLockVersion(before, '1.35.0');
    expect(after.match(/"version": "1\.35\.0"/g)).toHaveLength(2);
    expect(after).toContain('"version": "4.4.5"');
  });
});

describe('the committed CHANGELOG', () => {
  const plan = readFileSync('PLAN.md', 'utf8');
  const waves = extractWaves(plan);

  it('exists', () => {
    expect(existsSync('CHANGELOG.md'), 'run `npm run changelog`').toBe(true);
  });

  it('is exactly what PLAN.md produces — a drift in either direction fails here', () => {
    expect(readFileSync('CHANGELOG.md', 'utf8')).toBe(renderChangelog(waves));
  });

  it('reaches the last delivered wave and names every wave', () => {
    expect(Number(waves[0].version)).toBeGreaterThanOrEqual(40);
    for (const wave of waves) {
      expect(wave.title, `V${wave.version} has no title`).not.toBe('');
      expect(wave.summary, `V${wave.version} has no summary`).not.toBe('');
    }
  });

  it('is the version package.json declares', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(pkg.version).toBe(packageVersionFor(waves));
  });
});
