import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function readYaml(path: string) {
  return parse(read(path));
}

describe('supply-chain automation', () => {
  it('checks npm and GitHub Actions dependencies every week without grouping major updates', () => {
    const dependabot = readYaml('.github/dependabot.yml');

    expect(dependabot).toEqual({
      version: 2,
      updates: [
        {
          'package-ecosystem': 'npm',
          directory: '/',
          schedule: {
            interval: 'weekly',
            day: 'monday',
            time: '08:00',
            timezone: 'America/Toronto',
          },
          'open-pull-requests-limit': 10,
          labels: ['dependencies'],
          groups: {
            'development-dependencies': {
              'dependency-type': 'development',
              'update-types': ['minor', 'patch'],
            },
          },
        },
        {
          'package-ecosystem': 'github-actions',
          directory: '/',
          schedule: {
            interval: 'weekly',
            day: 'monday',
            time: '08:30',
            timezone: 'America/Toronto',
          },
          'open-pull-requests-limit': 5,
          labels: ['dependencies'],
          groups: {
            'actions-minor-and-patch': {
              patterns: ['*'],
              'update-types': ['minor', 'patch'],
            },
          },
        },
      ],
    });
  });

  it('runs CodeQL for pull requests, main, and a weekly schedule with narrow permissions', () => {
    const codeql = readYaml('.github/workflows/codeql.yml');

    expect(codeql.on).toEqual({
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
      schedule: [{ cron: '23 9 * * 1' }],
    });
    expect(codeql.permissions).toEqual({
      contents: 'read',
      'security-events': 'write',
    });
    expect(codeql.concurrency).toEqual({
      group: 'codeql-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    });
    expect(codeql.jobs).toEqual({
      analyze: {
        name: 'Analyze JavaScript and TypeScript',
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 20,
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            uses: 'github/codeql-action/init@v4',
            with: { languages: 'javascript-typescript' },
          },
          { uses: 'github/codeql-action/analyze@v4' },
        ],
      },
    });
  });

  it('blocks high production advisories and critical development advisories', () => {
    const ci = readYaml('.github/workflows/ci.yml');
    const auditStep = ci.jobs.quality.steps.find(
      (step: { name?: string }) => step.name === 'Audit production and development dependencies',
    );

    expect(auditStep).toEqual({
      name: 'Audit production and development dependencies',
      run: 'npm audit --omit=dev --audit-level=high\nnpm audit --audit-level=critical\n',
    });
  });
});
