// Excel template builders — generate ready-to-fill .xlsx files for bulk
// imports (volunteers / guides). Each template has the exact column headers
// the import parsers expect, one example row, and a second "רשימות" sheet
// listing the valid group names and activity times to copy from.

// The closed list of activity times.
import { GROUP_TIMES } from './groupOptions';


// Resolve a group's display name from either field shape.
function getGroupName(group) {
  return group.groupName || group.name || '';
}


// Build the shared "רשימות" (lists) sheet: valid groups + activity times.
function buildListsSheet(XLSX, groups) {
  const rows = [['קבוצות במערכת', 'זמני פעילות']];

  // Pair each group name with a time (times list is shorter; blanks after).
  const groupNames = groups.map(getGroupName).filter(Boolean);
  const rowCount = Math.max(groupNames.length, GROUP_TIMES.length);

  for (let index = 0; index < rowCount; index += 1) {
    rows.push([groupNames[index] || '', GROUP_TIMES[index] || '']);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 24 }, { wch: 14 }];
  return sheet;
}


// Download a workbook with a header row only — a completely empty template
// to fill in (no example data, nothing from the live system).
async function downloadTemplate({ groups, fileName, sheetName, headers }) {
  // Load the Excel library on demand (kept out of the main bundle).
  const XLSX = await import('xlsx');

  // Main sheet: just the ordered column headers, ready for new rows.
  const mainSheet = XLSX.utils.aoa_to_sheet([headers]);
  mainSheet['!cols'] = headers.map(() => ({ wch: 16 }));

  // Assemble the workbook: the fill-in sheet + the valid-values sheet.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, mainSheet, sheetName);
  XLSX.utils.book_append_sheet(workbook, buildListsSheet(XLSX, groups), 'רשימות');

  // Trigger the browser download.
  XLSX.writeFile(workbook, fileName);
}


// Template for bulk-adding volunteers.
export function downloadVolunteersTemplate(groups) {
  return downloadTemplate({
    groups,
    fileName: 'תבנית-מתנדבים.xlsx',
    sheetName: 'מתנדבים',
    headers: [
      'שם פרטי', 'שם משפחה', 'תעודת זהות', 'טלפון', 'תאריך לידה',
      'גיל', 'כתובת', 'אימייל', 'בית ספר', 'ניסיון', 'קבוצה', 'זמן פעילות',
    ],
  });
}


// Template for bulk-adding guides (login accounts are created on import).
export function downloadGuidesTemplate(groups) {
  return downloadTemplate({
    groups,
    fileName: 'תבנית-מדריכים.xlsx',
    sheetName: 'מדריכים',
    headers: [
      'שם פרטי', 'שם משפחה', 'אימייל', 'טלפון', 'תאריך לידה', 'קבוצה', 'זמן פעילות',
    ],
  });
}
