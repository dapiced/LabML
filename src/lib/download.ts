/**
 * V48 — one way to hand the visitor a file built in the tab.
 *
 * Five components each carried their own copy of this, and every copy revoked
 * the object URL in the same tick as `click()`. Chromium starts the download
 * synchronously and does not mind; other engines resolve the URL a little
 * later and can find it already revoked, which cancels the download without a
 * word. The URL is now released after the click has been handled.
 */
export const REVOKE_DELAY_MS = 1_000;

export function downloadFile(name: string, content: BlobPart, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
