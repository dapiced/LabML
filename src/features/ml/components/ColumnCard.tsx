import { Crosshair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { MiniDistribution } from '@/features/ml/components/MiniDistribution';
import { effectiveExclusion, useLabStore } from '@/features/ml/lab-store';
import type { ColumnProfile } from '@/features/ml/data/types';
import { cn } from '@/lib/utils';

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function ColumnCard({ profile }: { profile: ColumnProfile }) {
  const { t } = useTranslation();
  const target = useLabStore((s) => s.target);
  const baseline = useLabStore((s) => s.baseline);
  const leaks = useLabStore((s) => s.leaks);
  const overrides = useLabStore((s) => s.overrides);
  const setTarget = useLabStore((s) => s.setTarget);
  const toggleColumn = useLabStore((s) => s.toggleColumn);

  const isTarget = target === profile.name;
  const exclusion = effectiveExclusion({ baseline, leaks, overrides, target }, profile.name);
  const missingPercent = profile.rowCount
    ? Math.round((profile.missingCount / profile.rowCount) * 100)
    : 0;

  return (
    <div
      data-testid={`column-card-${profile.name}`}
      className={cn(
        'flex flex-col gap-2.5 rounded-2xl border bg-surface p-4 shadow-sm transition-colors',
        isTarget ? 'border-accent ring-1 ring-accent' : 'border-line',
        exclusion !== null && 'opacity-70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'truncate font-mono text-sm font-medium',
            exclusion !== null && 'line-through',
          )}
          title={profile.name}
        >
          {profile.name}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {isTarget && <Badge>{t('ml.lab.targetBadge')}</Badge>}
          {exclusion !== null && (
            <Badge variant={exclusion === 'leak' ? 'copper' : 'outline'}>
              {t(`ml.lab.reason.${exclusion}`)}
            </Badge>
          )}
          <Badge variant="outline">{t(`ml.lab.type.${profile.type}`)}</Badge>
        </div>
      </div>

      <MiniDistribution profile={profile} />

      <p className="flex flex-wrap gap-x-3 font-mono text-[0.68rem] text-muted">
        <span>{t('ml.lab.distinct', { count: profile.cardinality })}</span>
        {missingPercent > 0 && (
          <span className={cn(missingPercent >= 20 && 'text-copper')}>
            {t('ml.lab.missingShort', { percent: missingPercent })}
          </span>
        )}
        {profile.numeric && (
          <span>
            {formatNumber(profile.numeric.min)} → {formatNumber(profile.numeric.max)} ·{' '}
            {t('ml.lab.median')} {formatNumber(profile.numeric.median)}
          </span>
        )}
      </p>

      <div className="mt-auto flex items-center gap-2">
        {!isTarget && (
          <button
            type="button"
            onClick={() => setTarget(profile.name)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted transition-colors hover:bg-accent-soft hover:text-accent-strong"
          >
            <Crosshair className="h-3 w-3" aria-hidden="true" />
            {t('ml.lab.setTarget')}
          </button>
        )}
        {!isTarget && (
          <button
            type="button"
            onClick={() => toggleColumn(profile.name)}
            className="rounded-full px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {exclusion !== null ? t('ml.lab.include') : t('ml.lab.exclude')}
          </button>
        )}
      </div>
    </div>
  );
}
