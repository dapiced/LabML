import { ArrowLeft, FileUp, Loader2, RotateCcw, SendHorizonal, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { EnginePicker } from '@/features/ai/chat/EnginePicker';
import { useChatStore, type ChatMessage } from '@/features/ai/chat/chat-store';
import type { GroupRow, QueryResult } from '@/features/ai/chat/engine';
import { cn } from '@/lib/utils';

const DEMO_DATASETS = [
  { file: 'titanic.csv', tag: 'titanic' },
  { file: 'cafe-sales.csv', tag: 'cafe' },
  { file: 'mpg.csv', tag: 'mpg' },
] as const;

function formatNumber(value: number, lang: string): string {
  return value.toLocaleString(lang, { maximumFractionDigits: 3 });
}

function BarTable({ rows, lang }: { rows: GroupRow[]; lang: string }) {
  const { t } = useTranslation();
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1e-12);
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {rows.map(({ key, value, count, used }) => (
        <li key={key} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate font-mono text-[0.68rem]">{key}</span>
          <div className="h-2 max-w-56 flex-1 rounded-r-[2px] bg-surface-2" aria-hidden="true">
            <div
              className="h-full rounded-r-[2px] bg-accent/75"
              style={{ width: `${(Math.abs(value) / max) * 100}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[0.68rem] tabular-nums">
            {formatNumber(value, lang)}
          </span>
          {/* V27.2: a mean over a column with holes is not a mean over every
              row of the group — when they differ, both numbers are shown. */}
          <span
            className="shrink-0 font-mono text-[0.6rem] text-muted"
            title={
              used === undefined
                ? undefined
                : t('ai.chat.answers.usedOf', {
                    used: used.toLocaleString(lang),
                    rows: count.toLocaleString(lang),
                  })
            }
          >
            (n={used === undefined ? count : `${used}/${count}`})
          </span>
        </li>
      ))}
    </ul>
  );
}

function correlationStrength(value: number): string {
  if (value >= 0.7) return 'strongPos';
  if (value >= 0.3) return 'modPos';
  if (value > -0.3) return 'weak';
  if (value > -0.7) return 'modNeg';
  return 'strongNeg';
}

/** Renders one structured answer as a localized sentence + optional bars. */
function Answer({ result }: { result: QueryResult }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const { intent } = result;
  const filter =
    'filter' in intent && intent.filter
      ? t('ai.chat.answers.filterNote', {
          rows: result.rowsConsidered.toLocaleString(lang),
          filter: `${intent.filter.column} ${intent.filter.op} ${intent.filter.value}`,
        })
      : null;

  if (intent.kind === 'shape' && result.shape) {
    return (
      <p>
        {t('ai.chat.answers.shape', {
          rows: result.shape.rows.toLocaleString(lang),
          columns: result.shape.columns,
        })}
      </p>
    );
  }

  if (intent.kind === 'missing' && result.missing) {
    if (result.missing.length === 0) return <p>{t('ai.chat.answers.noMissing')}</p>;
    return (
      <div>
        <p>{t('ai.chat.answers.missing')}</p>
        <BarTable
          rows={result.missing.map(({ column, count }) => ({ key: column, value: count, count }))}
          lang={lang}
        />
      </div>
    );
  }

  if (intent.kind === 'correlation' && result.correlation !== undefined) {
    return (
      <p>
        {t('ai.chat.answers.correlation', {
          a: intent.a,
          b: intent.b,
          value: formatNumber(result.correlation, lang),
          rows: result.rowsConsidered.toLocaleString(lang),
          strength: t(`ai.chat.answers.strength.${correlationStrength(result.correlation)}`),
        })}
      </p>
    );
  }

  if (intent.kind === 'distribution' && result.distribution) {
    return (
      <div>
        <p>{t('ai.chat.answers.distribution', { column: intent.column })}</p>
        <BarTable
          rows={result.distribution.map(({ label, count }) => ({
            key: label,
            value: count,
            count,
          }))}
          lang={lang}
        />
      </div>
    );
  }

  if (intent.kind === 'count') {
    const clause =
      intent.filter &&
      t('ai.chat.answers.countFilter', {
        filter: `${intent.filter.column} ${intent.filter.op} ${intent.filter.value}`,
      });
    return (
      <p data-testid="chat-scalar">
        {t('ai.chat.answers.count', { count: result.scalar ?? 0 })}
        {clause ? ` ${clause}` : ''}.
      </p>
    );
  }

  if (intent.kind === 'topk' && result.groups) {
    const label =
      intent.op === 'count' || !intent.column
        ? t('ai.chat.answers.topk', { k: result.groups.length, group: intent.groupBy })
        : t('ai.chat.answers.topkMetric', {
            k: result.groups.length,
            group: intent.groupBy,
            op: t(`ai.chat.ops.${intent.op}`),
            column: intent.column,
          });
    return (
      <div>
        <p>
          {label}
          {filter ? ` — ${filter}` : ''}
        </p>
        <BarTable rows={result.groups} lang={lang} />
      </div>
    );
  }

  if (intent.kind === 'aggregate') {
    if (result.groups) {
      return (
        <div>
          <p>
            {t('ai.chat.answers.grouped', {
              op: t(`ai.chat.ops.${intent.op}`),
              column: intent.column,
              group: intent.groupBy,
            })}
            {filter ? ` — ${filter}` : ''}
          </p>
          <BarTable rows={result.groups} lang={lang} />
        </div>
      );
    }
    return (
      <p data-testid="chat-scalar">
        {t(
          // V27.2: `rowsConsidered` counts rows, not values. When the column
          // has holes, saying "over 891 rows" of a mean built from 714 is a
          // small lie — so the sentence names both numbers instead.
          result.valuesUsed === undefined
            ? 'ai.chat.answers.scalar'
            : 'ai.chat.answers.scalarPartial',
          {
            op: t(`ai.chat.ops.${intent.op}`),
            column: intent.column,
            value: result.scalar === undefined ? '—' : formatNumber(result.scalar, lang),
            rows: result.rowsConsidered.toLocaleString(lang),
            used: (result.valuesUsed ?? result.rowsConsidered).toLocaleString(lang),
          },
        )}
        {filter ? ` — ${filter}` : ''}
      </p>
    );
  }

  return null;
}

function Bubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  return (
    <li
      className={cn(
        'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm',
        isUser
          ? 'self-end rounded-br-sm bg-accent-soft text-accent-strong'
          : 'self-start rounded-bl-sm border border-line bg-surface',
      )}
      data-testid={isUser ? 'chat-user' : 'chat-assistant'}
    >
      {isUser && message.text}
      {message.unknown && <p className="text-muted">{t('ai.chat.unknown')}</p>}
      {message.result && <Answer result={message.result} />}
      {!isUser && message.engine && (
        <p className="mt-2 font-mono text-[0.6rem] tracking-wider text-muted uppercase">
          {t(`ai.chat.engine.by.${message.engine}`)}
        </p>
      )}
    </li>
  );
}

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const status = useChatStore((s) => s.status);
  const meta = useChatStore((s) => s.meta);
  const columns = useChatStore((s) => s.columns);
  const messages = useChatStore((s) => s.messages);
  const thinking = useChatStore((s) => s.thinking);
  const loadFile = useChatStore((s) => s.loadFile);
  const loadDemo = useChatStore((s) => s.loadDemo);
  const ask = useChatStore((s) => s.ask);
  const reset = useChatStore((s) => s.reset);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const lang = i18n.resolvedLanguage ?? 'en';

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, thinking]);

  const numeric = columns.filter((c) => c.isNumeric && !/(^|_)id$/i.test(c.name));
  const categorical = columns.filter((c) => !c.isNumeric && c.values.length > 0);
  const suggestions: string[] = [];
  if (numeric[0] && categorical[0]) {
    suggestions.push(t('ai.chat.suggest.mean', { num: numeric[0].name, cat: categorical[0].name }));
    suggestions.push(
      t('ai.chat.suggest.count', {
        cat: categorical[0].name,
        value: categorical[0].values[0],
      }),
    );
    suggestions.push(t('ai.chat.suggest.top', { cat: categorical[0].name, num: numeric[0].name }));
  }
  if (numeric.length >= 2) {
    suggestions.push(t('ai.chat.suggest.corr', { num: numeric[0].name, num2: numeric[1].name }));
  }
  suggestions.push(t('ai.chat.suggest.missing'));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    ask(draft, lang);
    setDraft('');
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto max-w-4xl px-4">
      <section className="py-12 sm:py-16">
        <Eyebrow>{t('ai.chat.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('ai.chat.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('ai.chat.lede')}</p>
      </section>

      {status !== 'ready' && (
        <section className="flex flex-col gap-6 pb-12">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) loadFile(file);
            }}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line bg-surface p-10 text-center transition-colors hover:border-accent"
          >
            <FileUp className="h-8 w-8 text-accent" aria-hidden="true" />
            <span className="font-display text-lg font-semibold">{t('ai.chat.drop.title')}</span>
            <span className="max-w-md text-sm text-muted">{t('ai.chat.drop.hint')}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv"
            className="sr-only"
            aria-label={t('ai.chat.drop.title')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) loadFile(file);
              e.target.value = '';
            }}
          />
          <div className="flex flex-col gap-2">
            <Eyebrow>{t('ai.chat.demoLabel')}</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {DEMO_DATASETS.map(({ file, tag }) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => loadDemo(file)}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  <span className="font-mono text-xs">{file}</span>
                  <Badge variant="outline">{t(`ai.chat.demo.${tag}`)}</Badge>
                </button>
              ))}
            </div>
          </div>
          {status === 'parsing' && (
            <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              {t('ai.chat.parsing')}
            </p>
          )}
          {status === 'error' && (
            <Card className="border-copper text-sm">{t('ai.chat.error')}</Card>
          )}
        </section>
      )}

      {status === 'ready' && meta && (
        <section className="flex flex-col gap-4 pb-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              <span className="font-mono">{meta.name}</span> ·{' '}
              {t('ai.chat.loaded', {
                rows: meta.rowCount.toLocaleString(lang),
                columns: meta.columnCount,
              })}
            </p>
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('ai.chat.restart')}
            </Button>
          </div>

          <EnginePicker />

          <Card className="flex min-h-64 flex-col gap-3">
            <ol className="flex flex-1 flex-col gap-3" aria-live="polite">
              {messages.length === 0 && !thinking && (
                <li className="self-start rounded-2xl rounded-bl-sm border border-line bg-surface px-3.5 py-2.5 text-sm text-muted">
                  {t('ai.chat.welcome')}
                </li>
              )}
              {messages.map((message, index) => (
                <Bubble key={index} message={message} />
              ))}
              {thinking && (
                <li className="flex items-center gap-2 self-start text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                  {t('ai.chat.thinking')}
                </li>
              )}
            </ol>
            <div ref={endRef} />
          </Card>

          <div className="flex flex-wrap gap-2" aria-label={t('ai.chat.suggestLabel')}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion, lang)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs transition-colors hover:border-accent hover:bg-accent-soft"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('ai.chat.placeholder')}
              aria-label={t('ai.chat.inputLabel')}
              className="h-11 flex-1 rounded-full border border-line bg-surface px-4 text-sm"
            />
            <Button type="submit" disabled={!draft.trim() || thinking}>
              <SendHorizonal className="h-4 w-4" aria-hidden="true" />
              {t('ai.chat.send')}
            </Button>
          </form>
        </section>
      )}

      <section className="pb-12">
        <Card className="flex flex-col gap-2 bg-surface-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            <Eyebrow>{t('ai.chat.honesty.title')}</Eyebrow>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            {t('ai.chat.honesty.body')}
          </p>
          <p className="max-w-3xl text-sm leading-relaxed font-medium text-accent-strong">
            {t('ai.chat.honesty.coming')}
          </p>
        </Card>
      </section>

      <section className="pb-20">
        <Link to="/ai" className={cn(buttonVariants({ variant: 'outline' }))}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('ai.chat.backToAi')}
        </Link>
      </section>
    </div>
  );
}

export default ChatPage;
