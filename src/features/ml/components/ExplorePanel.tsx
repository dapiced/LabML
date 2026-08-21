import { Loader2, Shapes } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import type { ClusterTrait } from '@/features/ml/unsupervised/explore';

/** Cluster identity is never color-alone: each group also gets a marker shape. */
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross'] as const;
type Shape = (typeof SHAPES)[number];

function Marker({
  shape,
  cluster,
  x,
  y,
  r,
}: {
  shape: Shape;
  cluster: number;
  x: number;
  y: number;
  r: number;
}) {
  const fill = `var(--cluster-${cluster})`;
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={r} fill={fill} />;
    case 'square':
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={fill} />;
    case 'triangle':
      return (
        <polygon
          points={`${x},${y - r * 1.2} ${x - r * 1.1},${y + r} ${x + r * 1.1},${y + r}`}
          fill={fill}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${x},${y - r * 1.3} ${x + r * 1.3},${y} ${x},${y + r * 1.3} ${x - r * 1.3},${y}`}
          fill={fill}
        />
      );
    case 'cross': {
      const w = r * 0.55;
      return (
        <path
          d={`M ${x - w} ${y - r * 1.2} h ${2 * w} v ${r * 1.2 - w} h ${r * 1.2 - w} v ${2 * w} h ${-(r * 1.2 - w)} v ${r * 1.2 - w} h ${-2 * w} v ${-(r * 1.2 - w)} h ${-(r * 1.2 - w)} v ${-2 * w} h ${r * 1.2 - w} Z`}
          fill={fill}
        />
      );
    }
  }
}

function ClusterScatter({ points }: { points: [number, number, number][] }) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number) => 4 + ((x - minX) / spanX) * 92;
  const sy = (y: number) => 66 - ((y - minY) / spanY) * 62;

  return (
    <svg viewBox="0 0 100 70" className="h-auto w-full max-w-xl" aria-hidden="true">
      <rect x="0" y="0" width="100" height="70" fill="var(--surface)" rx="2" />
      {points.map(([x, y, c], i) => (
        <Marker key={i} shape={SHAPES[c % SHAPES.length]} cluster={c} x={sx(x)} y={sy(y)} r={1.1} />
      ))}
    </svg>
  );
}

function TraitLine({ trait }: { trait: ClusterTrait }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const num = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 });
  const pct = (v: number) => (v * 100).toLocaleString(lang, { maximumFractionDigits: 0 });
  return (
    <li className="text-xs text-muted">
      {trait.kind === 'numeric'
        ? t('ml.lab.explore.traitNumeric', {
            column: trait.column,
            clusterMean: num(trait.clusterMean),
            overallMean: num(trait.overallMean),
          })
        : t('ml.lab.explore.traitCategorical', {
            column: trait.column,
            value: trait.value,
            share: pct(trait.share),
            overallShare: pct(trait.overallShare),
          })}
    </li>
  );
}

/** Unsupervised exploration: k-means + PCA, offered as soon as data is ready. */
export function ExplorePanel() {
  const { t, i18n } = useTranslation();
  const status = useLabStore((s) => s.status);
  const exploreStatus = useLabStore((s) => s.exploreStatus);
  const exploration = useLabStore((s) => s.exploration);
  const explore = useLabStore((s) => s.explore);
  if (status !== 'ready') return null;
  const lang = i18n.resolvedLanguage;

  return (
    <section
      data-testid="explore"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <Shapes className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.explore.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.explore.hint')}</p>
      </div>

      {exploreStatus !== 'done' && (
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={explore}
            disabled={exploreStatus === 'running'}
            data-testid="explore-start"
          >
            {t('ml.lab.explore.start')}
          </Button>
          {exploreStatus === 'running' && (
            <span className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              {t('ml.lab.explore.running')}
            </span>
          )}
        </div>
      )}

      {exploreStatus === 'done' && exploration && (
        <div className="flex flex-col gap-4" data-testid="explore-result">
          <p className="text-sm text-muted">
            {t('ml.lab.explore.summary', {
              k: exploration.k,
              silhouette: exploration.silhouette.toLocaleString(lang, {
                maximumFractionDigits: 2,
              }),
              tried: exploration.tried.map((entry) => entry.k).join(', '),
              rows: exploration.rowsUsed.toLocaleString(lang),
              p1: (exploration.explained[0] * 100).toLocaleString(lang, {
                maximumFractionDigits: 0,
              }),
              p2: (exploration.explained[1] * 100).toLocaleString(lang, {
                maximumFractionDigits: 0,
              }),
            })}
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <ClusterScatter points={exploration.points} />
              <ul className="flex flex-wrap gap-3">
                {exploration.clusters.map(({ id, size }) => (
                  <li key={id} className="flex items-center gap-1.5 text-xs">
                    <svg viewBox="0 0 10 10" className="h-3 w-3" aria-hidden="true">
                      <Marker shape={SHAPES[id % SHAPES.length]} cluster={id} x={5} y={5} r={3.4} />
                    </svg>
                    {t('ml.lab.explore.clusterName', { id: id + 1 })}
                    <span className="font-mono text-[0.65rem] text-muted">n={size}</span>
                  </li>
                ))}
              </ul>
            </div>

            <ol className="flex flex-col gap-3">
              {exploration.clusters.map(({ id, size, share, traits }) => (
                <li
                  key={id}
                  data-testid="cluster-card"
                  className="rounded-xl border border-line p-3"
                >
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <svg viewBox="0 0 10 10" className="h-3.5 w-3.5" aria-hidden="true">
                      <Marker shape={SHAPES[id % SHAPES.length]} cluster={id} x={5} y={5} r={3.4} />
                    </svg>
                    {t('ml.lab.explore.clusterName', { id: id + 1 })}
                    <span className="font-mono text-xs text-muted">
                      {t('ml.lab.explore.clusterSize', {
                        count: size,
                        share: (share * 100).toLocaleString(lang, { maximumFractionDigits: 0 }),
                      })}
                    </span>
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {traits.map((trait, index) => (
                      <TraitLine key={index} trait={trait} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>

          <p className="text-xs text-muted">{t('ml.lab.explore.note')}</p>
        </div>
      )}
    </section>
  );
}
