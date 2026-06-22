// Excel template builders — generate EMPTY, fill-in templates (not reports):
// real in-Excel dropdowns for every choice field, an automatic age formula,
// and bold headers with * marking required fields. The valid choices live on
// a hidden "רשימות" sheet, so the file itself shows no system data.
//
// Built with exceljs (loaded on demand) because the xlsx library cannot write
// dropdown validations.

// The closed list of activity times.
import { GROUP_TIMES } from './groupOptions';

// Allowed activity days (full Hebrew form, Sunday–Friday; Saturday is not
// selectable) — the single shared source used by BOTH the volunteers and groups
// templates (no duplicated local list).
import { ACTIVITY_DAYS as ALLOWED_ACTIVITY_DAYS } from './activityDays';

// How many data rows get dropdowns / formulas pre-wired.
const TEMPLATE_ROWS = 300;


// Resolve a display name from either field shape.
function getName(item) {
  return (
    item.groupName || item.name ||
    [item.firstName, item.lastName].filter(Boolean).join(' ').trim() ||
    ''
  );
}


// Trigger a browser download of the finished workbook.
async function downloadWorkbook(workbook, fileName) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}


// Start a workbook with a main RTL sheet + a hidden sheet holding the valid
// choice lists (referenced by the dropdowns, invisible to the user).
async function createTemplate(sheetName, headers) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet(sheetName, { views: [{ rightToLeft: true }] });
  sheet.columns = headers.map((header) => ({ header, width: 18 }));
  sheet.getRow(1).font = { bold: true };

  const lists = workbook.addWorksheet('רשימות');
  lists.state = 'veryHidden';

  return { workbook, sheet, lists };
}


// Enforce real DATES on a column: Excel rejects free text with a Hebrew
// error, and the cell is date-formatted. (A popup calendar can't be embedded
// in a plain .xlsx — that needs VBA — so strict validation is the maximum.)
function addDateColumn(sheet, columnLetter, {
  numFmt = 'dd/mm/yyyy',
  error = 'יש להזין תאריך אמיתי בפורמט יום/חודש/שנה (למשל 15/06/1999) — לא טקסט חופשי.',
} = {}) {
  for (let row = 2; row <= TEMPLATE_ROWS; row += 1) {
    const cell = sheet.getCell(`${columnLetter}${row}`);
    cell.numFmt = numFmt;
    cell.dataValidation = {
      type: 'date',
      operator: 'between',
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'תאריך לא תקין',
      error,
      formulae: [new Date(1900, 0, 1), new Date()],
    };
  }
}


// Force TEXT format on a column so Excel keeps leading zeros (phones, IDs).
function addTextColumn(sheet, columnLetter) {
  for (let row = 2; row <= TEMPLATE_ROWS; row += 1) {
    sheet.getCell(`${columnLetter}${row}`).numFmt = '@';
  }
}


