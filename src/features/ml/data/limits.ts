/**
 * V25: hard ceiling on cells (rows × columns) the lab keeps in worker memory.
 * Measured: 1M rows × 11 columns (11M cells) parses and profiles in ~13 s and
 * trains comfortably under the announced caps; well past 20M cells the tab
 * itself is at risk. The guard stops the stream and refuses BY NAME, with the
 * numbers, instead of letting the browser die silently.
 */
export const MAX_CELLS = 20_000_000;

/**
 * V54: reads the detail of the guard's refusal (`too-large:<rows>:<columns>`),
 * so every section spells out the budget and where reading stopped instead of
 * showing the raw code. Null for any other error.
 */
export function tooLargeDetail(error: string | null): { rows: number; columns: number } | null {
  const match = /^too-large:(\d+):(\d+)$/.exec(error ?? '');
  return match ? { rows: Number(match[1]), columns: Number(match[2]) } : null;
}
