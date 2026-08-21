import { HardDrive, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatSize } from '@/features/ml/projects/dataset-storage';
import { useLabStore } from '@/features/ml/lab-store';

/**
 * v19 opt-in: keep the current dataset in the browser (IndexedDB) so the
 * project survives a reload. Over quota → the refusal is spelled out with
 * the numbers; nothing is trimmed or dropped silently.
 */
export function KeepDatasetControl() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const savedDatasetId = useLabStore((s) => s.savedDatasetId);
  const datasetSaving = useLabStore((s) => s.datasetSaving);
  const quotaError = useLabStore((s) => s.datasetQuotaError);
  const saveDataset = useLabStore((s) => s.saveDataset);
  const forgetDataset = useLabStore((s) => s.forgetDataset);
  const size = (bytes: number) =>
    formatSize(bytes, lang, t('ml.lab.datasets.unitKb'), t('ml.lab.datasets.unitMb'));

  if (savedDatasetId !== null) {
    return (
      <span className="flex items-center gap-1">
        <Badge data-testid="dataset-kept">
          <HardDrive className="h-3 w-3" aria-hidden="true" />
          {t('ml.lab.datasets.keptBadge')}
        </Badge>
        <button
          type="button"
          onClick={() => forgetDataset(savedDatasetId)}
          aria-label={t('ml.lab.datasets.forget')}
          title={t('ml.lab.datasets.forget')}
          className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={saveDataset}
        disabled={datasetSaving}
        data-testid="dataset-keep"
      >
        <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
        {datasetSaving ? t('ml.lab.datasets.keeping') : t('ml.lab.datasets.keepButton')}
      </Button>
      {quotaError && (
        <span className="text-xs text-copper" data-testid="dataset-quota-error">
          {t('ml.lab.datasets.quotaError', {
            needed: size(quotaError.neededBytes),
            used: size(quotaError.usedBytes),
            quota: size(quotaError.quotaBytes),
          })}
        </span>
      )}
    </span>
  );
}
