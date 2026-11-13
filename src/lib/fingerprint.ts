/**
 * FNV-1a, 32 bits, as eight hexadecimal digits: enough to tell two short
 * texts apart, and it carries nothing of what it was computed from.
 *
 * V60 used it to name a run's configuration without naming its columns; V69
 * uses it to name the file a SQL query produces without quoting the query.
 */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
