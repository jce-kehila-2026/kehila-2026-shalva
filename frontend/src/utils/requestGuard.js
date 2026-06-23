// A monotonic request sequencer that guards against stale async results. Each
// load calls next() to claim the latest id; a load whose id is no longer the
// latest (because a newer load has since started) must NOT apply its result.
// Pure and framework-free, so it can be unit-tested directly.
export function createRequestGuard() {
  let latest = 0;

  return {
    // Claim and return the next request id (also makes it the current one).
    next() {
      latest += 1;
      return latest;
    },

    // Cancel any outstanding id WITHOUT issuing a new load id — used when a load
    // must be dropped (group/day change, unmount) so a late response is ignored.
    invalidate() {
      latest += 1;
    },

    // True only for the most recently claimed id.
    isCurrent(id) {
      return id === latest;
    },
  };
}
