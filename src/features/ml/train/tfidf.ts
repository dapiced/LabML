/**
 * Hand-written TF-IDF for free-text columns — the V24 way into the pipeline.
 *
 * Everything here is a pure function over strings: the vocabulary is fitted on
 * the TRAINING split only (same no-leakage contract as every other spec), and
 * the result is fully deterministic — no seed needed, because every tie is
 * broken by an explicit rule rather than by engine sort order.
 *
 * The lab is bilingual, and a real CSV mixes languages inside one column, so
 * tokenization folds accents and both stop-word lists apply at once.
 */

/** Terms kept per text column, by document frequency. Cap, not a target. */
export const MAX_TERMS = 256;
/**
 * A term appearing in a single training document cannot generalize — it is a
 * name, a typo, or a one-off. Keeping it would only add a column of zeros for
 * every other row.
 */
export const MIN_DOC_FREQUENCY = 2;
/** One- and two-letter tokens carry no signal once stop words are gone. */
const MIN_TERM_LENGTH = 3;

/**
 * Stop words for both UI languages, merged: a French column in an English
 * session must lose "les" just as an English one loses "the". Accents are
 * folded before the lookup, so entries are written unaccented.
 */
const STOP_WORDS = new Set([
  // English
  'the',
  'and',
  'for',
  'was',
  'were',
  'are',
  'but',
  'not',
  'you',
  'she',
  'her',
  'his',
  'him',
  'its',
  'our',
  'their',
  'they',
  'them',
  'this',
  'that',
  'these',
  'those',
  'with',
  'from',
  'have',
  'has',
  'had',
  'been',
  'being',
  'would',
  'could',
  'should',
  'will',
  'shall',
  'can',
  'may',
  'might',
  'must',
  'there',
  'here',
  'when',
  'where',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'why',
  'all',
  'any',
  'some',
  'each',
  'more',
  'most',
  'other',
  'than',
  'then',
  'too',
  'very',
  'just',
  'only',
  'also',
  'because',
  'about',
  'into',
  'over',
  'under',
  'after',
  'before',
  'again',
  'once',
  'get',
  'got',
  // French (accents folded: "été" → "ete", "très" → "tres")
  'les',
  'des',
  'une',
  'unes',
  'aux',
  'avec',
  'sans',
  'pour',
  'par',
  'sur',
  'sous',
  'dans',
  'chez',
  'mais',
  'donc',
  'car',
  'que',
  'qui',
  'quoi',
  'dont',
  'our',
  'est',
  'sont',
  'ete',
  'etait',
  'etaient',
  'suis',
  'sommes',
  'etes',
  'avoir',
  'avait',
  'avaient',
  'cette',
  'ces',
  'cet',
  'celui',
  'celle',
  'ceux',
  'elle',
  'elles',
  'ils',
  'lui',
  'leur',
  'leurs',
  'nous',
  'vous',
  'mon',
  'ton',
  'son',
  'mes',
  'tes',
  'ses',
  'nos',
  'vos',
  'notre',
  'votre',
  'plus',
  'moins',
  'tres',
  'trop',
  'peu',
  'beaucoup',
  'bien',
  'tout',
  'tous',
  'toute',
  'toutes',
  'meme',
  'aussi',
  'encore',
  'deja',
  'apres',
  'avant',
  'pendant',
  'depuis',
  'entre',
  'quand',
  'comme',
  'faire',
  'fait',
  'etre',
  'ils',
  'ont',
  'pas',
  'ne',
  'du',
  'de',
  'la',
  'le',
  'un',
  'et',
  'ou',
  'a',
]);

/**
 * Lowercases and strips diacritics so "Café" and "cafe" are one term — the
 * alternative (two columns for one word) splits an already-capped vocabulary.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Text → terms: split on anything that is not a letter or digit (this also
 * splits French elisions — "l'appareil" gives "l" + "appareil", and "l" is
 * dropped by the length floor), then drop stop words and short tokens.
 */
export function tokenize(raw: string): string[] {
  const terms: string[] = [];
  for (const token of normalizeText(raw).split(/[^a-z0-9]+/)) {
    if (token.length < MIN_TERM_LENGTH) continue;
    if (STOP_WORDS.has(token)) continue;
    terms.push(token);
  }
  return terms;
}

export interface TfidfVocabulary {
  /** Kept terms, in feature order (document frequency desc, then alphabetical). */
  terms: string[];
  /** Smoothed inverse document frequency, parallel to `terms`. */
  idf: number[];
}

/**
 * Fits the vocabulary on training documents only.
 *
 * Term ranking is document frequency descending, ties broken alphabetically —
 * so the same corpus always yields the same feature order, whatever the engine
 * does with equal keys. IDF is the smoothed form ln((1+n)/(1+df)) + 1, which
 * never divides by zero and never returns a negative weight.
 */
export function fitTfidf(
  documents: string[],
  maxTerms = MAX_TERMS,
  minDocFrequency = MIN_DOC_FREQUENCY,
): TfidfVocabulary {
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(tokenize(document))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const ranked = [...documentFrequency.entries()]
    .filter(([, df]) => df >= minDocFrequency)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTerms);

  const total = documents.length;
  return {
    terms: ranked.map(([term]) => term),
    idf: ranked.map(([, df]) => Math.log((1 + total) / (1 + df)) + 1),
  };
}

/**
 * One document → its TF-IDF vector over the fitted vocabulary, L2-normalized
 * so a long review and a short one are compared on their word mix rather than
 * on their length. Out-of-vocabulary terms are ignored (that is what a capped
 * vocabulary means); an empty or missing text yields all zeros — honest, since
 * there is nothing to say about it.
 */
export function transformDocument(raw: string | null, vocabulary: TfidfVocabulary): number[] {
  const vector = new Array<number>(vocabulary.terms.length).fill(0);
  if (raw === null || vocabulary.terms.length === 0) return vector;

  const index = new Map(vocabulary.terms.map((term, position) => [term, position]));
  for (const term of tokenize(raw)) {
    const position = index.get(term);
    if (position !== undefined) vector[position] += 1;
  }

  let squared = 0;
  for (let i = 0; i < vector.length; i++) {
    vector[i] *= vocabulary.idf[i];
    squared += vector[i] * vector[i];
  }
  if (squared === 0) return vector;
  const norm = Math.sqrt(squared);
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}
