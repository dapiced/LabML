/**
 * V32 — the documentation, checked against the app it documents.
 *
 * Rule (1) of the wave: everything in LabML is seeded at 42, so « you will get
 * 0.792 » is not a turn of phrase — it is an assertion. This spec runs the
 * tutorial's own path and compares what the app produces against what the
 * Markdown page claims. A page that drifts fails the build, which is the same
 * promise the rest of the site makes about its numbers.
 *
 * It also guards the rule the MEASUREMENT added, which the plan did not
 * anticipate: two runs of the same tutorial agree on every metric and disagree
 * on every wall clock (Random forest measured 12 050 ms and 13 231 ms). So a
 * doc page may quote a metric and may never quote a duration — the last test
 * here is what stops a well-meaning edit from putting one back.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

const DOC_DIR = 'src/content/docs';
const SHAPE = '891 rows · 15 columns';

/**
 * Every figure a doc page QUOTES from the app — that is, every number inside a
 * blockquote or a table cell. Prose may reason with numbers freely (« ten
 * minutes », « 62% of the rows »); a blockquote is a reproduction of what the
 * screen says, and a table is a reproduction of the leaderboard, so every
 * number in one has to exist in the app's own output.
 *
 * This direction is the one that matters, and the first version of this spec
 * had it backwards. It asserted the page CONTAINS the right figures — which a
 * page still does after someone edits one occurrence of 0.792 into 0.800,
 * because the other occurrence keeps the assertion true. Checked: that edit
 * passed. Reading the figures OUT of the page and demanding the app produce
 * each one fails on the first wrong digit.
 */
function quotedFigures(markdown: string): string[] {
  const figures = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) figures.add(match[0]);
  };
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const isQuote = trimmed.startsWith('>');
    const isTableRow = trimmed.startsWith('|') && !/^\|[\s|:-]+\|$/.test(trimmed);
    if (isQuote || isTableRow) collect(trimmed);
    // A **bolded** figure anywhere is a claim about the app too — and it is the
    // one the reader takes away. Checked: with only quotes and tables covered,
    // editing the prose « it scores **0.792** » into 0.800 still passed.
    for (const bold of trimmed.matchAll(/\*\*([^*]*\d[^*]*)\*\*/g)) collect(bold[1]);
  }
  return [...figures];
}

/**
 * The limit of this guard, stated rather than left to be discovered: it covers
 * blockquotes, tables and bold. A figure written in plain prose — « accuracy
 * lands near 0.8 » — is NOT checked, because prose also carries numbers that
 * are reasoning rather than quotation (« ten minutes », « 62% of the rows »,
 * « you could publish 99% »), and demanding the app produce those would fail
 * on sentences that are perfectly true. So the convention a page must follow
 * is: a figure you want checked goes in a quote, a table, or bold.
 */

/** The claims the tutorial makes in prose that must remain true of the app. */
const CLAIMS = ['k-nearest neighbors', 'decision tree'] as const;

