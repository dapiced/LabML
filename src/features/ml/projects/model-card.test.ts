import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildModelCard,
  cleanField,
  escapeMarkdown,
  MAX_FIELD_LENGTH,
  modelCardHtml,
  modelCardMarkdown,
  type CardSection,
  type ModelCard,
} from '@/features/ml/projects/model-card';
import type { RunRecord } from '@/features/ml/projects/types';
import type { ConformalAnalysis } from '@/features/ml/train/conformal-analysis';
import type { GroupAudit } from '@/features/ml/train/group-audit';
import i18n from '@/lib/i18n';

// V58: a model card must not invent what the run does not say, and must not
// stay silent about what the run never checked. The runs below are the three
// real ones captured for the share-link tests.

const load = (name: string) =>
  JSON.parse(readFileSync(`tests/share-links/${name}.json`, 'utf8')) as RunRecord;
const en = i18n.getFixedT('en');
const fr = i18n.getFixedT('fr');
const card = (record: RunRecord, t = en, lang = 'en') => buildModelCard(record, t, lang, '1.58.0');
const section = (built: ModelCard, id: string): CardSection =>
  built.sections.find((entry) => entry.id === id)!;
const text = (built: ModelCard, id: string) =>
  section(built, id)
    .lines.map((line) => `${line.label ?? ''} ${line.text}`)
    .join('\n');

const titanic = load('titanic');
const iris = load('iris');
const mpg = load('mpg');

describe('what the card says about a run', () => {
  it('always carries the same sections, in the same order', () => {
    const ids = card(titanic).sections.map((entry) => entry.id);
    expect(ids).toEqual([
      'identity',
      'intended',
      'data',
      'performance',
      'decision',
      'failures',
      'journal',
      'notAssessed',
      'limits',
      'reproduce',
    ]);
    // The fixed spine is there whatever the run carries.
    for (const record of [iris, mpg]) {
      const spine = card(record).sections.map((entry) => entry.id);
      for (const id of [
        'identity',
        'intended',
        'data',
        'performance',
        'journal',
        'notAssessed',
        'limits',
        'reproduce',
      ]) {
        expect(spine).toContain(id);
      }
    }
  });

  it('names the model the leaderboard crowns, its task and its seed', () => {
    const identity = text(card(titanic), 'identity');
    expect(identity).toContain('k-nearest neighbors');
    expect(identity).toContain('Binary classification');
    expect(identity).toContain('survived');
    expect(identity).toContain('Seed: 42');
    expect(identity).toContain('LabML 1.58.0');
  });

  it('describes the data by its shape and its splits, never by its rows', () => {
    const data = text(card(titanic), 'data');
    expect(data).toContain('titanic.csv, 891 rows × 15 columns');
    expect(data).toContain('570 rows to fit, 143 to choose the model, 178 to measure it');
    expect(data).toContain('keeping the class proportions');
    expect(data).toContain('62 % of the training rows');
    expect(data).toContain('No row of the data is in it');
  });

  it('gives the test metric with its interval, the baseline and the selection gap', () => {
    const performance = text(card(titanic), 'performance');
    expect(performance).toContain('Accuracy 0.792, 95 % interval 0.736 to 0.848, on 178 rows');
    expect(performance).toContain("the baseline's Accuracy is 0.618, a gap of 0.174");
    // The lesson V35 teaches: chosen at one figure, worth another.
    expect(performance).toContain('picked at Accuracy 0.818 on validation, scores 0.792 on test');
    const table = section(card(titanic), 'performance').table!;
    expect(table.head).toEqual(['Accuracy', 'F1', 'precision', 'recall', 'ROC-AUC', 'Log-loss']);
    expect(table.rows[0][0]).toBe('0.792');
  });

  it('reads a regression run with its own metrics', () => {
    const built = card(mpg);
    expect(text(built, 'identity')).toContain('Regression');
    expect(text(built, 'performance')).toContain('RMSE');
    expect(section(built, 'performance').table!.head).toEqual(['RMSE', 'MAE', 'R²']);
    // No class balance to state, and no decision threshold to miss.
    expect(text(built, 'data')).not.toContain('largest class');
    expect(text(built, 'notAssessed')).not.toContain('decision threshold');
  });

  it('repeats a leak warning where the data is described and where the limits are', () => {
    const built = card(iris);
    expect(text(built, 'data')).toMatch(/alone predicts the target at .* % on validation/);
    expect(text(built, 'limits')).toContain('predicts the target almost alone');
  });

  it('shows the weakest slices, worst column first', () => {
    const failures = text(card(titanic), 'failures');
    expect(failures).toContain('Weakest on deck = C: 0.625 over 16 rows');
    expect(failures).toContain('Weakest on class = First: 0.733 over 45 rows');
  });
});

