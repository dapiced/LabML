import { Download, FileJson, FlaskConical } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useDataStore } from '@/features/data/data-store';
import { useLabStore } from '@/features/ml/lab-store';

function downloadFile(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Exports of the cleaned dataset — generated locally, like everything else. */
export function DataExportBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stats = useDataStore((s) => s.stats);
  const exportedFile = useDataStore((s) => s.exportedFile);
  const labHandoff = useDataStore((s) => s.labHandoff);
  const exportCsv = useDataStore((s) => s.exportCsv);
  const exportRecipe = useDataStore((s) => s.exportRecipe);
  const openInLab = useDataStore((s) => s.openInLab);
  const clearExportedFile = useDataStore((s) => s.clearExportedFile);
  const clearLabHandoff = useDataStore((s) => s.clearLabHandoff);

  useEffect(() => {
    if (!exportedFile) return;
    downloadFile(exportedFile.name, exportedFile.mime, exportedFile.content);
    clearExportedFile();
  }, [exportedFile, clearExportedFile]);

  // The cleaned CSV becomes a File the ML Lab parses as if it had been dropped.
  useEffect(() => {
    if (!labHandoff) return;
    const file = new File([labHandoff.content], labHandoff.name, { type: 'text/csv' });
    clearLabHandoff();
    useLabStore.getState().loadFile(file);
    void navigate('/ml');
  }, [labHandoff, clearLabHandoff, navigate]);

  if (!stats) return null;

  return (
    <section className="flex flex-wrap items-center gap-3 pb-12">
      <Button onClick={openInLab}>
        <FlaskConical className="h-4 w-4" aria-hidden="true" />
        {t('data.export.lab')}
      </Button>
      <Button variant="outline" onClick={exportCsv}>
        <Download className="h-4 w-4" aria-hidden="true" />
        {t('data.export.csv')}
      </Button>
      <Button variant="outline" onClick={exportRecipe}>
        <FileJson className="h-4 w-4" aria-hidden="true" />
        {t('data.export.recipe')}
      </Button>
    </section>
  );
}
