// Unit tests for the attendance display-date resolver precedence.
import { describe, it, expect } from 'vitest';

import { resolveAttendanceDisplayDate, resolveAttendanceDateKey } from '../src/utils/attendanceDisplayDate.js';

// 2026-06-23T09:00:00Z == 12:00 Asia/Jerusalem on 2026-06-23.
const INSTANT = new Date('2026-06-23T09:00:00Z');
const TIMESTAMP = { toDate: () => INSTANT };           // Firestore Timestamp-like
const SECONDS = { seconds: Math.floor(INSTANT.getTime() / 1000) };


describe('resolveAttendanceDisplayDate — explicit precedence', () => {
  it('dateKey wins over date', () => {
    expect(resolveAttendanceDisplayDate({ dateKey: '2026-06-23', date: '2026-06-20' }))
      .toBe('23-06-2026');
  });

  it('a legacy date-only string is shown as DD-MM-YYYY', () => {
    expect(resolveAttendanceDisplayDate({ date: '2026-05-31' })).toBe('31-05-2026');
  });

  it('a date Timestamp works', () => {
    expect(resolveAttendanceDisplayDate({ date: TIMESTAMP })).toBe('23-06-2026');
  });

  it('a date Date instance works', () => {
    expect(resolveAttendanceDisplayDate({ date: INSTANT })).toBe('23-06-2026');
  });

  it('a date { seconds } object works', () => {
    expect(resolveAttendanceDisplayDate({ date: SECONDS })).toBe('23-06-2026');
  });

  it('a MALFORMED date string does NOT hide a valid createdAt', () => {
    expect(resolveAttendanceDisplayDate({ date: 'garbage', createdAt: INSTANT }))
      .toBe('23-06-2026');
  });

  it('an impossible date-only string falls through to createdAt', () => {
    // 2026-02-30 is not a real date -> rejected by the date-only formatter.
    expect(resolveAttendanceDisplayDate({ date: '2026-02-30', createdAt: TIMESTAMP }))
      .toBe('23-06-2026');
  });

  it('everything missing / unusable -> "ללא תאריך"', () => {
    expect(resolveAttendanceDisplayDate({})).toBe('ללא תאריך');
    expect(resolveAttendanceDisplayDate({ date: 'garbage' })).toBe('ללא תאריך');
    expect(resolveAttendanceDisplayDate(null)).toBe('ללא תאריך');
  });
});


describe('resolveAttendanceDateKey — logical key (YYYY-MM-DD) precedence', () => {
  it('returns a canonical YYYY-MM-DD key, never DD-MM-YYYY', () => {
    const key = resolveAttendanceDateKey({ dateKey: '2026-06-23' });
    expect(key).toBe('2026-06-23');
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('dateKey wins over date', () => {
    expect(resolveAttendanceDateKey({ dateKey: '2026-06-23', date: '2026-06-20' }))
      .toBe('2026-06-23');
  });

  it('a legacy date-only string is used as the key', () => {
    expect(resolveAttendanceDateKey({ date: '2026-05-31' })).toBe('2026-05-31');
  });

  it('a Date instant resolves to the Asia/Jerusalem dateKey', () => {
    expect(resolveAttendanceDateKey({ date: INSTANT })).toBe('2026-06-23');
  });

  it('a Timestamp-like instant works', () => {
    expect(resolveAttendanceDateKey({ date: TIMESTAMP })).toBe('2026-06-23');
  });

  it('a { seconds } instant works', () => {
    expect(resolveAttendanceDateKey({ date: SECONDS })).toBe('2026-06-23');
  });

  it('a malformed date string does NOT hide a valid createdAt', () => {
    expect(resolveAttendanceDateKey({ date: 'garbage', createdAt: INSTANT })).toBe('2026-06-23');
  });

  it('everything unusable -> ""', () => {
    expect(resolveAttendanceDateKey({})).toBe('');
    expect(resolveAttendanceDateKey({ date: 'garbage' })).toBe('');
    expect(resolveAttendanceDateKey(null)).toBe('');
  });

  it('an instant past midnight UTC but still "yesterday" in Jerusalem keys to the Jerusalem day', () => {
    // 2026-06-23T21:30:00Z == 2026-06-24 00:30 in Asia/Jerusalem (UTC+3) -> the
    // KEY is the Jerusalem day, NOT the UTC day. This is what makes the result
    // independent of the process timezone (getJerusalemDateKey converts itself).
    const crossMidnight = new Date('2026-06-23T21:30:00Z');
    expect(resolveAttendanceDateKey({ date: crossMidnight })).toBe('2026-06-24');
  });
});
