// Unit tests for the bounded-concurrency runner.
import { describe, it, expect } from 'vitest';

import { runWithConcurrency } from '../src/utils/concurrency.js';


describe('runWithConcurrency', () => {
  it('returns settled results in the original order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(results).toEqual(items.map((n) => ({ status: 'fulfilled', value: n * 10 })));
  });

  it('captures rejections without throwing (settled shape)', async () => {
    const items = ['ok', 'boom', 'ok2'];
    const results = await runWithConcurrency(items, 2, async (x) => {
      if (x === 'boom') {
        throw new Error('fail');
      }
      return x;
    });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1].status).toBe('rejected');
    expect(results[1].reason).toBeInstanceOf(Error);
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'ok2' });
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (unused, index) => index);

    await runWithConcurrency(items, 5, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });

    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles an empty list', async () => {
    expect(await runWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it('works when the limit exceeds the item count', async () => {
    const results = await runWithConcurrency([1, 2], 10, async (n) => n);
    expect(results.map((r) => r.value)).toEqual([1, 2]);
  });
});
