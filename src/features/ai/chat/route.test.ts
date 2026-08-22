import { describe, expect, it, vi } from 'vitest';
import { resolveIntent } from '@/features/ai/chat/route';
import type { Intent } from '@/features/ai/chat/engine';

const KEYWORD: Intent = { kind: 'count', filter: { column: 'sex', op: '=', value: 'female' } };
const RESCUED: Intent = { kind: 'aggregate', op: 'mean', column: 'age' };

describe('resolveIntent', () => {
  it('keeps the deterministic reading and never wakes the model', async () => {
    const llm = vi.fn(async () => RESCUED);
    const resolution = await resolveIntent(() => KEYWORD, llm);
    expect(resolution).toEqual({ intent: KEYWORD, by: 'deterministic' });
    expect(llm).not.toHaveBeenCalled();
  });

  it('asks the model only once the keyword grammar has given up', async () => {
    const llm = vi.fn(async () => RESCUED);
    const resolution = await resolveIntent(() => null, llm);
    expect(resolution).toEqual({ intent: RESCUED, by: 'llm' });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('says nobody understood — and that the model was consulted', async () => {
    expect(
      await resolveIntent(
        () => null,
        async () => null,
      ),
    ).toEqual({
      intent: null,
      by: 'none-both',
    });
  });

  it('says nobody understood — without claiming the model read anything', async () => {
    expect(await resolveIntent(() => null, null)).toEqual({ intent: null, by: 'none' });
  });
});
