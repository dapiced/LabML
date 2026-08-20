import { Check, Download, FileJson, FileSpreadsheet, FileText, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { buildReportHtml } from '@/features/ml/projects/report';
import { encodeShareFragment } from '@/features/ml/projects/share';
import { useLabStore } from '@/features/ml/lab-store';

function downloadFile(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Export & share actions for the completed run — everything generated locally. */
export function ExportBar() {
  const { t, i18n } = useTranslation();
  const insights = useLabStore((s) => s.insights);
  const currentRun = useLabStore((s) => s.currentRun);
  const exportedFile = useLabStore((s) => s.exportedFile);
  const exportModel = useLabStore((s) => s.exportModel);
  const exportPredictions = useLabStore((s) => s.exportPredictions);
  const clearExportedFile = useLabStore((s) => s.clearExportedFile);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!exportedFile) return;
    downloadFile(exportedFile.name, exportedFile.mime, exportedFile.content);
    clearExportedFile();
  }, [exportedFile, clearExportedFile]);

  useEffect(() => {
    if (!copied) return;
    const handle = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(handle);
  }, [copied]);

  if (!insights || !currentRun) return null;
  const lang = i18n.resolvedLanguage ?? 'en';

  function downloadReport() {
    if (!currentRun) return;
    downloadFile(
      `labml-${currentRun.dataset.name.replace(/\.[a-z]+$/i, '')}-report.html`,
      'text/html',
      buildReportHtml(currentRun, t, lang),
    );
  }

  async function copyShareLink() {
    if (!currentRun) return;
    const url = `${window.location.origin}/ml/share#${encodeShareFragment(currentRun)}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  const modelExportable = insights.model !== 'knn';

  return (
    <div data-testid="export-bar" className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={exportModel}
        disabled={!modelExportable}
        title={modelExportable ? undefined : t('ml.lab.export.knnNote')}
      >
        <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ml.lab.export.model')}
      </Button>
      <Button variant="outline" size="sm" onClick={exportPredictions}>
        <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ml.lab.export.predictions')}
      </Button>
      <Button variant="outline" size="sm" onClick={downloadReport}>
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ml.lab.export.report')}
      </Button>
      <Button variant="outline" size="sm" onClick={() => void copyShareLink()}>
        {copied ? (
          <Check className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
        ) : (
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {copied ? t('ml.lab.export.copied') : t('ml.lab.export.share')}
      </Button>
      <span className="flex items-center gap-1 font-mono text-[0.65rem] text-muted">
        <Download className="h-3 w-3" aria-hidden="true" />
        {t('ml.lab.export.localNote')}
      </span>
    </div>
  );
}
