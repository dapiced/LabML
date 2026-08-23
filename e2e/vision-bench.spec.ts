/**
 * V31 — the vision bench, replayed in the real browser.
 *
 * It drives `/ai/vision` exactly as a visitor does: the same canvas crop, the
 * same three ONNX sessions, the same worker. Measuring outside the page would
 * measure a different pipeline — the crop happens in a canvas, and the crop is
 * one of the things under suspicion.
 *
 * It runs with the ordinary e2e suite rather than behind a flag: fourteen
 * images cost about half a minute, and a measurement nobody runs is the defect
 * V30 spent a wave fixing.
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { VISION_CASES, unnameableCount } from '../src/features/ai/vision/corpus';

test.use({ locale: 'en-US' });

const MODELS_READY = /Models loaded in \d+ ms/;

interface Row {
  file: string;
  top1: string;
  top1p: number;
  top5: string[];
  /** 'ok' | 'wrong' | 'unnameable' — the third is not the model's fault. */
  verdict: 'ok' | 'wrong' | 'unnameable';
  /** What the page CLAIMED about the subject (V31 C — verdict.ts). */
  claim: 'named' | 'no-class-for-people' | 'unsure';
  top5hit: boolean;
  objects: Record<string, number>;
  objectsOk: boolean | null;
  faces: number;
  facesOk: boolean | null;
}

interface Snapshot {
  predictions: string[];
  chips: string[];
  faces: string;
  /** `data-verdict` off the subject block: 'named' until a result renders. */
  claim: string;
  /** Preview blob URL + inference time — both change for every new image. */
  stamp: string;
}

/**
 * One atomic read of the result panel — and the whole reason this is not three
 * locator calls. The panel keeps the PREVIOUS image's result on screen while
 * the worker computes the next one, so a naive read returns the last image's
 * answer for this one. The first run of this bench did exactly that and
 * reported every result shifted by one, which is a corpus-shaped lie.
 *
 * `stamp` is what makes the read honest: the preview's blob URL is fresh for
 * every file, and the inference time is re-measured for every run. Reading is
 * only allowed once BOTH have changed from what they were before the file was
 * set — the image on screen is the new one, and the number beside it was
 * computed for it.
 */
async function readResult(
  page: import('@playwright/test').Page,
  file: string,
  before: string,
): Promise<Snapshot> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const snapshot = await snap(page);
    if (snapshot.predictions.length === 5 && snapshot.faces !== '' && snapshot.stamp !== before) {
      return snapshot;
    }
    if (Date.now() > deadline) throw new Error(`résultat périmé ou incomplet pour ${file}`);
    await page.waitForTimeout(200);
  }
}

function snap(page: import('@playwright/test').Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const text = (id: string) =>
      [...document.querySelectorAll(`[data-testid="${id}"]`)].map(
        (node) => (node as HTMLElement).innerText,
      );
    const preview = document.querySelector<HTMLImageElement>('img[alt="Analyzed image"]');
    const subject = document.querySelector<HTMLElement>('[data-testid="vision-subject"]');
    const timing = [...document.querySelectorAll('p, span, div')]
      .map((node) => (node as HTMLElement).innerText ?? '')
      .find((value) => /inference \d+ ms/.test(value));
    return {
      predictions: text('vision-prediction'),
      chips: text('vision-object-chip'),
      faces: text('vision-faces')[0] ?? '',
      claim: subject?.dataset.verdict ?? '',
      stamp: `${preview?.src ?? ''}|${timing ?? ''}`,
    };
  });
}

