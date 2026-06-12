// Excel template builders — generate ready-to-fill .xlsx files for bulk
// imports (volunteers / guides). Each template has the exact column headers
// the import parsers expect, one example row, and a second "רשימות" sheet
// listing the valid group names and activity times to copy from.

// Download a workbook with a header row only — a completely empty template
// to fill in (no example data, nothing from the live system).
async function downloadTemplate({ fileName, sheetName, headers }) {
  // Load the Excel library on demand (kept out of the main bundle).
  const XLSX = await import('xlsx');

  // Main sheet: just the ordered column headers, ready for new rows.
  const mainSheet = XLSX.utils.aoa_to_sheet([headers]);
  mainSheet['!cols'] = headers.map(() => ({ wch: 16 }));

  // Assemble the workbook: a single, empty fill-in sheet.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, mainSheet, sheetName);

  // Trigger the browser download.
  XLSX.writeFile(workbook, fileName);
}


// Template for bulk-adding volunteers.
export function downloadVolunteersTemplate() {
  return downloadTemplate({

    fileName: 'תבנית-מתנדבים.xlsx',
    sheetName: 'מתנדבים',
    headers: [
      'שם פרטי', 'שם משפחה', 'תעודת זהות', 'טלפון', 'תאריך לידה',
      'גיל', 'כתובת', 'אימייל', 'בית ספר', 'ניסיון', 'קבוצה', 'זמן פעילות',
    ],
  });
}


// Template for bulk-adding guides (login accounts are created on import).
export function downloadGuidesTemplate() {
  return downloadTemplate({

    fileName: 'תבנית-מדריכים.xlsx',
    sheetName: 'מדריכים',
    headers: [
      'שם פרטי', 'שם משפחה', 'אימייל', 'טלפון', 'תאריך לידה', 'קבוצה', 'זמן פעילות',
    ],
  });
}
