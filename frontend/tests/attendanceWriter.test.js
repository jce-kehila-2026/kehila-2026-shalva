// Unit tests for the pure attendance-write planning + reconciliation helpers.
import { describe, it, expect } from 'vitest';

import {
  attendanceStateFromRecord,
  buildAttendanceOperations,
  reconcileAttendanceResults,
} from '../src/utils/attendanceWriter.js';


const SAVE_INSTANT = new Date('2026-06-12T09:00:00Z');
const DATEKEY = '2026-06-12';

function baseInput(overrides = {}) {
  return {
    volunteers: [{ id: 'v1', name: 'דני', groupId: 'groupA' }],
    marks: { v1: 'present' },
    touchedVolunteerIds: { v1: true },
    savedByVolunteer: {},
    canonicalGroupId: 'groupA',
    canonicalGroupName: 'קבוצה א',
    dateKey: DATEKEY,
    saveInstant: SAVE_INSTANT,
    ...overrides,
  };
}


describe('attendanceStateFromRecord', () => {
  it('maps boolean / string / missing to the UI state', () => {
    expect(attendanceStateFromRecord(null)).toBe('unmarked');
    expect(attendanceStateFromRecord({ status: true })).toBe('present');
    expect(attendanceStateFromRecord({ status: false })).toBe('absent');
    expect(attendanceStateFromRecord({ status: 'נוכח' })).toBe('present');
    expect(attendanceStateFromRecord({ status: 'נעדר' })).toBe('absent');
  });
});


describe('buildAttendanceOperations', () => {
  it('aborts without a canonical group id', () => {
    expect(buildAttendanceOperations(baseInput({ canonicalGroupId: '' })).ok).toBe(false);
  });

  it('creates a canonical set op for a newly-present volunteer', () => {
    const result = buildAttendanceOperations(baseInput());
    expect(result.ok).toBe(true);
    expect(result.operations).toHaveLength(1);

    const op = result.operations[0];
    expect(op.type).toBe('set');
    expect(op.attendanceId).toBe('groupA_2026-06-12_v1');
    expect(op.payload).toEqual({
      groupId: 'groupA',
      group: 'קבוצה א',
      groupName: 'קבוצה א',
      date: SAVE_INSTANT,
      dateKey: DATEKEY,
      status: true,
      volunteerId: 'v1',
      volunteerName: 'דני',
    });
  });

  it('reuses an existing record id on update (not a new canonical id)', () => {
    const existing = { id: 'legacy-1', groupId: 'groupA', volunteerId: 'v1', dateKey: DATEKEY, status: true };
    const result = buildAttendanceOperations(baseInput({ marks: { v1: 'absent' }, savedByVolunteer: { v1: existing } }));

    expect(result.operations[0].type).toBe('set');
    expect(result.operations[0].attendanceId).toBe('legacy-1');
    expect(result.operations[0].payload.status).toBe(false);
  });

  it('makes a delete op (reusing the existing id) when a marked volunteer is cleared', () => {
    const existing = { id: 'legacy-1', groupId: 'groupA', volunteerId: 'v1', dateKey: DATEKEY, status: true };
    const result = buildAttendanceOperations(baseInput({ marks: { v1: 'unmarked' }, savedByVolunteer: { v1: existing } }));

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('delete');
    expect(result.operations[0].attendanceId).toBe('legacy-1');
  });

  it('skips untouched volunteers and unchanged states', () => {
    const existing = { id: 'x', groupId: 'groupA', volunteerId: 'v1', dateKey: DATEKEY, status: true };
    // touched, but already saved as present -> no op
    expect(buildAttendanceOperations(baseInput({ savedByVolunteer: { v1: existing } })).operations).toHaveLength(0);
    // not touched -> no op
    expect(buildAttendanceOperations(baseInput({ touchedVolunteerIds: {} })).operations).toHaveLength(0);
  });

  it('aborts (fail-closed) when a touched volunteer belongs to another group', () => {
    const volunteers = [{ id: 'v1', name: 'דני', groupId: 'groupB' }]; // wrong group
    const result = buildAttendanceOperations(baseInput({
      volunteers,
      marks: { v1: 'present' },
      touchedVolunteerIds: { v1: true },
    }));
    expect(result.ok).toBe(false);
  });

  it('aborts on an identity mismatch (existing record from another day)', () => {
    // The desired state must DIFFER from the saved one, so the op is built and
    // the identity check is reached (here the existing record is for another day).
    const existing = { id: 'x', groupId: 'groupA', volunteerId: 'v1', dateKey: '2026-06-11', status: true };
    expect(buildAttendanceOperations(baseInput({ marks: { v1: 'absent' }, savedByVolunteer: { v1: existing } })).ok).toBe(false);
  });
});


