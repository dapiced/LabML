import {
  ArrowLeft,
  Camera,
  CircleHelp,
  ImageUp,
  Loader2,
  ShieldCheck,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import labels from '@/features/ai/vision-labels.json';
import { cocoLabel } from '@/features/ai/vision/coco-labels';
import type { DetectedBox } from '@/features/ai/vision/detect';
import {
  liteTensorFromRgba,
  ULTRA_H,
  ULTRA_W,
  ultraTensorFromRgba,
  VISION_SIZE,
  YOLOX_INPUT,
  yoloxTensorFromRgba,
} from '@/features/ai/vision/preprocess';
import { CONFIDENCE_FLOOR, judgeSubject } from '@/features/ai/vision/verdict';
import type { VisionRequest, VisionResponse } from '@/features/ai/vision/vision.worker';
import { cn } from '@/lib/utils';

type ModelStatus = 'loading' | 'ready' | 'classifying' | 'error';

interface Prediction {
  label: string;
  p: number;
}

interface AnalysisResult {
  top: Prediction[];
  objects: DetectedBox[];
  faces: DetectedBox[];
  width: number;
  height: number;
}

function rgbaFrom(ctx: CanvasRenderingContext2D, width: number, height: number) {
  return ctx.getImageData(0, 0, width, height).data;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas-2d');
  return { canvas, ctx };
}

/**
 * One source image → the three model inputs: a 224² center crop for the
 * classifier, plus gray letterboxes (ratio preserved, top-left anchored) at
 * 416² for YOLOX and 320×240 for UltraFace.
 */
function prepareTensors(source: CanvasImageSource, width: number, height: number) {
  const crop = makeCanvas(VISION_SIZE, VISION_SIZE);
  const side = Math.min(width, height);
  crop.ctx.drawImage(
    source,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    VISION_SIZE,
    VISION_SIZE,
  );

  const letterbox = makeCanvas(YOLOX_INPUT, YOLOX_INPUT);
  const ratio = Math.min(YOLOX_INPUT / width, YOLOX_INPUT / height);
  letterbox.ctx.fillStyle = '#727272'; // YOLOX's 114-gray padding
  letterbox.ctx.fillRect(0, 0, YOLOX_INPUT, YOLOX_INPUT);
  letterbox.ctx.drawImage(source, 0, 0, width, height, 0, 0, width * ratio, height * ratio);

  const faceBox = makeCanvas(ULTRA_W, ULTRA_H);
  const faceRatio = Math.min(ULTRA_W / width, ULTRA_H / height);
  faceBox.ctx.fillStyle = '#7f7f7f'; // 127-gray → 0 after (x−127)/128
  faceBox.ctx.fillRect(0, 0, ULTRA_W, ULTRA_H);
  faceBox.ctx.drawImage(source, 0, 0, width, height, 0, 0, width * faceRatio, height * faceRatio);

  return {
    classifier: liteTensorFromRgba(
      rgbaFrom(crop.ctx, VISION_SIZE, VISION_SIZE),
      VISION_SIZE,
      VISION_SIZE,
    ),
    objects: yoloxTensorFromRgba(
      rgbaFrom(letterbox.ctx, YOLOX_INPUT, YOLOX_INPUT),
      YOLOX_INPUT,
      YOLOX_INPUT,
    ),
    faces: ultraTensorFromRgba(rgbaFrom(faceBox.ctx, ULTRA_W, ULTRA_H), ULTRA_W, ULTRA_H),
    ratio,
    faceRatio,
  };
}

/** Group detected objects into localized "2 people · 1 dog" chips. */
function groupObjects(objects: DetectedBox[], lang: string): { label: string; count: number }[] {
  const counts = new Map<number, number>();
  for (const box of objects) counts.set(box.classIndex, (counts.get(box.classIndex) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([classIndex, count]) => ({ label: cocoLabel(classIndex, lang), count }));
}

export function VisionPage() {
  const { t, i18n } = useTranslation();
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<ModelStatus>('loading');
  const [loadMs, setLoadMs] = useState(0);
  const [inferMs, setInferMs] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const imageSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<VisionResponse>) => {
      const message = event.data;
      if (message.kind === 'ready') {
        setLoadMs(Math.round(message.loadMs));
        setStatus('ready');
      } else if (message.kind === 'result') {
        setInferMs(Math.round(message.inferMs));
        setResult({
          top: message.top.map(({ index, p }) => ({ label: labels[index] ?? `#${index}`, p })),
          objects: message.objects,
          faces: message.faces,
          width: imageSizeRef.current.width,
          height: imageSizeRef.current.height,
        });
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
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const analyzeSource = useCallback(
    (source: CanvasImageSource, width: number, height: number, previewUrl: string) => {
      const worker = workerRef.current;
      if (!worker) return;
      setStatus('classifying');
      setResult(null);
      setPreview(previewUrl);
      imageSizeRef.current = { width, height };
      try {
        const { classifier, objects, faces, ratio, faceRatio } = prepareTensors(
          source,
          width,
          height,
        );
        worker.postMessage(
          {
            kind: 'analyze',
            classifier,
            objects,
            faces,
            width,
            height,
            ratio,
            faceRatio,
          } satisfies VisionRequest,
          [classifier.buffer, objects.buffer, faces.buffer],
        );
      } catch {
        setStatus('error');
      }
    },
    [],
  );

  const classify = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      try {
        const bitmap = await createImageBitmap(file);
        try {
          analyzeSource(bitmap, bitmap.width, bitmap.height, URL.createObjectURL(file));
        } finally {
          bitmap.close();
        }
      } catch {
        setStatus('error');
      }
    },
    [analyzeSource],
  );

  // --- Webcam: the stream stays local, frames are analyzed like any photo. ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [webcamOn, setWebcamOn] = useState(false);
  const [webcamError, setWebcamError] = useState(false);

  const stopWebcam = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setWebcamOn(false);
  }, []);

  useEffect(() => stopWebcam, [stopWebcam]);

  async function startWebcam() {
    setWebcamError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setWebcamOn(true);
      // The <video> mounts with the state flip; attach on the next frame.
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch {
      setWebcamError(true);
    }
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    // Full frame, native resolution: the letterbox handles the aspect ratio,
    // and detection deserves the whole scene, not a center crop.
    const { canvas, ctx } = makeCanvas(video.videoWidth, video.videoHeight);
    ctx.drawImage(video, 0, 0);
    analyzeSource(canvas, canvas.width, canvas.height, canvas.toDataURL('image/png'));
  }

  const busy = status === 'loading' || status === 'classifying';
  const lang = i18n.language;
  const objectGroups = result ? groupObjects(result.objects, lang) : [];
  // What the page is allowed to CLAIM about the subject — the classifier
  // itself cannot abstain, so the refusal is decided outside it (verdict.ts).
  const verdict = result ? judgeSubject(result.top, result.objects, result.faces) : null;
  const top1 = result?.top[0];
  // SVG overlay geometry is in image pixels: scale strokes/text with the image.
  const unit = result ? Math.max(result.width, result.height) / 100 : 1;

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
            {result && (
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

        <div className="flex flex-col gap-3 lg:col-start-1">
          {!webcamOn ? (
            <button
              type="button"
              onClick={() => void startWebcam()}
              disabled={busy}
              data-testid="webcam-open"
              className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              {t('ai.vision.webcam.open')}
            </button>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                data-testid="webcam-video"
                className="w-full max-w-md rounded-xl border border-line bg-surface-2"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={captureFrame}
                  disabled={busy}
                  data-testid="webcam-capture"
                  className={cn(buttonVariants({ size: 'sm' }))}
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  {t('ai.vision.webcam.capture')}
                </button>
                <button
                  type="button"
                  onClick={stopWebcam}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  {t('ai.vision.webcam.close')}
                </button>
              </div>
            </>
          )}
          {webcamError && <p className="text-sm text-copper">{t('ai.vision.webcam.error')}</p>}
        </div>

        <Card className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <h2 className="font-display text-lg font-semibold">{t('ai.vision.results.title')}</h2>
          {status === 'classifying' && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              {t('ai.vision.results.working')}
            </p>
          )}
          {result ? (
            <div className="mt-4 flex flex-col gap-5">
              {preview && (
                <figure
                  data-testid="vision-annotated"
                  className="relative overflow-hidden rounded-xl"
                >
                  <img src={preview} alt={t('ai.vision.results.annotated')} className="w-full" />
                  <svg
                    viewBox={`0 0 ${result.width} ${result.height}`}
                    className="absolute inset-0 h-full w-full"
                    aria-hidden="true"
                  >
                    {result.objects.map((box, index) => (
                      <g key={`o${index}`}>
                        <rect
                          x={box.x1}
                          y={box.y1}
                          width={box.x2 - box.x1}
                          height={box.y2 - box.y1}
                          fill="none"
                          style={{ stroke: 'var(--accent)' }}
                          strokeWidth={unit * 0.45}
                        />
                        <text
                          x={box.x1 + unit * 0.8}
                          y={Math.max(box.y1 + unit * 3.2, unit * 3.6)}
                          fontSize={unit * 3}
                          fontWeight={600}
                          style={{
                            fill: 'var(--accent)',
                            stroke: 'var(--surface)',
                            strokeWidth: unit * 0.35,
                            paintOrder: 'stroke',
                          }}
                        >
                          {`${cocoLabel(box.classIndex, lang)} ${Math.round(box.score * 100)} %`}
                        </text>
                      </g>
                    ))}
                    {result.faces.map((box, index) => (
                      <rect
                        key={`f${index}`}
                        x={box.x1}
                        y={box.y1}
                        width={box.x2 - box.x1}
                        height={box.y2 - box.y1}
                        fill="none"
                        style={{ stroke: 'var(--copper)' }}
                        strokeWidth={unit * 0.45}
                        strokeDasharray={`${unit * 1.4} ${unit * 0.8}`}
                      />
                    ))}
                  </svg>
                </figure>
              )}

              <div className="flex flex-col gap-2" data-testid="vision-objects">
                <p className="text-sm font-medium">
                  {result.objects.length === 0
                    ? t('ai.vision.results.objectsNone')
                    : t('ai.vision.results.objectCount', { count: result.objects.length })}
                </p>
                {objectGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {objectGroups.map(({ label, count }) => (
                      <Badge key={label} variant="accent" data-testid="vision-object-chip">
                        {count > 1 ? `${label} ×${count}` : label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-sm font-medium" data-testid="vision-faces">
                {result.faces.length === 0
                  ? t('ai.vision.results.facesNone')
                  : t('ai.vision.results.faceCount', { count: result.faces.length })}
              </p>

              <div data-testid="vision-subject" data-verdict={verdict?.kind ?? 'named'}>
                <h3 className="font-mono text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                  {t('ai.vision.results.subject')}
                </h3>
                {/* The label is never hidden — it is framed. A number the reader
                    cannot see is a number they cannot check; the verdict says
                    what the number is worth and leaves it on screen. */}
                {verdict && top1 && verdict.kind !== 'named' && (
                  <div
                    data-testid="vision-verdict"
                    className="mt-3 flex gap-2.5 rounded-lg border border-copper bg-copper-soft p-3 text-copper"
                  >
                    {verdict.kind === 'no-class-for-people' ? (
                      <UserRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold">
                        {verdict.kind === 'no-class-for-people'
                          ? t('ai.vision.results.verdict.people', { count: verdict.people })
                          : t('ai.vision.results.verdict.unsure', {
                              label: top1.label,
                              p: (top1.p * 100).toFixed(1),
                            })}
                      </p>
                      <p className="text-xs leading-relaxed">
                        {verdict.kind === 'no-class-for-people'
                          ? t('ai.vision.results.verdict.peopleWhy', {
                              label: top1.label,
                              p: (top1.p * 100).toFixed(1),
                            })
                          : t('ai.vision.results.verdict.unsureWhy', {
                              floor: Math.round(CONFIDENCE_FLOOR * 100),
                            })}
                      </p>
                    </div>
                  </div>
                )}
                <ol className="mt-3 flex flex-col gap-3">
                  {result.top.map(({ label, p }, rank) => (
                    <li key={label} data-testid="vision-prediction" className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className={rank === 0 ? 'font-semibold' : undefined}>{label}</span>
                        <span className="font-mono text-xs text-muted">
                          {(p * 100).toFixed(1)} %
                        </span>
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
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">{t('ai.vision.results.detNote')}</p>
                <p className="text-xs text-muted">{t('ai.vision.results.note')}</p>
              </div>
            </div>
          ) : (
            status !== 'classifying' && (
              <p className="mt-4 text-sm text-muted">{t('ai.vision.results.empty')}</p>
            )
          )}
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
