/**
 * The bilingual (FR/EN) question parser behind /ai/chat. Deliberately NOT a
 * language model: a deterministic keyword grammar over the dataset's real
 * column names and category values. Same question, same intent — always.
 */
import type { AggOp, Filter, FilterOp, Intent } from '@/features/ai/chat/engine';

export interface ColumnInfo {
  name: string;
  isNumeric: boolean;
  /** Known category values for equality filters (non-numeric columns, capped). */
  values: string[];
  /**
   * V30 — how many distinct values the column holds, counted up to a cap and
   * then abandoned. It exists for one reason: `survived` and `fare` are both
   * « numeric », and only one of them is a quantity worth averaging. The
   * prompt's worked examples pick a measure with this, rather than taking
   * whichever numeric column happens to come first — which on Titanic wrote
   * « average survived » and taught the model to reach for that column.
   * Absent when it was not counted; never a reason to refuse anything.
   */
  distinct?: number;
}

/** Lowercase, strip accents, unify separators — the space all matching happens in. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_/]/g, ' ')
    .replace(/[^a-z0-9><=!.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Lexicon {
  ops: [AggOp, string[]][];
  count: string[];
  top: string[];
  by: string[];
  correlation: string[];
  distribution: string[];
  shape: string[];
  missing: string[];
  comparators: [FilterOp, string[]][];
}

const EN: Lexicon = {
  ops: [
    ['mean', ['mean', 'average', 'avg']],
    ['median', ['median']],
    ['sum', ['sum', 'total']],
    ['min', ['minimum', 'min', 'lowest', 'smallest']],
    ['max', ['maximum', 'max', 'highest', 'largest', 'biggest']],
    ['std', ['standard deviation', 'std', 'deviation']],
  ],
  count: ['how many', 'count', 'number of'],
  top: ['top', 'best'],
  by: ['by', 'per'],
  correlation: ['correlation', 'correlated', 'relationship between', 'link between'],
  distribution: ['distribution', 'breakdown', 'histogram'],
  shape: ['shape', 'dimensions', 'how big', 'size of', 'rows and columns', 'columns and rows'],
  missing: ['missing', 'empty cells'],
  comparators: [
    ['>=', ['greater than or equal to', 'at least', '>=']],
    ['<=', ['less than or equal to', 'at most', '<=']],
    ['!=', ['is not', 'not equal to', 'different from', '!=']],
    ['>', ['greater than', 'more than', 'above', 'over', '>']],
    ['<', ['less than', 'under', 'below', '<']],
    ['=', ['equals', 'equal to', 'is', '=']],
  ],
};

const FR: Lexicon = {
  ops: [
    ['mean', ['moyenne']],
    ['median', ['mediane']],
    ['sum', ['somme', 'total']],
    ['min', ['minimum', 'min', 'plus petit', 'plus petite', 'plus bas', 'plus basse']],
    ['max', ['maximum', 'max', 'plus grand', 'plus grande', 'plus eleve', 'plus elevee']],
    ['std', ['ecart type', 'ecart-type', 'deviation']],
  ],
  count: ['combien', 'nombre de'],
  top: ['top', 'meilleurs', 'meilleures'],
  by: ['par', 'selon'],
  correlation: ['correlation', 'correle', 'lien entre', 'relation entre'],
  distribution: ['distribution', 'repartition', 'histogramme', 'ventilation'],
  shape: [
    'taille du jeu',
    'dimensions',
    'quelle taille',
    'taille du tableau',
    'taille de la table',
    'taille du fichier',
    'taille des donnees',
    'lignes et de colonnes',
    'lignes et colonnes',
    'colonnes et de lignes',
    'colonnes et lignes',
  ],
  missing: ['manquante', 'manquantes', 'manquants', 'manquant', 'vides'],
  comparators: [
    ['>=', ['superieur ou egal a', 'superieure ou egale a', 'au moins', '>=']],
    ['<=', ['inferieur ou egal a', 'inferieure ou egale a', 'au plus', '<=']],
    ['!=', ['n est pas', 'different de', 'differente de', '!=']],
    ['>', ['superieur a', 'superieure a', 'plus grand que', 'plus grande que', 'plus de', '>']],
    ['<', ['inferieur a', 'inferieure a', 'plus petit que', 'plus petite que', 'moins de', '<']],
    ['=', ['egal a', 'egale a', 'vaut', 'est', '=']],
  ],
};

interface Mention {
  pos: number;
  len: number;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word occurrence of a folded phrase at/after `from`, or null. */
