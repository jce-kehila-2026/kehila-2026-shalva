// Unit tests for the stale-result request guard.
import { describe, it, expect } from 'vitest';

import { createRequestGuard } from '../src/utils/requestGuard.js';


describe('createRequestGuard', () => {
  it('assigns increasing ids', () => {
    const guard = createRequestGuard();
    expect(guard.next()).toBe(1);
    expect(guard.next()).toBe(2);
  });

  it('treats only the latest id as current', () => {
    const guard = createRequestGuard();
    const first = guard.next();
    expect(guard.isCurrent(first)).toBe(true);

    const second = guard.next();
    expect(guard.isCurrent(first)).toBe(false); // superseded by `second`
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('a stale (older) response is not current and must not be applied', () => {
    const guard = createRequestGuard();
    const slowLoad = guard.next(); // load A starts
    guard.next();                  // load B starts (B becomes latest)
    // A finishes last, but it is stale:
    expect(guard.isCurrent(slowLoad)).toBe(false);
  });

  it('an old context result is not applied after the context changed', () => {
    const guard = createRequestGuard();
    const oldContext = guard.next(); // group/day A
    const newContext = guard.next(); // group/day B (current)
    expect(guard.isCurrent(oldContext)).toBe(false);
    expect(guard.isCurrent(newContext)).toBe(true);
  });

  it('invalidate() makes the outstanding id stale without issuing a new one', () => {
    const guard = createRequestGuard();
    const id = guard.next();
    expect(guard.isCurrent(id)).toBe(true);

    guard.invalidate();
    expect(guard.isCurrent(id)).toBe(false); // the in-flight load is now stale

    // A subsequent load still gets a fresh, current id.
    const next = guard.next();
    expect(guard.isCurrent(next)).toBe(true);
  });

  it('separate guards are independent', () => {
    const guardA = createRequestGuard();
    const guardB = createRequestGuard();
    const idA = guardA.next();
    guardB.next();
    guardB.next();
    expect(guardA.isCurrent(idA)).toBe(true);
  });
});
