import { FileUp } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import { cn } from '@/lib/utils';

const DEMO_DATASETS = [
  { file: 'iris.csv', size: '4 KB', task: 'multiclass' },
  { file: 'titanic.csv', size: '56 KB', task: 'binary' },
  { file: 'mpg.csv', size: '21 KB', task: 'regression' },
  { file: 'energy.csv', size: '5 KB', task: 'timeseries' },
] as const;

export function DropZone() {
  const { t } = useTranslation();
  const loadFile = useLabStore((s) => s.loadFile);
  const loadDemo = useLabStore((s) => s.loadDemo);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) loadFile(file);
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors',
          dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent',
        )}
      >
        <FileUp className="h-8 w-8 text-accent" aria-hidden="true" />
        <span className="font-display text-lg font-semibold">{t('ml.lab.dropTitle')}</span>
        <span className="max-w-md text-sm text-muted">{t('ml.lab.dropHint')}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv"
        className="sr-only"
        aria-label={t('ml.lab.dropTitle')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
          e.target.value = '';
        }}
      />

      <div className="flex flex-col gap-2">
        <Eyebrow>{t('ml.lab.demoLabel')}</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {DEMO_DATASETS.map(({ file, size, task }) => (
            <button
              key={file}
              type="button"
              onClick={() => loadDemo(file)}
              className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <span className="font-mono text-xs">{file}</span>
              <span className="font-mono text-[0.65rem] text-muted">{size}</span>
              <Badge variant="outline">{t(`ml.lab.demoTask.${task}`)}</Badge>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