function findPhrase(text: string, phrase: string, from = 0): Mention | null {
  const pattern = new RegExp(`(?:^|\\s)(${escapeRegex(phrase)})(?=\\s|$|[.,])`, 'g');
  pattern.lastIndex = Math.max(0, from - 1);
  const match = pattern.exec(text);
  if (!match) return null;
  return { pos: match.index + match[0].indexOf(match[1]), len: match[1].length };
}

/** Earliest whole-word occurrence of any phrase; longer wins a position tie. */
function findAny(text: string, phrases: string[]): Mention | null {
  let best: Mention | null = null;
  for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
    const mention = findPhrase(text, phrase);
    if (!mention) continue;
    if (
      best === null ||
      mention.pos < best.pos ||
      (mention.pos === best.pos && mention.len > best.len)
    ) {
      best = mention;
    }
  }
  return best;
}

interface ColumnMention extends Mention {
  column: ColumnInfo;
}

/** Every whole-word column mention, longest-match-first at overlapping spans. */
function columnMentions(text: string, columns: ColumnInfo[]): ColumnMention[] {
  const found: ColumnMention[] = [];
  for (const column of columns) {
    const folded = fold(column.name);
    if (!folded) continue;
    const mention = findPhrase(text, folded);
    if (mention) found.push({ ...mention, column });
  }
  found.sort((a, b) => a.pos - b.pos || b.len - a.len);
  // Drop mentions fully inside a longer mention (e.g. `class` inside `pclass`).
  return found.filter(
    (m, i) =>
      !found.some(
        (other, j) =>
          j !== i &&
          other.pos <= m.pos &&
          other.pos + other.len >= m.pos + m.len &&
          other.len > m.len,
      ),
  );
}

/** First number in the text after `from`, with decimals ("3,5" and "3.5"). */
function numberAfter(text: string, from: number): number | null {
  const slice = text.slice(from);
  const match = /-?\d+(?:[.,]\d+)?/.exec(slice);
  if (!match) return null;
  return Number(match[0].replace(',', '.'));
}

function findValueMention(
  text: string,
  columns: ColumnInfo[],
  exclude: Set<string>,
): { column: string; value: string; pos: number } | null {
  let best: { column: string; value: string; pos: number; len: number } | null = null;
  for (const column of columns) {
    if (exclude.has(column.name)) continue;
    for (const value of column.values) {
      const folded = fold(value);
      if (!folded || folded.length < 2) continue;
      const mention = findPhrase(text, folded);
      if (
        mention &&
        (best === null ||
          mention.pos < best.pos ||
          (mention.pos === best.pos && mention.len > best.len))
      ) {
        best = { column: column.name, value, pos: mention.pos, len: mention.len };
      }
    }
  }
  return best && { column: best.column, value: best.value, pos: best.pos };
}

/** `column <comparator> number`, `column <comparator> category`, or a bare category value. */
function parseFilter(
  text: string,
  mentions: ColumnMention[],
  columns: ColumnInfo[],
  lexicon: Lexicon,
  exclude: Set<string>,
): Filter | undefined {
  for (const [op, phrases] of lexicon.comparators) {
    for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
      // Every occurrence: in "what is the mean where sex is female" only the
      // second "is" has a column on its left.
      for (
        let mention = findPhrase(text, phrase);
        mention !== null;
        mention = findPhrase(text, phrase, mention.pos + mention.len)
      ) {
        // The filtered column is the nearest mention BEFORE the comparator.
        const before = mentions.filter((m) => m.pos + m.len <= mention.pos + 1);
        const columnMention = before[before.length - 1];
        if (!columnMention) continue;
        const after = mention.pos + mention.len;
        if (columnMention.column.isNumeric) {
          const value = numberAfter(text, after);
          if (value !== null) return { column: columnMention.column.name, op, value };
        } else if (op === '=' || op === '!=') {
          const categorical = findValueMention(text.slice(after), columns, new Set());
          if (categorical && categorical.column === columnMention.column.name) {
            return { column: categorical.column, op, value: categorical.value };
          }
        }
      }
    }
  }
  // No comparator: a bare category value ("for female", "a paris") = equality.
  const bare = findValueMention(text, columns, exclude);
  return bare ? { column: bare.column, op: '=', value: bare.value } : undefined;
}

