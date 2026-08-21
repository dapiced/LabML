import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// V25 scale wave: a 120k-row CSV trains the full zoo under ANNOUNCED caps.
// Before V25 the app crashed past ~65k rows (call-stack overflow in the
// split); a file this size is the regression test for the whole mechanism.

/** Deterministic 120 000-row binary-classification CSV, learnable on x1+x2. */
function bigCsv(rows: number): Buffer {
  const lines: string[] = ['x1,x2,cat,label'];
  for (let i = 0; i < rows; i++) {
    const x1 = i % 97;
    const x2 = (i * 13) % 41;
    const cat = ['north', 'south', 'east'][i % 3];
    const label = x1 + x2 > 85 ? 'yes' : 'no';
    lines.push(`${x1},${x2},${cat},${label}`);
  }
  return Buffer.from(lines.join('\n'), 'utf-8');
}

test('120k rows: the zoo trains, every sample is announced, nothing dies', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/ml');
  await page.getByTestId('dataset-file-input').setInputFiles({
    name: 'big-120k.csv',
    mimeType: 'text/csv',
    buffer: bigCsv(120_000),
  });
  await expect(page.getByText('120,000 rows · 4 columns')).toBeVisible({ timeout: 60_000 });

  await page.selectOption('#target-select', 'label');
  await expect(page.getByTestId('task-badge')).toHaveText('Binary classification');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 240_000 });

  const leaderboard = page.getByTestId('leaderboard');
  // The global cap is announced by name and by number — never silent.
  await expect(leaderboard).toContainText(
    'announced sample: 100,000 of 120,000 usable rows (seeded, stratified)',
  );
  // Per-family caps are announced on their own rows (worst and best cases).
  await expect(leaderboard).toContainText('sample: 1,000 rows'); // forest
  await expect(leaderboard).toContainText('sample: 50,000 rows'); // gbdt
  // All 8 classifiers completed — the wave has no "failed" row.
  await expect(leaderboard).not.toContainText('failed');
});

test('the memory guard refuses a 21M-cell file by name, with the numbers', async ({ page }) => {
  test.setTimeout(180_000);
  // 210 columns x 100 000 rows = 21M cells: past the 20M budget the stream
  // stops and the refusal spells out the budget. The file itself is ~42 MB.
  const header = Array.from({ length: 210 }, (_, i) => `c${i + 1}`).join(',');
  const row = Array.from({ length: 210 }, () => '1').join(',');
  const csv = `${header}\n${`${row}\n`.repeat(100_000)}`;
  await page.goto('/ml');
  await page.getByTestId('dataset-file-input').setInputFiles({
    name: 'too-wide.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  });
  const panel = page.getByTestId('parse-error');
  await expect(panel).toBeVisible({ timeout: 120_000 });
  await expect(panel).toContainText('File too large for browser memory');
  await expect(panel).toContainText('20,000,000-cell budget');
  await expect(panel).toContainText('210 columns');
});
