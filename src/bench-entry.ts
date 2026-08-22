/** Entry point of the V27 interpretation bench — see features/ai/llm/bench.ts. */
import { runBench, type BenchReport } from '@/features/ai/llm/bench';

declare global {
  interface Window {
    v27?: BenchReport;
    v27Error?: string;
    v27Done?: boolean;
  }
}

const log = document.getElementById('log')!;
function append(line: string) {
  log.textContent += `\n${line}`;
}

runBench(append)
  .then((report) => {
    window.v27 = report;
    append('TERMINÉ');
  })
  .catch((error: unknown) => {
    window.v27Error = error instanceof Error ? error.message : String(error);
    append(`ÉCHEC : ${window.v27Error}`);
  })
  .finally(() => {
    window.v27Done = true;
  });
