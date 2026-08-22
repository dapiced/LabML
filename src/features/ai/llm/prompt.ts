/**
 * V27 — the local language model does ONE job: turn a free-form question into
 * a query the V6 deterministic engine can execute. It never computes an
 * answer, never sees a data row: it receives only column names, their type,
 * and (for small categoricals) the known values.
 *
 * Everything it produces is validated against the Intent grammar before it is
 * allowed anywhere near the engine — an unparseable or out-of-grammar answer
 * is a REFUSAL that falls back to the deterministic parser, never a guess.
 */
import type { AggOp, Filter, FilterOp, Intent } from '@/features/ai/chat/engine';
import type { ColumnInfo } from '@/features/ai/chat/parser';

const AGG_OPS: AggOp[] = ['count', 'mean', 'median', 'min', 'max', 'sum', 'std'];
const FILTER_OPS: FilterOp[] = ['>', '>=', '<', '<=', '=', '!='];
/** Category values quoted per column in the prompt — keeps it short and typed. */
const MAX_VALUES_SHOWN = 12;

/** The grammar, spelled out for the model, with one example per intent kind. */
export function buildSystemPrompt(columns: ColumnInfo[]): string {
  const schema = columns
    .map((c) => {
      const type = c.isNumeric ? 'number' : 'text';
      const values =
        !c.isNumeric && c.values.length > 0
          ? ` values: ${c.values.slice(0, MAX_VALUES_SHOWN).join(', ')}`
          : '';
      return `- ${c.name} (${type})${values}`;
    })
    .join('\n');

  return `You translate a question about a table into ONE JSON query. You never answer the question and never invent numbers.

Columns:
${schema}

Reply with ONE JSON object and nothing else. Allowed shapes:
{"kind":"aggregate","op":OP,"column":COL,"groupBy":COL?,"filter":FILTER?}
{"kind":"count","filter":FILTER?}
{"kind":"topk","groupBy":COL,"k":N,"op":OP,"column":COL?,"filter":FILTER?}
{"kind":"distribution","column":COL}
{"kind":"correlation","a":COL,"b":COL}
{"kind":"shape"}
{"kind":"missing"}

OP is one of: ${AGG_OPS.join(', ')}.
FILTER is {"column":COL,"op":CMP,"value":V} where CMP is one of: ${FILTER_OPS.join(', ')}.
Omit optional keys you do not need.

Rules:
1. COL must be copied exactly from the column list above.
2. A filter value on a text column must be one of the values listed for THAT column. If the value you want is not listed there, pick the column whose values do contain it.
3. Comparing two groups is not a count: use aggregate with groupBy set to the column that defines the groups.
4. An age or price threshold is a filter with < or >, on the numeric column it refers to.
5. A question that compares two groups (women vs men, one class against another) is an aggregate with groupBy on the column whose values name those groups — NEVER a correlation. Correlation relates two number columns and nothing else; never pick a column the question does not mention.
6. The examples below describe a DIFFERENT table. Never reuse a column name from them unless that exact name is in the list above.

Examples:
Q: average age of women -> {"kind":"aggregate","op":"mean","column":"age","filter":{"column":"sex","op":"=","value":"female"}}
Q: a quel age moyen voyageaient les passagers ? -> {"kind":"aggregate","op":"mean","column":"age"}
Q: did women pay more than men? -> {"kind":"aggregate","op":"mean","column":"fare","groupBy":"sex"}
Q: les hommes voyageaient-ils plus jeunes que les femmes ? -> {"kind":"aggregate","op":"mean","column":"age","groupBy":"sex"}
Q: combien d'enfants de moins de 10 ans ? -> {"kind":"count","filter":{"column":"age","op":"<","value":10}}
Q: combien de lignes ? -> {"kind":"count"}
Q: top 3 des ports par nombre de passagers -> {"kind":"topk","groupBy":"embark_town","k":3,"op":"count"}
Q: repartition des classes -> {"kind":"distribution","column":"pclass"}
Q: lien entre age et prix -> {"kind":"correlation","a":"age","b":"fare"}`;
}

