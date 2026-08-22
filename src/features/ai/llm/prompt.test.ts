import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  extractJson,
  intentFromCompletion,
  validateIntent,
} from '@/features/ai/llm/prompt';
import type { ColumnInfo } from '@/features/ai/chat/parser';

const COLUMNS: ColumnInfo[] = [
  { name: 'age', isNumeric: true, values: [] },
  { name: 'fare', isNumeric: true, values: [] },
  { name: 'sex', isNumeric: false, values: ['male', 'female'] },
  { name: 'class', isNumeric: false, values: ['First', 'Second', 'Third'] },
];

describe('buildSystemPrompt', () => {
  it('describes every column with its type, and quotes small category sets', () => {
    const prompt = buildSystemPrompt(COLUMNS);
    expect(prompt).toContain('- age (number)');
    expect(prompt).toContain('- sex (text) values: male, female');
    // The grammar itself is spelled out — the model is never asked to guess it.
    expect(prompt).toContain('"kind":"aggregate"');
    expect(prompt).toContain('"kind":"correlation"');
  });

  // V27.1 — the three holes the measured failures came out of: no groupBy
  // example at all (a comparison was read as a count), no rule tying a filter
  // value to the column that actually holds it (embarked = Cherbourg, 0 rows),
  // and no numeric-threshold example.
  it('shows a grouped comparison, a top-k and a numeric threshold', () => {
    const prompt = buildSystemPrompt(COLUMNS);
    expect(prompt).toContain('"groupBy":"sex"');
    expect(prompt).toContain('"kind":"topk"');
    expect(prompt).toContain('"op":"<","value":10');
  });

  it('ties a filter value to the column whose values list contains it', () => {
    const prompt = buildSystemPrompt(COLUMNS);
    expect(prompt).toContain('must be one of the values listed for THAT column');
    expect(prompt).toContain('DIFFERENT table');
  });
});

describe('extractJson', () => {
  it('pulls the first balanced object out of chatty output', () => {
    expect(extractJson('Sure! {"kind":"shape"} hope that helps')).toBe('{"kind":"shape"}');
    expect(extractJson('{"a":{"b":1}} trailing')).toBe('{"a":{"b":1}}');
  });

  it('returns null when there is no object at all', () => {
    expect(extractJson('I do not know')).toBeNull();
    expect(extractJson('{"unbalanced": ')).toBeNull();
  });
});

describe('validateIntent — the grammar is a wall, not a suggestion', () => {
  it('accepts every well-formed shape', () => {
    expect(validateIntent({ kind: 'shape' }, COLUMNS)).toEqual({ kind: 'shape' });
    expect(validateIntent({ kind: 'missing' }, COLUMNS)).toEqual({ kind: 'missing' });
    expect(validateIntent({ kind: 'count' }, COLUMNS)).toEqual({ kind: 'count' });
    expect(validateIntent({ kind: 'distribution', column: 'class' }, COLUMNS)).toEqual({
      kind: 'distribution',
      column: 'class',
    });
    expect(validateIntent({ kind: 'correlation', a: 'age', b: 'fare' }, COLUMNS)).toEqual({
      kind: 'correlation',
      a: 'age',
      b: 'fare',
    });
    expect(
      validateIntent({ kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'class' }, COLUMNS),
    ).toEqual({ kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'class' });
    expect(
      validateIntent({ kind: 'topk', groupBy: 'class', k: 3, op: 'mean', column: 'fare' }, COLUMNS),
    ).toEqual({ kind: 'topk', groupBy: 'class', k: 3, op: 'mean', column: 'fare' });
  });

  it('carries a well-formed filter through, numeric or categorical', () => {
    expect(
      validateIntent({ kind: 'count', filter: { column: 'age', op: '>', value: 60 } }, COLUMNS),
    ).toEqual({ kind: 'count', filter: { column: 'age', op: '>', value: 60 } });
    expect(
      validateIntent(
        {
          kind: 'aggregate',
          op: 'mean',
          column: 'fare',
          filter: { column: 'sex', op: '=', value: 'female' },
        },
        COLUMNS,
      ),
    ).toEqual({
      kind: 'aggregate',
      op: 'mean',
      column: 'fare',
      filter: { column: 'sex', op: '=', value: 'female' },
    });
  });

  it('refuses a column the model invented — never rewires it to a lookalike', () => {
    expect(validateIntent({ kind: 'distribution', column: 'ages' }, COLUMNS)).toBeNull();
    expect(validateIntent({ kind: 'correlation', a: 'age', b: 'price' }, COLUMNS)).toBeNull();
    expect(
      validateIntent({ kind: 'count', filter: { column: 'gender', op: '=', value: 'f' } }, COLUMNS),
    ).toBeNull();
  });

  it('tolerates case only — the one rewrite that cannot change meaning', () => {
    expect(validateIntent({ kind: 'distribution', column: ' Class ' }, COLUMNS)).toEqual({
      kind: 'distribution',
      column: 'class',
    });
  });

  it('refuses operators outside the closed lists', () => {
    expect(
      validateIntent({ kind: 'aggregate', op: 'variance', column: 'age' }, COLUMNS),
    ).toBeNull();
    expect(
      validateIntent({ kind: 'count', filter: { column: 'age', op: '~', value: 1 } }, COLUMNS),
    ).toBeNull();
  });

  it('refuses malformed or nonsensical intents', () => {
    expect(validateIntent({ kind: 'sql', query: 'SELECT 1' }, COLUMNS)).toBeNull();
    expect(validateIntent(null, COLUMNS)).toBeNull();
    expect(validateIntent('shape', COLUMNS)).toBeNull();
    // A correlation of a column with itself answers nothing.
    expect(validateIntent({ kind: 'correlation', a: 'age', b: 'age' }, COLUMNS)).toBeNull();
    // topk with a real aggregation but no column to aggregate.
    expect(
      validateIntent({ kind: 'topk', groupBy: 'class', k: 3, op: 'mean' }, COLUMNS),
    ).toBeNull();
    // An absurd k is a refusal, not a clamp.
    expect(
      validateIntent({ kind: 'topk', groupBy: 'class', k: 5000, op: 'count' }, COLUMNS),
    ).toBeNull();
  });
});

describe('intentFromCompletion', () => {
  it('survives the wrapping a chat model adds around its JSON', () => {
    expect(intentFromCompletion('```json\n{"kind":"shape"}\n```', COLUMNS)).toEqual({
      kind: 'shape',
    });
  });

  it('returns null on unparseable output instead of guessing', () => {
    expect(intentFromCompletion('{"kind": shape}', COLUMNS)).toBeNull();
    expect(intentFromCompletion('I am not sure what you mean.', COLUMNS)).toBeNull();
  });
});
