// Unit tests for the pure group-import preparation, preflight and resolution.
import { describe, it, expect } from 'vitest';

import {
  analyzeGroupImportHeaders,
  detectGroupImportFileType,
  buildGroupImportGuides,
  prepareGroupImportRow,
  preflightGroupImport,
  resolveGroupImport,
  buildGroupImportPlans,
  groupPlanOperationCount,
  commitGroupPlans,
} from '../src/utils/groupImport.js';

// The real writer — imported only to prove its operationCount guard fires
// BEFORE any Firestore write (it throws before touching the injected db).
import { commitOneGroup } from '../src/utils/groupImportWriter.js';


// A raw group row keyed by the template's Hebrew headers.
function gRow(overrides = {}) {
  return {
    'שם קבוצה *': 'תותים',
    ...overrides,
  };
}

// A preflight-validated row for resolve tests: { excelRow, fields, refs }.
function vRow(excelRow, {
  groupName = 'תותים', activityTime = '', activityDay = '',
  location = '', notes = '', guideNameRaw = '', volunteerNames = [],
} = {}) {
  return {
    excelRow,
    fields: { groupName, activityTime, activityDay, location, notes },
    refs: { guideNameRaw, volunteerNames },
  };
}


describe('analyzeGroupImportHeaders', () => {
  const bom = String.fromCharCode(0xFEFF);

  it('accepts a clean, distinct header row', () => {
    expect(analyzeGroupImportHeaders(['שם קבוצה *', 'מדריך אחראי', 'הערות']))
      .toEqual({ ok: true });
  });

  it('fails closed on two identical headers (stable code)', () => {
    expect(analyzeGroupImportHeaders(['שם קבוצה *', 'שם קבוצה *']))
      .toEqual({ ok: false, code: 'DUPLICATE_HEADERS' });
  });

  it('detects headers that collide only after stripping a leading BOM', () => {
    expect(analyzeGroupImportHeaders(['מדריך אחראי', bom + 'מדריך אחראי']))
      .toEqual({ ok: false, code: 'DUPLICATE_HEADERS' });
  });

  it('detects headers that collide only after trimming', () => {
    expect(analyzeGroupImportHeaders(['הערות', '  הערות  ']))
      .toEqual({ ok: false, code: 'DUPLICATE_HEADERS' });
  });

  it('does NOT treat several empty headers as duplicates', () => {
    expect(analyzeGroupImportHeaders(['שם קבוצה *', '', '   ', bom]))
      .toEqual({ ok: true });
  });

  it('blocks two different group-name aliases (ambiguous, not literal dup)', () => {
    expect(analyzeGroupImportHeaders(['שם קבוצה *', 'שם קבוצה']))
      .toEqual({ ok: false, code: 'AMBIGUOUS_HEADERS' });
  });

  it('blocks both volunteer-column aliases together', () => {
    expect(analyzeGroupImportHeaders([
      'מתנדבים משויכים (שמות, מופרדים בפסיק)', 'מתנדבים משויכים',
    ])).toEqual({ ok: false, code: 'AMBIGUOUS_HEADERS' });
  });

  it('accepts a single member of each alias family (including the legacy names)', () => {
    expect(analyzeGroupImportHeaders(['שם קבוצה *', 'מתנדבים משויכים (שמות, מופרדים בפסיק)']))
      .toEqual({ ok: true });
    expect(analyzeGroupImportHeaders(['שם קבוצה', 'מתנדבים משויכים']))
      .toEqual({ ok: true });
  });
});


