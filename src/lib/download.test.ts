import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVOKE_DELAY_MS, downloadFile } from './download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadFile', () => {
  it('keeps the object URL alive until the click has been handled', () => {
    vi.useFakeTimers();
    // jsdom implements neither half of the object-URL API.
    const create = vi.fn(() => 'blob:labml/1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadFile('query.csv', 'a,b\n1,2\n', 'text/csv');

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('query.csv');
    expect(anchor.href).toBe('blob:labml/1');
    // Revoked in the same tick, some engines cancel the download silently.
    expect(revoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith('blob:labml/1');
  });
});