function groupByColumn(
  text: string,
  mentions: ColumnMention[],
  lexicon: Lexicon,
  exclude: Set<string>,
): string | undefined {
  for (const phrase of lexicon.by) {
    const by = findPhrase(text, phrase);
    if (!by) continue;
    const after = mentions.find((m) => m.pos >= by.pos + by.len && !exclude.has(m.column.name));
    if (after) return after.column.name;
  }
  return undefined;
}

/**
 * A question that carries a condition this grammar could not read must be
 * REFUSED, never answered as if the condition were not there. "How many
 * children under 10?" answered with the total row count is a confidently
 * wrong answer — strictly worse than "I did not understand".
 *
 * Two signs of a dropped condition, both requiring that no filter was built:
 * an ORDERING comparator with nothing to attach it to, and a bare number that
 * is not part of any column name the question mentioned. Equality words are
 * deliberately excluded — "what IS the average age" is filler, not a filter.
 */
function droppedCondition(
  text: string,
  mentions: { column: ColumnInfo }[],
  filter: Filter | undefined,
  lexicon: Lexicon,
): boolean {
  if (filter) return false;
  const ordering: FilterOp[] = ['>', '>=', '<', '<='];
  const hasOrdering = lexicon.comparators.some(
    ([op, phrases]) => ordering.includes(op) && findAny(text, phrases) !== null,
  );
  if (hasOrdering) return true;
  let rest = text;
  for (const mention of mentions) rest = rest.split(fold(mention.column.name)).join(' ');
  return /\d/.test(rest);
}

/**
 * V30 — the words the parser did NOT read.
 *
 * The measured defect this exists for: on « combien de femmes ? » the grammar
 * knows `combien` and knows nothing about `femmes`, so it answered the total
 * row count — 891 instead of 314 — badged « déterministe », the badge that is
 * supposed to mean exact. `droppedCondition` did not catch it, because it only
 * looks for an ordering word or a stray digit, and « femmes » is neither.
 *
 * Measured on the V30 corpus: seven of fifty-five questions were answered with
 * a condition silently removed, and four of those seven the local model reads
 * correctly — but never gets asked, because the deterministic parser goes
 * first and never admits defeat.
 *
 * So the parser now checks its own coverage. Every word of the question must
 * be accounted for by something: a phrase from the lexicon, a column the
 * answer uses, a category value the answer filters on, or one of the three
 * closed lists below. A leftover word means the question said something the
 * grammar did not read, and the honest answer is to refuse and let the model
 * (or the user) have a turn.
 *
 * The trade is deliberate and one-directional: an unknown word can now cost a
 * refusal where an answer was possible, and never a wrong answer where a
 * refusal was right. A refusal is announced and falls through to the model; a
 * wrong answer is delivered with full confidence.
 */

/** The table's own furniture — never a condition on the rows. */
const STRUCTURE_WORDS = new Set([
  'ligne',
  'lignes',
  'rangee',
  'rangees',
  'enregistrement',
  'enregistrements',
  'entree',
  'entrees',
  'observation',
  'observations',
  'colonne',
  'colonnes',
  'champ',
  'champs',
  'valeur',
  'valeurs',
  'cellule',
  'cellules',
  'donnee',
  'donnees',
  'jeu',
  'tableau',
  'table',
  'fichier',
  'taille',
  'total',
  'row',
  'rows',
  'record',
  'records',
  'entry',
  'entries',
  'column',
  'columns',
  'field',
  'fields',
  'value',
  'values',
  'cell',
  'cells',
  'data',
  'dataset',
  'file',
  'size',
  'shape',
]);

/**
 * Generic nouns for « the thing one row is ». Deliberately a short, closed
 * list: an entity noun it does not know makes the parser refuse rather than
 * guess, which is the safe direction.
 */
const ENTITY_WORDS = new Set([
  'personne',
  'personnes',
  'gens',
  'individu',
  'individus',
  'passager',
  'passagers',
  'client',
  'clients',
  'utilisateur',
  'utilisateurs',
  'eleve',
  'eleves',
  'element',
  'elements',
  'produit',
  'produits',
  'people',
  'person',
  'persons',
  'individual',
  'individuals',
  'passenger',
  'passengers',
  'customer',
  'customers',
  'user',
  'users',
  'student',
  'students',
  'item',
  'items',
  'product',
  'products',
]);

