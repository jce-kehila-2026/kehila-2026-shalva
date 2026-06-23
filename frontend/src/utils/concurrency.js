// Run `worker(item, index)` over `items` with at most `limit` concurrent calls,
// resolving to settled results aligned to the original order. It NEVER throws —
// each entry is `{ status: 'fulfilled', value }` or `{ status: 'rejected', reason }`
// (the same shape as Promise.allSettled). There is deliberately NO writeBatch
// here: each worker performs its OWN independent operation, so a large set of
// writes is spread across many small requests instead of one big one.
export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);

  // The next item index any lane should pick up.
  let nextIndex = 0;

  // One "lane" keeps pulling the next item until the queue is empty.
  async function lane() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;

      try {
        results[current] = { status: 'fulfilled', value: await worker(items[current], current) };
      } catch (reason) {
        results[current] = { status: 'rejected', reason };
      }
    }
  }

  // Open up to `limit` lanes (never more than there are items, never fewer than 1).
  const laneCount = Math.max(1, Math.min(limit, items.length));
  const lanes = [];
  for (let i = 0; i < laneCount; i += 1) {
    lanes.push(lane());
  }

  await Promise.all(lanes);

  return results;
}
