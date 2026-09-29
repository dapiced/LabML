export interface Wave {
  version: string;
  title: string;
  summary: string;
  why: string;
}

export function extractWaves(plan: string): Wave[];
export function renderChangelog(waves: Wave[]): string;
export function packageVersionFor(waves: Wave[]): string;
export function syncPackageVersion(packageJson: string, version: string): string;
export function syncLockVersion(lock: string, version: string): string;
