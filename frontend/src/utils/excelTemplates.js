// Excel template builders — generate EMPTY, fill-in templates (not reports):
// real in-Excel dropdowns for every choice field, an automatic age formula,
// and bold headers with * marking required fields. The valid choices live on
// a hidden "רשימות" sheet, so the file itself shows no system data.
//
// Built with exceljs (loaded on demand) because the xlsx library cannot write
// dropdown validations.

// The closed list of activity times.
import { GROUP_TIMES } from './groupOptions';

// Activity days offered in the groups template.
const ACTIVITY_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

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
function addDateColumn(sheet, columnLetter) {
  for (let row = 2; row <= TEMPLATE_ROWS; row += 1) {
    const cell = sheet.getCell(`${columnLetter}${row}`);
    cell.numFmt = 'dd/mm/yyyy';
    cell.dataValidation = {
      type: 'date',
      operator: 'between',
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'תאריך לא תקין',
      error: 'יש להזין תאריך אמיתי בפורמט יום/חודש/שנה (למשל 15/06/1999) — לא טקסט חופשי.',
      formulae: [new Date(1900, 0, 1), new Date()],
    };
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
// Empty file for adding NEW volunteers; group + activity time are dropdowns,
// the birth date is a real date cell, and age fills itself from the date.
export async function downloadVolunteersTemplate(groups = []) {
  const headers = [
    'שם פרטי *', 'שם משפחה *', 'תעודת זהות', 'טלפון', 'אימייל',
    'תאריך לידה', 'גיל (אוטומטי)', 'קבוצה', 'זמן פעילות', 'כתובת', 'בית ספר', 'הערות',
  ];

  const { workbook, sheet, lists } = await createTemplate('מתנדבים', headers);

  // Dropdowns: group names (hidden list) + the fixed activity times.
  const groupNames = groups.map(getName).filter(Boolean);
  addDropdown(sheet, 'H', fillHiddenList(lists, 'A', groupNames));
  addDropdown(sheet, 'I', `"${GROUP_TIMES.join(',')}"`);

  // Birth date column: dates only (validated); age column: automatic formula.
  addDateColumn(sheet, 'F');
  for (let row = 2; row <= TEMPLATE_ROWS; row += 1) {
    sheet.getCell(`G${row}`).value = {
      formula: `IF(F${row}="","",DATEDIF(F${row},TODAY(),"Y"))`,
    };
  }

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

  // Birth date column: dates only (validated, dd/mm/yyyy).
  addDateColumn(sheet, 'E');

  await downloadWorkbook(workbook, 'תבנית-מדריכים.xlsx');
}


// ----- Groups template -----
// Empty file for adding NEW groups; activity time / day and the responsible
// guide are dropdowns (guides come from the live users list, hidden sheet).
export async function downloadGroupsTemplate(guides = [], volunteers = []) {
  const headers = [
    'שם קבוצה *', 'זמן פעילות', 'מדריך אחראי', 'מתנדבים משויכים (שמות, מופרדים בפסיק)',
    'מיקום / חדר', 'יום פעילות', 'הערות',
  ];

  const { workbook, sheet, lists } = await createTemplate('קבוצות', headers);
  sheet.getColumn(4).width = 34;

  addDropdown(sheet, 'B', `"${GROUP_TIMES.join(',')}"`);
  addDropdown(sheet, 'C', fillHiddenList(lists, 'A', guides.map(getName).filter(Boolean)));
  addDropdown(sheet, 'F', `"${ACTIVITY_DAYS.join(',')}"`);

  // Volunteer names also live on the hidden sheet (handy reference for the
  // free-text assignment column).
  fillHiddenList(lists, 'B', volunteers.map(getName).filter(Boolean));

  await downloadWorkbook(workbook, 'תבנית-קבוצות.xlsx');
}