describe('rule 1 — nothing is invented', () => {
  it('says « not stated » when nothing was typed, and flags the card', () => {
    const built = card(titanic);
    expect(built.complete).toBe(false);
    const intended = section(built, 'intended').lines;
    expect(intended.map((line) => line.text)).toEqual([
      'Not stated.',
      'Not stated.',
      'Not stated.',
    ]);
    expect(text(built, 'limits')).toContain('No intended use is stated');
    expect(modelCardMarkdown(built)).toContain('This card is incomplete');
    expect(modelCardHtml(built, 'en')).toContain('class="warn"');
  });

  it('carries the words that were typed, and stops calling the card incomplete', () => {
    const built = card({
      ...titanic,
      card: { intendedUse: 'Teaching example for a statistics course.', owner: 'D. D.' },
    });
    expect(built.complete).toBe(true);
    expect(text(built, 'intended')).toContain('Teaching example for a statistics course.');
    expect(text(built, 'intended')).toContain('Out of scope: Not stated.');
    expect(text(built, 'limits')).not.toContain('No intended use is stated');
    expect(modelCardHtml(built, 'en')).not.toContain('class="warn"');
  });

  it('treats a field of blanks as not stated', () => {
    expect(card({ ...titanic, card: { intendedUse: '   \n  ' } }).complete).toBe(false);
  });

  it('says which model an analysis is about when it is not the one of the card', () => {
    const other = card({
      ...titanic,
      artifacts: {
        ...titanic.artifacts,
        segments: { ...titanic.artifacts!.segments!, model: 'gbdt' },
      },
    });
    expect(text(other, 'failures')).toContain(
      'About Gradient boosting, the model that was inspected, not k-nearest neighbors',
    );
    expect(text(card(titanic), 'failures')).toContain('the model of this card');
  });

  it('says the model was picked on test when the run had no validation split', () => {
    const noValidation: RunRecord = {
      ...titanic,
      results: titanic.results.map((result) => ({
        ...result,
        valMetrics: undefined,
        valPrimary: undefined,
      })),
      summary: { ...titanic.summary, validationRows: undefined },
    };
    const built = card(noValidation);
    expect(text(built, 'performance')).toContain('picked on the test split it is measured on');
    expect(text(built, 'data')).toContain('no validation split');
    expect(text(built, 'limits')).toContain('no validation split');
  });
});

