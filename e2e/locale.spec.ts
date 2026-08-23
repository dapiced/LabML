import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(180_000);

/**
 * V38 — reading the file exactly as it was written.
 *
 * The file below is what French Excel actually produces: windows-1252 bytes,
 * semicolon delimiter, decimal comma, spaces grouping thousands. Before V38
 * every numeric column in it was lost in silence — measured at 18 accuracy
 * points on a 900-row set.
 */
function frenchExcelCsv(rows: number): Buffer {
  const lines = ['nom;surface;prix;région;cible'];
  for (let i = 0; i < rows; i++) {
    const surface = 30 + ((i * 7) % 170) + ',' + String(10 + (i % 90)).padStart(2, '0');
    const prix = `${1 + ((i * 13) % 9)} ${String((i * 37) % 1000).padStart(3, '0')},${String((i * 11) % 100).padStart(2, '0')}`;
    const region = ['Québec', 'Montréal', 'Gaspésie'][i % 3];
    const cible = (i * 7) % 170 > 85 ? 'oui' : 'non';
    lines.push(`bien ${i};${surface};${prix};${region};${cible}`);
  }
  // Encode as windows-1252: every character here is < 0x100 in that page.
  const text = lines.join('\n');
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

test('a French Excel export loads with its accents, its columns and its numbers', async ({
  page,
}) => {
  await page.goto('/ml');
  await page.getByTestId('dataset-file-input').setInputFiles({
    name: 'ventes-quebec.csv',
    mimeType: 'text/csv',
    buffer: frenchExcelCsv(400),
  });
  await expect(page.getByText('400 rows · 5 columns')).toBeVisible({ timeout: 60_000 });

  // The reading is announced, with the evidence that justified it.
  const notice = page.getByTestId('read-format-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Delimiter: « ; »');
  await expect(notice).toContainText('windows-1252');
  await expect(notice).toContainText('UTF-8 decoding failed');
  await expect(page.getByTestId('read-format-decimal')).toContainText('surface');
  await expect(page.getByTestId('read-format-decimal')).toContainText('prix');

  // The accents survived: replacement characters would mean the encoding lost.
  await expect(notice).toContainText('Québec');
  await expect(notice).not.toContainText('�');

  // And the point of the whole wave: the numbers are numbers again — with a
  // real range and a real median, not 400 one-hot buckets of text.
  const surface = page.getByTestId('column-card-surface');
  await expect(surface).toContainText('numeric');
  await expect(surface).toContainText('median');
  await expect(page.getByTestId('column-card-prix')).toContainText('numeric');
  await expect(page.getByTestId('column-card-région')).toContainText('categorical');
});

test('an ordinary UTF-8 comma file says nothing at all — no friction added', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  // Nothing was unusual, so there is nothing to announce.
  await expect(page.getByTestId('read-format-notice')).toHaveCount(0);
});