test('V31 — what the playground gets right, as a number', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/ai/vision');
  await expect(page.getByText(MODELS_READY)).toBeVisible({ timeout: 120_000 });

  const rows: Row[] = [];
  for (const entry of VISION_CASES) {
    const before = (await snap(page)).stamp;
    await page.locator('input[type="file"]').setInputFiles(entry.file);
    // Read the whole result in ONE pass, retrying until it is complete.
    // Reading piece by piece raced with React: `toHaveCount(5)` was satisfied by
    // the PREVIOUS image's rows, which were then cleared while the worker ran,
    // and the next read landed in the gap.
    const snapshot = await readResult(page, entry.file, before);

    const parsed = snapshot.predictions.map((text) => {
      const [label, percent] = text.split('\n');
      return { label: label.trim(), p: Number.parseFloat(percent) / 100 };
    });
    const objects: Record<string, number> = {};
    for (const chip of snapshot.chips) {
      const match = /^(.*?)(?: ×(\d+))?$/.exec(chip.trim());
      // The chips are upper-cased by CSS, not by the data — comparing them to
      // the corpus's COCO names without folding scored every detector case as a
      // miss, which is a bench bug masquerading as a model failure.
      if (match) objects[match[1].toLowerCase()] = Number(match[2] ?? 1);
    }
    const faces = /No faces/i.test(snapshot.faces)
      ? 0
      : Number(/(\d+)/.exec(snapshot.faces)?.[1] ?? 0);

    const top1 = parsed[0];
    const verdict: Row['verdict'] =
      entry.accept.length === 0 ? 'unnameable' : entry.accept.includes(top1.label) ? 'ok' : 'wrong';
    rows.push({
      file: entry.file.split('/').pop()!,
      top1: top1.label,
      top1p: top1.p,
      top5: parsed.map((x) => x.label),
      verdict,
      claim: snapshot.claim as Row['claim'],
      top5hit: entry.accept.some((label) => parsed.some((x) => x.label === label)),
      objects,
      objectsOk:
        entry.objects === undefined
          ? null
          : Object.entries(entry.objects).every(([label, min]) => (objects[label] ?? 0) >= min),
      faces,
      facesOk: entry.faces === undefined ? null : faces === entry.faces,
    });
  }

  const nameable = rows.filter((row) => row.verdict !== 'unnameable');
  const unnameable = rows.filter((row) => row.verdict === 'unnameable');
  const ok = nameable.filter((row) => row.verdict === 'ok').length;
  const top5 = nameable.filter((row) => row.top5hit).length;
  const objectRows = rows.filter((row) => row.objectsOk !== null);
  const faceRows = rows.filter((row) => row.facesOk !== null);

  // --- V31 (C): what the page CLAIMED, scored against what it should have.
  // A refusal is right on an image ImageNet cannot name and on one it names
  // wrongly; it is a *cost* on an image it named correctly. Both sides are
  // counted, because a refusal that never costs anything is a refusal that
  // never fires.
  const refused = (row: Row) => row.claim !== 'named';
  const honest = unnameable.filter(refused).length;
  const wrongRows = nameable.filter((row) => row.verdict === 'wrong');
  const caught = wrongRows.filter(refused).length;
  const okRows = nameable.filter((row) => row.verdict === 'ok');
  const lost = okRows.filter(refused).length;

  const report = [
    `\nbanc vision V31 — ${rows.length} images`,
    `classification (là où une étiquette existe, ${nameable.length}) : ` +
      `top-1 ${ok}/${nameable.length}, top-5 ${top5}/${nameable.length}`,
    `sans étiquette possible (${unnameable.length}) :`,
    ...unnameable.map(
      (row) =>
        `    ${row.file.padEnd(20)} « ${row.top1} » à ${(row.top1p * 100).toFixed(1)} %` +
        ` → ${refused(row) ? `REFUS (${row.claim})` : 'répond quand même'}`,
    ),
    `objets : ${objectRows.filter((r) => r.objectsOk).length}/${objectRows.length} images ` +
      `où tout ce qui devait être trouvé l'a été`,
    `visages : ${faceRows.filter((r) => r.facesOk).length}/${faceRows.length} comptes exacts`,
    '',
    'verdict honnête (V31 C) :',
    `  refus mérités   : ${honest}/${unnameable.length} images sans étiquette possible`,
    `  erreurs saisies : ${caught}/${wrongRows.length} mauvaises réponses annoncées comme telles`,
    `  coût            : ${lost}/${okRows.length} bonnes réponses perdues à un refus`,
    '',
    'détail :',
    ...rows.map(
      (row) =>
        `  ${row.verdict.padEnd(10)} ${row.claim.padEnd(20)} ${row.file.padEnd(20)} ` +
        `« ${row.top1} » ${(row.top1p * 100).toFixed(1)} % · ` +
        `objets ${JSON.stringify(row.objects)} · visages ${row.faces}`,
    ),
  ].join('\n');
  console.log(report);
  if (process.env.LABML_VISION_OUT) {
    writeFileSync(process.env.LABML_VISION_OUT, JSON.stringify({ rows }, null, 2));
  }

  expect(rows).toHaveLength(VISION_CASES.length);
  expect(unnameable.length).toBe(unnameableCount());
  // The two guarantees V31 (C) is allowed to claim, frozen so a later change to
  // the rules or the thresholds cannot quietly give them up:
  // every image ImageNet cannot name is refused, and no correct answer is lost.
  expect(honest).toBe(unnameable.length);
  expect(lost).toBe(0);
});
