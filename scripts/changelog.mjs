/**
 * V41 — the CHANGELOG, extracted from `PLAN.md` rather than written by hand.
 *
 * PLAN.md is the engineering log: every wave has a row in one of its roadmap
 * tables, with the wave's content and the reason it was built. At 195 KB it is
 * not something a visitor reads, so this script reads it instead and writes one
 * entry per wave, newest first. The rule is the one V34 set for the limits
 * page: a record recalled from memory flatters, a record extracted from the
 * source cannot. `src/lib/changelog.test.ts` fails when `CHANGELOG.md` and the
 * plan disagree, in either direction.
 *
 *   npm run changelog
 *
 * Also aligns the version in `package.json` (and the lockfile's root entries)
 * on `1.<latest wave>.0`, which is what the home page reads to say « V40 ».
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** @typedef {{ version: string; title: string; summary: string; why: string }} Wave */

const ROW = /^\|(.*)\|\s*$/;
/** `V7`, `V27.1 — delivered`, `V12 — pending` — after the bold markers are gone. */
const WAVE = /^V(\d+(?:\.\d+)?)(?:\s*—\s*(delivered|pending))?$/;
/**
 * A cell that opens like a wave row and is not one the parser reads: a bare
 * version, or a version followed by some dash — an en dash or a hyphen where
 * the plan writes an em dash, a status other than the two the plan uses. The
 * benchmark tables' rows (« V27.3 as shipped — … ») put a word after the
 * version and are left alone.
 */
const WAVE_LIKE = /^V\d+(?:\.\d+)?(?:\s*[—–-]|$)/;
/**
 * A sentence ends at a period followed by whitespace, optionally closing a
 * bold run first (`itself.** Two`) so the bold stays balanced. A period inside
 * a decimal (`0.818`), a version (`V27.1`) or a file name (`x.csv`) has no
 * whitespace after it and ends nothing.
 */
const SENTENCE_END = /\.(\*\*)?(?=\s)/;

/**
 * @param {string} plan
 * @returns {Wave[]}
 */
export function extractWaves(plan) {
  /** @type {Wave[]} */
  const waves = [];
  for (const line of plan.split(/\r?\n/)) {
    const row = ROW.exec(line);
    if (!row) continue;
    // Split on pipes that are not escaped, then drop the escape: `\|` is how
    // Markdown writes a pipe inside a cell.
    const cells = row[1].split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
    if (cells.length < 2) continue;
    const label = cells[0].replace(/\*/g, '').trim();
    const head = WAVE.exec(label);
    if (!head) {
      // A row that names a wave and cannot be read is refused rather than
      // skipped: skipped, it leaves the version a wave behind with every test
      // green. Statuses other than the two the plan uses are a question for a
      // person, not a guess for a script.
      if (WAVE_LIKE.test(label)) throw new Error(`PLAN.md: cannot read wave row « ${label} »`);
      continue;
    }
    if (head[2] === 'pending') continue;
    // An unescaped pipe inside a cell splits the row and turns the tail of the
    // content into the « why » — measured on the V32 row, whose inline code
    // held one. The byte-for-byte test cannot see it, so the generator refuses.
    if (cells.length > 3) {
      throw new Error(
        `PLAN.md: wave V${head[1]} has ${cells.length} cells — an unescaped | inside a cell? Write it as \\|`,
      );
    }
    const content = cells[1];
    const title = titleOf(content);
    // Three rows of the plan (V25–V27) never got a « why » cell; an empty
    // rationale is reported as such rather than dropping the wave.
    waves.push({
      version: head[1],
      title,
      summary: summaryOf(content, title),
      why: cells[2] ?? '',
    });
  }
  return waves.sort((a, b) => compareVersions(b.version, a.version));
}

/** @param {string} content */
function titleOf(content) {
  const bold = /\*\*(.+?)\*\*/.exec(content);
  const raw = bold ? bold[1] : content.split(':')[0];
  return plain(raw);
}

/**
 * The first sentence — unless that sentence is the bold title and nothing
 * else, in which case the heading would be repeated and the sentence after it
 * is the one that says what the wave did.
 * @param {string} content
 * @param {string} title
 */
function summaryOf(content, title) {
  const first = firstSentence(content);
  if (plain(first) !== title) return first;
  const rest = content.slice(first.length).trim();
  return rest === '' ? first : firstSentence(rest);
}

/** @param {string} content */
function firstSentence(content) {
  const end = SENTENCE_END.exec(content);
  return end ? content.slice(0, end.index + end[0].length) : content;
}

/** Markdown bold and trailing punctuation removed, for comparing a title to a sentence. */
function plain(text) {
  return text
    .replace(/\*\*/g, '')
    .trim()
    .replace(/[.:—-]+$/, '')
    .trim();
}

/**
 * `28` sorts after `27.3`, which sorts after `27`.
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const [aMajor, aMinor = 0] = a.split('.').map(Number);
  const [bMajor, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/**
 * @param {Wave[]} waves newest first
 * @returns {string}
 */
export function renderChangelog(waves) {
  const head = [
    '# Changelog',
    '',
    'Generated from the roadmap tables in `PLAN.md` by `npm run changelog` — not edited by',
    'hand: a unit test fails when this file and the plan disagree, in either direction. One',
    'entry per wave, newest first; the first six waves (V1–V6, the MVP) predate the tables and',
    'are recorded in PLAN.md §B and §J. Each entry carries the opening sentence of its row and',
    'the reason the wave was built.',
    '',
  ];
  const body = waves.flatMap((wave) => [
    `## V${wave.version} — ${wave.title}`,
    '',
    wave.summary,
    '',
    ...(wave.why === '' ? [] : [`_Why:_ ${wave.why}`, '']),
  ]);
  return [...head, ...body].join('\n');
}

/**
 * `1.<latest integer wave>.0` — major 1 because nothing here breaks a
 * consumer, minor for the wave, patch always 0. Sub-waves (27.1, 27.2…) are
 * honesty fixes to their wave and do not move the number.
 * @param {Wave[]} waves
 */
export function packageVersionFor(waves) {
  const latest = Math.max(...waves.map((wave) => parseInt(wave.version, 10)));
  return `1.${latest}.0`;
}

/**
 * Rewrites the first `"version"` field only, leaving the file otherwise
 * byte-identical — `package.json` is hand-formatted and diffs should say
 * « version », not « reformatted ».
 * @param {string} packageJson
 * @param {string} version
 */
export function syncPackageVersion(packageJson, version) {
  return packageJson.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
}

/**
 * The lockfile names the root package twice (top level and `packages[""]`);
 * both carry a version, and only those two — every dependency has its own name.
 * @param {string} lock
 * @param {string} version
 */
export function syncLockVersion(lock, version) {
  return lock.replace(/("name": "labml",\s*"version": ")[^"]*(")/g, `$1${version}$2`);
}

function main() {
  const waves = extractWaves(readFileSync('PLAN.md', 'utf8'));
  if (waves.length === 0) throw new Error('PLAN.md holds no wave row');
  writeFileSync('CHANGELOG.md', renderChangelog(waves));
  const version = packageVersionFor(waves);
  writeFileSync('package.json', syncPackageVersion(readFileSync('package.json', 'utf8'), version));
  writeFileSync(
    'package-lock.json',
    syncLockVersion(readFileSync('package-lock.json', 'utf8'), version),
  );
  console.log(`CHANGELOG.md: ${waves.length} waves, latest V${waves[0].version} → ${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