describe('prepareGroupImportRow', () => {
  it('treats an entirely empty row as blank', () => {
    expect(prepareGroupImportRow({})).toEqual({ ok: true, blank: true });
  });

  it('rejects duplicate headers after normalization (BOM collision)', () => {
    const bom = String.fromCharCode(0xFEFF);
    const result = prepareGroupImportRow({ 'שם קבוצה *': 'א', [bom + 'שם קבוצה *']: 'ב' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/כותרות כפולות/);
  });

  it('rejects a row object that carries two aliases of one field with different values', () => {
    const result = prepareGroupImportRow({ 'שם קבוצה *': 'תותים', 'שם קבוצה': 'דובדבן' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/alias/);
  });

  it('still accepts the legacy "שם קבוצה" alias on its own', () => {
    const result = prepareGroupImportRow({ 'שם קבוצה': 'תותים' });
    expect(result.ok).toBe(true);
    expect(result.fields.groupName).toBe('תותים');
  });

  it('requires a group name', () => {
    const result = prepareGroupImportRow({ 'מדריך אחראי': 'דנה כהן' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('חסר שם קבוצה');
  });

  it('trims + collapses whitespace in the group name', () => {
    expect(prepareGroupImportRow({ 'שם קבוצה *': '  תותים   אדומים ' }).fields.groupName)
      .toBe('תותים אדומים');
  });

  it('normalizes activity time, rejects an unknown one', () => {
    expect(prepareGroupImportRow(gRow({ 'זמן פעילות': '  בוקר ' })).fields.activityTime).toBe('בוקר');
    expect(prepareGroupImportRow(gRow({ 'זמן פעילות': 'מתישהו' })).ok).toBe(false);
  });

  it('normalizes a short activity day to the full form, rejects Saturday', () => {
    expect(prepareGroupImportRow(gRow({ 'יום פעילות': 'ראשון' })).fields.activityDay).toBe('יום ראשון');
    expect(prepareGroupImportRow(gRow({ 'יום פעילות': '' })).fields.activityDay).toBe('');

    const sat = prepareGroupImportRow(gRow({ 'יום פעילות': 'שבת' }));
    expect(sat.ok).toBe(false);
    expect(sat.errors.join(' ')).toMatch(/שבת/);
  });

  it('trims location and notes', () => {
    const result = prepareGroupImportRow(gRow({ 'מיקום / חדר': '  חדר 1 ', 'הערות': '  הערה ' }));
    expect(result.fields.location).toBe('חדר 1');
    expect(result.fields.notes).toBe('הערה');
  });

  it('parses comma-separated volunteer names and rejects a name repeated in the row', () => {
    const ok = prepareGroupImportRow(gRow({ 'מתנדבים משויכים (שמות, מופרדים בפסיק)': 'יוסי לוי, דנה כהן' }));
    expect(ok.refs.volunteerNames).toEqual(['יוסי לוי', 'דנה כהן']);

    const dup = prepareGroupImportRow(gRow({ 'מתנדבים משויכים (שמות, מופרדים בפסיק)': 'יוסי לוי, יוסי לוי' }));
    expect(dup.ok).toBe(false);
    expect(dup.errors.join(' ')).toMatch(/יותר מפעם אחת/);
  });

  it('still reads the legacy "מתנדבים משויכים" alias', () => {
    const result = prepareGroupImportRow(gRow({ 'מתנדבים משויכים': 'יוסי לוי' }));
    expect(result.ok).toBe(true);
    expect(result.refs.volunteerNames).toEqual(['יוסי לוי']);
  });

  it('rejects a typed numeric 0 in the volunteers cell (not a silent empty)', () => {
    const result = prepareGroupImportRow(gRow({ 'מתנדבים משויכים (שמות, מופרדים בפסיק)': 0 }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/ערך לא תקין/);
  });

  it('rejects a typed boolean false in the volunteers cell', () => {
    const result = prepareGroupImportRow(gRow({ 'מתנדבים משויכים (שמות, מופרדים בפסיק)': false }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/ערך לא תקין/);
  });

  it('treats a truly empty volunteers cell as no volunteers (allowed)', () => {
    const result = prepareGroupImportRow(gRow({ 'מתנדבים משויכים (שמות, מופרדים בפסיק)': '' }));
    expect(result.ok).toBe(true);
    expect(result.refs.volunteerNames).toEqual([]);
  });
});


describe('preflightGroupImport', () => {
  it('separates valid / rejected / blank with Excel row numbers', () => {
    const rows = [
      gRow({ 'שם קבוצה *': 'תותים' }),                 // row 2 — valid
      { 'שם קבוצה *': 'דובדבן', 'יום פעילות': 'שבת' },  // row 3 — rejected (Saturday)
      {},                                              // row 4 — blank
    ];
    const { valid, rejected, blankSkipped } = preflightGroupImport(rows);

    expect(valid.map((r) => r.excelRow)).toEqual([2]);
    expect(rejected.map((r) => r.excelRow)).toEqual([3]);
    expect(blankSkipped).toBe(1);
  });
});


describe('resolveGroupImport — group name duplicates', () => {
  it('rejects BOTH rows that share a group name in the file', () => {
    const rows = [vRow(2, { groupName: 'תותים' }), vRow(3, { groupName: '  תותים ' })];
    const { ready, rejected } = resolveGroupImport(rows, {});
    expect(ready).toHaveLength(0);
    expect(rejected.map((r) => r.excelRow)).toEqual([2, 3]);
  });

  it('rejects a group name that already exists in Firestore', () => {
    const { ready, rejected } = resolveGroupImport([vRow(2, { groupName: 'תותים' })], {
      existingGroups: [{ id: 'g0', groupName: 'תותים' }],
    });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/כבר קיים/);
  });
});


describe('resolveGroupImport — guide matching', () => {
  const guides = [{ id: 'gd1', name: 'דנה כהן' }];

  it('accepts an empty guide (no assignment)', () => {
    const { ready } = resolveGroupImport([vRow(2)], { guides });
    expect(ready).toHaveLength(1);
    expect(ready[0].guideId).toBe('');
    expect(ready[0].operationCount).toBe(1);
  });

  it('matches a single guide and plans the guide link', () => {
    const { ready } = resolveGroupImport([vRow(2, { guideNameRaw: '  דנה   כהן ' })], { guides });
    expect(ready[0].guideId).toBe('gd1');
    expect(ready[0].operationCount).toBe(2); // group + guide
  });

  it('rejects an unknown guide', () => {
    const { ready, rejected } = resolveGroupImport([vRow(2, { guideNameRaw: 'מישהו' })], { guides });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/מדריך אחראי לא נמצא/);
  });

  it('rejects an ambiguous guide (more than one match)', () => {
    const dup = [{ id: 'gd1', name: 'דנה כהן' }, { id: 'gd2', name: 'דנה כהן' }];
    const { rejected } = resolveGroupImport([vRow(2, { guideNameRaw: 'דנה כהן' })], { guides: dup });
    expect(rejected[0].reasons.join(' ')).toMatch(/עמום/);
  });

  it('rejects a guide already assigned via an existing group (existingGroups.guideId)', () => {
    const { ready, rejected } = resolveGroupImport([vRow(2, { guideNameRaw: 'דנה כהן' })], {
      guides, // guide record itself carries no groupId
      existingGroups: [{ id: 'g0', groupName: 'אחרת', guideId: 'gd1' }],
    });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/כבר משויך/);
  });

  it('rejects a guide whose OWN record carries a groupId (no existing group needed)', () => {
    const assigned = [{ id: 'gd1', name: 'דנה כהן', groupId: 'gX' }];
    const { ready, rejected } = resolveGroupImport([vRow(2, { guideNameRaw: 'דנה כהן' })], {
      guides: assigned,
      existingGroups: [], // not assigned via existingGroups — only via guide.groupId
    });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/כבר משויך/);
  });

  it('blocks an inconsistent guide record: groupName present but no groupId', () => {
    const inconsistent = [{ id: 'gd1', name: 'דנה כהן', groupName: 'תותים' }]; // no groupId
    const { ready, rejected } = resolveGroupImport([vRow(2, { guideNameRaw: 'דנה כהן' })], {
      guides: inconsistent,
    });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/אינה עקבית/);
  });

  it('accepts a genuinely free guide (no groupId, no groupName, not in existingGroups)', () => {
    const { ready, rejected } = resolveGroupImport([vRow(2, { guideNameRaw: 'דנה כהן' })], {
      guides: [{ id: 'gd1', name: 'דנה כהן', groupId: '', groupName: '' }],
      existingGroups: [],
    });
    expect(rejected).toHaveLength(0);
    expect(ready[0].guideId).toBe('gd1');
  });

  it('rejects the same guide assigned to two groups in the file', () => {
    const rows = [
      vRow(2, { groupName: 'תותים', guideNameRaw: 'דנה כהן' }),
      vRow(3, { groupName: 'דובדבן', guideNameRaw: 'דנה כהן' }),
    ];
    const { ready, rejected } = resolveGroupImport(rows, { guides });
    expect(ready).toHaveLength(0);
    expect(rejected.map((r) => r.excelRow)).toEqual([2, 3]);
    expect(rejected[0].reasons.join(' ')).toMatch(/אותו מדריך/);
  });
});


describe('resolveGroupImport — volunteer matching', () => {
  const volunteers = [
    { id: 'v1', name: 'יוסי לוי', groupId: '' },
    { id: 'v2', name: 'דנה כהן', groupId: '' },
  ];

  it('matches volunteers and counts one write per volunteer', () => {
    const { ready } = resolveGroupImport(
      [vRow(2, { volunteerNames: ['יוסי לוי', 'דנה כהן'] })],
      { volunteers },
    );
    expect(ready[0].volunteerIds).toEqual(['v1', 'v2']);
    expect(ready[0].operationCount).toBe(3); // group + 2 volunteers
  });

  it('rejects an unknown volunteer', () => {
    const { ready, rejected } = resolveGroupImport(
      [vRow(2, { volunteerNames: ['מישהו'] })],
      { volunteers },
    );
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/מתנדב לא נמצא/);
  });

  it('rejects an ambiguous volunteer name', () => {
    const dup = [{ id: 'v1', name: 'יוסי לוי', groupId: '' }, { id: 'v2', name: 'יוסי לוי', groupId: '' }];
    const { rejected } = resolveGroupImport([vRow(2, { volunteerNames: ['יוסי לוי'] })], { volunteers: dup });
    expect(rejected[0].reasons.join(' ')).toMatch(/עמום/);
  });

  it('rejects a volunteer already assigned to a group (groupId set)', () => {
    const assigned = [{ id: 'v1', name: 'יוסי לוי', groupId: 'gX' }];
    const { ready, rejected } = resolveGroupImport([vRow(2, { volunteerNames: ['יוסי לוי'] })], { volunteers: assigned });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/כבר משויך/);
  });

  it('rejects an inconsistent volunteer record: groupName present but no groupId', () => {
    const inconsistent = [{ id: 'v1', name: 'יוסי לוי', groupId: '', groupName: 'תותים' }];
    const { ready, rejected } = resolveGroupImport([vRow(2, { volunteerNames: ['יוסי לוי'] })], { volunteers: inconsistent });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/אינה עקבית/);
  });

  it("rejects a volunteer whose groupName is 'Unassigned' with no groupId (NOT a volunteer sentinel)", () => {
    const odd = [{ id: 'v1', name: 'יוסי לוי', groupId: '', groupName: 'Unassigned' }];
    const { ready, rejected } = resolveGroupImport([vRow(2, { volunteerNames: ['יוסי לוי'] })], { volunteers: odd });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/אינה עקבית/);
  });

  it('accepts a genuinely free volunteer (groupId AND groupName empty) with the right plan', () => {
    const free = [{ id: 'v1', name: 'יוסי לוי', groupId: '', groupName: '' }];
    const { ready, rejected } = resolveGroupImport([vRow(2, { volunteerNames: ['יוסי לוי'] })], { volunteers: free });
    expect(rejected).toHaveLength(0);
    expect(ready[0].volunteerIds).toEqual(['v1']);
    expect(ready[0].operationCount).toBe(2); // group + 1 volunteer
  });

  it('rejects the same volunteer placed in two groups in the file', () => {
    const rows = [
      vRow(2, { groupName: 'תותים', volunteerNames: ['יוסי לוי'] }),
      vRow(3, { groupName: 'דובדבן', volunteerNames: ['יוסי לוי'] }),
    ];
    const { ready, rejected } = resolveGroupImport(rows, { volunteers });
    expect(ready).toHaveLength(0);
    expect(rejected.map((r) => r.excelRow)).toEqual([2, 3]);
    expect(rejected[0].reasons.join(' ')).toMatch(/אותו מתנדב/);
  });
});


