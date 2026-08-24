/**
 * V35 — the two SheetJS calls LabML actually depends on, pinned.
 *
 * `xlsx` no longer comes from npm. The registry copy is frozen at 0.18.5 and
 * carries two high advisories with `fixAvailable: false` — Prototype Pollution
 * (GHSA-4r6h-8v6p-xvw6, CVSS 7.8) and ReDoS (GHSA-5pgg-2g8v-p4x9, CVSS 7.5) —
 * because SheetJS left npm and publishes only to its own host. The dependency
 * now points at the official tarball, which fixes both; `package-lock.json`
 * records its `integrity` hash, so a tampered download fails `npm ci` rather
 * than shipping.
 *
 * That trade is worth stating plainly. Vendoring the file into the repository
 * would have removed the build-time host, but it would also have removed the
 * package from the manifest — and a dependency `npm audit` cannot see is not
 * a dependency that got safer, only one that stopped reporting. Keeping it a
 * real, versioned, integrity-pinned dependency keeps the next advisory
 * visible. The runtime promise is untouched either way: the tarball is fetched
 * at install time and bundled, so the browser still calls nobody.
 *
 * What the change costs is a compatibility risk across 0.18 → 0.20, and these
 * tests are what covers it: the surface LabML uses is two calls wide, and both
 * are exercised here against the version actually installed.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

/** The exact call shape the three workers use. */
const readFirstSheetAsCsv = (bytes: Uint8Array) => {
  const workbook = XLSX.read(bytes, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(firstSheet);
};

const workbookBytes = (rows: unknown[][]): Uint8Array => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Feuille1');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

describe('the SheetJS surface LabML depends on', () => {
  it('is the patched build, not the abandoned npm one', () => {
    // 0.19.3 fixed the prototype pollution, 0.20.2 the ReDoS. Anything below
    // 0.20.2 means the dependency silently fell back to the registry copy.
    const [major, minor, patch] = XLSX.version.split('.').map(Number);
    expect(
      major * 10000 + minor * 100 + patch,
      `xlsx is ${XLSX.version}; the advisories are only fixed from 0.20.2`,
    ).toBeGreaterThanOrEqual(2002);
  });

  it('reads a workbook from raw bytes and returns the first sheet as CSV', () => {
    const csv = readFirstSheetAsCsv(
      workbookBytes([
        ['name', 'score'],
        ['iris', 0.97],
        ['titanic', 0.79],
      ]),
    );
    expect(csv.trim().split('\n')).toEqual(['name,score', 'iris,0.97', 'titanic,0.79']);
  });

  it('quotes a cell containing the delimiter rather than splitting the row', () => {
    // A French export writes « Paris, France » in one cell. If the conversion
    // stopped quoting it, every downstream column would shift by one.
    const csv = readFirstSheetAsCsv(
      workbookBytes([
        ['city', 'n'],
        ['Paris, France', 3],
      ]),
    );
    expect(csv).toContain('"Paris, France",3');
  });

  it('keeps accented headers intact — the parser reads them as column names', () => {
    const csv = readFirstSheetAsCsv(
      workbookBytes([
        ['âge', 'catégorie'],
        [42, 'élevé'],
      ]),
    );
    expect(csv).toContain('âge,catégorie');
    expect(csv).toContain('élevé');
  });

  it('leaves an empty cell empty instead of inventing a value', () => {
    const csv = readFirstSheetAsCsv(
      workbookBytes([
        ['a', 'b'],
        [1, null],
      ]),
    );
    // A missing value must survive as missing: the Data Studio's whole
    // imputation story starts from knowing which cells were blank.
    expect(csv.trim().split('\n')[1]).toBe('1,');
  });
});
