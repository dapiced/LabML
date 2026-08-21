/**
 * V25: hard ceiling on cells (rows × columns) the lab keeps in worker memory.
 * Measured: 1M rows × 11 columns (11M cells) parses and profiles in ~13 s and
 * trains comfortably under the announced caps; well past 20M cells the tab
 * itself is at risk. The guard stops the stream and refuses BY NAME, with the
 * numbers, instead of letting the browser die silently.
 */
export const MAX_CELLS = 20_000_000;
