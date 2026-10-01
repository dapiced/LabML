import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('supply-chain automation', () => {
  it('checks npm and GitHub Actions dependencies every week without grouping major updates', () => {
    const dependabot = read('.github/dependabot.yml');

    expect(dependabot).toContain('package-ecosystem: npm');
    expect(dependabot).toContain('package-ecosystem: github-actions');
    expect(dependabot.match(/interval: weekly/g)).toHaveLength(2);
    expect(dependabot).toContain('update-types:');
    expect(dependabot).toContain('- minor');
    expect(dependabot).toContain('- patch');
    expect(dependabot).not.toContain('- major');
  });

  it('runs CodeQL for pull requests, main, and a weekly schedule with narrow permissions', () => {
    const codeql = read('.github/workflows/codeql.yml');

    expect(codeql).toContain('pull_request:');
    expect(codeql).toContain('branches: [main]');
    expect(codeql).toContain('schedule:');
    expect(codeql).toContain('security-events: write');
    expect(codeql).toContain('contents: read');
    expect(codeql).toContain('languages: javascript-typescript');
    expect(codeql).toContain('github/codeql-action/init@v3');
    expect(codeql).toContain('github/codeql-action/analyze@v3');
  });

  it('blocks high production advisories and critical development advisories', () => {
    const ci = read('.github/workflows/ci.yml');

    expect(ci).toContain('name: Audit production and development dependencies');
    expect(ci).toContain('npm audit --omit=dev --audit-level=high');
    expect(ci).toContain('npm audit --audit-level=critical');
    expect(ci).not.toContain('run: npm audit --audit-level=high');
  });
});
