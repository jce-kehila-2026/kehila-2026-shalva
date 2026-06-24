// Unit tests for the shared event-group helpers. These power the "an event can
// belong to several groups" feature while still reading the legacy single-group
// documents, so they're worth pinning down.
import { describe, it, expect } from 'vitest';

import {
  NO_GROUP,
  getEventGroups,
  eventMatchesGroupName,
  formatEventGroups,
} from '../src/utils/eventGroups.js';


describe('getEventGroups', () => {
  it('reads the new assignedGroups array', () => {
    const event = { assignedGroups: ['תותים', 'דובדבן'] };
    expect(getEventGroups(event)).toEqual(['תותים', 'דובדבן']);
  });

  it('falls back to the legacy single assignedGroup', () => {
    const event = { assignedGroup: 'אתרוג' };
    expect(getEventGroups(event)).toEqual(['אתרוג']);
  });

  it('prefers the array when both fields exist', () => {
    const event = { assignedGroups: ['תותים', 'דובדבן'], assignedGroup: 'תותים' };
    expect(getEventGroups(event)).toEqual(['תותים', 'דובדבן']);
  });

  it('drops the "no group" sentinel and empty values', () => {
    expect(getEventGroups({ assignedGroups: [NO_GROUP] })).toEqual([]);
    expect(getEventGroups({ assignedGroup: NO_GROUP })).toEqual([]);
    expect(getEventGroups({ assignedGroups: ['', '  ', 'רימונים'] })).toEqual(['רימונים']);
  });

  it('de-duplicates while preserving order', () => {
    const event = { assignedGroups: ['תותים', 'תותים', 'דובדבן'] };
    expect(getEventGroups(event)).toEqual(['תותים', 'דובדבן']);
  });

  it('returns an empty array for an event with no group (or no event)', () => {
    expect(getEventGroups({})).toEqual([]);
    expect(getEventGroups(null)).toEqual([]);
  });
});


describe('eventMatchesGroupName', () => {
  it('matches any of the event\'s groups (new array or legacy single)', () => {
    const multi = { assignedGroups: ['תותים', 'דובדבן'] };
    expect(eventMatchesGroupName(multi, 'דובדבן')).toBe(true);
    expect(eventMatchesGroupName(multi, 'אתרוג')).toBe(false);

    const legacy = { assignedGroup: 'אתרוג' };
    expect(eventMatchesGroupName(legacy, 'אתרוג')).toBe(true);
  });

  it('never matches an empty group name', () => {
    expect(eventMatchesGroupName({ assignedGroups: ['תותים'] }, '')).toBe(false);
  });
});


describe('formatEventGroups', () => {
  it('joins several groups with a comma', () => {
    expect(formatEventGroups({ assignedGroups: ['תותים', 'דובדבן'] })).toBe('תותים, דובדבן');
  });

  it('uses the fallback when there is no group', () => {
    expect(formatEventGroups({}, { fallback: '—' })).toBe('—');
    // Default fallback is the "no group" label.
    expect(formatEventGroups({})).toBe(NO_GROUP);
  });
});