describe('rule 2 — what was not assessed is listed', () => {
  it('names every analysis the run does not carry', () => {
    const missing = text(card(titanic), 'notAssessed');
    expect(missing).toContain('repeated folds: not run');
    expect(missing).toContain('prediction sets): not run');
    expect(missing).toContain('learning curve): not run');
    expect(missing).toContain('Hyperparameter search: not run');
    // Present in this run, so not listed as missing.
    expect(missing).not.toContain('Intervals on the metrics');
    expect(missing).not.toContain('by segment');
    expect(missing).not.toContain('decision threshold');
  });

  it('never lets a group audit that was not run pass as checked', () => {
    for (const record of [titanic, iris, mpg]) {
      expect(text(card(record), 'notAssessed')).toContain('no group audit was run on this model');
    }
  });

  it('carries the group audit once one was run, and stops listing it as missing (V59)', () => {
    const groupAudit: GroupAudit = {
      model: 'knn',
      column: 'sex',
      inFeatures: true,
      kind: 'binary',
      positiveClass: '1',
      testRows: 178,
      minRows: 20,
      minCases: 10,
      rates: ['selection', 'recall', 'falseAlarm', 'accuracy'],
      reference: 'male',
      groups: [
        {
          value: 'male',
          rows: 107,
          rates: {
            selection: { value: 0.07, lo: 0.03, hi: 0.13, cases: 107 },
            recall: { value: 0.17, lo: 0.06, hi: 0.39, cases: 18 },
            falseAlarm: { value: 0.04, lo: 0.02, hi: 0.11, cases: 89 },
            accuracy: { value: 0.82, lo: 0.74, hi: 0.88, cases: 107 },
          },
        },
        {
          value: 'female',
          rows: 71,
          rates: {
            selection: { value: 0.8, lo: 0.7, hi: 0.88, cases: 71 },
            recall: { value: 0.9, lo: 0.79, hi: 0.96, cases: 50 },
            falseAlarm: null,
            accuracy: { value: 0.75, lo: 0.64, hi: 0.83, cases: 71 },
          },
        },
      ],
      gaps: [
        { rate: 'selection', group: 'female', delta: 0.73, lo: 0.61, hi: 0.82, real: true },
        { rate: 'accuracy', group: 'female', delta: -0.07, lo: -0.2, hi: 0.05, real: false },
      ],
      small: [],
      beyondCap: 0,
      missingRows: 0,
    };
    const built = card({ ...titanic, artifacts: { ...titanic.artifacts, groupAudit } });
    expect(built.sections.map((entry) => entry.id)).toContain('groups');
    const groups = text(built, 'groups');
    expect(groups).toContain('the model of this card');
    expect(groups).toContain('Audited on « sex », a column the model uses');
    expect(groups).toContain('female (71 test rows)');
    expect(groups).toContain('false alarms: fewer than 10 cases, not computed');
    expect(groups).toContain('« female » is +73 points against « male »');
    expect(groups).toContain('1 other gap(s) are inside the noise');
    expect(text(built, 'notAssessed')).not.toContain('group audit');
    // And a card with no audit has no such section.
    expect(card(titanic).sections.map((entry) => entry.id)).not.toContain('groups');
  });

  it('moves an analysis out of the list once the run carries it', () => {
    const conformal: ConformalAnalysis = {
      model: 'knn',
      alpha: 0.1,
      isClassification: true,
      testRows: 178,
      calibrationRows: 89,
      qHat: 0.8,
      coverage: 0.961,
      coverageLo: 0.921,
      coverageHi: 0.981,
      meanSize: 1.5,
      sizeShares: [0, 0.5, 0.5],
    };
    const built = card({ ...titanic, artifacts: { ...titanic.artifacts, conformal } });
    expect(text(built, 'notAssessed')).not.toContain('prediction sets');
    expect(text(built, 'uncertainty')).toContain('96.1 % covered');
    expect(text(built, 'uncertainty')).toContain('the model of this card');
  });

  it('lists everything on a run with no analysis at all', () => {
    const bare = card({ ...titanic, artifacts: undefined });
    expect(section(bare, 'notAssessed').lines).toHaveLength(8);
    expect(text(bare, 'performance')).toContain('no interval was computed');
    expect(bare.sections.map((entry) => entry.id)).not.toContain('failures');
  });

  it('carries the run journal, or says that nothing fell back', () => {
    expect(text(card(titanic), 'journal')).toContain('nothing fell back');
    const noted = card({
      ...titanic,
      summary: { ...titanic.summary, notes: [{ code: 'ensemble-failed', detail: 'boom' }] },
    });
    expect(text(noted, 'journal')).toContain('The ensemble could not be built');
    expect(text(noted, 'journal')).toContain('(boom)');
  });
});

