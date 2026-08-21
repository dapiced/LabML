import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

/**
 * Local-only dataset persistence: the CSV is compressed and lives in
 * IndexedDB, never in share links and never on any server. The budget is
 * explicit — a file that does not fit is refused BY NAME, never trimmed
 * or dropped silently.
 */
export const DATASET_QUOTA_BYTES = 50 * 1024 * 1024;

/** A dataset kept in the browser, linked to the runs trained on it. */
export interface StoredDataset {
  id?: number;
  name: string;
  rowCount: number;
  columnCount: number;
  /** Size of the plain CSV text, for honest display. */
  originalBytes: number;
  /** What the copy actually costs against the quota. */
  storedBytes: number;
  savedAt: number;
  /** lz-string UTF-16 compressed CSV. */
  csv: string;
}

export interface PackedDataset {
  csv: string;
  originalBytes: number;
  storedBytes: number;
}

/** UTF-16 stores 2 bytes per char in IndexedDB. */
function utf16Bytes(text: string): number {
  return text.length * 2;
}

export function packDataset(csvText: string): PackedDataset {
  const compressed = compressToUTF16(csvText);
  return {
    csv: compressed,
    originalBytes: utf16Bytes(csvText),
    storedBytes: utf16Bytes(compressed),
  };
}

/** null = corrupted entry (never silently an empty dataset). */
export function unpackDataset(stored: string): string | null {
  const text = decompressFromUTF16(stored);
  return text ? text : null;
}

/** Whether a new copy fits the quota next to what is already stored. */
export function fitsQuota(existingStoredBytes: number, newStoredBytes: number): boolean {
  return existingStoredBytes + newStoredBytes <= DATASET_QUOTA_BYTES;
}

/** Honest human size — KB below half a MB so small files never show "0 MB". */
export function formatSize(bytes: number, lang: string, kbUnit: string, mbUnit: string): string {
  if (bytes < 512 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(lang)} ${kbUnit}`;
  }
  const mb = (bytes / (1024 * 1024)).toLocaleString(lang, { maximumFractionDigits: 1 });
  return `${mb} ${mbUnit}`;
}
