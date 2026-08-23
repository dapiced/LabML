/**
 * V30 — the reference corpus: every question the chat is measured on.
 *
 * V27 shipped 18 cases that lived inside the browser bench and could only run
 * on a machine with WebGPU. That made every claim about the chat unfalsifiable
 * in practice: nobody could re-run it, so « 5 of 6 » was a number in a document
 * rather than a measurement anyone could reproduce. This module exists to fix
 * that first, because nothing else in V30 is measurable until it does.
 *
 * Three rules shape it:
 *
 * 1. **No hand-labelled difficulty.** V27's corpus carried a `beyondKeywords`
 *    flag written by hand — a PREDICTION about what the deterministic parser
 *    would fail at. Predictions belong in the plan, not in the measuring
 *    instrument: the split is now computed from the parser's actual behaviour
 *    at report time, so it cannot be wrong.
 * 2. **A question may have more than one right answer.** « combien de
 *    passagers en première classe ? » is correctly read as `class = First` or
 *    as `pclass = 1`. Forcing one would score a correct reading as a failure,
 *    so `alsoOk` names the other acceptable readings explicitly.
 * 3. **Refusing is an answer.** Three cases here are not queries at all. The
 *    only correct behaviour is a refusal, and a run that invents a query for
 *    them is scored wrong — which is exactly how V30's constrained decoding
 *    gets held to account, since constraining the output makes refusal harder,
 *    not easier.
 */
import type { Intent } from '@/features/ai/chat/engine';
import type { ColumnInfo } from '@/features/ai/chat/parser';

