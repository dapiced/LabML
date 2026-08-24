/**
 * V35 wave 4 — turning the first row of a file into column names LabML can
 * actually address.
 *
 * Both workers used to do this inline, identically:
 *
 * ```ts
 * header = row.map((cell, i) => (cell.trim() === '' ? `column_${i + 1}` : cell.trim()));
 * ```
 *
 * which is correct for a well-formed file and wrong for two that are not.
 *
 * **A file may name two columns the same thing.** `age,age` is legal CSV, and
 * a spreadsheet export produces it all the time. LabML then held two columns
 * under one name and resolved that name two different ways: `header.indexOf`
 * (the forecast panel) returned the FIRST, `new Map(header.map(…))` (training,
 * exploration, target analysis, robust ranking) returned the LAST. Measured on
 * `age,age\n10,999\n20,888`: `indexOf('age')` → `["10","20"]`, the map →
 * `["999","888"]`. The user picked one column and got statistics from one and a
 * model from the other, with nothing on screen to tell them apart — the profile
 * list showed « age » twice.
 *
 * **The auto-naming could manufacture that collision itself.** `a,,column_2`
 * gave `["a", "column_2", "column_2"]`: an unnamed column stole the name of a
 * real one. So a perfectly ordinary file walked into the bug above.
 *
 * The rule here is that **names are unique by construction**, every rename is
 * reported so the UI can say what it did, and a name the file actually gives a
 * column is never taken by a generated one — the real `column_2` keeps its
 * name, and it is the unnamed neighbour that moves.
 */

/** What was wrong with a column's name in the file, and what LabML calls it. */
export interface HeaderIssue {
  /** `unnamed`: the file left the cell blank. `duplicate`: the name was taken. */
  kind: 'unnamed' | 'duplicate';
  /** 0-based position of the column in the file. */
  index: number;
  /** Exactly what the file said — `''` for an unnamed column. */
  original: string;
  /** The unique name LabML uses from here on. */
  name: string;
}

export interface HeaderRead {
  /** One unique, non-empty name per column, in file order. */
  names: string[];
  /** Every column whose name LabML had to change, in file order. */
  issues: HeaderIssue[];
}

/**
 * Reads a header row into unique names.
 *
 * A repeated name gets a ` (2)`, ` (3)` … suffix, so `age,age,age` becomes
 * `age`, `age (2)`, `age (3)`: the first occurrence keeps the name the user
 * typed, which is the one they will look for. The suffix keeps climbing past a
 * name the file already uses, so a file containing `age`, `age (2)` and a
 * second `age` still ends up with three distinct names.
 */
export function readHeader(row: readonly string[]): HeaderRead {
  const raw = row.map((cell) => cell.trim());
  /** Names the file itself gives a column — a generated name must avoid these. */
  const claimed = new Set(raw.filter((name) => name !== ''));
  const used = new Set<string>();
  const names: string[] = [];
  const issues: HeaderIssue[] = [];

  for (let i = 0; i < raw.length; i++) {
    const original = raw[i];
    const generated = original === '';
    const base = generated ? `column_${i + 1}` : original;

    let name = base;
    let attempt = 1;
    // A generated name also yields to any name the file spells out elsewhere,
    // so `a,,column_2` renames the blank column, never the real `column_2`.
    while (used.has(name) || (generated && claimed.has(name))) {
      attempt += 1;
      name = `${base} (${attempt})`;
    }

    used.add(name);
    names.push(name);
    if (generated) issues.push({ kind: 'unnamed', index: i, original, name });
    else if (name !== original) issues.push({ kind: 'duplicate', index: i, original, name });
  }

  return { names, issues };
}
