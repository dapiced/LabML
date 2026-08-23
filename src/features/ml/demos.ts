/**
 * The demo datasets, in one place.
 *
 * V32 made this a shared module rather than a constant inside `DropZone`:
 * the documentation's « try it » links carry `?demo=<file>`, and that value
 * reaches `loadDemo`, which builds the path `/datasets/<file>`. A URL
 * parameter that becomes a file path is a hole unless something closes it, so
 * the deep link is checked against this list and nothing else — an unknown
 * name is ignored, never fetched.
 */
export const DEMO_DATASETS = [
  { file: 'iris.csv', size: '4 KB', task: 'multiclass' },
  { file: 'titanic.csv', size: '56 KB', task: 'binary' },
  { file: 'fraud.csv', size: '20 KB', task: 'binary' },
  { file: 'mpg.csv', size: '21 KB', task: 'regression' },
  { file: 'energy.csv', size: '5 KB', task: 'timeseries' },
  { file: 'reviews.csv', size: '28 KB', task: 'text' },
] as const;

export type DemoFile = (typeof DEMO_DATASETS)[number]['file'];

/**
 * Resolve a `?demo=` value to a real demo file, or null.
 *
 * Accepts the bare stem too (`titanic`), because that is what reads well in a
 * documentation link and what a person types by hand. Everything else — a
 * path, a traversal, an absolute URL, an unknown name — returns null.
 */
export function resolveDemo(value: string | null | undefined): DemoFile | null {
  if (!value) return null;
  const wanted = value.endsWith('.csv') ? value : `${value}.csv`;
  return DEMO_DATASETS.find((demo) => demo.file === wanted)?.file ?? null;
}
