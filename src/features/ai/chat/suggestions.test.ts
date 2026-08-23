/**
 * V30 — the guard on the coverage rule.
 *
 * `parseQuestion` now refuses a question it has not read in full. That is the
 * right trade for a question a user typed, but it would be a bad joke if the
 * app SUGGESTED a question and then refused it: the chips under the input are
 * the app's own words, offered as things it can answer.
 *
 * So every suggestion template, in both languages, filled with real column
 * names from the shipped demo datasets, must parse. This is the test that
 * fails the day the closed word lists in `parser.ts` drift away from the
 * phrasings the product puts in front of people.
 */
import { describe, it, expect } from 'vitest';
import fr from '@/locales/fr.json';
import en from '@/locales/en.json';
import { parseQuestion, type ColumnInfo } from '@/features/ai/chat/parser';

/** Column shapes taken from the demo datasets the chat offers. */
const DATASETS: { name: string; columns: ColumnInfo[] }[] = [
  {
    name: 'titanic.csv',
    columns: [
      { name: 'survived', isNumeric: true, values: [] },
      { name: 'age', isNumeric: true, values: [] },
      { name: 'fare', isNumeric: true, values: [] },
      { name: 'sex', isNumeric: false, values: ['male', 'female'] },
      { name: 'class', isNumeric: false, values: ['Third', 'First', 'Second'] },
    ],
  },
  {
    name: 'iris.csv',
    columns: [
      { name: 'sepal_length', isNumeric: true, values: [] },
      { name: 'petal_width', isNumeric: true, values: [] },
      { name: 'species', isNumeric: false, values: ['setosa', 'virginica'] },
    ],
  },
  {
    name: 'cafe-sales.csv',
    columns: [
      { name: 'quantity', isNumeric: true, values: [] },
      { name: 'unit_price', isNumeric: true, values: [] },
      { name: 'product', isNumeric: false, values: ['Espresso', 'Latte'] },
      { name: 'payment', isNumeric: false, values: ['card', 'cash'] },
    ],
  },
];

/** The same fill-in ChatPage performs, without pulling React into the test. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
}

function suggestionsFor(bundle: typeof fr | typeof en, columns: ColumnInfo[]): string[] {
  const suggest = bundle.ai.chat.suggest;
  const numeric = columns.filter((c) => c.isNumeric && !/(^|_)id$/i.test(c.name));
  const categorical = columns.filter((c) => !c.isNumeric && c.values.length > 0);
  const out: string[] = [];
  if (numeric[0] && categorical[0]) {
    out.push(fill(suggest.mean, { num: numeric[0].name, cat: categorical[0].name }));
    out.push(fill(suggest.count, { cat: categorical[0].name, value: categorical[0].values[0] }));
    out.push(fill(suggest.top, { cat: categorical[0].name, num: numeric[0].name }));
  }
  if (numeric.length >= 2) {
    out.push(fill(suggest.corr, { num: numeric[0].name, num2: numeric[1].name }));
  }
  out.push(suggest.missing);
  return out;
}

describe('le chat sait répondre à ce qu’il propose lui-même', () => {
  for (const { name, columns } of DATASETS) {
    for (const [lang, bundle] of [
      ['fr', fr],
      ['en', en],
    ] as const) {
      it(`${name} · ${lang}`, () => {
        const suggestions = suggestionsFor(bundle, columns);
        expect(suggestions.length).toBeGreaterThanOrEqual(4);
        for (const question of suggestions) {
          expect(parseQuestion(question, columns, lang), `${lang} : ${question}`).not.toBeNull();
        }
      });
    }
  }
});
