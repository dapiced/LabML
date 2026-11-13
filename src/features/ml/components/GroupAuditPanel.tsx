import { Scale3d } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { useLabStore } from '@/features/ml/lab-store';
import {
  formatGap,
  formatRate,
  groupAuditLines,
  isGroupAuditRefusal,
  MAX_GROUPS,
} from '@/features/ml/train/group-audit';

/**
 * V59: the group audit of the inspected model. The lab does not decide which
 * column is sensitive: the panel waits for the user to name one, then shows
 * each group's rates with their intervals and says of every gap whether it can
 * be told from the draw. It shows a gap; it issues no verdict and fixes nothing.
 */
export function GroupAuditPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const done = useLabStore((s) => s.trainStatus === 'done');
  const insights = useLabStore((s) => s.insights);
  const profiles = useLabStore((s) => s.profiles);
  const target = useLabStore((s) => s.target);
  const column = useLabStore((s) => s.groupAuditColumn);
  const pending = useLabStore((s) => s.groupAuditPending);
  const outcome = useLabStore((s) => s.groupAudit);
  const auditGroups = useLabStore((s) => s.auditGroups);
  if (!done || !insights) return null;

  // Columns that form groups: categorical or boolean, the target aside. A
  // column kept OUT of the features is offered too, on purpose: a model can
  // treat groups differently through other columns that stand in for it.
  const candidates = profiles.filter(
    (profile) =>
      profile.name !== target &&
      (profile.type === 'categorical' || profile.type === 'boolean') &&
      profile.cardinality >= 2,
  );
  if (candidates.length === 0) return null;

  const audit = outcome && !isGroupAuditRefusal(outcome) ? outcome : null;
  const gapOf = (group: string, rate: string) =>
    audit?.gaps.find((gap) => gap.group === group && gap.rate === rate);

  return (
    <section
      data-testid="group-audit-panel"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Scale3d className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.groupAudit.title')}</Eyebrow>
          <Badge variant="outline">{t(`ml.lab.models.${insights.model}`)}</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.groupAudit.hint')}</p>
      </div>

      <label className="flex flex-wrap items-center gap-2 text-sm">
        {t('ml.lab.groupAudit.column')}
        <select
          data-testid="group-audit-column"
          className="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
          value={column ?? ''}
          onChange={(event) => auditGroups(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('ml.lab.groupAudit.pick')}</option>
          {candidates.map((profile) => (
            <option key={profile.name} value={profile.name}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>

      {pending && <p className="text-sm text-muted">{t('ml.lab.groupAudit.pending')}</p>}

      {outcome && isGroupAuditRefusal(outcome) && (
        <p className="max-w-3xl text-sm" data-testid="group-audit-refusal">
          {groupAuditLines(outcome, t, lang)[0]}
        </p>
      )}

      {audit && (
        <>
          <p className="max-w-3xl text-sm" data-testid="group-audit-scope">
            {groupAuditLines(audit, t, lang)
              .slice(0, audit.kind === 'binary' ? 2 : 1)
              .join(' ')}
          </p>
          <ScrollRegion>
            <table
              className="w-full min-w-[40rem] text-left text-sm whitespace-nowrap tabular-nums"
              data-testid="group-audit-table"
            >
              <thead>
                <tr className="border-b border-line font-mono text-[0.68rem] tracking-wider text-muted uppercase">
                  <th className="py-1.5 pr-3 font-medium">{t('ml.lab.groupAudit.colGroup')}</th>
                  <th className="py-1.5 pr-3 font-medium">{t('ml.lab.groupAudit.colRows')}</th>
                  {audit.rates.map((rate) => (
                    <th key={rate} className="py-1.5 pr-3 font-medium">
                      {t(`ml.lab.groupAudit.rate.${rate}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit.groups.map((group) => (
                  <tr key={group.value} className="border-b border-line align-top last:border-b-0">
                    <td className="py-1.5 pr-3 font-medium">
                      {group.value}
                      {group.value === audit.reference && (
                        <span className="ml-1.5 font-mono text-[0.65rem] font-normal text-muted">
                          {t('ml.lab.groupAudit.reference')}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{group.rows.toLocaleString(lang)}</td>
                    {audit.rates.map((rate) => {
                      const estimate = group.rates[rate];
                      const gap = gapOf(group.value, rate);
                      return (
                        <td key={rate} className="py-1.5 pr-3">
                          {estimate ? (
                            <>
                              {formatRate(rate, estimate.value, lang)}
                              <span className="block font-mono text-[0.65rem] text-muted">
                                {formatRate(rate, estimate.lo, lang)} →{' '}
                                {formatRate(rate, estimate.hi, lang)}
                              </span>
                              {gap && (
                                <span
                                  className={`block font-mono text-[0.65rem] ${gap.real ? 'font-semibold text-copper' : 'text-muted'}`}
                                >
                                  {formatGap(rate, gap.delta, lang)}{' '}
                                  {t(
                                    gap.real ? 'ml.lab.groupAudit.real' : 'ml.lab.groupAudit.noise',
                                  )}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted">{t('ml.lab.groupAudit.tooFew')}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <div className="flex max-w-3xl flex-col gap-1 text-sm" data-testid="group-audit-findings">
            {groupAuditLines(audit, t, lang)
              .slice((audit.kind === 'binary' ? 2 : 1) + audit.groups.length)
              .map((line, index) => (
                <p key={index} className={index === 0 ? 'font-medium' : 'text-muted'}>
                  {line}
                </p>
              ))}
          </div>
        </>
      )}

      <p className="max-w-3xl text-xs text-muted">
        {t('ml.lab.groupAudit.note', { max: MAX_GROUPS })}
      </p>
    </section>
  );
}
