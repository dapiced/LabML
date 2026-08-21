import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

/** A 224×224 PNG built in the browser — no binary fixture to maintain. */
async function makePhoto(page: import('@playwright/test').Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 224;
    canvas.height = 224;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-2d');
    ctx.fillStyle = '#b45309';
    ctx.fillRect(0, 0, 224, 224);
    ctx.fillStyle = '#134e4a';
    ctx.beginPath();
    ctx.arc(112, 112, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f7f6';
    ctx.fillRect(40, 40, 60, 24);
    return canvas.toDataURL('image/png');
  });
  return {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
  };
}

test('the AI hub links to the vision playground', async ({ page }) => {
  await page.goto('/ai');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Deep learning');
  await expect(page.getByText('Chat over your data')).toBeVisible();
  await page.getByRole('link', { name: 'Open the vision playground' }).click();
  await expect(page).toHaveURL(/\/ai\/vision$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('neural network');
});

test('vision playground classifies an image entirely in the browser', async ({ page }) => {
  await page.goto('/ai/vision');

  // The ~5 MB model is served by the site itself; first load can take a while.
  await expect(page.getByText(/Model loaded in \d+ ms/)).toBeVisible({ timeout: 120_000 });

  const photo = await makePhoto(page);
  await page.locator('input[type="file"]').setInputFiles(photo);

  // Content-agnostic assertions: 5 ranked classes with probabilities, plus latency.
  await expect(page.getByTestId('vision-prediction')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.getByText(/inference \d+ ms/)).toBeVisible();
  await expect(page.getByTestId('vision-prediction').first()).toContainText('%');
  await expect(page.getByRole('img', { name: 'Analyzed image' })).toBeVisible();
});

test('webcam capture classifies a live frame (fake camera)', async ({ page }) => {
  await page.goto('/ai/vision');
  await expect(page.getByText(/Model loaded in \d+ ms/)).toBeVisible({ timeout: 120_000 });

  await page.getByTestId('webcam-open').click();
  const video = page.getByTestId('webcam-video');
  await expect(video).toBeVisible();
  // Wait for the fake stream to deliver frames before capturing.
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);

  await page.getByTestId('webcam-capture').click();
  await expect(page.getByTestId('vision-prediction')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.getByRole('img', { name: 'Analyzed image' })).toBeVisible();
});
