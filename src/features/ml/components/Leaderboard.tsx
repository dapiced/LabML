import { LeaderboardTable } from '@/features/ml/components/LeaderboardTable';
import { useLabStore } from '@/features/ml/lab-store';

/** Store-bound leaderboard of the live run, with per-row model inspection. */
export function Leaderboard() {
  const results = useLabStore((s) => s.results);
  const summary = useLabStore((s) => s.summary);
  const task = useLabStore((s) => s.task);
  const insights = useLabStore((s) => s.insights);
  const selectInsightModel = useLabStore((s) => s.selectInsightModel);
  const rankMetric = useLabStore((s) => s.rankMetric);
  const setRankMetric = useLabStore((s) => s.setRankMetric);
  if (results.length === 0 || !task) return null;

  return (
    <LeaderboardTable
      results={results}
      summary={summary}
      taskType={task.type}
      inspectedModel={insights?.model ?? null}
      onSelectModel={selectInsightModel}
      rankMetric={rankMetric}
      onRankMetric={setRankMetric}
    />
  );
}
