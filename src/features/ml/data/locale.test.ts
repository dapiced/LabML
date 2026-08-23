/**
 * V38 — reading the file exactly as it was written.
 *
 * The tests that matter most here are the ones that assert nothing changes:
 * a module that rewrites values in a data file is only safe if it refuses far
 * more often than it acts.
 */
import { describe, expect, it } from 'vitest';
import {
  DECIMAL_CONFIDENCE,
  decodeBytes,
  detectColumnFormat,
  detectDelimiter,
  isNonDefault,
  normalizeNumber,
} from '@/features/ml/data/locale';

/** "Québec;Montréal;coût" as French Excel writes it (windows-1252). */
const CP1252 = new Uint8Array([
  0x51, 0x75, 0xe9, 0x62, 0x65, 0x63, 0x3b, 0x4d, 0x6f, 0x6e, 0x74, 0x72, 0xe9, 0x61, 0x6c, 0x3b,
  0x63, 0x6f, 0xfb, 0x74,
]);

describe('V38 — encoding decided by failing, not by sniffing', () => {
  it('reads windows-1252 accents correctly instead of replacement characters', () => {
    const { text, choice } = decodeBytes(CP1252);
    expect(text).toBe('Québec;Montréal;coût');
    expect(choice.encoding).toBe('windows-1252');
    // The fallback is a certainty: UTF-8 genuinely threw on these bytes.
    expect(choice.utf8Failed).toBe(true);
  });

  it('leaves valid UTF-8 alone and says nothing failed', () => {
    const bytes = new TextEncoder().encode('Québec;Montréal;coût');
    const { text, choice } = decodeBytes(bytes);
    expect(text).toBe('Québec;Montréal;coût');
    expect(choice.encoding).toBe('utf-8');
    expect(choice.utf8Failed).toBe(false);
  });

  it('strips a UTF-8 BOM and treats it as settled, not inferred', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = new TextEncoder().encode('nom,prix');
    const bytes = new Uint8Array([...bom, ...body]);
    const { text, choice } = decodeBytes(bytes);
    expect(text).toBe('nom,prix');
    expect(choice.hadBom).toBe(true);
    expect(choice.utf8Failed).toBe(false);
  });

  it('obeys an explicit override even when detection would disagree', () => {
    const { text, choice } = decodeBytes(CP1252, 'utf-8');
    expect(choice.encoding).toBe('utf-8');
    // The user asked for UTF-8 and gets UTF-8 — replacement characters and all.
    expect(text).toContain('�');
  });
});

describe('V38 — the delimiter, announced rather than guessed silently', () => {
  it('finds the semicolon a French export uses', () => {
    const text = 'nom;prix;quantité\nvis;12,50;3\nécrou;0,75;120';
    expect(detectDelimiter(text)).toEqual({ delimiter: ';', columns: 3 });
  });

  it('finds a tab', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3').delimiter).toBe('\t');
  });

  it('is not fooled by a comma inside a quoted field', () => {
    // Every line has 2 real columns; the comma only appears inside quotes.
    const text = 'nom;note\n"vis, tête plate";bien\n"écrou, long";moyen';
    expect(detectDelimiter(text)).toEqual({ delimiter: ';', columns: 2 });
  });

  it('requires consistency across lines, not just a big first line', () => {
    // The comma splits line 1 into 4 but line 2 into 2 — inconsistent, so the
    // semicolon (3 everywhere) wins.
    const text = 'a;b;c\n1,2,3;x;y\n4;5;6';
    expect(detectDelimiter(text).delimiter).toBe(';');
  });

  it('falls back to a comma on a single-column file', () => {
    expect(detectDelimiter('valeur\n1\n2')).toEqual({ delimiter: ',', columns: 1 });
  });
});

