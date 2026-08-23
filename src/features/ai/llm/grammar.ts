/**
 * V30 — the query grammar as an automaton, so an invalid query cannot be
 * WRITTEN rather than being caught after the fact.
 *
 * V27 let the model produce whatever it liked and then checked the result
 * (`validateIntent`). That catches every malformed answer, but catching is not
 * the same as preventing: a refused answer is a question the app cannot
 * answer, and the measured V27 failures were overwhelmingly SHAPE errors —
 * the model had found the right column and then wrapped it in the wrong
 * envelope, or in three paragraphs of markdown.
 *
 * This module describes the set of legal query strings as a small
 * non-deterministic automaton over CHARACTERS. Given the text generated so
 * far, it answers two questions: which characters may come next, and is what
 * we have a complete query. A logits processor (`constrain.ts`) turns those
 * two answers into a mask over the model's vocabulary, so the only tokens the
 * model can pick are ones that keep the answer inside the grammar.
 *
 * Three deliberate limits, stated rather than hidden:
 *
 * 1. **It is a filter, not the validator.** The automaton over-approximates in
 *    two places where exactness would multiply its size for no gain
 *    (`correlation` with a === b, and a k outside its bounds is impossible but
 *    a nonsense combination of op and column is not). Everything it produces
 *    still goes through `validateIntent`, which stays the authority.
 * 2. **Refusing must stay possible.** Constraining the output makes a refusal
 *    HARDER, not easier: a model that can only emit valid queries will emit a
 *    valid query for « what is the capital of France? ». So the grammar has a
 *    `{"kind":"none"}` shape whose only meaning is « I cannot express this »,
 *    and it maps to the same refusal V27 already had.
 * A note on units: the automaton steps over UTF-8 BYTES, not characters.
 * Qwen's vocabulary is byte-level BPE, so 1 457 of its 151 669 tokens are
 * fragments of a multi-byte character rather than a character. Stepping over
 * characters would have meant masking those tokens out, and with them any
 * category value the tokenizer happens to split mid-character — « Côte
 * d'Ivoire » in a French file, for instance. Bytes cost about thirty lines and
 * remove the whole class of problem.
 *
 * 3. **A filter value is checked against its own column.** The prompt asked
 *    for this in prose (rule 2) and nothing enforced it. Here, choosing
 *    `"column":"sex"` restricts what may follow `"value":` to the values `sex`
 *    actually has. A column with no known values (free text) still accepts an
 *    arbitrary string — constraining what we do not know would remove a
 *    capability rather than add correctness.
 */
import type { ColumnInfo } from '@/features/ai/chat/parser';

/** Aggregation operators, in the order the prompt lists them. */
export const GRAMMAR_OPS = ['count', 'mean', 'median', 'min', 'max', 'sum', 'std'] as const;
export const GRAMMAR_FILTER_OPS = ['>', '>=', '<', '<=', '=', '!='] as const;
/** `validateIntent` refuses a k outside 1–50; the grammar cannot write one. */
export const MAX_K = 50;
/** A free-text filter value never needs to be longer than this. */
const MAX_FREE_STRING = 64;
/**
 * Only the first columns of a wide table get their own filter shape. Each one
 * adds five alternatives to the automaton (its value list has to be tied to
 * its own column, which is the whole point), so an uncapped table would make
 * the mask below slower with every column. Past the cap a column can still be
 * aggregated, grouped and described — it simply cannot be filtered on, and
 * `buildGrammar` reports how many were left out rather than pretending.
 */
export const MAX_FILTER_COLUMNS = 64;

export type Atom =
  | { kind: 'lit'; bytes: Uint8Array }
  | { kind: 'oneOf'; options: Uint8Array[] }
  | { kind: 'number' }
  | { kind: 'freeString' };

const encoder = new TextEncoder();
export function lit(text: string): Atom {
  return { kind: 'lit', bytes: encoder.encode(text) };
}
function oneOf(options: string[]): Atom {
  return { kind: 'oneOf', options: options.map((option) => encoder.encode(option)) };
}

export interface Grammar {
  alternatives: Atom[][];
}

