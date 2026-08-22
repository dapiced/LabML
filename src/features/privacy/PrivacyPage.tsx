import { Boxes, Cpu, HardDrive, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { auditRequests, type NetworkAudit } from '@/features/privacy/audit';
import { DevtoolsFigure } from '@/features/privacy/DevtoolsFigure';
import { CONNECT_SRC, CSP_HEADER, PERMISSIONS_POLICY } from '@/features/privacy/policy';

const MECHANISMS = [
  { key: 'csp', Icon: ShieldCheck },
  { key: 'assets', Icon: Boxes },
  { key: 'workers', Icon: Cpu },
  { key: 'storage', Icon: HardDrive },
] as const;

const STEPS = ['offline', 'network', 'headers', 'storage'] as const;
const TRAFFIC = ['app', 'demo', 'vision', 'llm'] as const;

/**
 * V28 — the audit the reader can run without leaving the page. It counts what
 * the browser recorded, and says plainly what it cannot see, because a proof
 * that oversells itself is worth less than no proof at all.
 */
function LiveAudit() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const [audit, setAudit] = useState<NetworkAudit | null>(null);

  const run = () => {
    const names = performance.getEntriesByType('resource').map((entry) => entry.name);
    setAudit(auditRequests([window.location.href, ...names], window.location.origin));
  };

  return (
    <Card className="flex flex-col gap-3" data-testid="privacy-audit">
      <Eyebrow>{t('privacy.live.title')}</Eyebrow>
      <p className="max-w-3xl text-sm text-muted">{t('privacy.live.body')}</p>
      <div>
        <button
          type="button"
          onClick={run}
          data-testid="privacy-audit-run"
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-strong"
        >
          {t('privacy.live.button')}
        </button>
      </div>
      {audit && (
        <div className="flex flex-col gap-2" data-testid="privacy-audit-result" aria-live="polite">
          <p
            className={
              audit.thirdParty.length === 0
                ? 'font-medium text-[var(--ok)]'
                : 'font-medium text-[var(--copper)]'
            }
          >
            {audit.thirdParty.length === 0
              ? t('privacy.live.clean', {
                  total: audit.total.toLocaleString(lang),
                  origin: window.location.origin,
                })
              : t('privacy.live.dirty', {
                  count: audit.thirdParty.reduce((n, o) => n + o.count, 0),
                  origins: audit.thirdParty.map((o) => o.origin).join(', '),
                })}
          </p>
          <dl className="grid gap-2 font-mono text-xs text-muted sm:grid-cols-3">
            <div>
              <dt className="inline">{t('privacy.live.sameOrigin')} </dt>
              <dd className="inline text-ink">{audit.sameOrigin}</dd>
            </div>
            <div>
              <dt className="inline">{t('privacy.live.thirdParty')} </dt>
              <dd className="inline text-ink">
                {audit.thirdParty.reduce((n, o) => n + o.count, 0)}
              </dd>
            </div>
            <div>
              <dt className="inline">{t('privacy.live.inline')} </dt>
              <dd className="inline text-ink">{audit.inline}</dd>
            </div>
          </dl>
        </div>
      )}
      <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('privacy.live.caveat')}</p>
    </Card>
  );
}

export function PrivacyPage() {
  const { t } = useTranslation();
  const figureRows = t('privacy.figure.rows', { returnObjects: true }) as string[];
  const figureTabs = t('privacy.figure.tabs', { returnObjects: true }) as string[];
  const figureColumns = t('privacy.figure.columns', { returnObjects: true }) as string[];

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-20">
        <Eyebrow>{t('privacy.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('privacy.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('privacy.lede')}</p>
      </section>

      <section className="pb-12">
        <Card className="border-accent/40 bg-accent-soft/40">
          <Eyebrow>{t('privacy.promise.title')}</Eyebrow>
          <p className="mt-3 max-w-3xl leading-relaxed">{t('privacy.promise.body')}</p>
        </Card>
      </section>

      <section className="pb-12">
        <h2 className="mb-4 font-display text-2xl font-semibold">{t('privacy.how.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {MECHANISMS.map(({ key, Icon }) => (
            <Card key={key} className="flex flex-col gap-2">
              <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold">
                {t(`privacy.how.${key}.title`)}
              </h3>
              <p className="text-sm leading-relaxed text-muted">{t(`privacy.how.${key}.body`)}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="pb-12">
        <Card className="flex flex-col gap-3">
          <Eyebrow>{t('privacy.header.title')}</Eyebrow>
          <p className="max-w-3xl text-sm text-muted">{t('privacy.header.body')}</p>
          <pre className="overflow-x-auto rounded-xl bg-surface-2 p-4 font-mono text-[0.7rem] leading-relaxed break-words whitespace-pre-wrap text-ink">
            {CSP_HEADER}
          </pre>
          <p className="text-sm text-muted">
            {t('privacy.header.note')}{' '}
            <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent-strong">
              {CONNECT_SRC}
            </code>
          </p>
          <p className="text-sm text-muted">
            {t('privacy.header.camera')}{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
              {PERMISSIONS_POLICY}
            </code>
          </p>
        </Card>
      </section>

      <section className="pb-12">
        <h2 className="mb-2 font-display text-2xl font-semibold">{t('privacy.verify.title')}</h2>
        <p className="mb-5 max-w-3xl text-muted">{t('privacy.verify.lede')}</p>
        <ol className="flex flex-col gap-4">
          {STEPS.map((key, index) => (
            <li key={key}>
              <Card className="flex gap-4">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-sm font-semibold text-accent-strong"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-display text-lg font-semibold">
                    {t(`privacy.verify.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted">
                    {t(`privacy.verify.${key}.body`)}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="pb-12">
        <Card className="flex flex-col gap-3">
          <Eyebrow>{t('privacy.figure.title')}</Eyebrow>
          <DevtoolsFigure
            tabs={figureTabs}
            activeTab={figureTabs[2]}
            preserveLog={t('privacy.figure.preserveLog')}
            offline={t('privacy.figure.offline')}
            columns={figureColumns}
            rows={figureRows}
            emptyNote={t('privacy.figure.emptyNote')}
            calloutOffline={t('privacy.figure.calloutOffline')}
            calloutEmpty={t('privacy.figure.calloutEmpty')}
            ariaLabel={t('privacy.figure.alt')}
          />
          <p className="text-xs text-muted">{t('privacy.figure.caption')}</p>
        </Card>
      </section>

      <section className="pb-12">
        <LiveAudit />
      </section>

      <section className="pb-20">
        <Card className="flex flex-col gap-3 bg-surface-2">
          <Eyebrow>{t('privacy.traffic.title')}</Eyebrow>
          <p className="max-w-3xl text-sm text-muted">{t('privacy.traffic.body')}</p>
          <ul className="ml-5 list-disc space-y-1.5 text-sm text-muted">
            {TRAFFIC.map((key) => (
              <li key={key}>{t(`privacy.traffic.${key}`)}</li>
            ))}
          </ul>
          <p className="max-w-3xl text-sm font-medium text-ink">{t('privacy.traffic.never')}</p>
        </Card>
      </section>
    </div>
  );
}

export default PrivacyPage;
