/** Deterministic PRNG (mulberry32) so every run with the same seed is identical. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle driven by the provided PRNG. */
export function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * V25: a seeded ordering of positions 0..count-1 whose every prefix is a fair
 * announced sample. With labels, each position is placed at its quantile
 * inside its own (seeded-shuffled) label group, so a prefix of size K holds
 * ~K x share rows of every label — and a smaller prefix is always a subset of
 * a larger one, which keeps per-family training sets nested and comparable.
 */
export function nestedSampleOrder(
  count: number,
  labels: (string | null)[] | null,
  seed: number,
): number[] {
  const rng = mulberry32(seed);
  if (!labels) {
    return shuffleInPlace(
      Array.from({ length: count }, (_, i) => i),
      rng,
    );
  }
  const groups = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const label = labels[i] ?? '';
    const group = groups.get(label);
    if (group) group.push(i);
    else groups.set(label, [i]);
  }
  const scored: { position: number; quantile: number }[] = [];
  for (const key of [...groups.keys()].sort()) {
    const group = shuffleInPlace(groups.get(key)!, rng);
    group.forEach((position, rank) => {
      scored.push({ position, quantile: (rank + 0.5) / group.length });
    });
  }
  scored.sort((a, b) => a.quantile - b.quantile || a.position - b.position);
  return scored.map((s) => s.position);
}
