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
import { RobustRankPanel } from '@/features/ml/components/RobustRankPanel';
import { TEST_RATIO, TRAIN_SEED, useLabStore } from '@/features/ml/lab-store';
import { VALIDATION_RATIO } from '@/features/ml/train/trainer';
import type { SplitChoice } from '@/features/ml/train/types';

export function TrainPanel() {
  const { t } = useTranslation();
  const task = useLabStore((s) => s.task);
  const trainStatus = useLabStore((s) => s.trainStatus);
  const modelProgress = useLabStore((s) => s.modelProgress);
  const train = useLabStore((s) => s.train);
  const cancelTrain = useLabStore((s) => s.cancelTrain);
  const profiles = useLabStore((s) => s.profiles);
  const target = useLabStore((s) => s.target);
  const splitChoice = useLabStore((s) => s.splitChoice);
  const setSplitChoice = useLabStore((s) => s.setSplitChoice);
  const classWeighting = useLabStore((s) => s.classWeighting);
  const setClassWeighting = useLabStore((s) => s.setClassWeighting);
  const summary = useLabStore((s) => s.summary);
  if (!task) return null;

  // V35: the split is now three-way — validation is carved from the train
  // side, the test share is untouched. 64/16/20 with the default ratios.
  const testPct = Math.round(TEST_RATIO * 100);
  const valPct = Math.round((1 - TEST_RATIO) * VALIDATION_RATIO * 100);
  const splitLabel = `${100 - testPct - valPct}/${valPct}/${testPct}`;

  // V35: announced non-random splits — offered only when a column supports
  // one. Chronological needs a date column; group needs a repeated identifier.
  const splitOptions: SplitChoice[] = [
    ...profiles
      .filter((p) => p.type === 'date' && p.name !== target)
      .map((p) => ({ mode: 'chronological' as const, column: p.name })),
    ...profiles
      .filter(
        (p) => p.type === 'id' && p.name !== target && p.cardinality < p.rowCount - p.missingCount,
      )
      .map((p) => ({ mode: 'group' as const, column: p.name })),
  ];
  const choiceValue = splitChoice ? `${splitChoice.mode}:${splitChoice.column}` : 'random';

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
        {task.type !== 'regression' && trainStatus !== 'training' && (
          <label
            className="flex items-center gap-2 text-xs text-muted"
            title={t('ml.lab.leaderboard.weightToggleHint')}
          >
            <input
              type="checkbox"
              data-testid="class-weighting"
              checked={classWeighting}
              onChange={(event) => setClassWeighting(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            {t('ml.lab.leaderboard.weightToggle')}
            {summary?.imbalanced && <span className="text-copper">•</span>}
          </label>
        )}
        {splitOptions.length > 0 && trainStatus !== 'training' && (
          <label className="flex items-center gap-2 text-xs text-muted">
            {t('ml.lab.splitMode.label')}
            <select
              data-testid="split-mode"
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
              value={choiceValue}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'random') setSplitChoice(null);
                else {
                  const [mode, column] = value.split(/:(.*)/s);
                  setSplitChoice({ mode: mode as SplitChoice['mode'], column });
                }
              }}
            >
              <option value="random">{t('ml.lab.splitMode.random')}</option>
              {splitOptions.map((option) => (
                <option
                  key={`${option.mode}:${option.column}`}
                  value={`${option.mode}:${option.column}`}
                >
                  {t(
                    option.mode === 'chronological'
                      ? 'ml.lab.splitMode.chronological'
                      : 'ml.lab.splitMode.group',
                    { column: option.column },
                  )}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <Leaderboard />

      <UncertaintyPanel />

      <RobustRankPanel />

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