test('every figure the tutorial quotes is one the app really produces', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/ml');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await page.selectOption('#target-select', 'survived');
  await expect(page.getByTestId('task-badge')).toHaveText('Binary classification');
  // The tutorial teaches that the leak is caught and named. If it stopped being
  // caught, the page would be promising a safety net that is not there.
  await expect(page.getByTestId('leak-alert')).toContainText('alive');

  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('plain-read')).not.toBeEmpty({ timeout: 60_000 });

  // Everything the tutorial reproduces, as the app renders it.
  const shown = await page.evaluate(() => {
    const at = (selector: string) =>
      (document.querySelector(selector) as HTMLElement | null)?.innerText ?? '';
    const runInfo = [...document.querySelectorAll('p')]
      .map((node) => (node as HTMLElement).innerText ?? '')
      .filter((text) => /seed 42 · \d+ train rows/.test(text.trim()))
      .join(' ');
    return [
      at('[data-testid="leaderboard"]'),
      at('[data-testid="champion-gap"]'),
      at('[data-testid="plain-read"]'),
      at('[data-testid="leak-alert"]'),
      runInfo,
      document.body.innerText.match(/\d+ rows · \d+ columns/)?.[0] ?? '',
    ].join('\n');
  });

  for (const lang of readdirSync(DOC_DIR)) {
    for (const file of readdirSync(`${DOC_DIR}/${lang}`)) {
      const markdown = readFileSync(`${DOC_DIR}/${lang}/${file}`, 'utf8');
      const figures = quotedFigures(markdown);
      expect(figures.length, `${lang}/${file} quotes no figure at all`).toBeGreaterThan(8);
      for (const figure of figures) {
        expect(shown, `${lang}/${file} quotes ${figure}, which the app never shows`).toContain(
          figure,
        );
      }
    }
  }

  // The tutorial's central lesson: the elected champion is NOT best on test.
  const rows = page.getByTestId('leaderboard').locator('tbody tr');
  await expect(rows.first()).toContainText(CLAIMS[0]);
  await expect(page.getByTestId('champion-gap')).toContainText(CLAIMS[0]);
  const leaderboard = (await page.getByTestId('leaderboard').innerText()).toLowerCase();
  expect(leaderboard.indexOf(CLAIMS[1])).toBeGreaterThan(-1);
});

test('the docs index lists the tutorial and the local search finds it', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Learn LabML');
  await expect(page.getByTestId('docs-link')).toContainText('Your first model in 10 minutes');

  // Search is a local index — no request may leave for it.
  const outbound: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).host;
    if (host !== new URL(page.url()).host) outbound.push(request.url());
  });
  await page.getByTestId('docs-search').fill('leakage');
  await expect(page.getByTestId('docs-hit')).toContainText('Your first model');
  await page.getByTestId('docs-search').fill('zzzznothing');
  await expect(page.getByTestId('docs-no-hit')).toBeVisible();
  expect(outbound, 'searching must not call anyone').toEqual([]);
});

test('a doc page renders its outline and its « try it » link does the thing', async ({ page }) => {
  await page.goto('/docs/premier-modele');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your first model');
  // The outline is built from the page's own h2/h3 — not hand-maintained.
  const toc = page.getByTestId('doc-toc').locator('li');
  expect(await toc.count()).toBeGreaterThan(4);

  // Rule (3): better than a screenshot, a link that lands ready to use.
  await page.locator('[data-doc-try]').first().click();
  await expect(page).toHaveURL(/\/ml\?demo=titanic/);
  await expect(page.getByText(SHAPE)).toBeVisible({ timeout: 30_000 });
});

test('a deep link may load a demo AND select the target', async ({ page }) => {
  await page.goto('/ml?demo=titanic&target=survived');
  await expect(page.getByText(SHAPE)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('task-badge')).toHaveText('Binary classification');
  await expect(page.locator('#target-select')).toHaveValue('survived');
});

test('an unknown ?demo= is ignored rather than fetched', async ({ page }) => {
  const attempted: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/datasets/')) attempted.push(request.url());
  });
  await page.goto('/ml?demo=../../../etc/passwd');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(attempted, 'a URL parameter that becomes a path must be gated').toEqual([]);
});

test('no documentation page quotes a wall-clock duration', () => {
  // Measured on the tutorial's own path: two identical runs agreed on every
  // metric and disagreed on every timing (Random forest 12 050 ms vs
  // 13 231 ms). A page quoting « trained in 0.7 ms » would therefore break the
  // build with nothing actually broken — so quoting one is forbidden here
  // rather than discovered later by a red CI on an innocent commit.
  const forbidden = /\b\d+(?:[.,]\d+)?\s*(ms|milliseconds?|secondes?|seconds?)\b/i;
  for (const lang of readdirSync(DOC_DIR)) {
    for (const file of readdirSync(`${DOC_DIR}/${lang}`)) {
      const text = readFileSync(`${DOC_DIR}/${lang}/${file}`, 'utf8');
      const hit = forbidden.exec(text);
      expect(hit?.[0], `${lang}/${file} quotes a timing: ${hit?.[0]}`).toBeUndefined();
    }
  }
});
