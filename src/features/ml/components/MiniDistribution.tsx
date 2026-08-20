import type { ColumnProfile } from '@/features/ml/data/types';

function formatShort(value: number): string {
  if (Math.abs(value) >= 1000)
    return Intl.NumberFormat('en', { notation: 'compact' }).format(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Tiny single-series distribution: histogram bars for numeric columns,
 * top-category bars otherwise. One hue (accent), baseline-anchored thin
 * marks with 2px gaps, native tooltips per mark; labels use text tokens.
 */
export function MiniDistribution({ profile }: { profile: ColumnProfile }) {
  if (profile.type === 'numeric' && profile.numeric) {
    const { counts, min, max } = profile.numeric.histogram;
    const peak = Math.max(...counts, 1);
    const width = counts.length > 0 ? (max - min) / counts.length : 0;
    return (
      <div className="flex h-10 items-end gap-[2px]" role="img" aria-hidden="true">
        {counts.map((count, i) => (
          <div
            key={i}
            className="min-h-[2px] flex-1 rounded-t-[2px] bg-accent/75"
            style={{ height: `${(count / peak) * 100}%` }}
            title={`${formatShort(min + i * width)} – ${formatShort(min + (i + 1) * width)} : ${count}`}
          />
        ))}
      </div>
    );
  }

  const top = profile.topValues?.slice(0, 3) ?? [];
  if (top.length === 0) return null;
  const peak = Math.max(...top.map((t) => t.count), 1);
  return (
    <div className="flex flex-col gap-1">
      {top.map(({ value, count }) => (
        <div key={value} className="flex items-center gap-2" title={`${value} : ${count}`}>
          <span className="w-16 shrink-0 truncate font-mono text-[0.65rem] text-muted">
            {value}
          </span>
          <div className="h-2 flex-1 rounded-r-[2px] bg-surface-2">
            <div
              className="h-full rounded-r-[2px] bg-accent/75"
              style={{ width: `${(count / peak) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-[0.65rem] text-muted tabular-nums">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}