describe('resolveGroupImport — ready item shape', () => {
  it('builds a ready item with normalized fields, ids and an operation count (no excelRow inside fields)', () => {
    const guides = [{ id: 'gd1', name: 'דנה כהן' }];
    const volunteers = [{ id: 'v1', name: 'יוסי לוי', groupId: '' }];

    const { ready } = resolveGroupImport(
      [vRow(2, {
        groupName: 'תותים', activityTime: 'בוקר', activityDay: 'יום ראשון',
        location: 'חדר 1', notes: 'הערה', guideNameRaw: 'דנה כהן', volunteerNames: ['יוסי לוי'],
      })],
      { guides, volunteers },
    );

    expect(ready).toHaveLength(1);
    const item = ready[0];
    expect(item.excelRow).toBe(2);
    expect(item.fields).toEqual({
      groupName: 'תותים', activityTime: 'בוקר', activityDay: 'יום ראשון',
      location: 'חדר 1', notes: 'הערה',
    });
    expect(item.fields).not.toHaveProperty('excelRow');
    expect(item.guideId).toBe('gd1');
    expect(item.volunteerIds).toEqual(['v1']);
    expect(item.operationCount).toBe(3); // group + guide + 1 volunteer
  });
});


// Item 2: cross-row reuse must consider rows the PREFLIGHT rejected, not only
// the valid rows. The valid + rejected rows are fed through the real pipeline
// (preflight → resolve) so the `identities` carry every non-blank row.
describe('resolveGroupImport — reuse vs preflight-rejected rows', () => {
  it('rejects a valid row whose guide is reused by a Saturday (rejected) row', () => {
    const jsonRows = [
      { 'שם קבוצה *': 'תותים', 'מדריך אחראי': 'דנה כהן' },                         // row 2 — valid
      { 'שם קבוצה *': 'דובדבן', 'מדריך אחראי': 'דנה כהן', 'יום פעילות': 'שבת' },     // row 3 — rejected (Saturday)
    ];
    const { valid, rejected, identities } = preflightGroupImport(jsonRows);

    // The Saturday row stays rejected by preflight, for the Saturday reason.
    expect(rejected.map((r) => r.excelRow)).toEqual([3]);
    expect(rejected[0].reasons.join(' ')).toMatch(/שבת/);

    // The valid row must NOT become ready — its guide is reused by the rejected row.
    const result = resolveGroupImport(valid, {
      guides: [{ id: 'gd1', name: 'דנה כהן' }],
      allRowIdentities: identities,
    });
    expect(result.ready).toHaveLength(0);
    expect(result.rejected[0].reasons.join(' ')).toMatch(/אותו מדריך/);
  });

  it('rejects a valid row whose volunteer is reused by an unknown-time (rejected) row', () => {
    const jsonRows = [
      { 'שם קבוצה *': 'תותים', 'מתנדבים משויכים (שמות, מופרדים בפסיק)': 'יוסי לוי' },                   // row 2 — valid
      { 'שם קבוצה *': 'דובדבן', 'זמן פעילות': 'מתישהו', 'מתנדבים משויכים (שמות, מופרדים בפסיק)': 'יוסי לוי' }, // row 3 — rejected (time)
    ];
    const { valid, rejected, identities } = preflightGroupImport(jsonRows);

    expect(rejected.map((r) => r.excelRow)).toEqual([3]);

    const result = resolveGroupImport(valid, {
      volunteers: [{ id: 'v1', name: 'יוסי לוי', groupId: '' }],
      allRowIdentities: identities,
    });
    expect(result.ready).toHaveLength(0);
    expect(result.rejected[0].reasons.join(' ')).toMatch(/אותו מתנדב/);
  });
});


