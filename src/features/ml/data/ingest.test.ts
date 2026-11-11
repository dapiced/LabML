import { describe, expect, it } from 'vitest';
import { Ingestion, isSpreadsheet, readTable } from '@/features/ml/data/ingest';
import { MAX_CELLS, tooLargeDetail } from '@/features/ml/data/limits';

// V54: one ingestion for the ML Lab, the Data Studio and the chat. The memory
// guard, the format detection and the malformed-row count used to depend on
// which section the file was dropped into.

function csv(rows: number, columns = 3): string {
  const lines = [Array.from({ length: columns }, (_, c) => `c${c}`).join(',')];
  for (let r = 0; r < rows; r++) {
    lines.push(Array.from({ length: columns }, (_, c) => String(r * (c + 1))).join(','));
  }
  return lines.join('\n');
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'no-refusal';
}

describe('the memory guard (V25, shared by V54)', () => {
  it('uses the lab budget when none is given', () => {
    const ingestion = new Ingestion();
    expect(
      ingestion.push([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe(true);
    expect(MAX_CELLS).toBe(20_000_000);
  });

  it('keeps the row that fills the budget and refuses the next one', () => {
    const ingestion = new Ingestion({ maxCells: 6 });
    const kept = ingestion.push([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
    expect(kept).toBe(true);
    expect(ingestion.push([['7', '8', '9']])).toBe(false);
    expect(ingestion.overflowed).toBe(true);
    expect(ingestion.rowCount).toBe(2);
    // Once blown, nothing more is kept, whatever is pushed.
    expect(ingestion.push([['x', 'y', 'z']])).toBe(false);
    expect(ingestion.columns[0]).toEqual(['1', '4']);
  });

  it('refuses text past the budget by name, with where reading stopped', async () => {
    const message = await refusal(() => readTable(csv(50), { maxCells: 30 }));
    expect(message).toBe('too-large:10:3');
    expect(tooLargeDetail(message)).toEqual({ rows: 10, columns: 3 });
  });

  it('stops a file stream at the budget instead of reading it all', async () => {
    const file = new File([csv(5000, 4)], 'big.csv', { type: 'text/csv' });
    const message = await refusal(() => readTable(file, { maxCells: 400 }));
    expect(message).toBe('too-large:100:4');
  });

  it('reads a file that fits, and reports progress', async () => {
    const seen: number[] = [];
    const file = new File([csv(12000, 2)], 'ok.csv', { type: 'text/csv' });
    const table = await readTable(file, { onProgress: (rows) => seen.push(rows) });
    expect(table.rowCount).toBe(12000);
    expect(table.header).toEqual(['c0', 'c1']);
    expect(seen).toEqual([5000, 10000]);
  });

  it('only reads its own refusal', () => {
    expect(tooLargeDetail('empty')).toBeNull();
    expect(tooLargeDetail(null)).toBeNull();
    expect(tooLargeDetail('too-large:abc:3')).toBeNull();
  });
});

describe('one reading for every section (V54)', () => {
  it('refuses an empty file and a header with no rows by the same name', async () => {
    expect(await refusal(() => readTable(''))).toBe('empty');
    expect(await refusal(() => readTable('a,b,c\n'))).toBe('empty');
  });

  it('reads a French export the same way wherever it is dropped', async () => {
    // The shape the chat worker used to read with no detection at all:
    // semicolons, decimal commas.
    const text = [
      'ville;prix;surface',
      'Lyon;12,5;40,25',
      'Paris;18,75;22,5',
      'Nice;9,5;61,0',
      'Lille;7,25;35,5',
      'Brest;6,0;48,75',
    ].join('\n');
    const table = await readTable(text);
    expect(table.header).toEqual(['ville', 'prix', 'surface']);
    expect(table.columns[1]).toEqual(['12.5', '18.75', '9.5', '7.25', '6.0']);
    expect(table.readFormat.delimiter).toBe(';');
    expect(table.readFormat.decimalColumns.map((c) => c.column)).toEqual(['prix', 'surface']);
  });

  it('decodes a windows-1252 file from its bytes', async () => {
    // « é » is 0xE9 in windows-1252 and an invalid sequence in UTF-8.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('cat'),
      0xe9,
      ...new TextEncoder().encode('gorie,n\na,1\nb,2\n'),
    ]);
    const table = await readTable(new File([bytes], 'latin.csv'));
    expect(table.header).toEqual(['catégorie', 'n']);
    expect(table.readFormat.encoding.encoding).toBe('windows-1252');
  });

  it('counts the rows the file did not deliver as declared', async () => {
    const table = await readTable('a,b\n1,2\n3\n4,5,6\n7,8\n');
    expect(table.rowCount).toBe(4);
    expect(table.readFormat.malformedRows).toBe(2);
    // Missing cells are null, extra ones dropped.
    expect(table.columns[1]).toEqual(['2', null, '5', '8']);
  });

  it('keeps column names unique and reports the rename', async () => {
    const table = await readTable('age,age\n1,2\n3,4\n');
    expect(new Set(table.header).size).toBe(2);
    expect(table.readFormat.headerIssues).toHaveLength(1);
  });

  it('skips blank lines without counting them', async () => {
    const table = await readTable('a,b\n1,2\n\n3,4\n');
    expect(table.rowCount).toBe(2);
    expect(table.readFormat.malformedRows).toBeUndefined();
  });

  it('recognises spreadsheets by name', () => {
    expect(isSpreadsheet('sales.XLSX')).toBe(true);
    expect(isSpreadsheet('sales.xls')).toBe(true);
    expect(isSpreadsheet('sales.csv')).toBe(false);
  });
});
