import { AlertTriangle, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useLabStore } from '@/features/ml/lab-store';

export function TargetPicker() {
  const { t } = useTranslation();
  const profiles = useLabStore((s) => s.profiles);
  const target = useLabStore((s) => s.target);
  const task = useLabStore((s) => s.task);
  const unsupported = useLabStore((s) => s.targetUnsupported);
  const leaks = useLabStore((s) => s.leaks);
  const setTarget = useLabStore((s) => s.setTarget);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="target-select"
          className="flex items-center gap-2 text-sm font-medium whitespace-nowrap"
        >
          <Target className="h-4 w-4 text-accent" aria-hidden="true" />
          {t('ml.lab.targetLabel')}
        </label>
        <select
          id="target-select"
          value={target ?? ''}
          onChange={(e) => setTarget(e.target.value || null)}
          className="h-9 min-w-48 rounded-full border border-line bg-surface px-3 font-mono text-sm"
        >
          <option value="">{t('ml.lab.targetPlaceholder')}</option>
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        {task && (
          <Badge data-testid="task-badge">
            {t(`ml.lab.task.${task.type}`, { count: task.classes?.length ?? 0 })}
          </Badge>
        )}
      </div>

      {unsupported && (
        <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
          {t(`ml.lab.unsupported.${unsupported}`)}
        </p>
      )}

      {leaks.length > 0 && (
        <p
          data-testid="leak-alert"
          className="flex items-start gap-2 rounded-xl bg-copper-soft px-3 py-2 text-sm text-copper"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('ml.lab.leakAlert', {
            columns: leaks.map((l) => l.column).join(', '),
          })}
        </p>
      )}
    </div>
  );
}