/**
 * Grammatical filler. Comparison words (plus, moins, more, than, over…) are
 * deliberately ABSENT: they are the signal `droppedCondition` reads, and
 * treating them as filler would hide exactly what it is looking for.
 */
const FILLER_WORDS = new Set([
  'le',
  'la',
  'les',
  'l',
  'un',
  'une',
  'des',
  'du',
  'de',
  'd',
  'au',
  'aux',
  'et',
  'ou',
  'a',
  'en',
  'dans',
  'sur',
  'pour',
  'avec',
  'sans',
  'est',
  'sont',
  'etait',
  'etaient',
  'ce',
  'c',
  'cette',
  'ces',
  'qui',
  'que',
  'quoi',
  'quel',
  'quelle',
  'quels',
  'quelles',
  'y',
  'il',
  'elle',
  'on',
  'se',
  'ne',
  'me',
  'son',
  'sa',
  'ses',
  'leur',
  'leurs',
  'notre',
  'nos',
  'votre',
  'vos',
  'moi',
  'the',
  'an',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'without',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'that',
  'this',
  'these',
  'those',
  'and',
  'or',
  'do',
  'does',
  'did',
  'there',
  'here',
  'it',
  'its',
  'their',
  'his',
  'her',
  'my',
  'your',
  'our',
  'to',
  'from',
  'as',
  'me',
  'each',
  'per',
  'show',
  'give',
  'tell',
  'list',
  'where',
  'when',
  'between',
  'among',
  'have',
  'has',
  'had',
  'being',
  'all',
  'any',
  'some',
  'only',
  'also',
  'just',
  'please',
  'can',
  'could',
  'would',
  'should',
  'will',
  'much',
  'many',
  'avait',
  'avaient',
  'ont',
  'tous',
  'toutes',
  'tout',
  'toute',
  'entre',
  'parmi',
  'seulement',
  'aussi',
  'peut',
  'donne',
  'montre',
  'liste',
  'affiche',
]);

/** Splits folded text into comparable words, without their trailing marks. */
function words(text: string): string[] {
  return text
    .split(' ')
    .map((word) => word.replace(/^[.,-]+/, '').replace(/[.,-]+$/, ''))
    .filter((word) => word.length > 0);
}

function markPhrase(tokens: string[], used: boolean[], phrase: string): void {
  const parts = words(phrase);
  if (parts.length === 0) return;
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    if (!parts.every((part, k) => tokens[i + k] === part)) continue;
    for (let k = 0; k < parts.length; k++) used[i + k] = true;
  }
}

/** Every column the answer actually refers to. */
function intentColumns(intent: Intent): string[] {
  const names: string[] = [];
  if ('column' in intent && intent.column) names.push(intent.column);
  if ('groupBy' in intent && intent.groupBy) names.push(intent.groupBy);
  if ('a' in intent) names.push(intent.a, intent.b);
  if ('filter' in intent && intent.filter) names.push(intent.filter.column);
  return names;
}

/**
 * The words of `question` that nothing in the answer accounts for. An empty
 * result means the parser read the whole question; anything else means it did
 * not, and `parseQuestion` refuses instead of answering a shorter question.
 */
export function unreadWords(question: string, intent: Intent, lang: string): string[] {
  const lexicon = lang.startsWith('fr') ? FR : EN;
  const text = fold(question);
  const tokens = words(text);
  const used = new Array<boolean>(tokens.length).fill(false);

  for (const [, phrases] of lexicon.ops)
    for (const phrase of phrases) markPhrase(tokens, used, phrase);
  for (const [, phrases] of lexicon.comparators)
    for (const phrase of phrases) markPhrase(tokens, used, phrase);
  for (const list of [
    lexicon.count,
    lexicon.top,
    lexicon.by,
    lexicon.correlation,
    lexicon.distribution,
    lexicon.shape,
    lexicon.missing,
  ]) {
    for (const phrase of list) markPhrase(tokens, used, phrase);
  }
  for (const name of intentColumns(intent)) markPhrase(tokens, used, fold(name));
  if ('filter' in intent && intent.filter)
    markPhrase(tokens, used, fold(String(intent.filter.value)));
  if ('k' in intent) markPhrase(tokens, used, String(intent.k));

  const leftover: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const token = tokens[i];
    // A one- or two-letter leftover is noise, not a condition; a bare number
    // is already `droppedCondition`'s business.
    if (token.length < 3 || /^\d+(?:[.,]\d+)?$/.test(token)) continue;
    if (STRUCTURE_WORDS.has(token) || ENTITY_WORDS.has(token) || FILLER_WORDS.has(token)) continue;
    leftover.push(token);
  }
  return leftover;
}

