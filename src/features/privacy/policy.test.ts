import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONNECT_SRC, CSP_HEADER, PERMISSIONS_POLICY } from '@/features/privacy/policy';

/** The header block Cloudflare Pages serves for every path. */
function servedHeader(name: string): string {
  const line = readFileSync('public/_headers', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  if (!line) throw new Error(`header-not-served:${name}`);
  return line.slice(name.length + 1).trim();
}

describe('the policy quoted on /privacy is the policy we serve', () => {
  it('matches the Content-Security-Policy in public/_headers, character for character', () => {
    expect(CSP_HEADER).toBe(servedHeader('Content-Security-Policy'));
  });

  it('still forbids every outbound connection to another origin', () => {
    // The one directive the whole page rests on. If it is ever widened, this
    // fails before the claim reaches a reader.
    expect(CSP_HEADER).toContain(CONNECT_SRC);
  });

  it('matches the Permissions-Policy in public/_headers', () => {
    expect(PERMISSIONS_POLICY).toBe(servedHeader('Permissions-Policy'));
  });
});
