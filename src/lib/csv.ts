/**
 * V35 wave 4 — writing a CSV cell that a spreadsheet will read as data, not as code.
 *
 * Every CSV LabML exports carries values the user gave it: the columns of the
 * file they dropped, re-emitted so the scored batch re-joins cleanly with the
 * original. That round trip is the point — and it is also the risk. A cell
 * beginning with `=`, `+`, `-`, `@`, a tab or a carriage return is a formula to
 * Excel, LibreOffice and Google Sheets, so `=cmd|'/c calc'!A1` sitting in a
 * file someone sent you becomes a command when the cleaned export is opened.
 *
 * The audit measured it: all five hostile cells crossed the old writer
 * untouched. Nothing executes inside LabML — the browser never evaluates any of
 * it — so this is not a hole in the app. It is a hazard the app was passing
 * downstream, which for a tool whose whole pitch is « drop the file you were
 * sent » is the one that matters.
 *
 * **A number is left exactly as it was.** The usual advice — prefix every
 * dangerous-looking cell with an apostrophe — would rewrite a column of
 * negative numbers into `'-5`, and corrupting real data to prevent a
 * hypothetical formula is a bad trade in a project whose first promise is that
 * it does not quietly change what you gave it. So the guard fires only on cells
 * that trigger a formula AND are not a number. `-5` and `+3.2e4` go through
 * untouched; `-2+3+cmd|…` does not.
 *
 * This lives in one place because it used to live in three — `serialize.ts`,
 * `score.ts` and `sql/table.ts` each carried their own copy of the same escape,
 * and all three had the same gap.
 */

/** Leading characters a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A value a spreadsheet would parse as a number anyway. Accepts a comma as the
 * decimal mark: a French export writes `-1,5`, and that is data, not code.
 */
const NUMERIC = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

/**
 * One CSV cell, quoted per RFC 4180 and safe to open in a spreadsheet.
 *
 * `\r` is in the quoting set alongside `"`, `,` and `\n`: a lone carriage
 * return inside a value splits the row in readers that accept CRLF endings.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) && !NUMERIC.test(value.trim()) ? `'${value}` : value;
  return /["\n\r,]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One CSV row. */
export const csvRow = (cells: readonly string[]): string => cells.map(csvCell).join(',');

/** Header plus rows, `\n`-separated — the shape every LabML export uses. */
export const toCsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [csvRow(header), ...rows.map(csvRow)].join('\n');
