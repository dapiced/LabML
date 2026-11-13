import { FileText, FileType } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  buildModelCard,
  modelCardHtml,
  modelCardMarkdown,
} from '@/features/ml/projects/model-card';
import type { RunRecord } from '@/features/ml/projects/types';
import { downloadFile } from '@/lib/download';

/**
 * V58: the two downloads of a model card, for the run on screen or a stored
 * one. Both are written from the same structure, generated locally.
 */
export function ModelCardDownloads({ record }: { record: RunRecord }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const base = `labml-${record.dataset.name.replace(/\.[a-z]+$/i, '')}-model-card`;
  const card = () => buildModelCard(record, t, lang, __APP_VERSION__);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="model-card-downloads">
      <Button
        variant="outline"
        size="sm"
        data-testid="model-card-html"
        onClick={() => downloadFile(`${base}.html`, modelCardHtml(card(), lang), 'text/html')}
      >
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ml.lab.card.downloadHtml')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="model-card-markdown"
        onClick={() => downloadFile(`${base}.md`, modelCardMarkdown(card()), 'text/markdown')}
      >
        <FileType className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ml.lab.card.downloadMarkdown')}
      </Button>
    </div>
  );
}
