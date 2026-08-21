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
  shape: ['shape', 'dimensions', 'how big', 'size of'],
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
  shape: ['taille du jeu', 'dimensions', 'quelle taille'],
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

export function parseQuestion(
  question: string,
  columns: ColumnInfo[],
  lang: string,
): Intent | null {
  const lexicon = lang.startsWith('fr') ? FR : EN;
  const text = fold(question);
  if (!text) return null;
  const mentions = columnMentions(text, columns);

  if (findAny(text, lexicon.missing)) return { kind: 'missing' };

  if (findAny(text, lexicon.correlation) && mentions.length >= 2) {
    return { kind: 'correlation', a: mentions[0].column.name, b: mentions[1].column.name };
  }

  if (findAny(text, lexicon.distribution) && mentions.length >= 1) {
    return { kind: 'distribution', column: mentions[0].column.name };
  }

  if (findAny(text, lexicon.shape)) return { kind: 'shape' };

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
        return {
          kind: 'topk',
          groupBy,
          k,
          op: opHit.op,
          column: metricMention.column.name,
          filter: parseFilter(text, mentions, columns, lexicon, new Set([groupBy])),
        };
      }
      return {
        kind: 'topk',
        groupBy,
        k,
        op: 'count',
        filter: parseFilter(text, mentions, columns, lexicon, new Set([groupBy])),
      };
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
      return {
        kind: 'aggregate',
        op: opHit.op,
        column,
        groupBy,
        filter: parseFilter(text, mentions, columns, lexicon, exclude),
      };
    }
  }

  if (findAny(text, lexicon.count)) {
    const groupBy = groupByColumn(text, mentions, lexicon, new Set());
    if (groupBy) {
      return {
        kind: 'topk',
        groupBy,
        k: 12,
        op: 'count',
        filter: parseFilter(text, mentions, columns, lexicon, new Set([groupBy])),
      };
    }
    return { kind: 'count', filter: parseFilter(text, mentions, columns, lexicon, new Set()) };
  }

  return null;
}
