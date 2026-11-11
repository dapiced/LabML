import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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
            react: {
              patterns: ['react', 'react-dom', '@types/react', '@types/react-dom'],
              'update-types': ['minor', 'patch'],
            },
          },
          ignore: [
            {
              'dependency-name': '@duckdb/duckdb-wasm',
              versions: ['>=1.29.0'],
            },
            {
              'dependency-name': '@huggingface/transformers',
              versions: ['>=4.3.0 <4.4.0'],
            },
            {
              'dependency-name': 'typescript',
              versions: ['>=7.0.0'],
            },
          ],
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
    expect(codeql.jobs.analyze).toMatchObject({
      name: 'Analyze JavaScript and TypeScript',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 20,
    });
    expect(codeql.jobs.analyze.steps).toHaveLength(3);
    expect(codeql.jobs.analyze.steps[0]).toEqual({
      uses: expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
      with: { 'persist-credentials': false },
    });
    expect(codeql.jobs.analyze.steps.slice(1)).toEqual([
      {
        uses: expect.stringMatching(/^github\/codeql-action\/init@[0-9a-f]{40}$/),
        with: { languages: 'javascript-typescript' },
      },
      { uses: expect.stringMatching(/^github\/codeql-action\/analyze@[0-9a-f]{40}$/) },
    ]);
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

  it('does not request deployment secrets for Dependabot pull requests', () => {
    const ci = readYaml('.github/workflows/ci.yml');

    expect(ci.jobs.deploy.if).toBe(
      "github.actor != 'dependabot[bot]' && (github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository)",
    );
  });

  // V49 — a tag can be moved by whoever controls the action's repository; a
  // commit SHA cannot. Dependabot keeps the pins current and reads the
  // trailing `# vX.Y.Z` comment to say which release a pin is.
  const WORKFLOWS = readdirSync('.github/workflows')
    .filter((name) => name.endsWith('.yml'))
    .map((name) => `.github/workflows/${name}`);

  it.each(WORKFLOWS)('%s pins every action to a full commit SHA with its release', (path) => {
    const uses = read(path)
      .split('\n')
      .filter((line) => /^\s*(- )?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it.each(WORKFLOWS)('%s never leaves the git token on the runner disk', (path) => {
    const workflow = readYaml(path);
    for (const job of Object.values(workflow.jobs) as {
      steps: { uses?: string; with?: object }[];
    }[]) {
      for (const step of job.steps.filter((s) => s.uses?.startsWith('actions/checkout@'))) {
        expect(step.with).toMatchObject({ 'persist-credentials': false });
      }
    }
  });

  it.each(WORKFLOWS)('%s expands no pull-request-controlled value inside a script', (path) => {
    // `${{ }}` is pasted into the script before the shell parses it, so a
    // branch name or a title there runs as code. Such values go through `env:`.
    const workflow = readYaml(path);
    const risky = /\$\{\{[^}]*github\.(head_ref|event\.(pull_request|issue|comment|review)\.)/;
    for (const job of Object.values(workflow.jobs) as { steps: { run?: string }[] }[]) {
      for (const step of job.steps) {
        if (step.run) expect(step.run).not.toMatch(risky);
      }
    }
  });
});

/**
 * V56 — the incidents of one working session, turned into rules. A browser
 * install died on a runner's DNS and took the e2e job with it; a deploy step
 * ended in `|| true`, which forgives every failure and not only the one it was
 * written for; four jobs had no time limit; the Node version was a literal in
 * six places beside a `.nvmrc` nobody read. Each rule below fails on the
 * workflows before this wave.
 */
describe('CI guards (V56)', () => {
  const WORKFLOWS = readdirSync('.github/workflows')
    .filter((name) => name.endsWith('.yml'))
    .map((name) => `.github/workflows/${name}`);

  type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
  type Job = { 'timeout-minutes'?: number; steps: Step[] };
  const jobsOf = (path: string) => Object.entries(readYaml(path).jobs as Record<string, Job>);

  it.each(WORKFLOWS)('%s gives every job a time limit', (path) => {
    for (const [name, job] of jobsOf(path)) {
      // GitHub's default is six hours: a hung job would burn them in silence.
      expect(job['timeout-minutes'], `${path} › ${name} has no timeout-minutes`).toBeTypeOf(
        'number',
      );
      expect(job['timeout-minutes']).toBeLessThanOrEqual(60);
    }
  });

  it.each(WORKFLOWS)('%s reads the Node version from .nvmrc, never from a literal', (path) => {
    for (const [name, job] of jobsOf(path)) {
      for (const step of job.steps.filter((s) => s.uses?.startsWith('actions/setup-node@'))) {
        expect(step.with, `${path} › ${name}`).toMatchObject({ 'node-version-file': '.nvmrc' });
        expect(step.with).not.toHaveProperty('node-version');
      }
    }
  });

  it('keeps .nvmrc inside the range package.json declares', () => {
    const major = Number(read('.nvmrc').trim().split('.')[0]);
    const floor = /(\d+)/.exec(JSON.parse(read('package.json')).engines.node)!;
    expect(major).toBeGreaterThanOrEqual(Number(floor[1]));
  });

  it.each(WORKFLOWS)('%s forgives no failure wholesale', (path) => {
    // `|| true` hides an expired token as well as an « already exists ».
    for (const [name, job] of jobsOf(path)) {
      for (const step of job.steps) {
        if (step.run) expect(step.run, `${path} › ${name}`).not.toMatch(/\|\|\s*(true|:)\s*$/m);
      }
    }
  });

  it('retries the browser download instead of failing the suite on one network error', () => {
    const steps = jobsOf('.github/workflows/ci.yml').flatMap(([, job]) => job.steps);
    const install = steps.filter((step) => step.run?.includes('playwright install'));
    expect(install.length).toBeGreaterThan(0);
    for (const step of install) {
      expect(step.run).toMatch(/for attempt in 1 2 3/);
      expect(step.run).toMatch(/sleep/);
    }
  });
});

/**
 * V56 — the weights LabML ships are binaries nobody reads in a diff. The
 * vision models are committed; their SHA-256 is pinned beside them, so a
 * model swapped for another of the same size fails here. The language model
 * is fetched at deploy time; `prepare-llm.mjs` held byte sizes only, and a
 * size says nothing about content.
 */
describe('model fingerprints (V56)', () => {
  const pinned = new Map(
    read('tests/models.sha256')
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, name] = line.trim().split(/\s+/);
        return [name, hash] as const;
      }),
  );

  it('pins every vision model that ships, and no model that does not', () => {
    expect([...pinned.keys()].sort()).toEqual(readdirSync('public/models').sort());
  });

  it.each(readdirSync('public/models'))('%s matches its pinned SHA-256', (file) => {
    const actual = createHash('sha256')
      .update(readFileSync(`public/models/${file}`))
      .digest('hex');
    expect(actual).toBe(pinned.get(file));
  });

  it('pins a SHA-256 for every language-model file fetched at a pinned revision', () => {
    const script = read('scripts/prepare-llm.mjs');
    const table = /const FILES = \{([\s\S]*?)\n\};/.exec(script)![1];
    const entries = [...table.matchAll(/'([^']+)':\s*(\{[^}]*\}|null)/g)];
    expect(entries.length).toBeGreaterThanOrEqual(9);
    for (const [, path, value] of entries) {
      // The one file taken from the base model's moving branch is not pinned,
      // by size or by hash, and the script says so.
      if (value === 'null') {
        expect(path).toBe('generation_config.json');
        continue;
      }
      expect(value, path).toMatch(/bytes: \d+/);
      expect(value, path).toMatch(/sha256:\s*'[0-9a-f]{64}'/);
    }
    // And the check is made, not merely declared.
    expect(script).toMatch(/hash-mismatch:/);
  });
});

/**
 * V56 — the README quoted 924 unit tests while a comment elsewhere said 898.
 * Counting `it(` would be wrong (an `it.each` is many tests), so this does not
 * count: it requires the README and the engineering log to state the same
 * figure, the highest one a delivered wave recorded.
 */
describe('the test counts the README quotes (V56)', () => {
  it('match the engineering log', () => {
    const plan = read('PLAN.md');
    const recorded = [...plan.matchAll(/(\d+)\s+unit\s+tests,\s+(\d+)\s+e2e/g)].map((m) => ({
      unit: Number(m[1]),
      e2e: Number(m[2]),
    }));
    const latest = recorded.reduce((a, b) => (b.unit > a.unit ? b : a));
    const quoted = /(\d+)\s+unit\s+tests\s+and\s+(\d+)\s+Playwright/.exec(read('README.md'))!;
    expect({ unit: Number(quoted[1]), e2e: Number(quoted[2]) }).toEqual(latest);
  });
});