describe('a stranger wrote part of this card', () => {
  const hostile: RunRecord = {
    ...titanic,
    name: 'run <script>alert(1)</script>',
    target: 'sur|vived',
    card: {
      intendedUse: '<img src=x onerror=alert(1)>\n\n# Heading\n[click](javascript:alert(1)) | cell',
      outOfScope: 'x'.repeat(5000),
    },
  };

  it('escapes every character in the HTML', () => {
    const html = modelCardHtml(card(hostile), 'en');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps typed Markdown as text: no heading, no link, no table cell', () => {
    const markdown = modelCardMarkdown(card(hostile));
    const intended = markdown.split('\n').find((row) => row.includes('Intended use:**'))!;
    // One line, whatever was typed.
    expect(intended).toContain('\\# Heading');
    expect(intended).toContain('\\[click\\](javascript:alert(1))');
    expect(intended).toContain('\\| cell');
    expect(intended).toContain('\\<img src=x onerror=alert(1)\\>');
    expect(markdown).toContain('sur\\|vived');
    expect(markdown.split('\n').filter((row) => row.startsWith('# '))).toHaveLength(1);
  });

  it('bounds what a field can hold', () => {
    expect(cleanField('x'.repeat(5000))).toHaveLength(MAX_FIELD_LENGTH);
    expect(cleanField('  a \n\n b  ')).toBe('a b');
    expect(cleanField(undefined)).toBe('');
    expect(cleanField({ not: 'a string' })).toBe('');
    expect(text(card(hostile), 'intended').length).toBeLessThan(2 * MAX_FIELD_LENGTH + 400);
  });

  it('reads a card field of the wrong type as not stated', () => {
    const damaged = { ...titanic, card: { intendedUse: 42 } } as unknown as RunRecord;
    expect(card(damaged).complete).toBe(false);
    expect(card({ ...titanic, card: 'nope' } as unknown as RunRecord).complete).toBe(false);
  });

  it('escapes Markdown syntax and nothing else', () => {
    expect(escapeMarkdown('a_b *c* `d` [e] #f |g <h> ~i \\j')).toBe(
      'a\\_b \\*c\\* \\`d\\` \\[e\\] \\#f \\|g \\<h\\> \\~i \\\\j',
    );
    expect(escapeMarkdown('0.792 (95 %) - fine.')).toBe('0.792 (95 %) - fine.');
  });
});

describe('two renderings, one set of facts', () => {
  it('states every line of the card in both', () => {
    const built = card({ ...titanic, card: { intendedUse: 'Teaching example.' } });
    const markdown = modelCardMarkdown(built);
    const html = modelCardHtml(built, 'en');
    for (const entry of built.sections) {
      expect(markdown).toContain(`## ${escapeMarkdown(entry.title)}`);
      expect(html).toContain(`<h2>${entry.title}</h2>`);
      for (const line of entry.lines) {
        expect(markdown).toContain(escapeMarkdown(line.text));
        expect(html).toContain(line.text.replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
      }
    }
  });

  it('is the same card twice', () => {
    expect(modelCardMarkdown(card(titanic))).toBe(modelCardMarkdown(card(titanic)));
    expect(modelCardHtml(card(mpg), 'en')).toBe(modelCardHtml(card(mpg), 'en'));
  });

  it('is self-contained: no script, no request', () => {
    const html = modelCardHtml(card(titanic), 'en');
    expect(html).not.toMatch(/<script|<link|<img|src=|@import|url\(/);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('is written in French when asked, numbers included', () => {
    const built = card(titanic, fr, 'fr');
    expect(built.title).toBe('Fiche de modèle : titanic · survived');
    expect(text(built, 'performance')).toContain('0,792');
    expect(text(built, 'intended')).toContain('Non renseigné.');
    expect(section(built, 'notAssessed').title).toBe('Non évalué');
  });

  it('leaves no untranslated key in either language', () => {
    for (const [t, lang] of [
      [en, 'en'],
      [fr, 'fr'],
    ] as const) {
      for (const record of [titanic, iris, mpg]) {
        expect(modelCardMarkdown(card(record, t, lang))).not.toMatch(/ml\\?\.lab\\?\./);
      }
    }
  });
});