// --- position packing -------------------------------------------------
// A position is (alternative, atom, option, offset). Packed into one number so
// a state is a Set<number>: the mask below walks the whole vocabulary at every
// generated token, and object churn there is the difference between a
// millisecond and a second.
const ATOMS_PER_ALT = 64;
const OPTIONS = 4096;
const OFFSETS = 256;
/**
 * Sub-states of a `number` atom, stored in the option field. Only IN_INT and
 * IN_FRAC may end the atom, so `-` and `1.` can never be a complete value.
 */
const NUM_START = 4000;
const NUM_AFTER_SIGN = 4001;
const NUM_IN_INT = 4002;
const NUM_AFTER_DOT = 4003;
const NUM_IN_FRAC = 4004;
/** Sub-states of a `freeString` atom. */
const STR_OPEN = 4010;
const STR_BODY = 4011;

function pack(alt: number, atom: number, option: number, offset: number): number {
  return ((alt * ATOMS_PER_ALT + atom) * OPTIONS + option) * OFFSETS + offset;
}

/**
 * The packing above only holds if every field stays inside its field width.
 * `alt` is unbounded (a number carries 53 bits and the alternatives are
 * capped by MAX_FILTER_COLUMNS anyway); the other three are checked once, when
 * the grammar is built, so a long column name can never silently corrupt a
 * position into a different one.
 */
function assertPackable(grammar: Grammar): void {
  for (const atoms of grammar.alternatives) {
    if (atoms.length >= ATOMS_PER_ALT) throw new Error('grammar-too-long');
    for (const atom of atoms) {
      if (atom.kind === 'lit' && atom.bytes.length >= OFFSETS) throw new Error('grammar-atom-long');
      if (atom.kind !== 'oneOf') continue;
      if (atom.options.length >= 3000) throw new Error('grammar-too-many-options');
      for (const option of atom.options) {
        if (option.length >= OFFSETS) throw new Error('grammar-option-long');
      }
    }
  }
}
function unpack(position: number): { alt: number; atom: number; option: number; offset: number } {
  const offset = position % OFFSETS;
  const rest = (position - offset) / OFFSETS;
  const option = rest % OPTIONS;
  const alt = (rest - option) / OPTIONS;
  return { alt: Math.floor(alt / ATOMS_PER_ALT), atom: alt % ATOMS_PER_ALT, option, offset };
}

// --- building the grammar ---------------------------------------------

const json = (value: string) => JSON.stringify(value);

function filterVariants(columns: ColumnInfo[]): Atom[][] {
  const variants: Atom[][] = [];
  for (const column of columns) {
    // A category whose JSON form does not fit a position's offset field is
    // dropped rather than truncated: half a value is a value that does not
    // exist. A column left with none of them falls back to a free string.
    const listed = column.values.map(json).filter((option) => encoder.encode(option).length < 200);
    const value: Atom = column.isNumeric
      ? { kind: 'number' }
      : listed.length > 0
        ? oneOf(listed)
        : { kind: 'freeString' };
    // An ordering comparison only means something between numbers: on a text
    // column the grammar offers equality and inequality and nothing else,
    // which is the rule `asFilter` already enforces after the fact.
    const ops = column.isNumeric ? GRAMMAR_FILTER_OPS : (['=', '!='] as const);
    variants.push([
      lit(`{"column":${json(column.name)},"op":`),
      oneOf(ops.map(json)),
      lit(',"value":'),
      value,
      lit('}'),
    ]);
  }
  return variants;
}

