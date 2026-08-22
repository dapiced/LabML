/**
 * Drives the V27 interpretation bench in a real browser and prints the tally.
 * Needs a GPU with `shader-f16` — CI runners do not have one, which is why
 * this is a repo tool and not a test.
 *
 *   npm run llm:prepare -- public/llm
 *   V27_BENCH=1 npm run build && npm run preview &
 *   node scripts/run-llm-bench.mjs [url]
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/bench-v27.html';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('[page]', String(error).slice(0, 300)));
await page.goto(url);

let previous = '';
for (;;) {
  if (await page.evaluate(() => window.v27Done === true)) break;
  const text = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
  if (text !== previous) {
    const lines = text.trim().split('\n');
    console.log('  ' + lines[lines.length - 1]);
    previous = text;
  }
  await page.waitForTimeout(2000);
}

const report = await page.evaluate(() => window.v27);
const failure = await page.evaluate(() => window.v27Error);
await browser.close();

if (!report) {
  console.error(`\nBanc en échec : ${failure ?? 'aucun résultat'}`);
  process.exit(1);
}

const tally = (key) =>
  report.rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] ?? 0) + 1;
    return acc;
  }, {});
const beyond = report.rows.filter((r) => r.beyondKeywords);
console.log(`\nchargement : ${report.loadMs} ms · ${report.total} questions`);
console.log('déterministe :', JSON.stringify(tally('deterministic')));
console.log('modèle local :', JSON.stringify(tally('llm')));
console.log(
  `au-delà des mots-clés (${beyond.length} questions) : ` +
    `déterministe ${beyond.filter((r) => r.deterministic === 'ok').length}/${beyond.length}, ` +
    `modèle ${beyond.filter((r) => r.llm === 'ok').length}/${beyond.length}`,
);
if (process.env.V27_OUT) {
  writeFileSync(process.env.V27_OUT, JSON.stringify(report, null, 2));
  console.log(`\nrapport écrit dans ${process.env.V27_OUT}`);
}