/** Titanic's columns, as the chat worker summarizes them for the model. */
export const BENCH_COLUMNS: ColumnInfo[] = [
  // `distinct` is what the chat worker would report for titanic.csv, capped at
  // 13 the way it caps it: it is what lets the prompt's examples pick `age`
  // rather than `survived` as the quantity to average.
  { name: 'survived', isNumeric: true, values: [], distinct: 2 },
  { name: 'pclass', isNumeric: true, values: [], distinct: 3 },
  { name: 'sex', isNumeric: false, values: ['male', 'female'], distinct: 2 },
  { name: 'age', isNumeric: true, values: [], distinct: 13 },
  { name: 'fare', isNumeric: true, values: [], distinct: 13 },
  { name: 'embarked', isNumeric: false, values: ['S', 'C', 'Q'] },
  { name: 'class', isNumeric: false, values: ['Third', 'First', 'Second'] },
  { name: 'who', isNumeric: false, values: ['man', 'woman', 'child'] },
  { name: 'deck', isNumeric: false, values: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
  { name: 'embark_town', isNumeric: false, values: ['Southampton', 'Cherbourg', 'Queenstown'] },
  { name: 'alive', isNumeric: false, values: ['no', 'yes'] },
  { name: 'alone', isNumeric: false, values: ['True', 'False'] },
];

export interface BenchCase {
  q: string;
  lang: 'fr' | 'en';
  /** The intent kind expected, or 'refuse' when no query is the right answer. */
  family: Intent['kind'] | 'refuse';
  /** The canonical correct reading. Null means: the only right answer is none. */
  want: Intent | null;
  /** Other readings that are also correct — a question can be honestly ambiguous. */
  alsoOk?: Intent[];
}

export const BENCH_CASES: BenchCase[] = [
  // --- shape -----------------------------------------------------------
  { q: 'how many rows and columns?', lang: 'en', family: 'shape', want: { kind: 'shape' } },
  {
    q: 'combien de lignes et de colonnes ?',
    lang: 'fr',
    family: 'shape',
    want: { kind: 'shape' },
  },
  { q: 'what is the size of this table?', lang: 'en', family: 'shape', want: { kind: 'shape' } },
  { q: 'quelle est la taille du tableau ?', lang: 'fr', family: 'shape', want: { kind: 'shape' } },

  // --- missing ---------------------------------------------------------
  { q: 'valeurs manquantes', lang: 'fr', family: 'missing', want: { kind: 'missing' } },
  {
    q: 'which columns have missing values?',
    lang: 'en',
    family: 'missing',
    want: { kind: 'missing' },
  },
  {
    q: 'y a-t-il des trous dans les données ?',
    lang: 'fr',
    family: 'missing',
    want: { kind: 'missing' },
  },

  // --- count -----------------------------------------------------------
  {
    q: 'how many female?',
    lang: 'en',
    family: 'count',
    want: { kind: 'count', filter: { column: 'sex', op: '=', value: 'female' } },
  },
  {
    q: 'combien de femmes ?',
    lang: 'fr',
    family: 'count',
    want: { kind: 'count', filter: { column: 'sex', op: '=', value: 'female' } },
    alsoOk: [{ kind: 'count', filter: { column: 'who', op: '=', value: 'woman' } }],
  },
  {
    q: 'count the passengers older than 60',
    lang: 'en',
    family: 'count',
    want: { kind: 'count', filter: { column: 'age', op: '>', value: 60 } },
  },
  {
    q: "combien d'enfants de moins de 10 ans ?",
    lang: 'fr',
    family: 'count',
    want: { kind: 'count', filter: { column: 'age', op: '<', value: 10 } },
  },
  {
    q: 'combien de personnes sont montées à Cherbourg ?',
    lang: 'fr',
    family: 'count',
    want: { kind: 'count', filter: { column: 'embark_town', op: '=', value: 'Cherbourg' } },
    alsoOk: [{ kind: 'count', filter: { column: 'embarked', op: '=', value: 'C' } }],
  },
  {
    q: 'how many passengers boarded at Southampton?',
    lang: 'en',
    family: 'count',
    want: { kind: 'count', filter: { column: 'embark_town', op: '=', value: 'Southampton' } },
    alsoOk: [{ kind: 'count', filter: { column: 'embarked', op: '=', value: 'S' } }],
  },
  { q: 'combien de lignes ?', lang: 'fr', family: 'count', want: { kind: 'count' } },
  {
    q: 'how many people travelled alone?',
    lang: 'en',
    family: 'count',
    want: { kind: 'count', filter: { column: 'alone', op: '=', value: 'True' } },
  },
  {
    q: 'combien de passagers en première classe ?',
    lang: 'fr',
    family: 'count',
    want: { kind: 'count', filter: { column: 'class', op: '=', value: 'First' } },
    alsoOk: [{ kind: 'count', filter: { column: 'pclass', op: '=', value: 1 } }],
  },
  {
    q: 'combien de passagers avaient plus de 30 ans ?',
    lang: 'fr',
    family: 'count',
    want: { kind: 'count', filter: { column: 'age', op: '>', value: 30 } },
  },

  // --- aggregate, one number -------------------------------------------
  {
    q: 'average age',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'age' },
  },
  {
    q: 'âge moyen',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'age' },
  },
  {
    q: 'what was the typical age of the people on board?',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'age' },
    alsoOk: [{ kind: 'aggregate', op: 'median', column: 'age' }],
  },
  {
    q: 'à quel âge moyen voyageaient les passagers ?',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'age' },
  },
  {
    q: 'median fare',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'median', column: 'fare' },
  },
  {
    q: 'prix médian du billet',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'median', column: 'fare' },
  },
  {
    q: 'highest fare paid',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'max', column: 'fare' },
  },
  {
    q: 'le prix le plus bas payé',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'min', column: 'fare' },
  },
  {
    q: 'total of all fares',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'sum', column: 'fare' },
  },
  {
    q: "écart-type de l'âge",
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'std', column: 'age' },
  },

  // --- aggregate, by group ---------------------------------------------
  {
    q: 'moyenne de fare par class',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'class' },
  },
  {
    q: 'average fare by class',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'class' },
    alsoOk: [{ kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'pclass' }],
  },
  {
    q: 'did women pay more than men?',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'sex' },
  },
  {
    q: 'est-ce que les femmes payaient plus cher que les hommes ?',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'sex' },
  },
  {
    q: 'est-ce que le prix du billet dépendait de la classe ?',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'class' },
    alsoOk: [{ kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'pclass' }],
  },
  {
    q: 'les hommes voyageaient-ils plus jeunes que les femmes ?',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'age', groupBy: 'sex' },
  },
  {
    q: 'average age per deck',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'age', groupBy: 'deck' },
  },
  {
    q: 'survival rate by sex',
    lang: 'en',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'survived', groupBy: 'sex' },
  },
  {
    q: 'quel âge avaient les passagers en moyenne, par classe ?',
    lang: 'fr',
    family: 'aggregate',
    want: { kind: 'aggregate', op: 'mean', column: 'age', groupBy: 'class' },
    alsoOk: [{ kind: 'aggregate', op: 'mean', column: 'age', groupBy: 'pclass' }],
  },

  // --- aggregate, filtered ---------------------------------------------
  {
    q: 'average age of women',
    lang: 'en',
    family: 'aggregate',
    want: {
      kind: 'aggregate',
      op: 'mean',
      column: 'age',
      filter: { column: 'sex', op: '=', value: 'female' },
    },
    alsoOk: [
      {
        kind: 'aggregate',
        op: 'mean',
        column: 'age',
        filter: { column: 'who', op: '=', value: 'woman' },
      },
    ],
  },
  {
    q: 'âge moyen des hommes',
    lang: 'fr',
    family: 'aggregate',
    want: {
      kind: 'aggregate',
      op: 'mean',
      column: 'age',
      filter: { column: 'sex', op: '=', value: 'male' },
    },
    alsoOk: [
      {
        kind: 'aggregate',
        op: 'mean',
        column: 'age',
        filter: { column: 'who', op: '=', value: 'man' },
      },
    ],
  },
  {
    q: 'how much did a ticket cost on average in third class?',
    lang: 'en',
    family: 'aggregate',
    want: {
      kind: 'aggregate',
      op: 'mean',
      column: 'fare',
      filter: { column: 'class', op: '=', value: 'Third' },
    },
    alsoOk: [
      {
        kind: 'aggregate',
        op: 'mean',
        column: 'fare',
        filter: { column: 'pclass', op: '=', value: 3 },
      },
    ],
  },
  {
    q: 'prix moyen payé par les survivants',
    lang: 'fr',
    family: 'aggregate',
    want: {
      kind: 'aggregate',
      op: 'mean',
      column: 'fare',
      filter: { column: 'alive', op: '=', value: 'yes' },
    },
    alsoOk: [
      {
        kind: 'aggregate',
        op: 'mean',
        column: 'fare',
        filter: { column: 'survived', op: '=', value: 1 },
      },
    ],
  },

  // --- distribution ----------------------------------------------------
  {
    q: 'distribution of class',
    lang: 'en',
    family: 'distribution',
    want: { kind: 'distribution', column: 'class' },
  },
  {
    q: 'répartition des classes',
    lang: 'fr',
    family: 'distribution',
    want: { kind: 'distribution', column: 'class' },
    alsoOk: [{ kind: 'distribution', column: 'pclass' }],
  },
  {
    q: 'show me how the ticket prices spread out',
    lang: 'en',
    family: 'distribution',
    want: { kind: 'distribution', column: 'fare' },
  },
  {
    q: 'comment se répartissent les âges ?',
    lang: 'fr',
    family: 'distribution',
    want: { kind: 'distribution', column: 'age' },
  },

  // --- correlation -----------------------------------------------------
  {
    q: 'correlation between age and fare',
    lang: 'en',
    family: 'correlation',
    want: { kind: 'correlation', a: 'age', b: 'fare' },
  },
  {
    q: 'y a-t-il un lien entre le prix payé et la survie ?',
    lang: 'fr',
    family: 'correlation',
    want: { kind: 'correlation', a: 'fare', b: 'survived' },
  },
  {
    q: 'is age related to how much people paid?',
    lang: 'en',
    family: 'correlation',
    want: { kind: 'correlation', a: 'age', b: 'fare' },
  },
  {
    q: "corrélation entre l'âge et la classe",
    lang: 'fr',
    family: 'correlation',
    want: { kind: 'correlation', a: 'age', b: 'pclass' },
  },

  // --- top-k -----------------------------------------------------------
  {
    q: 'les 3 ponts avec le plus de passagers',
    lang: 'fr',
    family: 'topk',
    want: { kind: 'topk', groupBy: 'deck', k: 3, op: 'count' },
  },
  {
    q: 'top 3 embarkation towns by number of passengers',
    lang: 'en',
    family: 'topk',
    want: { kind: 'topk', groupBy: 'embark_town', k: 3, op: 'count' },
  },
  {
    q: 'which 5 decks have the highest average fare?',
    lang: 'en',
    family: 'topk',
    want: { kind: 'topk', groupBy: 'deck', k: 5, op: 'mean', column: 'fare' },
  },
  {
    q: "les 2 classes où l'âge moyen est le plus élevé",
    lang: 'fr',
    family: 'topk',
    want: { kind: 'topk', groupBy: 'class', k: 2, op: 'mean', column: 'age' },
    alsoOk: [{ kind: 'topk', groupBy: 'pclass', k: 2, op: 'mean', column: 'age' }],
  },

  // --- questions the grammar cannot express: refusing IS the answer ------
  { q: 'predict who would survive', lang: 'en', family: 'refuse', want: null },
  { q: 'trace-moi un graphique en camembert', lang: 'fr', family: 'refuse', want: null },
  { q: 'quelle est la capitale de la France ?', lang: 'fr', family: 'refuse', want: null },
];

/** Key-order-independent equality — the grammar has no meaningful ordering. */
export function sameIntent(a: Intent | null, b: Intent | null): boolean {
  if (a === null || b === null) return a === b;
  const norm = (i: Intent) => JSON.stringify(i, Object.keys(i).sort());
  return norm(a) === norm(b);
}

export type Outcome = 'ok' | 'wrong' | 'none';

/**
 * Scores one reading against a case. A refusal case is passed by refusing;
 * everything else is passed by matching the canonical reading or one of the
 * readings the case declares equally correct.
 */
export function score(testCase: BenchCase, got: Intent | null): Outcome {
  if (testCase.want === null) return got === null ? 'ok' : 'wrong';
  if (got === null) return 'none';
  if (sameIntent(got, testCase.want)) return 'ok';
  return (testCase.alsoOk ?? []).some((alt) => sameIntent(got, alt)) ? 'ok' : 'wrong';
}