// Item 4: a typed 0 / false in the volunteers cell must reach validation as an
// invalid reference, never a silent empty (and successful) assignment.
describe('preflight + resolve — typed volunteers cell', () => {
  it('keeps a numeric 0 out of ready', () => {
    const { valid } = preflightGroupImport([
      { 'שם קבוצה *': 'תותים', 'מתנדבים משויכים (שמות, מופרדים בפסיק)': 0 },
    ]);
    expect(valid).toHaveLength(0);
    expect(resolveGroupImport(valid, {}).ready).toHaveLength(0);
  });

  it('keeps a boolean false out of ready', () => {
    const { valid } = preflightGroupImport([
      { 'שם קבוצה *': 'תותים', 'מתנדבים משויכים (שמות, מופרדים בפסיק)': false },
    ]);
    expect(valid).toHaveLength(0);
    expect(resolveGroupImport(valid, {}).ready).toHaveLength(0);
  });

  it('still allows a row with a truly empty volunteers cell', () => {
    const { valid } = preflightGroupImport([
      { 'שם קבוצה *': 'תותים', 'מתנדבים משויכים (שמות, מופרדים בפסיק)': '' },
    ]);
    expect(valid).toHaveLength(1);
    expect(resolveGroupImport(valid, {}).ready).toHaveLength(1);
  });
});


