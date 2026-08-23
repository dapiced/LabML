/**
 * V32 — « try it »: a documentation link that DOES the thing.
 *
 * The wave's rule (3): better than a screenshot, a link that lands on the
 * panel with the demo already loaded. A screenshot is a claim about the past —
 * it rots silently the day the UI moves, and nothing fails. A deep link either
 * works or is caught by `e2e/docs.spec.ts`.
 *
 * `/ml?demo=titanic&target=survived` loads the dataset and selects the column.
 * Both parameters are validated, never trusted: `demo` is resolved against the
 * shipped list (it becomes a fetched path), and `target` is applied only once
 * the file has actually been read and only if the column really exists —
 * otherwise the lab would sit in a state its own UI cannot produce.
 *
 * It fires ONCE per navigation. Re-applying on every render would fight the
 * visitor: choose another target and the URL would snap it back.
 */
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { resolveDemo } from '@/features/ml/demos';
import { useLabStore } from '@/features/ml/lab-store';

export function useDeepLink(): void {
  const [params] = useSearchParams();
  const demo = resolveDemo(params.get('demo'));
  const wantedTarget = params.get('target');

  const loadDemo = useLabStore((s) => s.loadDemo);
  const setTarget = useLabStore((s) => s.setTarget);
  const status = useLabStore((s) => s.status);
  const profiles = useLabStore((s) => s.profiles);
  const currentTarget = useLabStore((s) => s.target);

  const loaded = useRef(false);
  const targeted = useRef(false);

  useEffect(() => {
    if (!demo || loaded.current) return;
    loaded.current = true;
    loadDemo(demo);
  }, [demo, loadDemo]);

  useEffect(() => {
    if (!demo || !wantedTarget || targeted.current) return;
    // The column list only exists once the worker has parsed the file.
    if (status !== 'ready' || currentTarget !== null) return;
    if (!profiles.some((profile) => profile.name === wantedTarget)) return;
    targeted.current = true;
    setTarget(wantedTarget);
  }, [demo, wantedTarget, status, profiles, currentTarget, setTarget]);
}
