/**
 * V28 — the live network audit behind /privacy.
 *
 * The page makes a strong claim: nothing you load leaves the browser. A claim
 * is worth what it can be checked against, so the page counts the requests the
 * browser itself recorded and groups them by origin. Pure function here, so
 * the counting is unit-tested rather than trusted.
 *
 * Its honest limit is stated on the page: this reads the page's own resource
 * timeline. Requests made inside a Web Worker have their own timeline, and a
 * request the CSP blocked never lands here at all — which is exactly why the
 * DevTools protocol next to it stays the reference proof.
 */
export interface OriginCount {
  origin: string;
  count: number;
}

export interface NetworkAudit {
  /** Requests that actually crossed the network layer (http/https only). */
  total: number;
  sameOrigin: number;
  /** Anything not served by the page's own origin, worst case first. */
  thirdParty: OriginCount[];
  /** `data:` / `blob:` URLs — resolved inside the tab, never a request. */
  inline: number;
}

export function auditRequests(urls: readonly string[], pageOrigin: string): NetworkAudit {
  let sameOrigin = 0;
  let inline = 0;
  const third = new Map<string, number>();

  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url, pageOrigin);
    } catch {
      continue; // Unparseable entries are not evidence of anything.
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      inline += 1;
      continue;
    }
    if (parsed.origin === pageOrigin) sameOrigin += 1;
    else third.set(parsed.origin, (third.get(parsed.origin) ?? 0) + 1);
  }

  const thirdParty = [...third.entries()]
    .map(([origin, count]) => ({ origin, count }))
    .sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));

  return {
    total: sameOrigin + thirdParty.reduce((n, o) => n + o.count, 0),
    sameOrigin,
    thirdParty,
    inline,
  };
}