// Apply a list dropdown to a whole column (rows 2..TEMPLATE_ROWS).
function addDropdown(sheet, columnLetter, listFormula) {
  for (let row = 2; row <= TEMPLATE_ROWS; row += 1) {
    sheet.getCell(`${columnLetter}${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [listFormula],
    };
  }
}


// Fill a hidden-list column and return the range formula dropdowns can use.
function fillHiddenList(lists, columnLetter, values) {
  values.forEach((value, index) => {
    lists.getCell(`${columnLetter}${index + 1}`).value = value;
  });
  return `רשימות!$${columnLetter}$1:$${columnLetter}$${Math.max(values.length, 1)}`;
}


// ----- Volunteers template -----
// Build the volunteers template workbook WITHOUT downloading it — separated from
// the download so tests can generate and inspect the real workbook with no DOM.
// exceljs stays lazy-loaded (inside createTemplate); nothing is imported eagerly.
export async function buildVolunteersWorkbook(groups = [], programs = []) {
  const headers = [
    'שם פרטי *', 'שם משפחה *', 'תעודת זהות', 'טלפון', 'אימייל',
    'תאריך לידה', 'גיל (אוטומטי)', 'קבוצה', 'תוכנית', 'יום פעילות', 'זמן פעילות',
    'כתובת', 'בית ספר', 'ניסיון קודם', 'הערות',
  ];

  const { workbook, sheet, lists } = await createTemplate('מתנדבים', headers);

  // Dropdowns: group names + program names (hidden lists), the volunteer days,
  // and the activity time (the shared GROUP_TIMES — not duplicated here).
  const groupNames = groups.map(getName).filter(Boolean);
  const programNames = programs.map(getName).filter(Boolean);
  addDropdown(sheet, 'H', fillHiddenList(lists, 'A', groupNames));
  addDropdown(sheet, 'I', fillHiddenList(lists, 'B', programNames));
  addDropdown(sheet, 'J', `"${ALLOWED_ACTIVITY_DAYS.join(',')}"`);
  addDropdown(sheet, 'K', `"${GROUP_TIMES.join(',')}"`);

  // ID + phone columns stay TEXT so Excel keeps the leading 0.
  addTextColumn(sheet, 'C');
  addTextColumn(sheet, 'D');

  // Birth date column: real dates only, displayed dd-mm-yyyy with a dash example
  // in the validation error (never slashes); age column: an automatic,
  // display-only formula (the import never reads it).
  addDateColumn(sheet, 'F', {
    numFmt: 'dd-mm-yyyy',
    error: 'יש להזין תאריך אמיתי בפורמט יום-חודש-שנה (למשל 15-06-1999) — לא טקסט חופשי.',
  });
  for (let row = 2; row <= TEMPLATE_ROWS; row += 1) {
    sheet.getCell(`G${row}`).value = {
      formula: `IF(F${row}="","",DATEDIF(F${row},TODAY(),"Y"))`,
    };
  }

  return workbook;
}


// Empty file for adding NEW volunteers; group/program/day/time are dropdowns and
// the birth date is a real date cell.
export async function downloadVolunteersTemplate(groups = [], programs = []) {
  const workbook = await buildVolunteersWorkbook(groups, programs);
  await downloadWorkbook(workbook, 'תבנית-מתנדבים.xlsx');
}


// ----- Guides template -----
// Empty file for adding NEW guides (login accounts are created on import).
export async function downloadGuidesTemplate(groups = []) {
  const headers = [
    'שם פרטי *', 'שם משפחה *', 'אימייל *', 'טלפון', 'תאריך לידה', 'קבוצה', 'זמן פעילות',
  ];

  const { workbook, sheet, lists } = await createTemplate('מדריכים', headers);

  const groupNames = groups.map(getName).filter(Boolean);
  addDropdown(sheet, 'F', fillHiddenList(lists, 'A', groupNames));
  addDropdown(sheet, 'G', `"${GROUP_TIMES.join(',')}"`);

  // Phone column stays TEXT so Excel keeps the leading 0.
  addTextColumn(sheet, 'D');

  // Birth date column: dates only (validated, dd/mm/yyyy).
  addDateColumn(sheet, 'E');

  await downloadWorkbook(workbook, 'תבנית-מדריכים.xlsx');
}


// ----- Groups template -----
// Build the groups template workbook WITHOUT downloading it — separated so tests
// can generate and inspect the real workbook with no DOM. exceljs stays lazy.
export async function buildGroupsWorkbook(guides = [], volunteers = []) {
  const headers = [
    'שם קבוצה *', 'זמן פעילות', 'מדריך אחראי', 'מתנדבים משויכים (שמות, מופרדים בפסיק)',
    'מיקום / חדר', 'יום פעילות', 'הערות',
  ];

  const { workbook, sheet, lists } = await createTemplate('קבוצות', headers);
  sheet.getColumn(4).width = 34;

  // Activity time + responsible guide + activity day are dropdowns. The day list
  // is the SHARED full-form ACTIVITY_DAYS (Sun–Fri, no Saturday) — not a local
  // duplicate. Old files with the short form (ראשון) still import via the
  // normalizer.
  addDropdown(sheet, 'B', `"${GROUP_TIMES.join(',')}"`);
  addDropdown(sheet, 'C', fillHiddenList(lists, 'A', guides.map(getName).filter(Boolean)));
  addDropdown(sheet, 'F', `"${ALLOWED_ACTIVITY_DAYS.join(',')}"`);

  // Volunteer names also live on the hidden sheet (handy reference for the
  // free-text assignment column).
  fillHiddenList(lists, 'B', volunteers.map(getName).filter(Boolean));

  return workbook;
}


// Empty file for adding NEW groups; activity time / day and the responsible
// guide are dropdowns (guides come from the live users list, hidden sheet).
export async function downloadGroupsTemplate(guides = [], volunteers = []) {
  const workbook = await buildGroupsWorkbook(guides, volunteers);
  await downloadWorkbook(workbook, 'תבנית-קבוצות.xlsx');
}