// ===========================================================================
// Stage 6 — sources contract, file detection, plans, orchestrator
// ===========================================================================

describe('buildGroupImportGuides', () => {
  const active = (id, name, extra = {}) => ({ id, role: 'guide', name, ...extra });

  it('includes only ACTIVE guides (role guide, not disabled)', () => {
    const users = [
      active('u1', 'דנה'),
      active('u2', 'רון', { disabled: true }),
      { id: 'u3', role: 'viewer', name: 'נועה' },
    ];
    expect(buildGroupImportGuides(users, []).map((g) => g.id)).toEqual(['u1']);
  });

  it('merges groupId/groupName from the guides/{uid} link by id, keeping the user name', () => {
    const [guide] = buildGroupImportGuides(
      [active('u1', 'דנה')],
      [{ id: 'u1', groupId: 'gX', groupName: 'תותים' }],
    );
    expect(guide.groupId).toBe('gX');
    expect(guide.groupName).toBe('תותים');
    expect(guide.name).toBe('דנה'); // user's own name never replaced
  });

  it('treats a missing link as an empty mapping', () => {
    const [guide] = buildGroupImportGuides([active('u1', 'דנה')], []);
    expect(guide.groupId).toBe('');
    expect(guide.groupName).toBe('');
  });

  it('does NOT turn an orphan guides link (no active user) into a candidate', () => {
    expect(buildGroupImportGuides([], [{ id: 'ghost', groupId: 'gX', groupName: 'תותים' }]))
      .toHaveLength(0);
  });
});


