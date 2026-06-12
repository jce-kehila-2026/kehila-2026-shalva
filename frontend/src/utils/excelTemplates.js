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


// Download a workbook built from a header row + one example row.
async function downloadTemplate({ groups, fileName, sheetName, headers, exampleRow }) {
  // Load the Excel library on demand (kept out of the main bundle).
  const XLSX = await import('xlsx');

  // Main sheet: headers + a single example row to delete after reading.
  const mainSheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
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
    exampleRow: [
      'דנה', 'לוי', '123456789', '052-1234567', '2006-01-15',
      '20', 'ירושלים', 'dana@example.com', 'תיכון דוגמה', 'שנה בתנועת נוער',
      'תותים', 'בוקר',
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
    exampleRow: [
      'יוסי', 'כהן', 'yossi@example.com', '054-7654321', '1995-06-02', 'דובדבן', 'ערב',
    ],
  });
}