export function buildUserPrompt(question: string): string {
  return `Q: ${question} -> `;
}

/** JSON-ish text (the model may wrap it) reduced to its first object. */
export function extractJson(raw: string): string | null {
  // Belt and braces against Qwen3's reasoning mode: a <think> block can hold
  // braces of its own, and taking the first one would parse the model's
  // deliberation instead of its answer.
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '');
  const raw2 = text.trim().length > 0 ? text : raw;
  const start = raw2.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw2.length; i++) {
    if (raw2[i] === '{') depth += 1;
    else if (raw2[i] === '}') {
      depth -= 1;
      if (depth === 0) return raw2.slice(start, i + 1);
    }
  }
  return null;
}

function asColumn(value: unknown, columns: ColumnInfo[]): string | null {
  if (typeof value !== 'string') return null;
  const exact = columns.find((c) => c.name === value);
  if (exact) return exact.name;
  // One tolerance only: case and surrounding space. Never a fuzzy guess —
  // a column the model invented must be refused, not silently rewired.
  const loose = columns.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
  return loose ? loose.name : null;
}

function asFilter(value: unknown, columns: ColumnInfo[]): Filter | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const column = asColumn(raw.column, columns);
  if (!column) return null;
  if (!FILTER_OPS.includes(raw.op as FilterOp)) return null;
  const v = raw.value;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  return { column, op: raw.op as FilterOp, value: v };
}

/**
 * Strict grammar check: every field must exist, every column must be real,
 * every operator must be in the closed list. Anything else returns null —
 * the caller then falls back to the deterministic parser, announced.
 */
export function validateIntent(parsed: unknown, columns: ColumnInfo[]): Intent | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  const filter = raw.filter === undefined ? undefined : asFilter(raw.filter, columns);
  if (raw.filter !== undefined && filter === null) return null;
  const withFilter = <T extends object>(intent: T): T =>
    filter ? ({ ...intent, filter } as T) : intent;

  switch (raw.kind) {
    case 'shape':
      return { kind: 'shape' };
    case 'missing':
      return { kind: 'missing' };
    case 'count':
      return withFilter({ kind: 'count' } as Intent);
    case 'distribution': {
      const column = asColumn(raw.column, columns);
      return column ? { kind: 'distribution', column } : null;
    }
    case 'correlation': {
      const a = asColumn(raw.a, columns);
      const b = asColumn(raw.b, columns);
      return a && b && a !== b ? { kind: 'correlation', a, b } : null;
    }
    case 'aggregate': {
      const column = asColumn(raw.column, columns);
      if (!column || !AGG_OPS.includes(raw.op as AggOp)) return null;
      const groupBy = raw.groupBy === undefined ? undefined : asColumn(raw.groupBy, columns);
      if (raw.groupBy !== undefined && !groupBy) return null;
      return withFilter({
        kind: 'aggregate',
        op: raw.op as AggOp,
        column,
        ...(groupBy ? { groupBy } : {}),
      } as Intent);
    }
    case 'topk': {
      const groupBy = asColumn(raw.groupBy, columns);
      if (!groupBy || !AGG_OPS.includes(raw.op as AggOp)) return null;
      const k = typeof raw.k === 'number' && Number.isFinite(raw.k) ? Math.trunc(raw.k) : 5;
      if (k < 1 || k > 50) return null;
      const column = raw.column === undefined ? undefined : asColumn(raw.column, columns);
      if (raw.column !== undefined && !column) return null;
      // Every op but count needs a numeric column to aggregate.
      if (raw.op !== 'count' && !column) return null;
      return withFilter({
        kind: 'topk',
        groupBy,
        k,
        op: raw.op as AggOp,
        ...(column ? { column } : {}),
      } as Intent);
    }
    default:
      return null;
  }
}

/** Raw model text -> a validated Intent, or null (a named refusal upstream). */
export function intentFromCompletion(raw: string, columns: ColumnInfo[]): Intent | null {
  const json = extractJson(raw);
  if (!json) return null;
  try {
    return validateIntent(JSON.parse(json), columns);
  } catch {
    return null;
  }
}