describe('resolveGroupImport — guide source contract (built candidate list)', () => {
  const active = (id, name, extra = {}) => ({ id, role: 'guide', name, ...extra });
  const oneRow = (guideNameRaw) => [vRow(2, { guideNameRaw })];

  it('active guide + free link → accepted, ready carries canonical guideId + guideName', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן')], [{ id: 'u1', groupId: '', groupName: 'Unassigned' }]);
    const { ready, rejected } = resolveGroupImport(oneRow('דנה כהן'), { guides });
    expect(rejected).toHaveLength(0);
    expect(ready[0].guideId).toBe('u1');
    expect(ready[0].guideName).toBe('דנה כהן');
  });

  it('active guide, no link, no existing group → accepted', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן')], []);
    const { ready } = resolveGroupImport(oneRow('דנה כהן'), { guides, existingGroups: [] });
    expect(ready[0].guideId).toBe('u1');
  });

  it('active guide whose link has a groupId → rejected (already assigned)', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן')], [{ id: 'u1', groupId: 'gX', groupName: 'תותים' }]);
    const { ready, rejected } = resolveGroupImport(oneRow('דנה כהן'), { guides });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/כבר משויך/);
  });

  it('existingGroups.guideId points at the uid → rejected, even if the link says Unassigned', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן')], [{ id: 'u1', groupId: '', groupName: 'Unassigned' }]);
    const { ready, rejected } = resolveGroupImport(oneRow('דנה כהן'), {
      guides, existingGroups: [{ id: 'g0', groupName: 'אחרת', guideId: 'u1' }],
    });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/כבר משויך/);
  });

  it("link groupName 'Unassigned' (any case) with empty groupId → accepted", () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן')], [{ id: 'u1', groupId: '', groupName: 'unassigned' }]);
    expect(resolveGroupImport(oneRow('דנה כהן'), { guides }).ready[0].guideId).toBe('u1');
  });

  it('real groupName without a groupId → rejected as inconsistent', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן')], [{ id: 'u1', groupId: '', groupName: 'תותים' }]);
    const { ready, rejected } = resolveGroupImport(oneRow('דנה כהן'), { guides });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/אינה עקבית/);
  });

  it('two ACTIVE guides with the same name → ambiguous', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן'), active('u2', 'דנה כהן')], []);
    expect(resolveGroupImport(oneRow('דנה כהן'), { guides }).rejected[0].reasons.join(' ')).toMatch(/עמום/);
  });

  it('active guide + disabled namesake → the active one is accepted', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן'), active('u2', 'דנה כהן', { disabled: true })], []);
    expect(resolveGroupImport(oneRow('דנה כהן'), { guides }).ready[0].guideId).toBe('u1');
  });

  it('active guide + non-guide namesake → the active one is accepted', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן'), { id: 'u2', role: 'viewer', name: 'דנה כהן' }], []);
    expect(resolveGroupImport(oneRow('דנה כהן'), { guides }).ready[0].guideId).toBe('u1');
  });

  it('only a disabled namesake exists → no candidate (not found)', () => {
    const guides = buildGroupImportGuides([active('u1', 'דנה כהן', { disabled: true })], []);
    const { ready, rejected } = resolveGroupImport(oneRow('דנה כהן'), { guides });
    expect(ready).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/לא נמצא/);
  });
});


