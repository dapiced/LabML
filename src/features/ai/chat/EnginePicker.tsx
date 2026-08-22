import { Cpu, Download, Loader2, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/features/ai/chat/chat-store';
import { formatBytes } from '@/features/ai/llm/shards';
import { cn } from '@/lib/utils';

/**
 * V27 — the two interpreters, offered side by side. The deterministic one is
 * the default and never needs downloading; the local language model states
 * its full weight BEFORE anything is fetched, and every refusal is named.
 */
export function EnginePicker() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const llmStatus = useChatStore((s) => s.llmStatus);
  const llmBytes = useChatStore((s) => s.llmBytes);
  const llmProgress = useChatStore((s) => s.llmProgress);
  const llmError = useChatStore((s) => s.llmError);
  const engine = useChatStore((s) => s.engine);
  const probeLlm = useChatStore((s) => s.probeLlm);
  const enableLlm = useChatStore((s) => s.enableLlm);
  const setEngine = useChatStore((s) => s.setEngine);

  useEffect(() => {
    probeLlm();
  }, [probeLlm]);

  // Nothing deployed (local dev without the model): the deterministic engine
  // is simply the only one, and saying nothing is the honest UI.
  if (llmStatus === 'unavailable') return null;

  const percent =
    llmProgress && llmProgress.total > 0
      ? Math.round((llmProgress.loaded / llmProgress.total) * 100)
      : 0;

  return (
    <div
      data-testid="engine-picker"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="h-4 w-4 text-accent" aria-hidden="true" />
        <span className="font-mono text-[0.68rem] tracking-wider uppercase">
          {t('ai.chat.engine.title')}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEngine('deterministic')}
          data-testid="engine-deterministic"
          className={cn(
            'rounded-xl border px-3 py-2 text-left text-sm transition-colors',
            engine === 'deterministic'
              ? 'border-accent bg-surface font-medium'
              : 'border-line bg-surface hover:bg-surface-2',
          )}
        >
          {t('ai.chat.engine.deterministic')}
          <span className="block text-xs text-muted">{t('ai.chat.engine.deterministicNote')}</span>
        </button>

        <button
          type="button"
          onClick={() => setEngine('llm')}
          disabled={llmStatus !== 'ready'}
          data-testid="engine-llm"
          className={cn(
            'rounded-xl border px-3 py-2 text-left text-sm transition-colors',
            engine === 'llm'
              ? 'border-accent bg-surface font-medium'
              : 'border-line bg-surface hover:bg-surface-2',
            llmStatus !== 'ready' && 'cursor-not-allowed opacity-60 hover:bg-surface',
          )}
        >
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            {t('ai.chat.engine.llm')}
          </span>
          <span className="block text-xs text-muted">
            {t('ai.chat.engine.llmNote', { size: formatBytes(llmBytes, lang) })}
          </span>
        </button>
      </div>

      {llmStatus === 'no-webgpu' && (
        <p className="text-xs text-muted" data-testid="llm-no-webgpu">
          {t('ai.chat.engine.noWebgpu')}
        </p>
      )}

      {llmStatus === 'offered' && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={enableLlm} data-testid="llm-download">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('ai.chat.engine.download', { size: formatBytes(llmBytes, lang) })}
          </Button>
          <span className="text-xs text-muted">{t('ai.chat.engine.downloadNote')}</span>
        </div>
      )}

      {llmStatus === 'loading' && (
        <div className="flex items-center gap-3 text-sm text-muted" aria-live="polite">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
          {t('ai.chat.engine.downloading', { percent })}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-40 overflow-hidden rounded-full bg-surface"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {llmStatus === 'ready' && (
        <p className="text-xs text-muted">
          <Badge variant="outline" className="mr-2 text-[0.62rem]">
            {t('ai.chat.engine.readyTag')}
          </Badge>
          {t('ai.chat.engine.readyNote')}
        </p>
      )}

      {llmStatus === 'failed' && (
        <p className="text-xs text-copper" data-testid="llm-failed">
          {t('ai.chat.engine.failed', { reason: llmError ?? '?' })}
        </p>
      )}
    </div>
  );
}
