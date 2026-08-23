/**
 * V30 — one shape for a bench result, and one way of printing it.
 *
 * The browser bench (WebGPU, the shipped runtime) and the Node bench (CPU, the
 * one that runs without a GPU) must be comparable line by line, so both fill in
 * the same row type and both print through the function below. A difference
 * between two runs is then a difference in the model or the code — never in how
 * the two harnesses happened to count.
 */
import type { BenchCase, Outcome } from '@/features/ai/llm/corpus';

export interface BenchRow {
  q: string;
  lang: string;
  family: BenchCase['family'];
  /** The keyword grammar's reading. */
  deterministic: Outcome;
  /** The model's reading, asked of every question regardless of order. */
  llm: Outcome;
  /**
   * What the app actually answers, in the shipped order: the keyword grammar
   * when it has a reading, the model only otherwise. This is the number that
   * describes the product; the two above describe its parts.
   */
  pipeline: Outcome;
  raw: string;
  ms: number;
}

export interface BenchReport {
  label: string;
  total: number;
  loadMs: number;
  rows: BenchRow[];
}

export function tally(rows: readonly BenchRow[], key: 'deterministic' | 'llm' | 'pipeline') {
  const counts: Record<Outcome, number> = { ok: 0, wrong: 0, none: 0 };
  for (const row of rows) counts[row[key]] += 1;
  return counts;
}

function line(name: string, counts: Record<Outcome, number>, total: number): string {
  const pct = ((counts.ok / total) * 100).toFixed(0);
  return `${name.padEnd(22)} ${String(counts.ok).padStart(3)}/${total} justes (${pct} %) · ${counts.wrong} faux · ${counts.none} sans réponse`;
}

/**
 * The printed report. Wrong answers are listed in full and refusals are not:
 * a refusal is announced to the user as one, while a wrong answer is delivered
 * with the same confidence as a right one, and is the only outcome that costs
 * trust.
 */
export function formatReport(report: BenchReport): string {
  const out: string[] = [];
  const { rows, total } = report;
  out.push(`\n${report.label} — ${total} questions, modèle chargé en ${report.loadMs} ms`);
  out.push(line('déterministe', tally(rows, 'deterministic'), total));
  out.push(line('modèle local', tally(rows, 'llm'), total));
  out.push(line('appli (ordre livré)', tally(rows, 'pipeline'), total));

  // The split V27 hand-labelled is computed here instead: the questions the
  // keyword grammar gives up on ARE the gap the download has to justify.
  const gap = rows.filter((row) => row.deterministic === 'none');
  if (gap.length > 0) {
    const rescued = gap.filter((row) => row.llm === 'ok').length;
    out.push(
      `\nlà où le déterministe déclare forfait (${gap.length} questions) : ` +
        `modèle juste ${rescued}, faux ${gap.filter((r) => r.llm === 'wrong').length}, ` +
        `refus ${gap.filter((r) => r.llm === 'none').length}`,
    );
  }

  const misread = rows.filter((row) => row.deterministic === 'wrong');
  if (misread.length > 0) {
    out.push(
      `\nlues de travers par le déterministe (${misread.length}) — jamais rattrapables, ` +
        `il passe en premier :`,
    );
    for (const row of misread) out.push(`  ${row.q}`);
  }

  const wrong = rows.filter((row) => row.pipeline === 'wrong');
  if (wrong.length > 0) {
    out.push(
      `\nréponses fausses de l'appli (${wrong.length}) — les seules qui coûtent la confiance :`,
    );
    for (const row of wrong)
      out.push(`  ${row.q}\n    ${row.raw.replace(/\n/g, ' ').slice(0, 160)}`);
  }

  const times = rows.map((row) => row.ms).sort((a, b) => a - b);
  if (times.length > 0) {
    const median = Math.round(times[Math.floor(times.length / 2)]);
    out.push(
      `\nlatence modèle : médiane ${median} ms, max ${Math.round(times[times.length - 1])} ms`,
    );
  }
  return out.join('\n');
}