describe('detectGroupImportFileType', () => {
  it('detects a group-only header (either alias)', () => {
    expect(detectGroupImportFileType(['שם קבוצה *', 'מדריך אחראי'])).toBe('groups');
    expect(detectGroupImportFileType(['שם קבוצה'])).toBe('groups');
  });

  it('detects a volunteer-only header (incl. legacy aliases)', () => {
    expect(detectGroupImportFileType(['שם פרטי *', 'שם משפחה *'])).toBe('volunteers');
    expect(detectGroupImportFileType(['firstName', 'lastName'])).toBe('volunteers');
    expect(detectGroupImportFileType(['שם מלא'])).toBe('volunteers');
    expect(detectGroupImportFileType(['name'])).toBe('volunteers');
  });

  it('flags a mixed file (both families present) as ambiguous — not groups', () => {
    expect(detectGroupImportFileType(['שם קבוצה *', 'שם פרטי *'])).toBe('ambiguous');
    expect(detectGroupImportFileType(['שם פרטי *', 'שם קבוצה *'])).toBe('ambiguous'); // order independent
  });

  it('returns unknown for an unrecognized / empty header', () => {
    expect(detectGroupImportFileType(['משהו אחר'])).toBe('unknown');
    expect(detectGroupImportFileType([])).toBe('unknown');
  });
});


describe('buildGroupImportPlans + operationCount', () => {
  const readyItem = {
    excelRow: 2,
    fields: { groupName: 'תותים', activityTime: 'בוקר', activityDay: 'יום ראשון', location: 'חדר 1', notes: 'הערה' },
    guideId: 'gd1', guideName: 'דנה כהן', volunteerIds: ['v1', 'v2'], operationCount: 4,
  };

  it('maps activityTime → time and keeps ONLY schema fields in groupDoc (no excelRow/operationCount)', () => {
    const [plan] = buildGroupImportPlans([readyItem]);
    expect(plan.groupDoc).toEqual({
      groupName: 'תותים', time: 'בוקר', activityDay: 'יום ראשון', location: 'חדר 1', notes: 'הערה',
      guideId: 'gd1', guideName: 'דנה כהן',
    });
    expect(plan.groupDoc).not.toHaveProperty('excelRow');
    expect(plan.groupDoc).not.toHaveProperty('operationCount');
    expect(plan.groupDoc).not.toHaveProperty('activityTime');
    expect(plan.excelRow).toBe(2); // kept on the plan, in memory only
  });

  it('computes operationCount = group + guide + volunteers and matches the plan', () => {
    const [plan] = buildGroupImportPlans([readyItem]);
    expect(groupPlanOperationCount(plan)).toBe(4);
    expect(groupPlanOperationCount(plan)).toBe(plan.operationCount);
  });

  it('the writer rejects a plan whose operationCount disagrees, BEFORE any commit', async () => {
    const [plan] = buildGroupImportPlans([readyItem]);
    const tampered = { ...plan, operationCount: 99 };
    // db is null on purpose: the guard must throw before writeBatch is reached.
    await expect(commitOneGroup(null, tampered)).rejects.toThrow(/operationCount/);
  });
});


describe('commitGroupPlans — sequential, stop at first failure', () => {
  it('writes up to the failing group, does not attempt the rest, counts correctly', async () => {
    const plans = [{ excelRow: 2 }, { excelRow: 3 }, { excelRow: 4 }];
    const attempted = [];
    const commitOne = async (plan) => {
      attempted.push(plan.excelRow);
      if (plan.excelRow === 3) {
        throw new Error('boom');
      }
    };

    const result = await commitGroupPlans(plans, commitOne);

    expect(attempted).toEqual([2, 3]); // row 4 never attempted
    expect(result.writtenGroups).toBe(1);
    expect(result.failedCurrentGroup).toBe(1);
    expect(result.notAttemptedGroups).toBe(1);
    expect(result.failedExcelRow).toBe(3);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('reports all written when every group succeeds', async () => {
    const result = await commitGroupPlans([{ excelRow: 2 }, { excelRow: 3 }], async () => {});
    expect(result).toMatchObject({
      writtenGroups: 2, failedCurrentGroup: 0, notAttemptedGroups: 0, failedExcelRow: null, error: null,
    });
  });
});
