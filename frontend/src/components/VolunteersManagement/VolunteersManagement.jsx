// VolunteersManagement — admin/guide screen for managing volunteers: add,
// edit, delete, search and assign them to a group. When opened from the guide
// dashboard it's pre-filtered to the guide's own group (the `initialGroup` prop).

// React hooks for state, effects, memoization, stable callbacks, and refs.
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

// Firestore helpers for reading and writing documents.
import { addDoc, collection, doc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

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

  // Signed forms that came back from the public digital form (admin-readable),
  // matched to a volunteer by the registrant id they were approved from.
  const [signedForms, setSignedForms] = useState([]);

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
      const [volunteersSnap, groupsSnap] = await Promise.all([
        getDocs(collection(db, 'volunteers')),
        getDocs(collection(db, 'groups')),
      ]);

      setVolunteers(volunteersSnap.docs.map(toRecord));
      setGroups(groupsSnap.docs.map(toRecord));

      // Signed digital forms (best-effort: a missing collection / permission
      // issue must not break the volunteers list, so it has its own catch).
      const signedSnap = await getDocs(collection(db, 'signedForms')).catch(() => null);
      if (signedSnap) {
        setSignedForms(signedSnap.docs.map(toRecord));
      }
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
    if (!window.confirm('למחוק מתנדב זה? גם היסטוריית הנוכחות שלו תימחק. הפעולה אינה הפיכה.')) return;

    try {
      const batch = writeBatch(db);

      const attendanceSnap = await getDocs(
        query(collection(db, 'attendance'), where('volunteerId', '==', volunteerId)),
      );
      attendanceSnap.docs.forEach((attendanceDoc) => batch.delete(attendanceDoc.ref));

      batch.delete(doc(db, 'volunteers', volunteerId));

      await batch.commit();
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
      
      const jsonRows = XLSX.utils.sheet_to_json(worksheet);

      // Collect the parsed rows first; written in chunks after parsing.
      const volunteersToAdd = [];

      const parseExcelDate = (excelValue) => {
        if (!excelValue) return '';
        if (typeof excelValue === 'string') return excelValue.trim();
        if (typeof excelValue === 'number') {
          try {
            const dateObj = XLSX.SSF.parse_date_code(excelValue);
            const year = dateObj.y;
            const month = String(dateObj.m).padStart(2, '0'); 
            const day = String(dateObj.d).padStart(2, '0');
            return `${year}-${month}-${day}`;
          } catch {
            // Unparseable date number: keep the raw value as text.
            return String(excelValue);
          }
        }
        return String(excelValue);
      };

      jsonRows.forEach((row) => {
        const firstName = String(row['שם פרטי *'] || row['שם פרטי'] || row['firstName'] || '').trim();
        const lastName = String(row['שם משפחה *'] || row['שם משפחה'] || row['lastName'] || '').trim();
        
        let name = String(row['שם מלא'] || row['שם'] || row['name'] || '').trim();
        if (!name && (firstName || lastName)) {
          name = `${firstName} ${lastName}`.trim();
        }

        if (!name) return; 

        const rawBirthDate = row['תאריך לידה'] || row['birthDate'] || '';
        const birthDate = parseExcelDate(rawBirthDate);

        // Restore the leading 0 if Excel stored the phone as a number.
        let phone = String(row['טלפון'] || row['phone'] || '').trim();
        if (/^5\d{8}$/.test(phone)) {
          phone = `0${phone}`;
        }
        const idNumber = String(row['תעודת זהות'] || row['ת.ז'] || row['idNumber'] || '').trim();
        const age = String(row['גיל (אוטומטי)'] || row['גיל'] || row['age'] || '').trim();
        const notes = String(row['הערות'] || row['notes'] || '').trim();
        const address = String(row['כתובת'] || row['address'] || '').trim();
        const email = String(row['אימייל'] || row['דוא"ל'] || row['email'] || '').trim();
        const experience = String(row['ניסיון קודם'] || row['ניסיון'] || row['experience'] || '').trim();
        const school = String(row['בית ספר'] || row['school'] || '').trim();

        // Group column: match the name against the live groups list so the
        // volunteer gets a real groupId (falls back to the locked group).
        const groupNameRaw = String(row['קבוצה'] || row['group'] || '').trim();
        const matchedGroup = groups.find(
          (group) => (group.groupName || group.name || '').trim() === groupNameRaw,
        );

        // Activity time column (בוקר / צהריים / ערב).
        const activityTime = String(row['זמן פעילות'] || row['activityTime'] || '').trim();

        volunteersToAdd.push({
          name,
          firstName,
          lastName,
          idNumber,
          phone,
          birthDate,
          age,
          address,
          email,
          experience,
          school,
          notes,
          activityTime,
          groupId: matchedGroup?.id || passedGroup?.id || '',
          groupName:
            matchedGroup?.groupName || matchedGroup?.name ||
            passedGroup?.groupName || groupNameRaw || '',
          createdAt: new Date(),
        });
      });

      const addedCount = volunteersToAdd.length;

      if (addedCount > 0) {
        // Firestore allows at most 500 writes per batch, so commit in chunks.
        const CHUNK_SIZE = 450;

        for (let start = 0; start < volunteersToAdd.length; start += CHUNK_SIZE) {
          const batch = writeBatch(db);

          volunteersToAdd
            .slice(start, start + CHUNK_SIZE)
            .forEach((volunteerPayload) => {
              const newDocRef = doc(collection(db, 'volunteers'));
              batch.set(newDocRef, volunteerPayload);
            });

          await batch.commit();
        }

        alert(`בהצלחה! יובאו ${addedCount} מתנדבים מהקובץ.`);
        await fetchData();
      } else {
        // No usable rows. A common mistake is importing the GROUPS template on
        // this (volunteers) screen — detect that and point to the right place.
        const looksLikeGroupsFile = jsonRows.some(
          (row) => row['שם קבוצה *'] !== undefined || row['שם קבוצה'] !== undefined,
        );

        if (looksLikeGroupsFile) {
          alert('נראה שזהו קובץ קבוצות, ולא מתנדבים. כדי לייבא קבוצות עברו למסך "ניהול קבוצות" ← "ייבוא קבוצות".');
        } else {
          alert('לא נמצאו נתונים תקינים בקובץ. ודא שקיימת עמודה בשם "שם מלא" או "שם פרטי".');
        }
      }

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

            {/* Downloads the import template. The groups list is pulled fresh
                at click time, so the file always matches the system NOW. */}
            <button
              className="mgmt-secondary-btn"
              onClick={async () => {
                const snapshot = await getDocs(collection(db, 'groups'));
                downloadVolunteersTemplate(snapshot.docs.map((groupDoc) => groupDoc.data()));
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
            </div>

            {/* Signed form — a digital submission and/or a scanned/attached copy. */}
            <div style={{ borderTop: '1px solid #eee', paddingTop: '14px', marginBottom: '16px' }}>
              <strong>טופס חתום:</strong>
              {!signedByVolunteer[viewingVolunteer.id] && !viewingVolunteer.signedFormImage ? (
                <span className="mgmt-muted"> טרם התקבל טופס חתום.</span>
              ) : (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {signedByVolunteer[viewingVolunteer.id] && (
                    <div>
                      <div style={{ color: '#15803d', fontWeight: 700, marginBottom: '6px' }}>✓ נחתם דיגיטלית</div>
                      {signedByVolunteer[viewingVolunteer.id].signature && (
                        <img
                          src={signedByVolunteer[viewingVolunteer.id].signature}
                          alt="חתימה דיגיטלית"
                          style={{ maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '10px', background: '#fff' }}
                        />
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

                {/* Activity time — the same closed list used for groups. */}
                <div className="form-group">
                  <label>זמן פעילות:</label>
                  <select
                    className="styled-input full-width-input"
                    value={formData.activityTime}
                    onChange={(e) => setFormData({ ...formData, activityTime: e.target.value })}
                  >
                    <option value="">-- בחר זמן פעילות --</option>
                    {GROUP_TIMES.map((timeOption) => (
                      <option key={timeOption} value={timeOption}>{timeOption}</option>
                    ))}
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
