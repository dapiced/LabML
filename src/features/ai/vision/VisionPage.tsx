import { ArrowLeft, ImageUp, Loader2, ShieldCheck, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import labels from '@/features/ai/vision-labels.json';
import { tensorFromRgba, VISION_SIZE } from '@/features/ai/vision/preprocess';
import type { VisionRequest, VisionResponse } from '@/features/ai/vision/vision.worker';
import { cn } from '@/lib/utils';

type ModelStatus = 'loading' | 'ready' | 'classifying' | 'error';

interface Prediction {
  label: string;
  p: number;
}

/** Center-crop an image file to a 224×224 RGBA buffer via an offscreen canvas. */
async function rgbaFromFile(file: File): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = VISION_SIZE;
    canvas.height = VISION_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas-2d');
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      VISION_SIZE,
      VISION_SIZE,
    );
    return ctx.getImageData(0, 0, VISION_SIZE, VISION_SIZE).data;
  } finally {
    bitmap.close();
  }
}

export function VisionPage() {
  const { t } = useTranslation();
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<ModelStatus>('loading');
  const [loadMs, setLoadMs] = useState(0);
  const [inferMs, setInferMs] = useState(0);
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<VisionResponse>) => {
      const message = event.data;
      if (message.kind === 'ready') {
        setLoadMs(Math.round(message.loadMs));
        setStatus('ready');
      } else if (message.kind === 'top') {
        setInferMs(Math.round(message.inferMs));
        setPredictions(
          message.items.map(({ index, p }) => ({ label: labels[index] ?? `#${index}`, p })),
        );
        setStatus('ready');
      } else {
        setStatus('error');
      }
    };
    worker.postMessage({ kind: 'init' } satisfies VisionRequest);
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const classify = useCallback(async (file: File) => {
    const worker = workerRef.current;
    if (!worker || !file.type.startsWith('image/')) return;
    setStatus('classifying');
    setPredictions(null);
    setPreview(URL.createObjectURL(file));
    try {
      const rgba = await rgbaFromFile(file);
      const tensor = tensorFromRgba(rgba, VISION_SIZE, VISION_SIZE);
      worker.postMessage({ kind: 'classify', tensor } satisfies VisionRequest, [tensor.buffer]);
    } catch {
      setStatus('error');
    }
  }, []);

  const busy = status === 'loading' || status === 'classifying';

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-12 sm:py-16">
        <Eyebrow>{t('ai.vision.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('ai.vision.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('ai.vision.lede')}</p>
      </section>

      <section className="pb-6" aria-live="polite">
        {status === 'loading' && (
          <Card className="flex items-center gap-3 text-sm text-muted">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
            {t('ai.vision.loading')}
          </Card>
        )}
        {status === 'error' && (
          <Card className="border-copper text-sm">{t('ai.vision.error')}</Card>
        )}
        {(status === 'ready' || status === 'classifying') && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">{t('ai.vision.ready', { ms: loadMs })}</Badge>
            {predictions && (
              <Badge variant="copper">
                <Zap className="h-3 w-3" aria-hidden="true" />
                {t('ai.vision.results.inferMs', { ms: inferMs })}
              </Badge>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-4 pb-12 lg:grid-cols-2">
        <label
          htmlFor="vision-file"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void classify(file);
          }}
          className={cn(
            'flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors focus-within:border-accent',
            dragging
              ? 'border-accent bg-accent-soft'
              : 'border-line bg-surface hover:border-accent',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {preview ? (
            <img
              src={preview}
              alt={t('ai.vision.results.preview')}
              className="h-40 w-40 rounded-lg object-cover shadow-sm"
            />
          ) : (
            <ImageUp className="h-8 w-8 text-accent" aria-hidden="true" />
          )}
          <span className="font-display text-lg font-semibold">{t('ai.vision.drop.title')}</span>
          <span className="max-w-xs text-sm text-muted">{t('ai.vision.drop.hint')}</span>
          <span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            {t('ai.vision.drop.browse')}
          </span>
          <input
            id="vision-file"
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void classify(file);
              event.target.value = '';
            }}
          />
        </label>

        <Card>
          <h2 className="font-display text-lg font-semibold">{t('ai.vision.results.title')}</h2>
          {status === 'classifying' && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              {t('ai.vision.results.working')}
            </p>
          )}
          {predictions ? (
            <ol className="mt-4 flex flex-col gap-3">
              {predictions.map(({ label, p }, rank) => (
                <li key={label} data-testid="vision-prediction" className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className={rank === 0 ? 'font-semibold' : undefined}>{label}</span>
                    <span className="font-mono text-xs text-muted">{(p * 100).toFixed(1)} %</span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-surface-2"
                    aria-hidden="true"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full',
                        rank === 0 ? 'bg-accent' : 'bg-accent/45',
                      )}
                      style={{ width: `${Math.max(p * 100, 1.5)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            status !== 'classifying' && (
              <p className="mt-4 text-sm text-muted">{t('ai.vision.results.empty')}</p>
            )
          )}
          {predictions && <p className="mt-5 text-xs text-muted">{t('ai.vision.results.note')}</p>}
        </Card>
      </section>

      <section className="pb-12">
        <Card className="flex flex-col gap-2 bg-surface-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            <Eyebrow>{t('ai.vision.how.title')}</Eyebrow>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('ai.vision.how.body')}</p>
        </Card>
      </section>

      <section className="pb-20">
        <Link to="/ai" className={cn(buttonVariants({ variant: 'outline' }))}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('ai.vision.backToAi')}
        </Link>
      </section>
    </div>
  );
}

export default VisionPage;
