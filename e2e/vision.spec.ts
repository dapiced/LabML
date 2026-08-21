import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// The three models total ~19 MB served by the site itself — first load is slow.
const MODELS_READY = /Models loaded in \d+ ms/;

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

test('the deployed CSP allows blob: image previews', () => {
  // The preview server does not enforce _headers, so guard the config itself:
  // without blob: in img-src, uploaded-file previews render as broken images.
  const headers = readFileSync('public/_headers', 'utf8');
  expect(headers).toMatch(/img-src [^;\n]*blob:/);
});

test('vision playground analyzes an image entirely in the browser', async ({ page }) => {
  await page.goto('/ai/vision');
  await expect(page.getByText(MODELS_READY)).toBeVisible({ timeout: 120_000 });

  const photo = await makePhoto(page);
  await page.locator('input[type="file"]').setInputFiles(photo);

  // Content-agnostic assertions: 5 ranked classes with probabilities, plus latency.
  await expect(page.getByTestId('vision-prediction')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.getByText(/inference \d+ ms/)).toBeVisible();
  await expect(page.getByTestId('vision-prediction').first()).toContainText('%');
  // A drawn abstract image holds no faces — the honest answer is zero, not noise.
  await expect(page.getByTestId('vision-faces')).toContainText('No faces detected');
  // The preview must actually DECODE, not just exist — a CSP that blocks
  // blob: URLs leaves a visible-but-broken <img> (naturalWidth 0).
  const previewImg = page.getByRole('img', { name: 'Analyzed image' }).first();
  await expect(previewImg).toBeVisible();
  await expect
    .poll(async () => previewImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});

test('detection finds the person and the face on a real portrait', async ({ page }) => {
  await page.goto('/ai/vision');
  await expect(page.getByText(MODELS_READY)).toBeVisible({ timeout: 120_000 });

  // NASA portrait of Cdr. Eileen Collins (GPN-2000-001177) — public domain.
  // Path is cwd-relative, like the _headers read above.
  await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/astronaut.jpg');

  await expect(page.getByTestId('vision-faces')).toContainText('1 face detected', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('vision-objects')).toContainText('1 object detected');
  await expect(page.getByTestId('vision-object-chip')).toContainText('person');
  // Boxes are drawn over the image: one solid object rect + one dashed face rect.
  const annotated = page.getByTestId('vision-annotated');
  await expect(annotated.locator('svg rect')).toHaveCount(2);
});

test('webcam capture analyzes a live frame (fake camera)', async ({ page }) => {
  await page.goto('/ai/vision');
  await expect(page.getByText(MODELS_READY)).toBeVisible({ timeout: 120_000 });

  await page.getByTestId('webcam-open').click();
  const video = page.getByTestId('webcam-video');
  await expect(video).toBeVisible();
  // Wait for the fake stream to deliver frames before capturing.
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);

  await page.getByTestId('webcam-capture').click();
  await expect(page.getByTestId('vision-prediction')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.getByRole('img', { name: 'Analyzed image' }).first()).toBeVisible();
});