export function buildGrammar(columns: ColumnInfo[]): Grammar {
  // A name whose JSON form does not fit a position's offset field is left out
  // of the grammar entirely rather than truncated into a column that does not
  // exist. 200 bytes is far past any real header.
  const usable = columns.filter(
    (c) => c.name.length > 0 && encoder.encode(json(c.name)).length < 200,
  );
  const numeric = usable.filter((c) => c.isNumeric);
  // A table with no numeric column can still be counted and described; the
  // aggregate target then falls back to every column rather than to none.
  const measurable = (numeric.length > 0 ? numeric : usable).map((c) => json(c.name));
  const anyColumn = usable.map((c) => json(c.name));
  const ops = GRAMMAR_OPS.map(json);
  const opsWithoutCount = GRAMMAR_OPS.filter((op) => op !== 'count').map(json);
  const ks = Array.from({ length: MAX_K }, (_, i) => String(i + 1));
  const filters = filterVariants(usable.slice(0, MAX_FILTER_COLUMNS));

  const alternatives: Atom[][] = [
    [lit('{"kind":"shape"}')],
    [lit('{"kind":"missing"}')],
    // The escape hatch — see the header. Not an Intent: it maps to a refusal.
    [lit('{"kind":"none"}')],
    [lit('{"kind":"distribution","column":'), oneOf(anyColumn), lit('}')],
    [
      lit('{"kind":"correlation","a":'),
      oneOf(measurable),
      lit(',"b":'),
      oneOf(measurable),
      lit('}'),
    ],
  ];

  const tails: (Atom[] | null)[] = [null, ...filters];
  for (const tail of tails) {
    const withFilter = (head: Atom[]): Atom[] =>
      tail === null ? [...head, lit('}')] : [...head, lit(',"filter":'), ...tail, lit('}')];

    alternatives.push(withFilter([lit('{"kind":"count"')]));

    for (const grouped of [false, true]) {
      const head: Atom[] = [
        lit('{"kind":"aggregate","op":'),
        oneOf(ops),
        lit(',"column":'),
        oneOf(measurable),
      ];
      if (grouped) {
        head.push(lit(',"groupBy":'), oneOf(anyColumn));
      }
      alternatives.push(withFilter(head));
    }

    // Counting the rows of each group needs no measured column; every other
    // operator needs one, so the two are separate shapes rather than one shape
    // with an optional key the validator has to police.
    alternatives.push(
      withFilter([
        lit('{"kind":"topk","groupBy":'),
        oneOf(anyColumn),
        lit(',"k":'),
        oneOf(ks),
        lit(',"op":"count"'),
      ]),
    );
    alternatives.push(
      withFilter([
        lit('{"kind":"topk","groupBy":'),
        oneOf(anyColumn),
        lit(',"k":'),
        oneOf(ks),
        lit(',"op":'),
        oneOf(opsWithoutCount),
        lit(',"column":'),
        oneOf(measurable),
      ]),
    );
  }
  const grammar: Grammar = { alternatives };
  assertPackable(grammar);
  return grammar;
}

// --- walking the automaton --------------------------------------------

/** The set of positions the automaton may be in. Empty means: dead. */
export type State = ReadonlySet<number>;

/** Every position reachable without consuming a character. */
function expand(grammar: Grammar, alt: number, atom: number, out: Set<number>): void {
  const atoms = grammar.alternatives[alt];
  if (atom >= atoms.length) {
    // Complete: parked one past the last atom. `accepting` looks for this.
    out.add(pack(alt, atom, 0, 0));
    return;
  }
  const current = atoms[atom];
  switch (current.kind) {
    case 'lit':
      if (current.bytes.length === 0) expand(grammar, alt, atom + 1, out);
      else out.add(pack(alt, atom, 0, 0));
      return;
    case 'oneOf':
      for (let option = 0; option < current.options.length; option++) {
        if (current.options[option].length === 0) expand(grammar, alt, atom + 1, out);
        else out.add(pack(alt, atom, option, 0));
      }
      return;
    case 'number':
      out.add(pack(alt, atom, NUM_START, 0));
      return;
    case 'freeString':
      out.add(pack(alt, atom, STR_OPEN, 0));
      return;
  }
}

export function startState(grammar: Grammar): State {
  const out = new Set<number>();
  for (let alt = 0; alt < grammar.alternatives.length; alt++) expand(grammar, alt, 0, out);
  return out;
}

export function accepting(grammar: Grammar, state: State): boolean {
  for (const position of state) {
    const { alt, atom } = unpack(position);
    if (atom >= grammar.alternatives[alt].length) return true;
  }
  return false;
}

const BYTE_ZERO = 0x30;
const BYTE_NINE = 0x39;
const BYTE_MINUS = 0x2d;
const BYTE_DOT = 0x2e;
const BYTE_QUOTE = 0x22;
const BYTE_BACKSLASH = 0x5c;
const BYTE_SPACE = 0x20;

function isDigit(byte: number): boolean {
  return byte >= BYTE_ZERO && byte <= BYTE_NINE;
}

