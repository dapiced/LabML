import { describe, it, expect } from 'vitest';
import { buildExamples, pickExampleColumns } from '@/features/ai/llm/examples';
import { validateIntent } from '@/features/ai/llm/prompt';
import { buildGrammar, isComplete } from '@/features/ai/llm/grammar';
import { BENCH_COLUMNS } from '@/features/ai/llm/corpus';
import type { ColumnInfo } from '@/features/ai/chat/parser';

const SALES: ColumnInfo[] = [
  { name: 'montant', isNumeric: true, values: [], distinct: 40 },
  { name: 'quantite', isNumeric: true, values: [], distinct: 9 },
  { name: 'boutique', isNumeric: false, values: ['Nord', 'Sud'] },
  { name: 'paiement', isNumeric: false, values: ['carte', 'especes'] },
  { name: 'commentaire', isNumeric: false, values: [] },
];

/** The JSON on the right-hand side of each `Q: … -> …` line. */
function payloads(columns: ColumnInfo[]): unknown[] {
  return buildExamples(columns).map((line) => JSON.parse(line.slice(line.indexOf('-> ') + 3)));
}

describe('exemples tirés des colonnes du fichier', () => {
  it('choisit deux nombres et deux catégories utilisables', () => {
    const picked = pickExampleColumns(SALES);
    expect(picked.numeric?.name).toBe('montant');
    expect(picked.otherNumeric?.name).toBe('quantite');
    expect(picked.categorical?.name).toBe('boutique');
    expect(picked.otherCategorical?.name).toBe('paiement');
  });

  it('ignore une colonne de texte sans valeurs connues', () => {
    // `commentaire` has no listed values, so it can neither be filtered on in
    // an example nor be the group of a top-k.
    expect(pickExampleColumns(SALES).categorical?.name).not.toBe('commentaire');
  });

  it("n'écrit que des colonnes qui existent, dans chaque exemple", () => {
    const known = new Set(SALES.map((c) => c.name));
    for (const line of buildExamples(SALES)) {
      for (const [, name] of line.matchAll(/"(?:column|groupBy|a|b)":"([^"]+)"/g)) {
        expect(known.has(name), line).toBe(true);
      }
    }
    // The Titanic names V27 hard-coded must not survive anywhere.
    const text = buildExamples(SALES).join('\n');
    for (const ghost of ['fare', 'embark_town', 'pclass', 'sex']) {
      expect(text).not.toContain(`"${ghost}"`);
    }
  });

  it('préfère une grandeur à un drapeau 0/1', () => {
    // Measured on the corpus: taking the first numeric column gave `survived`
    // on Titanic, and « average survived » in an example is a column the model
    // then reached for on questions that never mention it.
    const titanicish: ColumnInfo[] = [
      { name: 'survived', isNumeric: true, values: [], distinct: 2 },
      { name: 'age', isNumeric: true, values: [], distinct: 13 },
      { name: 'sex', isNumeric: false, values: ['male', 'female'], distinct: 2 },
    ];
    expect(pickExampleColumns(titanicish).numeric?.name).toBe('age');
    // With nothing but flags, the examples still get built rather than vanish.
    const flagsOnly: ColumnInfo[] = [{ name: 'ok', isNumeric: true, values: [], distinct: 2 }];
    expect(pickExampleColumns(flagsOnly).numeric?.name).toBe('ok');
    // A column counted by nobody keeps the benefit of the doubt.
    const uncounted: ColumnInfo[] = [{ name: 'x', isNumeric: true, values: [] }];
    expect(pickExampleColumns(uncounted).numeric?.name).toBe('x');
  });

  it('produit des requêtes que le validateur et la grammaire acceptent', () => {
    // An example outside the grammar would teach the model to write something
    // the constrained decoder then forbids — the worst of both.
    const grammar = buildGrammar(SALES);
    for (const intent of payloads(SALES)) {
      const kind = (intent as { kind: string }).kind;
      expect(isComplete(grammar, JSON.stringify(intent)), JSON.stringify(intent)).toBe(true);
      if (kind === 'none') continue;
      expect(validateIntent(intent, SALES), JSON.stringify(intent)).not.toBeNull();
    }
  });

  it('montre le refus une fois, et pas en dernier', () => {
    // Measured: two refusal examples at the END of the list took the model
    // from two refusals out of 55 to eleven. A small model imitates the last
    // examples hardest, and refusing is not the habit to teach it.
    const kinds = payloads(SALES).map((intent) => (intent as { kind: string }).kind);
    expect(kinds.filter((kind) => kind === 'none').length).toBe(1);
    expect(kinds[kinds.length - 1]).not.toBe('none');
  });

  it("montre l'agrégat avec filtre — la forme dont l'absence a coûté onze réponses", () => {
    const withFilter = payloads(SALES).filter(
      (intent) =>
        (intent as { kind: string }).kind === 'aggregate' &&
        (intent as { filter?: unknown }).filter !== undefined,
    );
    expect(withFilter.length).toBeGreaterThanOrEqual(1);
  });

  it('reste utilisable sur une table sans aucune colonne numérique', () => {
    const textOnly: ColumnInfo[] = [{ name: 'ville', isNumeric: false, values: ['Paris', 'Lyon'] }];
    const lines = buildExamples(textOnly);
    expect(lines.length).toBeGreaterThan(3);
    const grammar = buildGrammar(textOnly);
    for (const intent of payloads(textOnly)) {
      expect(isComplete(grammar, JSON.stringify(intent)), JSON.stringify(intent)).toBe(true);
    }
    // No numeric column means no example that would need one.
    expect(lines.join('\n')).not.toContain('"correlation"');
  });

  it('reste utilisable sur une table vide de tout', () => {
    expect(buildExamples([]).length).toBeGreaterThan(0);
  });

  it('couvre toutes les formes sur une table riche', () => {
    const kinds = new Set(
      payloads(BENCH_COLUMNS).map((intent) => (intent as { kind: string }).kind),
    );
    for (const kind of [
      'count',
      'shape',
      'aggregate',
      'topk',
      'distribution',
      'correlation',
      'none',
    ]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });
});
