import { Loader2, Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Leaderboard } from '@/features/ml/components/Leaderboard';
import { BatchScorePanel } from '@/features/ml/components/BatchScorePanel';
import { SegmentsPanel } from '@/features/ml/components/SegmentsPanel';
import { ThresholdPanel } from '@/features/ml/components/ThresholdPanel';
import { UncertaintyPanel } from '@/features/ml/components/UncertaintyPanel';
import { LearningCurvePanel } from '@/features/ml/components/LearningCurvePanel';
import { TuningPanel } from '@/features/ml/components/TuningPanel';
import { InsightsSection } from '@/features/ml/components/insights/InsightsSection';
import { TEST_RATIO, TRAIN_SEED, useLabStore } from '@/features/ml/lab-store';

export function TrainPanel() {
  const { t } = useTranslation();
  const task = useLabStore((s) => s.task);
  const trainStatus = useLabStore((s) => s.trainStatus);
  const modelProgress = useLabStore((s) => s.modelProgress);
  const train = useLabStore((s) => s.train);
  const cancelTrain = useLabStore((s) => s.cancelTrain);
  if (!task) return null;

  const splitLabel = `${Math.round((1 - TEST_RATIO) * 100)}/${Math.round(TEST_RATIO * 100)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {trainStatus === 'idle' && (
          <Button onClick={train} data-testid="train-button">
            <Play className="h-4 w-4" aria-hidden="true" />
            {t('ml.lab.trainButton')}
          </Button>
        )}
        {trainStatus === 'training' && (
          <>
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              {modelProgress
                ? t('ml.lab.trainingModel', {
                    name: t(`ml.lab.models.${modelProgress.key}`),
                    index: modelProgress.index + 1,
                    total: modelProgress.total,
                  })
                : t('ml.lab.trainingPreparing')}
            </span>
            <Button variant="outline" size="sm" onClick={cancelTrain}>
              {t('ml.lab.cancel')}
            </Button>
          </>
        )}
        {trainStatus === 'done' && (
          <Button variant="outline" onClick={train} data-testid="train-again">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('ml.lab.trainAgain')}
          </Button>
        )}
        <span className="font-mono text-[0.68rem] text-muted">
          {t('ml.lab.trainConfig', { seed: TRAIN_SEED, split: splitLabel })}
        </span>
      </div>

      <Leaderboard />

      <UncertaintyPanel />

      <TuningPanel />

      <LearningCurvePanel />

      <InsightsSection />

      <ThresholdPanel />

      <SegmentsPanel />

      <BatchScorePanel />

      {trainStatus === 'done' && (
        <p className="text-xs text-muted">{t('ml.lab.reproducibleNote')}</p>
      )}
    </div>
  );
}
