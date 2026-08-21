import { describe, expect, it } from 'vitest';
import { fitTfidf, MAX_TERMS, normalizeText, tokenize, transformDocument } from './tfidf';

describe('normalizeText', () => {
  it('folds case and diacritics so "Café" and "cafe" are one term', () => {
    expect(normalizeText('Café')).toBe('cafe');
    expect(normalizeText('LIVRÉ très tôt')).toBe('livre tres tot');
  });
});

describe('tokenize', () => {
  it('splits on punctuation and drops stop words in both languages', () => {
    expect(tokenize('The delivery was very fast!')).toEqual(['delivery', 'fast']);
    expect(tokenize('La livraison a été très rapide.')).toEqual(['livraison', 'rapide']);
  });

  it('splits French elisions and drops the orphan letter', () => {
    // "l'appareil" → ["l", "appareil"]; "l" is below the length floor.
    expect(tokenize("l'appareil est cassé")).toEqual(['appareil', 'casse']);
  });

  it('keeps digits-bearing tokens but drops tokens under three characters', () => {
    expect(tokenize('sav 4g ok wifi6')).toEqual(['sav', 'wifi6']);
  });

  it('returns nothing for an empty or punctuation-only text', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!! ... ???')).toEqual([]);
  });
});

describe('fitTfidf', () => {
  const corpus = [
    'delivery fast delivery fast',
    'delivery slow',
    'broken product',
    'broken product',
  ];

  it('ranks terms by document frequency, ties broken alphabetically', () => {
    const { terms } = fitTfidf(corpus);
    // delivery: 2 docs, broken: 2, product: 2, fast: 1 (dropped), slow: 1 (dropped).
    expect(terms).toEqual(['broken', 'delivery', 'product']);
  });

  it('drops terms seen in a single training document', () => {
    const { terms } = fitTfidf(corpus);
    expect(terms).not.toContain('fast');
    expect(terms).not.toContain('slow');
  });

  it('computes the smoothed idf ln((1+n)/(1+df)) + 1', () => {
    const { terms, idf } = fitTfidf(corpus);
    const position = terms.indexOf('delivery');
    expect(idf[position]).toBeCloseTo(Math.log((1 + 4) / (1 + 2)) + 1, 10);
    // Every weight stays positive with the smoothed form.
    expect(Math.min(...idf)).toBeGreaterThan(0);
  });

  it('caps the vocabulary and keeps the most frequent terms', () => {
    // 5 documents sharing "common", each with its own repeated pair.
    const documents = Array.from(
      { length: 5 },
      (_, i) => `common common word${i} word${i} shared shared`,
    );
    const { terms } = fitTfidf(documents, 2);
    expect(terms).toHaveLength(2);
    expect(terms).toEqual(['common', 'shared']);
  });

  it('is deterministic: the same corpus yields the same feature order', () => {
    expect(fitTfidf(corpus).terms).toEqual(fitTfidf([...corpus]).terms);
  });

  it('defaults to a capped vocabulary', () => {
    expect(MAX_TERMS).toBe(256);
  });
});

describe('transformDocument', () => {
  const vocabulary = fitTfidf(['alpha beta', 'alpha gamma', 'alpha beta gamma']);

  it('produces one L2-normalized weight per vocabulary term', () => {
    const vector = transformDocument('alpha beta', vocabulary);
    expect(vector).toHaveLength(vocabulary.terms.length);
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it('weighs a repeated term higher than a single mention, within one document', () => {
    const [repeated] = [transformDocument('beta beta beta alpha', vocabulary)];
    const betaPosition = vocabulary.terms.indexOf('beta');
    const alphaPosition = vocabulary.terms.indexOf('alpha');
    expect(repeated[betaPosition]).toBeGreaterThan(repeated[alphaPosition]);
  });

  it('ignores out-of-vocabulary words instead of inventing a column', () => {
    const known = transformDocument('alpha beta', vocabulary);
    const withNoise = transformDocument('alpha beta zzzztotallyunseen', vocabulary);
    expect(withNoise).toEqual(known);
  });

  it('returns all zeros for missing, empty, or fully out-of-vocabulary text', () => {
    const zeros = new Array(vocabulary.terms.length).fill(0);
    expect(transformDocument(null, vocabulary)).toEqual(zeros);
    expect(transformDocument('', vocabulary)).toEqual(zeros);
    expect(transformDocument('zzzz yyyy', vocabulary)).toEqual(zeros);
  });

  it('matches a hand-computed vector on a two-term vocabulary', () => {
    // Corpus of 2 documents, both containing "good" and "price".
    const corpus = ['good price', 'good price'];
    const fitted = fitTfidf(corpus);
    expect(fitted.terms).toEqual(['good', 'price']);
    // idf = ln(3/3) + 1 = 1 for both; tf = 1 each → raw [1,1] → L2 → [√2/2, √2/2].
    const vector = transformDocument('good price', fitted);
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('folds accents at transform time too, matching the fitted terms', () => {
    const fitted = fitTfidf(['livraison rapide', 'livraison lente', 'livraison rapide']);
    const accented = transformDocument('LIVRAISON RAPIDE', fitted);
    const plain = transformDocument('livraison rapide', fitted);
    expect(accented).toEqual(plain);
    expect(Math.max(...accented)).toBeGreaterThan(0);
  });
});
