// VolunteersManagement — admin/guide screen for managing volunteers: add,
// edit, delete, search and assign them to a group. When opened from the guide
// dashboard it's pre-filtered to the guide's own group (the `initialGroup` prop).

// React hooks for state, effects, memoization, stable callbacks, and refs.
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

// Firestore helpers for reading and writing documents.
import { addDoc, collection, doc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore';

// Allowed activity days (Sunday–Friday) + legacy-Saturday detection for display.
import { ACTIVITY_DAYS, isLegacySaturdayActivityDay } from '../../utils/activityDays';

// Storage helpers for reading and deleting files.
import { getDownloadURL, ref as storageRef, deleteObject } from 'firebase/storage';

// Our Firestore and Storage database instances.
import { db, storage } from '../../firebase';

// Date picker for the birth date field.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker';

// Button that opens a pre-filled WhatsApp message.
import WhatsAppButton from '../shared/WhatsAppButton/WhatsAppButton';

// Shared collapsible advanced-search bar (free text + per-field filters).
import SearchFilters from '../shared/SearchFilters/SearchFilters';

// Builds the greeting text for WhatsApp.
import { greetingMessage } from '../../utils/whatsapp';

// Downloads the ready-to-fill Excel template for bulk volunteer import.
import { downloadVolunteersTemplate } from '../../utils/excelTemplates';

// Validates + normalizes each imported volunteer row before any write, detects
// the file type from its header, and commits valid rows in chunks.
import {
  preflightVolunteerImport,
  detectImportFileType,
  commitVolunteerChunks,
} from '../../utils/volunteerImport';

// The closed list of activity times (בוקר / צהריים / ערב).
import { GROUP_TIMES } from '../../utils/groupOptions';

// Shared age calculation (the form derives age from the birth date).
import { computeAge } from '../../utils/people';

// Shared management-screen styles + this screen's own styles.
import '../shared/ManagementScreen.css';
import './VolunteersManagement.css';

// Turn a Firestore document snapshot into a plain object that keeps its id.
const toRecord = (documentSnapshot) => ({
  id: documentSnapshot.id,
  ...documentSnapshot.data(),
});

// Best available display name for a volunteer, with graceful fallbacks.
const getVolunteerName = (volunteer) => (
  volunteer?.name ||
  [volunteer?.firstName, volunteer?.lastName].filter(Boolean).join(' ').trim() ||
  volunteer?.email ||
  'מתנדב ללא שם'
);

const VolunteersManagement = ({ initialGroup = null, onBack, registerBack }) => {
  const passedGroup = initialGroup?.id || initialGroup?.groupName ? initialGroup : null;

  const [volunteers, setVolunteers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [programs, setPrograms] = useState([]);

  // Signed forms that came back from the public digital form (admin-readable),
  // matched to a volunteer by the registrant id they were approved from.
  const [signedForms, setSignedForms] = useState([]);
  const [policeForms, setPoliceForms] = useState([]);
  const [medicalForms, setMedicalForms] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');

  // Structured "advanced filters" — every field can narrow the list further,
  // on top of the free-text search above. Empty string means "don't filter".
  const [filters, setFilters] = useState({
    groupId: '',
    activityTime: '',
    ageMin: '',
    ageMax: '',
  });

  // Update one filter by name (handed to the shared SearchFilters component).
  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  // Reset every structured filter back to "don't filter".
  const clearFilters = () => {
    setFilters({ groupId: '', activityTime: '', ageMin: '', ageMax: '' });
  };

  // Which column the table is sorted by ('name' or 'group') and its direction.
  // Defaults to the volunteer name, A→Z.
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Click a column header: toggle direction if it's already the sort column,
  // otherwise switch to that column starting A→Z.
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  };

  // On phones the list collapses to names only; this is the row tapped open.
  const [expandedId, setExpandedId] = useState(null);
  const toggleExpand = (id) => setExpandedId((current) => (current === id ? null : id));

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVolunteer, setEditingVolunteer] = useState(null);
  const [viewingVolunteer, setViewingVolunteer] = useState(null);

  const [saving, setSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const fileInputRef = useRef(null);

  // --- UPDATED: formData now includes all fields ---
  const defaultFormData = {
    name: '',
    firstName: '',
    lastName: '',
    idNumber: '',
    phone: '',
    birthDate: '',
    activityTime: '',
    day: '',
    programId: '',
    programName: '',
    address: '',
    email: '',
    school: '',
    experience: '',
    groupId: passedGroup?.id || '',
    // A scanned / photographed signed form (stored as a data URL on the doc).
    signedFormImage: '',
  };

  const [formData, setFormData] = useState(defaultFormData);

  // Age derived from the selected birth date — never typed by hand.
  const computedAge = formData.birthDate
    ? String(computeAge(new Date(formData.birthDate)))
    : '';

  // Dashboard back button: close an open card / form first, then leave.
  useEffect(() => {
    if (!registerBack) return;
    registerBack(() => {
      if (viewingVolunteer) {
        setViewingVolunteer(null);
        return true;
      }
      if (isModalOpen) {
        setIsModalOpen(false);
        return true;
      }
      return false;
    });
  }, [registerBack, viewingVolunteer, isModalOpen]);

  const fetchData = useCallback(async () => {
    try {
      const [volunteersSnap, groupsSnap, programsSnap] = await Promise.all([
        getDocs(collection(db, 'volunteers')),
        getDocs(collection(db, 'groups')),
        getDocs(collection(db, 'programs')).catch(() => null),
      ]);

      setVolunteers(volunteersSnap.docs.map(toRecord));
      setGroups(groupsSnap.docs.map(toRecord));
      if (programsSnap) setPrograms(programsSnap.docs.map(toRecord));

      // Signed digital forms, police forms, and medical forms (best-effort)
      const [signedSnap, policeSnap, medicalSnap] = await Promise.all([
        getDocs(collection(db, 'signedForms')).catch(() => null),
        getDocs(collection(db, 'policeForms')).catch(() => null),
        getDocs(collection(db, 'medicalForms')).catch(() => null),
      ]);
      if (signedSnap) setSignedForms(signedSnap.docs.map(toRecord));
      if (policeSnap) setPoliceForms(policeSnap.docs.map(toRecord));
      if (medicalSnap) setMedicalForms(medicalSnap.docs.map(toRecord));
    } catch (error) {
      console.error('שגיאה בשליפת נתונים:', error);
    }
  }, []);

  // Digital signed forms indexed by the volunteer they belong to (a volunteer
  // approved from a registration shares that registrant's id as its doc id).
  const signedByVolunteer = useMemo(() => {
    const map = {};
    signedForms.forEach((signed) => {
      if (signed.registrantId) {
        map[signed.registrantId] = signed;
      }
    });
    return map;
  }, [signedForms]);

  const policeByVolunteer = useMemo(() => {
    const map = {};
    policeForms.forEach((doc) => {
      const rid = doc.registrantId || doc.id;
      if (rid) map[rid] = doc;
    });
    return map;
  }, [policeForms]);

  const medicalByVolunteer = useMemo(() => {
    const map = {};
    medicalForms.forEach((doc) => {
      const rid = doc.registrantId || doc.id;
      if (rid) map[rid] = doc;
    });
    return map;
  }, [medicalForms]);

  // Attach a scanned / photographed signed form to the volunteer being edited.
  // Stored inline as a data URL (kept small — Firestore documents cap at ~1MB).
  const handleSignedFormUpload = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    // Guard the document size: reject anything over ~900KB.
    if (file.size > 900 * 1024) {
      alert('הקובץ גדול מדי (עד 900KB). צלמו/סרקו באיכות נמוכה יותר.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setFormData((previous) => ({ ...previous, signedFormImage: reader.result }));
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  // Open the completed signed form PDF from Storage.
  const openSignedPdf = async (signedForm) => {
    const path = signedForm?.pdfStoragePath || signedForm?.fileStoragePath;
    if (!path) {
      alert('לטופס הזה עדיין אין קובץ שמור.');
      return;
    }

    // Open the window immediately to capture the user gesture (prevents popup blockers).
    const pdfWindow = window.open('', '_blank');

    try {
      const url = await getDownloadURL(storageRef(storage, path));
      if (pdfWindow) {
        pdfWindow.location.href = url;
      } else {
        window.open(url, '_blank');
      }
    } catch (pdfError) {
      if (pdfWindow) {
        pdfWindow.close();
      }
      console.error('פתיחת קובץ נכשלה:', pdfError);
      alert('לא ניתן לפתוח את הקובץ כרגע.');
    }
  };





  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getGroupName = useCallback((groupId, fallbackName = '') => {
    if (!groupId) return fallbackName || 'ללא קבוצה';
    const group = groups.find((item) => item.id === groupId);
    return group ? (group.groupName || group.name || 'קבוצה ללא שם') : (fallbackName || 'קבוצה לא ידועה');
  }, [groups]);

  const filteredAndSortedVolunteers = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    // Parse the age range once (empty boxes mean "no bound").
    const ageMin = filters.ageMin !== '' ? Number(filters.ageMin) : null;
    const ageMax = filters.ageMax !== '' ? Number(filters.ageMax) : null;

    return volunteers
      .filter((volunteer) => {
        // When opened from a guide's dashboard, only their own group is shown.
        const matchesLockedGroup = !passedGroup || (
          volunteer.groupId === passedGroup.id ||
          volunteer.groupName === passedGroup.groupName
        );
        if (!matchesLockedGroup) return false;

        // Advanced filter — group dropdown (a sentinel matches the unassigned).
        if (filters.groupId) {
          if (filters.groupId === '__none__') {
            if (volunteer.groupId || volunteer.groupName) return false;
          } else if (volunteer.groupId !== filters.groupId) {
            return false;
          }
        }

        // Advanced filter — activity time (בוקר / צהריים / ערב).
        if (filters.activityTime && volunteer.activityTime !== filters.activityTime) {
          return false;
        }

        // Advanced filter — age range (a volunteer with no age is excluded
        // once any bound is set, since we can't tell if they qualify).
        if (ageMin !== null || ageMax !== null) {
          const age = Number(volunteer.age);
          if (!Number.isFinite(age)) return false;
          if (ageMin !== null && age < ageMin) return false;
          if (ageMax !== null && age > ageMax) return false;
        }

        // Free-text search — matches across EVERY text column of the record.
        if (search) {
          const searchableText = [
            volunteer.name,
            volunteer.firstName,
            volunteer.lastName,
            volunteer.email,
            volunteer.phone,
            volunteer.idNumber,
            volunteer.address,
            volunteer.school,
            volunteer.experience,
            volunteer.activityTime,
            volunteer.age,
            getGroupName(volunteer.groupId, volunteer.groupName),
          ].filter(Boolean).join(' ').toLowerCase();

          if (!searchableText.includes(search)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by the chosen column — the volunteer's name or their group —
        // honouring the direction the header toggles.
        const valueA = sortBy === 'group' ? getGroupName(a.groupId, a.groupName) : getVolunteerName(a);
        const valueB = sortBy === 'group' ? getGroupName(b.groupId, b.groupName) : getVolunteerName(b);
        const comparison = valueA.localeCompare(valueB, 'he');
        return sortDir === 'asc' ? comparison : -comparison;
      });
  }, [getGroupName, passedGroup, searchQuery, filters, volunteers, sortBy, sortDir]);

  // The fields shown inside the advanced filter panel. The group dropdown is
  // dropped when the screen is already locked to a single group (guide view).
  const volunteerFilterFields = [
    ...(passedGroup ? [] : [{
      name: 'groupId',
      label: 'קבוצה',
      type: 'select',
      placeholder: 'כל הקבוצות',
      options: [
        { value: '__none__', label: 'ללא קבוצה' },
        ...groups.map((group) => ({
          value: group.id,
          label: group.groupName || group.name || 'קבוצה ללא שם',
        })),
      ],
    }]),
    {
      name: 'activityTime',
      label: 'זמן פעילות',
      type: 'select',
      placeholder: 'כל הזמנים',
      options: GROUP_TIMES,
    },
    { name: 'ageMin', label: 'גיל מינימום', type: 'number', placeholder: 'מ-' },
    { name: 'ageMax', label: 'גיל מקסימום', type: 'number', placeholder: 'עד' },
  ];

  const handleOpenAdd = () => {
    setEditingVolunteer(null);
    setFormData(defaultFormData);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (volunteer) => {
    setEditingVolunteer(volunteer);
    // --- UPDATED: populate form with all existing fields ---
    setFormData({
      name: getVolunteerName(volunteer),
      firstName: volunteer.firstName || '',
      lastName: volunteer.lastName || '',
      idNumber: volunteer.idNumber || '',
      phone: volunteer.phone || '',
      birthDate: volunteer.birthDate || '',
      activityTime: volunteer.activityTime || '',
      day: volunteer.day || '',
      programId: volunteer.programId || '',
      programName: volunteer.programName || '',
      address: volunteer.address || '',
      email: volunteer.email || '',
      school: volunteer.school || '',
      experience: volunteer.experience || '',
      groupId: volunteer.groupId || passedGroup?.id || '',
      signedFormImage: volunteer.signedFormImage || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving) return;

    let name = formData.name.trim();
    if (!name && (formData.firstName || formData.lastName)) {
      name = `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim();
    }
    
    if (!name) {
      alert('יש להזין שם למתנדב');
      return;
    }

    const selectedGroup = groups.find((group) => group.id === formData.groupId);
    const selectedProgram = programs.find((program) => program.id === formData.programId);
    
    // --- UPDATED: Payload saves all fields ---
    const payload = {
      name,
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      idNumber: formData.idNumber.trim(),
      phone: formData.phone.trim(),
      birthDate: formData.birthDate.trim(),
      age: computedAge,
      activityTime: formData.activityTime,
      day: formData.day,
      programId: formData.programId,
      programName: selectedProgram?.name || '',
      address: formData.address.trim(),
      email: formData.email.trim(),
      school: formData.school.trim(),
      experience: formData.experience.trim(),
      groupId: formData.groupId,
      groupName: selectedGroup?.groupName || selectedGroup?.name || passedGroup?.groupName || '',
      signedFormImage: formData.signedFormImage || '',
    };

    setSaving(true);

    try {
      if (editingVolunteer) {
        await updateDoc(doc(db, 'volunteers', editingVolunteer.id), payload);
      } else {
        await addDoc(collection(db, 'volunteers'), {
          ...payload,
          createdAt: new Date(),
        });
      }
      setIsModalOpen(false);
      await fetchData();
    } catch (error) {
      console.error('שגיאה בשמירת מתנדב:', error);
      alert('אירעה שגיאה בשמירת המתנדב');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (volunteerId) => {
    if (!window.confirm('למחוק מתנדב זה? כל הטפסים והקבצים שלו (טופס דיגיטלי, רפואי ומשטרתי) והיסטוריית הנוכחות שלו יימחקו. הפעולה אינה הפיכה.')) return;

    try {
      const batch = writeBatch(db);

      // Delete attendance history
      const attendanceSnap = await getDocs(
        query(collection(db, 'attendance'), where('volunteerId', '==', volunteerId)),
      );
      attendanceSnap.docs.forEach((attendanceDoc) => batch.delete(attendanceDoc.ref));

      // Get documents from state
      const signedDoc = signedByVolunteer[volunteerId];
      const policeDoc = policeByVolunteer[volunteerId];
      const medicalDoc = medicalByVolunteer[volunteerId];

      // Delete Firestore records
      if (signedDoc) {
        batch.delete(doc(db, 'signedForms', signedDoc.id));
      }
      if (policeDoc) {
        batch.delete(doc(db, 'policeForms', policeDoc.id));
      }
      if (medicalDoc) {
        batch.delete(doc(db, 'medicalForms', medicalDoc.id));
      }

      // Delete main volunteer document
      batch.delete(doc(db, 'volunteers', volunteerId));

      await batch.commit();

      // Delete files from Firebase Storage asynchronously (best-effort)
      const storageDeletes = [];
      if (signedDoc?.pdfStoragePath) {
        storageDeletes.push(deleteObject(storageRef(storage, signedDoc.pdfStoragePath)).catch(err => console.warn("Failed to delete signed PDF:", err)));
      }
      if (policeDoc?.fileStoragePath) {
        storageDeletes.push(deleteObject(storageRef(storage, policeDoc.fileStoragePath)).catch(err => console.warn("Failed to delete police file:", err)));
      }
      if (medicalDoc?.fileStoragePath) {
        storageDeletes.push(deleteObject(storageRef(storage, medicalDoc.fileStoragePath)).catch(err => console.warn("Failed to delete medical file:", err)));
      }

      if (storageDeletes.length > 0) {
        await Promise.all(storageDeletes);
      }

      await fetchData();
    } catch (error) {
      console.error('שגיאה במחיקת מתנדב:', error);
      alert('אירעה שגיאה במחיקת המתנדב');
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsImporting(true);

    try {
      // Load the Excel parser on demand — only admins importing a file pay
      // for it, so the main bundle stays small for everyone else.
      const XLSX = await import('xlsx');

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Identify the file from its HEADER row first — this also catches an
      // EMPTY groups template (headers present, but no data rows).
      const headerRow = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0] || [];
      const fileType = detectImportFileType(headerRow);

      if (fileType === 'duplicate-headers') {
        alert('הקובץ מכיל כותרות כפולות או עמומות (ייתכן בגלל BOM או רווחים בשמות העמודות). תקנו את שורת הכותרות ונסו שוב.');
        return;
      }
      if (fileType === 'ambiguous') {
        alert('הקובץ מכיל גם כותרות של קבוצות וגם של מתנדבים יחד, ולכן לא ניתן לייבא אותו. הפרידו את הנתונים לקבצים נפרדים.');
        return;
      }
      if (fileType === 'groups') {
        alert('נראה שזהו קובץ קבוצות, ולא מתנדבים. כדי לייבא קבוצות עברו למסך "ניהול קבוצות" ← "ייבוא קבוצות".');
        return;
      }
      if (fileType === 'unknown') {
        alert('לא נמצאו עמודות מתנדבים בקובץ. ודא שקיימת עמודה בשם "שם מלא" או "שם פרטי".');
        return;
      }

      const jsonRows = XLSX.utils.sheet_to_json(worksheet);

      // Honour the workbook's date system (1900 vs 1904) when decoding serials.
      const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);

      // Validate EVERY row up front (preflight). Empty rows are skipped silently.
      const { valid, rejected } = preflightVolunteerImport(jsonRows, { date1904 });

      // Assemble the Firestore payloads from the valid rows, keeping the existing
      // group/program matching and document schema unchanged. The Excel row
      // number is kept alongside each payload IN MEMORY only (for reporting) —
      // it is never written to Firestore.
      const itemsToWrite = valid.map(({ excelRow, fields }) => {
        // Group column: match the name against the live groups list so the
        // volunteer gets a real groupId (falls back to the locked group).
        const matchedGroup = groups.find(
          (group) => (group.groupName || group.name || '').trim() === fields.groupNameRaw,
        );

        // Program column: match the name against the live programs list.
        const matchedProgram = programs.find(
          (program) => (program.name || '').trim() === fields.programNameRaw,
        );

        return {
          excelRow,
          payload: {
            name: fields.name,
            firstName: fields.firstName,
            lastName: fields.lastName,
            idNumber: fields.idNumber,
            phone: fields.phone,
            birthDate: fields.birthDate,
            age: fields.age,
            address: fields.address,
            email: fields.email,
            experience: fields.experience,
            school: fields.school,
            notes: fields.notes,
            activityTime: fields.activityTime,
            day: fields.day,
            programId: matchedProgram?.id || '',
            programName: matchedProgram?.name || fields.programNameRaw || '',
            groupId: matchedGroup?.id || passedGroup?.id || '',
            groupName:
              matchedGroup?.groupName || matchedGroup?.name ||
              passedGroup?.groupName || fields.groupNameRaw || '',
            createdAt: new Date(),
          },
        };
      });

      // A volunteer file with no data rows and nothing rejected.
      if (itemsToWrite.length === 0 && rejected.length === 0) {
        alert('הקובץ אינו מכיל שורות נתונים לייבוא.');
        return;
      }

      // Commit the valid rows in bounded chunks to limit request size and
      // support accurate partial-failure reporting. It stops at the first
      // failing chunk and reports written / failed / not-attempted honestly.
      const { written, failedInCurrentBatch, notAttempted, error: writeError } =
        await commitVolunteerChunks(
          itemsToWrite,
          (payloads) => {
            const batch = writeBatch(db);
            payloads.forEach((volunteerPayload) => {
              batch.set(doc(collection(db, 'volunteers')), volunteerPayload);
            });
            return batch.commit();
          },
          450,
        );

      if (writeError) {
        console.error('שגיאה בכתיבת מתנדבים:', writeError);
      }

      // Refresh whatever landed — a refresh failure is NOT an import failure.
      let refreshFailed = false;
      if (written > 0) {
        try {
          await fetchData();
        } catch (refreshError) {
          console.error('רענון המסך נכשל אחרי ייבוא:', refreshError);
          refreshFailed = true;
        }
      }

      // Honest, PII-free summary (sensitive values were already masked upstream).
      const summaryLines = [`נכתבו ${written} מתנדבים.`];

      if (rejected.length > 0) {
        summaryLines.push(`נדחו ${rejected.length} שורות בבדיקת תקינות.`);
      }
      if (writeError) {
        summaryLines.push(`כתיבת ${failedInCurrentBatch} שורות נכשלה, ו-${notAttempted} שורות לא נוסו.`);
      }
      if (written > 0) {
        summaryLines.push('שימו לב: עדיין אין מניעת כפילויות — אל תייבאו מחדש את כל הקובץ ללא טיפול בשורות שכבר נכתבו.');
      }
      if (refreshFailed) {
        summaryLines.push('הנתונים נשמרו, אך רענון המסך נכשל — רעננו את הדף ידנית.');
      }

      if (rejected.length > 0) {
        summaryLines.push('');
        summaryLines.push('שורות שנדחו:');
        rejected.slice(0, 20).forEach(({ excelRow, reasons }) => {
          summaryLines.push(`שורה ${excelRow}: ${reasons.join('; ')}`);
        });
        if (rejected.length > 20) {
          summaryLines.push(`ועוד ${rejected.length - 20} שורות…`);
        }
      }

      alert(summaryLines.join('\n'));

    } catch (error) {
      console.error('שגיאה בייבוא קובץ:', error);
      alert('אירעה שגיאה בייבוא הקובץ. ודא שזהו קובץ אקסל תקין.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = null;
      }
    }
  };

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        {/* Header: the volunteers count on the right + the action buttons
            raised up onto the same row (left side). */}
        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{filteredAndSortedVolunteers.length}</span>
            <small>מתנדבים</small>
          </div>

          <div className="mgmt-toolbar" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {typeof onBack === 'function' && (
              <button className="mgmt-secondary-btn" onClick={onBack}>חזרה</button>
            )}
            <button className="mgmt-primary-btn" onClick={handleOpenAdd}>+ הוסף מתנדב חדש</button>

            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button
              className="mgmt-secondary-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? '⏳ מייבא...' : '📥 ייבא מתנדבים'}
            </button>

            {/* Downloads the import template. The groups and programs list is pulled fresh
                at click time, so the file always matches the system NOW. */}
            <button
              className="mgmt-secondary-btn"
              onClick={async () => {
                const [groupsSnap, programsSnap] = await Promise.all([
                  getDocs(collection(db, 'groups')),
                  getDocs(collection(db, 'programs')),
                ]);
                downloadVolunteersTemplate(
                  groupsSnap.docs.map((groupDoc) => groupDoc.data()),
                  programsSnap.docs.map((programDoc) => ({ id: programDoc.id, ...programDoc.data() }))
                );
              }}
            >
              ⬇️ הורדת תבנית אקסל
            </button>
          </div>
        </header>

        {/* When opened from a guide's dashboard: a note that the list is scoped. */}
        {passedGroup && (
          <section className="mgmt-section">
            <p className="mgmt-subtitle">מסונן עבור קבוצה: <strong>{passedGroup.groupName || getGroupName(passedGroup.id)}</strong></p>
          </section>
        )}

        <section className="mgmt-section">
          {/* Free-text search + collapsible advanced filters (group, activity
              time, age range). The free text searches every column. */}
          <div className="mgmt-filters-row">
            <SearchFilters
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="🔍 חיפוש מתנדב לפי שם, ת.ז, טלפון, כתובת..."
              fields={volunteerFilterFields}
              values={filters}
              onChange={updateFilter}
              onClear={clearFilters}
            />
          </div>
        </section>

        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>רשימת מתנדבים</h2>
          </div>

          <div className="mgmt-table-wrap">
            <table className="mgmt-table">
              {/* Name + group headers are buttons that sort the list A↔Z. */}
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className={`mgmt-sort ${sortBy === 'name' ? 'is-active' : ''}`}
                      onClick={() => handleSort('name')}
                    >
                      שם המתנדב
                      {sortBy === 'name' && (
                        <span className="mgmt-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`mgmt-sort ${sortBy === 'group' ? 'is-active' : ''}`}
                      onClick={() => handleSort('group')}
                    >
                      שיוך לקבוצה
                      {sortBy === 'group' && (
                        <span className="mgmt-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </th>
                  <th>טלפון</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedVolunteers.length > 0 ? (
                  filteredAndSortedVolunteers.map((volunteer) => (
                    <tr key={volunteer.id} className={expandedId === volunteer.id ? 'is-expanded' : ''}>
                      <td
                        data-label="שם המתנדב"
                        className="mgmt-name-cell"
                        onClick={() => toggleExpand(volunteer.id)}
                      >
                        <strong>{getVolunteerName(volunteer)}</strong>
                      </td>
                      <td data-label="שיוך לקבוצה">{getGroupName(volunteer.groupId, volunteer.groupName)}</td>
                      <td data-label="טלפון">
                        {volunteer.phone
                          ? <a href={`tel:${String(volunteer.phone).replace(/[^\d+]/g, '')}`} dir="ltr">{volunteer.phone}</a>
                          : <span className="mgmt-muted">—</span>}
                      </td>
                      <td data-label="פעולות" className="mgmt-actions-cell">
                        <div className="mgmt-row-actions">
                          <WhatsAppButton
                            phone={volunteer.phone}
                            message={greetingMessage(getVolunteerName(volunteer))}
                            label="וואטסאפ"
                            compact
                          />
                          <button className="mgmt-secondary-btn" onClick={() => setViewingVolunteer(volunteer)}>👁️ צפה</button>
                          <button onClick={() => handleOpenEdit(volunteer)}>ערוך</button>
                          <button className="danger" onClick={() => handleDelete(volunteer.id)}>מחק</button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="mgmt-empty">לא נמצאו מתנדבים.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {/* View Volunteer Details Modal */}
      {viewingVolunteer && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">פרטי מתנדב</div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px', lineHeight: '1.6' }}>
              <div><strong>שם מלא:</strong> {getVolunteerName(viewingVolunteer)}</div>
              <div><strong>שם פרטי:</strong> {viewingVolunteer.firstName || '—'}</div>
              <div><strong>שם משפחה:</strong> {viewingVolunteer.lastName || '—'}</div>
              <div><strong>תעודת זהות:</strong> {viewingVolunteer.idNumber || '—'}</div>
              <div><strong>טלפון:</strong> <span dir="ltr">{viewingVolunteer.phone || '—'}</span></div>
              <div><strong>תאריך לידה:</strong> {viewingVolunteer.birthDate || '—'}</div>
              <div><strong>גיל:</strong> {viewingVolunteer.age || '—'}</div>
              <div><strong>אימייל:</strong> {viewingVolunteer.email || '—'}</div>
              <div><strong>כתובת:</strong> {viewingVolunteer.address || '—'}</div>
              <div><strong>בית ספר:</strong> {viewingVolunteer.school || '—'}</div>
              <div><strong>ניסיון קודם:</strong> {viewingVolunteer.experience || '—'}</div>
              <div><strong>קבוצה נוכחית:</strong> {getGroupName(viewingVolunteer.groupId, viewingVolunteer.groupName)}</div>
              <div><strong>יום פעילות נוכחי:</strong> {viewingVolunteer.day || 'כל הימים / לא מוגדר'}</div>
              <div><strong>תוכנית:</strong> {viewingVolunteer.programName || 'ללא תוכנית'}</div>
            </div>

            {/* Signed form — a digital submission and/or a scanned/attached copy. */}
            <div style={{ borderTop: '1px solid #eee', paddingTop: '14px', marginBottom: '16px' }}>
              <strong>טפסים ומסמכים:</strong>
              {!signedByVolunteer[viewingVolunteer.id] && !viewingVolunteer.signedFormImage && !policeByVolunteer[viewingVolunteer.id] && !medicalByVolunteer[viewingVolunteer.id] ? (
                <span className="mgmt-muted"> טרם התקבלו טפסים או מסמכים.</span>
              ) : (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {signedByVolunteer[viewingVolunteer.id] && (
                    <div>
                      <div style={{ color: '#15803d', fontWeight: 700, marginBottom: '6px' }}>✓ נחתם דיגיטלית</div>
                      {signedByVolunteer[viewingVolunteer.id].signature && (
                        <img
                          src={signedByVolunteer[viewingVolunteer.id].signature}
                          alt="חתימה דיגיטלית"
                          style={{ maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '10px', background: '#fff', marginBottom: '8px' }}
                        />
                      )}
                      {signedByVolunteer[viewingVolunteer.id].pdfStoragePath && (
                        <div style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="mgmt-secondary-btn"
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={() => openSignedPdf(signedByVolunteer[viewingVolunteer.id])}
                          >
                            📄 פתיחת PDF חתום
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {policeByVolunteer[viewingVolunteer.id] && (
                    <div>
                      <div style={{ color: '#0369a1', fontWeight: 700, marginBottom: '6px' }}>✓ טופס משטרתי התקבל</div>
                      {policeByVolunteer[viewingVolunteer.id].fileStoragePath && (
                        <div style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="mgmt-secondary-btn"
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={() => openSignedPdf(policeByVolunteer[viewingVolunteer.id])}
                          >
                            📄 פתיחת טופס משטרתי
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {medicalByVolunteer[viewingVolunteer.id] && (
                    <div>
                      <div style={{ color: '#b45309', fontWeight: 700, marginBottom: '6px' }}>✓ טופס רפואי התקבל</div>
                      {medicalByVolunteer[viewingVolunteer.id].fileStoragePath && (
                        <div style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="mgmt-secondary-btn"
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={() => openSignedPdf(medicalByVolunteer[viewingVolunteer.id])}
                          >
                            📄 פתיחת טופס רפואי
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {viewingVolunteer.signedFormImage && (
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: '6px' }}>טופס שצורף</div>
                      <img
                        src={viewingVolunteer.signedFormImage}
                        alt="טופס חתום שצורף"
                        style={{ maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '10px' }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
              <button type="button" className="btn btn-outline" onClick={() => setViewingVolunteer(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit volunteer modal. */}
      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content" style={{ maxWidth: '700px' }}>
            <div className="modal-header">{editingVolunteer ? 'עריכת מתנדב' : 'הוספת מתנדב חדש'}</div>
            <form onSubmit={handleSave} className="volunteer-form">
              
              {/* Used a grid layout here to keep the form compact */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>שם מלא:</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>שם פרטי:</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>שם משפחה:</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>תעודת זהות:</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={formData.idNumber}
                    onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>טלפון (לשליחה בוואטסאפ):</label>
                  <input
                    type="tel"
                    className="styled-input full-width-input"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="לדוגמה: 052-1234567"
                    dir="ltr"
                  />
                </div>

                <div className="form-group">
                  <BirthDatePicker
                    key={editingVolunteer ? editingVolunteer.id : 'new'}
                    value={formData.birthDate}
                    onChange={(birthDate) => setFormData({ ...formData, birthDate })}
                    label="תאריך לידה"
                    showPreview
                  />
                </div>

                {/* Age is derived from the birth date — never typed by hand. */}
                <div className="form-group">
                  <label>גיל (מחושב אוטומטית):</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={computedAge !== '' ? computedAge : 'בחרו תאריך לידה'}
                    readOnly
                    disabled
                  />
                </div>



                {/* Day of week for volunteer attendance */}
                <div className="form-group">
                  <label>יום פעילות:</label>
                  <select
                    className="styled-input full-width-input"
                    value={formData.day}
                    onChange={(e) => setFormData({ ...formData, day: e.target.value })}
                  >
                    <option value="">כל הימים / לא מוגדר</option>
                    {ACTIVITY_DAYS.map((activityDay) => (
                      <option key={activityDay} value={activityDay}>{activityDay}</option>
                    ))}
                    {/* Existing Saturday record: show its value as a selected but
                        disabled option so it stays visible and can't be re-chosen.
                        Once a Sunday–Friday day is picked, this disappears. */}
                    {isLegacySaturdayActivityDay(formData.day) && (
                      <option value={formData.day} disabled>יום שבת — נתון קיים</option>
                    )}
                  </select>
                </div>

                <div className="form-group">
                  <label>אימייל:</label>
                  <input
                    type="email"
                    className="styled-input full-width-input"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    dir="ltr"
                  />
                </div>

                <div className="form-group">
                  <label>כתובת:</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>בית ספר:</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={formData.school}
                    onChange={(e) => setFormData({ ...formData, school: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>ניסיון קודם:</label>
                  <input
                    type="text"
                    className="styled-input full-width-input"
                    value={formData.experience}
                    onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>שיוך לקבוצה:</label>
                  <select
                    className="styled-input full-width-input"
                    value={formData.groupId}
                    onChange={(e) => setFormData({ ...formData, groupId: e.target.value })}
                    disabled={Boolean(passedGroup)}
                  >
                    <option value="">-- ללא קבוצה --</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.groupName || group.name || 'קבוצה ללא שם'}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>שיוך לתוכנית:</label>
                  <select
                    className="styled-input full-width-input"
                    value={formData.programId}
                    onChange={(e) => setFormData({ ...formData, programId: e.target.value })}
                  >
                    <option value="">-- ללא תוכנית --</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>{program.name || 'תוכנית ללא שם'}</option>
                    ))}
                  </select>
                </div>

                {/* Attach a signed form (scan / photo) for an existing volunteer. */}
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>טופס חתום (סריקה / צילום):</label>
                  <input type="file" accept="image/*" onChange={handleSignedFormUpload} />
                  {formData.signedFormImage && (
                    <div style={{ marginTop: '10px' }}>
                      <img
                        src={formData.signedFormImage}
                        alt="טופס חתום"
                        style={{ maxWidth: '100%', maxHeight: '220px', border: '1px solid var(--border)', borderRadius: '10px' }}
                      />
                      <div>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ marginTop: '8px' }}
                          onClick={() => setFormData((previous) => ({ ...previous, signedFormImage: '' }))}
                        >
                          הסרת הטופס
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              </div>

              <div className="modal-actions" style={{ marginTop: '20px' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>ביטול</button>
                <button type="submit" className="btn btn-success" disabled={saving}>{saving ? 'שומר...' : editingVolunteer ? 'שמור שינויים' : 'הוסף מתנדב'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default VolunteersManagement;