describe('V38 — a column is rewritten only when doing nothing would lose it', () => {
  it('detects the French decimal comma and counts the evidence', () => {
    const values = ['12,50', '3,25', '0,75', '48,90', '7,10', '199,99'];
    const format = detectColumnFormat('prix', values);
    expect(format).not.toBeNull();
    expect(format!.decimal).toBe(',');
    expect(format!.matched).toBe(6);
    expect(format!.total).toBe(6);
    expect(format!.grouped).toBe(false);
  });

  it('handles grouped thousands, including the space Excel actually emits', () => {
    const values = ['1 234,56', '12 000,00', '999,50', '2 500,25', '75 300,10'];
    const format = detectColumnFormat('montant', values);
    expect(format!.grouped).toBe(true);
    expect(normalizeNumber('1 234,56')).toBe('1234.56');
    // The narrow no-break space (U+202F) that French Excel writes.
    expect(normalizeNumber('12 000,00')).toBe('12000.00');
  });

  it('REFUSES a column that already reads correctly', () => {
    expect(detectColumnFormat('prix', ['12.50', '3.25', '0.75', '48.90', '7.10'])).toBeNull();
  });

  it('REFUSES genuine text that merely contains commas', () => {
    const values = [
      'Bonjour, 12 personnes',
      'vis, tête plate',
      'écrou, long, inox',
      'boulon, M8',
      'rondelle, 12 mm',
    ];
    expect(detectColumnFormat('description', values)).toBeNull();
  });

  it('REFUSES a column of bare integers — there is nothing to rewrite', () => {
    // These match the French pattern too, but no value uses a comma, so
    // rewriting them would be a change with no cause.
    expect(detectColumnFormat('quantité', ['3', '120', '7', '45', '9'])).toBeNull();
  });

  it('REFUSES a column too small to judge', () => {
    expect(detectColumnFormat('prix', ['12,50', '3,25'])).toBeNull();
  });

  it('REFUSES a mixed column below the confidence floor', () => {
    // 5 of 10 are French numbers — half is not evidence.
    const values = ['12,50', '3,25', '0,75', '48,90', '7,10', 'n/d', 'à venir', 'x', 'y', 'z'];
    const format = detectColumnFormat('prix', values);
    expect(format).toBeNull();
    expect(DECIMAL_CONFIDENCE).toBeGreaterThan(0.5);
  });

  it('ignores missing values when counting, rather than holding them against the column', () => {
    const values = ['12,50', null, '3,25', '', '0,75', '48,90', '   ', '7,10'];
    // Eight entries, three of them missing: the count is over the five real ones.
    const format = detectColumnFormat('prix', values);
    expect(format!.total).toBe(5);
    expect(format!.matched).toBe(5);
  });
});

describe('V38 — normalising one value', () => {
  it('rewrites the French form into the canonical one', () => {
    expect(normalizeNumber('12,5')).toBe('12.5');
    expect(normalizeNumber('-0,75')).toBe('-0.75');
    expect(normalizeNumber('1 234,56')).toBe('1234.56');
    expect(normalizeNumber('1.234,56')).toBe('1234.56');
  });

  it('leaves anything that is not that form completely untouched', () => {
    // A stray label inside a numeric column stays a stray label. It must never
    // become a plausible-looking number.
    for (const value of ['n/d', 'à venir', '12.5', 'Bonjour, 12', '', '1,2,3']) {
      expect(normalizeNumber(value)).toBe(value);
    }
  });
});

describe('V38 — when the reading is worth announcing at all', () => {
  const plain = {
    encoding: { encoding: 'utf-8' as const, utf8Failed: false, hadBom: false },
    delimiter: ',' as const,
    decimalColumns: [],
  };

  it('stays quiet on an ordinary UTF-8 comma file — no friction for the common case', () => {
    expect(isNonDefault(plain)).toBe(false);
  });

  it('speaks up for a different encoding, delimiter, or decimal separator', () => {
    expect(isNonDefault({ ...plain, delimiter: ';' })).toBe(true);
    expect(
      isNonDefault({
        ...plain,
        encoding: { encoding: 'windows-1252', utf8Failed: true, hadBom: false },
      }),
    ).toBe(true);
    expect(
      isNonDefault({
        ...plain,
        decimalColumns: [{ column: 'prix', decimal: ',', matched: 6, total: 6, grouped: false }],
      }),
    ).toBe(true);
  });
});