export function parseQuestion(
  question: string,
  columns: ColumnInfo[],
  lang: string,
): Intent | null {
  const lexicon = lang.startsWith('fr') ? FR : EN;
  const text = fold(question);
  if (!text) return null;
  const mentions = columnMentions(text, columns);
  // Every reading below goes through here: an answer that leaves part of the
  // question unread is not an answer, it is a different question.
  const readOrRefuse = (intent: Intent | null): Intent | null =>
    intent && unreadWords(question, intent, lang).length === 0 ? intent : null;

  if (findAny(text, lexicon.missing)) return readOrRefuse({ kind: 'missing' });

  if (findAny(text, lexicon.correlation) && mentions.length >= 2) {
    return readOrRefuse({
      kind: 'correlation',
      a: mentions[0].column.name,
      b: mentions[1].column.name,
    });
  }

  if (findAny(text, lexicon.distribution) && mentions.length >= 1) {
    return readOrRefuse({ kind: 'distribution', column: mentions[0].column.name });
  }

  if (findAny(text, lexicon.shape)) return readOrRefuse({ kind: 'shape' });

  const top = findAny(text, lexicon.top);
  if (top) {
    const k = numberAfter(text.slice(top.pos, top.pos + top.len + 4), 0) ?? 5;
    const groupMention =
      mentions.find((m) => m.pos >= top.pos && !m.column.isNumeric) ??
      mentions.find((m) => !m.column.isNumeric) ??
      mentions[0];
    if (groupMention) {
      const groupBy = groupMention.column.name;
      const opHit = lexicon.ops
        .map(([op, phrases]) => ({ op, mention: findAny(text, phrases) }))
        .find((entry) => entry.mention !== null);
      const metricMention = mentions.find((m) => m.column.isNumeric && m.column.name !== groupBy);
      if (opHit && metricMention) {
        return readOrRefuse({
          kind: 'topk',
          groupBy,
          k,
          op: opHit.op,
          column: metricMention.column.name,
          filter: parseFilter(text, mentions, columns, lexicon, new Set([groupBy])),
        });
      }
      return readOrRefuse({
        kind: 'topk',
        groupBy,
        k,
        op: 'count',
        filter: parseFilter(text, mentions, columns, lexicon, new Set([groupBy])),
      });
    }
  }

  const opHit = lexicon.ops
    .map(([op, phrases]) => ({ op, mention: findAny(text, phrases) }))
    .filter((entry) => entry.mention !== null)
    .sort((a, b) => a.mention!.pos - b.mention!.pos)[0];
  if (opHit) {
    const target = mentions.find((m) => m.column.isNumeric);
    if (target) {
      const column = target.column.name;
      const exclude = new Set([column]);
      const groupBy = groupByColumn(text, mentions, lexicon, exclude);
      if (groupBy) exclude.add(groupBy);
      const filter = parseFilter(text, mentions, columns, lexicon, exclude);
      if (droppedCondition(text, mentions, filter, lexicon)) return null;
      return readOrRefuse({ kind: 'aggregate', op: opHit.op, column, groupBy, filter });
    }
  }

  if (findAny(text, lexicon.count)) {
    const groupBy = groupByColumn(text, mentions, lexicon, new Set());
    if (groupBy) {
      return readOrRefuse({
        kind: 'topk',
        groupBy,
        k: 12,
        op: 'count',
        filter: parseFilter(text, mentions, columns, lexicon, new Set([groupBy])),
      });
    }
    const filter = parseFilter(text, mentions, columns, lexicon, new Set());
    if (droppedCondition(text, mentions, filter, lexicon)) return null;
    return readOrRefuse({ kind: 'count', filter });
  }

  return null;
}