/** A byte allowed inside a JSON string without escaping. */
function plainStringByte(byte: number): boolean {
  return byte !== BYTE_QUOTE && byte !== BYTE_BACKSLASH && byte >= BYTE_SPACE;
}

function stepPosition(grammar: Grammar, position: number, byte: number, out: Set<number>): void {
  const { alt, atom, option, offset } = unpack(position);
  const atoms = grammar.alternatives[alt];
  if (atom >= atoms.length) return; // complete: nothing may follow
  const current = atoms[atom];

  const advanceLiteral = (bytes: Uint8Array): void => {
    if (bytes[offset] !== byte) return;
    if (offset + 1 === bytes.length) expand(grammar, alt, atom + 1, out);
    else out.add(pack(alt, atom, option, offset + 1));
  };

  switch (current.kind) {
    case 'lit':
      advanceLiteral(current.bytes);
      return;
    case 'oneOf':
      advanceLiteral(current.options[option]);
      return;
    case 'number': {
      // Reaching a sub-state that may end the number also opens whatever comes
      // after it, which is what lets `,` or `}` close the value without the
      // number atom having to know what follows it.
      const enter = (next: number): void => {
        out.add(pack(alt, atom, next, 0));
        if (next === NUM_IN_INT || next === NUM_IN_FRAC) expand(grammar, alt, atom + 1, out);
      };
      if (option === NUM_START) {
        if (byte === BYTE_MINUS) enter(NUM_AFTER_SIGN);
        else if (isDigit(byte)) enter(NUM_IN_INT);
        return;
      }
      if (option === NUM_AFTER_SIGN) {
        if (isDigit(byte)) enter(NUM_IN_INT);
        return;
      }
      if (option === NUM_IN_INT) {
        if (isDigit(byte)) enter(NUM_IN_INT);
        else if (byte === BYTE_DOT) enter(NUM_AFTER_DOT);
        return;
      }
      if (option === NUM_AFTER_DOT) {
        if (isDigit(byte)) enter(NUM_IN_FRAC);
        return;
      }
      if (option === NUM_IN_FRAC && isDigit(byte)) enter(NUM_IN_FRAC);
      return;
    }
    case 'freeString': {
      if (option === STR_OPEN) {
        if (byte === BYTE_QUOTE) out.add(pack(alt, atom, STR_BODY, 0));
        return;
      }
      if (byte === BYTE_QUOTE) {
        expand(grammar, alt, atom + 1, out);
        return;
      }
      if (offset < MAX_FREE_STRING && plainStringByte(byte)) {
        out.add(pack(alt, atom, STR_BODY, offset + 1));
      }
      return;
    }
  }
}

/** One byte. Returns the new state; an empty set means the byte is illegal. */
export function stepByte(grammar: Grammar, state: State, byte: number): State {
  const out = new Set<number>();
  for (const position of state) stepPosition(grammar, position, byte, out);
  return out;
}

/** A run of bytes — what the mask uses, since a token is a run of bytes. */
export function stepBytes(grammar: Grammar, state: State, bytes: Uint8Array): State {
  let current = state;
  for (const byte of bytes) {
    if (current.size === 0) return current;
    current = stepByte(grammar, current, byte);
  }
  return current;
}

/** One character, for readable call sites; multi-byte characters step twice. */
export function step(grammar: Grammar, state: State, char: string): State {
  return stepBytes(grammar, state, encoder.encode(char));
}

/** Every byte the automaton would accept next — the mask's first cut. */
export function allowedBytes(grammar: Grammar, state: State): Set<number> {
  const allowed = new Set<number>();
  for (let byte = 0; byte < 256; byte++) {
    if (stepByte(grammar, state, byte).size > 0) allowed.add(byte);
  }
  return allowed;
}

/** A whole string. */
export function advance(grammar: Grammar, state: State, text: string): State {
  return stepBytes(grammar, state, encoder.encode(text));
}

/** True when `text` is a complete, legal query for this grammar. */
export function isComplete(grammar: Grammar, text: string): boolean {
  const state = advance(grammar, startState(grammar), text);
  return state.size > 0 && accepting(grammar, state);
}

/** True when `text` could still become one. */
export function isLegalPrefix(grammar: Grammar, text: string): boolean {
  return advance(grammar, startState(grammar), text).size > 0;
}