describe('reconcileAttendanceResults', () => {
  function setOp(volunteerId, attendanceId, status) {
    return {
      type: 'set',
      volunteerId,
      volunteerName: 'name-' + volunteerId,
      attendanceId,
      payload: { groupId: 'groupA', group: 'g', groupName: 'g', dateKey: DATEKEY, status, volunteerId, volunteerName: 'name-' + volunteerId },
    };
  }
  function deleteOp(volunteerId, attendanceId) {
    return { type: 'delete', volunteerId, volunteerName: 'name-' + volunteerId, attendanceId };
  }

  it('applies all succeeded operations and reports none failed', () => {
    const ops = [setOp('v1', 'id1', true)];
    const recon = reconcileAttendanceResults(ops, [{ status: 'fulfilled' }], []);

    expect(recon.failedCount).toBe(0);
    expect(recon.succeededVolunteerIds).toEqual(['v1']);
    expect(recon.nextRecords).toEqual([
      { id: 'id1', groupId: 'groupA', group: 'g', groupName: 'g', dateKey: DATEKEY, status: true, volunteerId: 'v1', volunteerName: 'name-v1' },
    ]);
  });

  it('applies ONLY succeeded ops on a partial failure and keeps the failures', () => {
    const ops = [setOp('v1', 'id1', true), setOp('v2', 'id2', false)];
    const results = [{ status: 'fulfilled' }, { status: 'rejected', reason: { code: 'permission-denied' } }];
    const recon = reconcileAttendanceResults(ops, results, []);

    expect(recon.succeededCount).toBe(1);
    expect(recon.failedCount).toBe(1);
    expect(recon.nextRecords).toHaveLength(1);
    expect(recon.nextRecords[0].id).toBe('id1');
    expect(recon.failed[0].volunteerId).toBe('v2');
    expect(recon.failed[0].reason.code).toBe('permission-denied');
  });

  it('leaves the baseline unchanged when all operations fail', () => {
    const previous = [{ id: 'pre', volunteerId: 'v0' }];
    const ops = [setOp('v1', 'id1', true)];
    const recon = reconcileAttendanceResults(ops, [{ status: 'rejected', reason: new Error('x') }], previous);

    expect(recon.nextRecords).toEqual(previous);
    expect(recon.succeededCount).toBe(0);
  });

  it('a successful delete removes ONLY its own id', () => {
    const previous = [{ id: 'id1', volunteerId: 'v1' }, { id: 'keep', volunteerId: 'v9' }];
    const recon = reconcileAttendanceResults([deleteOp('v1', 'id1')], [{ status: 'fulfilled' }], previous);

    expect(recon.nextRecords).toEqual([{ id: 'keep', volunteerId: 'v9' }]);
  });

  it('a successful set replaces the same-id record (no duplicate)', () => {
    const previous = [{ id: 'id1', volunteerId: 'v1', status: true }];
    const recon = reconcileAttendanceResults([setOp('v1', 'id1', false)], [{ status: 'fulfilled' }], previous);

    expect(recon.nextRecords).toHaveLength(1);
    expect(recon.nextRecords[0].status).toBe(false);
  });

  it('does NOT delete a different legacy duplicate record', () => {
    const previous = [{ id: 'id1', volunteerId: 'v1' }, { id: 'dup-other', volunteerId: 'v1' }];
    const recon = reconcileAttendanceResults([setOp('v1', 'id1', true)], [{ status: 'fulfilled' }], previous);

    expect(recon.nextRecords.some((record) => record.id === 'dup-other')).toBe(true);
  });
});
