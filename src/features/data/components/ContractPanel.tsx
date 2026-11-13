import { FileCheck2, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useDataStore } from '@/features/data/data-store';
import type { Clause, ClauseOutcome } from '@/features/data/quality/contract';
import { cn } from '@/lib/utils';

const FAMILIES = ['schema', 'missing', 'rule', 'distribution'] as const;

/**
 * V63: freeze what the loaded file looks like, or read it against a contract
 * drawn earlier. The clauses that did not hold are spelled out, broken ones
 * first; the ones that held are counted.
 */
export function ContractPanel() {
  const { t, i18n } = useTranslation();
  const status = useDataStore((s) => s.status);
  const meta = useDataStore((s) => s.meta);
  const contractStatus = useDataStore((s) => s.contractStatus);
  const check = useDataStore((s) => s.contractCheck);
  const info = useDataStore((s) => s.contractInfo);
  const exportContract = useDataStore((s) => s.exportContract);
  const checkContract = useDataStore((s) => s.checkContract);
  const inputRef = useRef<HTMLInputElement>(null);
  if (status !== 'ready' || !meta) return null;

  const lang = i18n.resolvedLanguage;
  const num = (value: number, digits: number) =>
    value.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const pct = (value: number) => num(value * 100, 1);

  const sentence = (clause: Clause): string => {
    if (clause.family === 'schema') {
      return clause.kind === 'present'
        ? t('data.contract.clause.absent', { column: clause.column })
        : t('data.contract.clause.reading', {
            column: clause.column,
            expected: t(`data.contract.reading.${clause.expected}`),
            found: t(`data.contract.reading.${clause.found}`),
          });
    }
    if (clause.family === 'missing') {
      return t('data.contract.clause.missing', {
        column: clause.column,
        found: pct(clause.found),
        reference: pct(clause.reference),
        lo: pct(clause.lo),
      });
    }
    if (clause.family === 'distribution') {
      return t('data.contract.clause.distribution', {
        column: clause.column,
        psi: num(clause.psi, 2),
        ceiling: num(clause.ceiling ?? 0, 2),
      });
    }
    const named = {
      rule: t(`data.contract.rule.${clause.rule}`),
      columns: clause.columns.join(', '),
    };
    if (clause.unreadable) return t('data.contract.clause.ruleUnreadable', named);
    const broken = t('data.contract.clause.ruleBroken', {
      ...named,
      failures: clause.failures.toLocaleString(lang),
      tested: clause.tested.toLocaleString(lang),
      refFailures: clause.referenceFailures.toLocaleString(lang),
      refTested: clause.referenceTested.toLocaleString(lang),
    });
    if (clause.rows.length === 0) return broken;
    // Rows as a spreadsheet numbers them: the header is row 1.
    return `${broken} ${t('data.contract.clause.ruleExamples', {
      rows: clause.rows.map((row) => row + 2).join(', '),
      examples: clause.examples.join(' · '),
    })}`;
  };

  const tone = (outcome: ClauseOutcome) =>
    cn(
      outcome === 'kept' && 'text-ok',
      outcome === 'warning' && 'text-copper',
      outcome === 'broken' && 'font-semibold text-copper',
    );
  const open = check ? check.clauses.filter((clause) => clause.outcome !== 'kept') : [];

  return (
    <section
      data-testid="contract"
      className="mb-12 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('data.contract.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('data.contract.hint', { name: meta.name })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={exportContract} data-testid="contract-export">
          {t('data.contract.export')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={contractStatus === 'checking'}
          data-testid="contract-browse"
        >
          {t('data.contract.check')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          data-testid="contract-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) checkContract(file);
            event.target.value = '';
          }}
        />
        {contractStatus === 'checking' && (
          <span className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
            {t('data.contract.checking')}
          </span>
        )}
      </div>

      {contractStatus === 'refused' && (
        <p className="max-w-3xl text-sm text-copper" data-testid="contract-refused">
          {t('data.contract.refused', { name: info?.name ?? '' })}
        </p>
      )}

      {contractStatus === 'done' && check && info && (
        <div
          className="flex flex-col gap-4"
          data-testid="contract-result"
          data-verdict={check.verdict}
        >
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={tone(check.verdict)} data-testid="contract-verdict">
              {t(`data.contract.verdict.${check.verdict}`)}
            </Badge>
            {t('data.contract.summary', {
              file: meta.name,
              source: info.source || info.name,
              date: info.createdAt ? new Date(info.createdAt).toLocaleDateString(lang) : '?',
              broken: check.counts.broken,
              warning: check.counts.warning,
              kept: check.counts.kept,
              rows: check.rows.toLocaleString(lang),
            })}
          </p>

          {FAMILIES.map((family) => {
            const clauses = open
              .filter((clause) => clause.family === family)
              .sort((a, b) => Number(b.outcome === 'broken') - Number(a.outcome === 'broken'));
            if (clauses.length === 0) return null;
            return (
              <div key={family} className="flex flex-col gap-1" data-testid={`contract-${family}`}>
                <span className="text-xs font-semibold">{t(`data.contract.family.${family}`)}</span>
                <ul className="flex flex-col gap-1 text-xs">
                  {clauses.map((clause, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-2">
                      <Badge variant="outline" className={tone(clause.outcome)}>
                        {t(`data.contract.outcome.${clause.outcome}`)}
                      </Badge>
                      <span className="max-w-3xl">{sentence(clause)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <p className="text-xs text-muted" data-testid="contract-kept">
            {t('data.contract.keptCount', { count: check.counts.kept })}
          </p>
          {check.extraColumns.length > 0 && (
            <p className="text-xs text-muted" data-testid="contract-extra">
              {t('data.contract.extra', { list: check.extraColumns.join(', ') })}
            </p>
          )}
        </div>
      )}

      <p className="max-w-3xl text-xs text-muted">{t('data.contract.note')}</p>
    </section>
  );
}
