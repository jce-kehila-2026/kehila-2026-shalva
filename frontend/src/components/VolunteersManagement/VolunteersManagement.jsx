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
  const [searchQuery, setSearchQuery] = useState('');

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
    } catch (error) {
      console.error('שגיאה בשליפת נתונים:', error);
    }
  }, []);

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

    return volunteers
      .filter((volunteer) => {
        const matchesGroup = !passedGroup || (
          volunteer.groupId === passedGroup.id ||
          volunteer.groupName === passedGroup.groupName
        );

        const searchableText = [
          volunteer.name,
          volunteer.firstName,
          volunteer.lastName,
          volunteer.email,
          volunteer.phone,
          volunteer.idNumber,
        ].filter(Boolean).join(' ').toLowerCase();

        return matchesGroup && (!search || searchableText.includes(search));
      })
      .sort((a, b) => getGroupName(a.groupId, a.groupName).localeCompare(getGroupName(b.groupId, b.groupName), 'he'));
  }, [getGroupName, passedGroup, searchQuery, volunteers]);

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

        const phone = String(row['טלפון'] || row['phone'] || '').trim();
        const idNumber = String(row['תעודת זהות'] || row['ת.ז'] || row['idNumber'] || '').trim();
        const age = String(row['גיל (אוטומטי)'] || row['גיל'] || row['age'] || '').trim();
        const notes = String(row['הערות'] || row['notes'] || '').trim();
        const address = String(row['כתובת'] || row['address'] || '').trim();
        const email = String(row['אימייל'] || row['דוא"ל'] || row['email'] || '').trim();
        const experience = String(row['ניסיון'] || row['experience'] || '').trim();
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
        alert('לא נמצאו נתונים תקינים בקובץ. ודא שקיימת עמודה בשם "שם מלא" או "שם פרטי".');
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

        <header className="mgmt-header">
          <div>
            {passedGroup && (
              <p className="mgmt-subtitle">מסונן עבור קבוצה: <strong>{passedGroup.groupName || getGroupName(passedGroup.id)}</strong></p>
            )}
          </div>

          <div className="mgmt-header-side">
            {typeof onBack === 'function' && (
              <button className="mgmt-secondary-btn" onClick={onBack}>חזרה</button>
            )}
            <div className="mgmt-count">
              <span>{filteredAndSortedVolunteers.length}</span>
              <small>מתנדבים</small>
            </div>
          </div>
        </header>

        <section className="mgmt-section">
          <div className="mgmt-toolbar" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
              {isImporting ? '⏳ מייבא...' : '📥 ייבא מאקסל'}
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

            <input
              type="search"
              className="mgmt-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="🔍 חפש מתנדב לפי שם או ת.ז..."
              style={{ flexGrow: 1 }}
            />
          </div>
        </section>

        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>רשימת מתנדבים</h2>
          </div>

          <div className="mgmt-table-wrap">
            <table className="mgmt-table">
              <thead>
                <tr>
                  <th>שם המתנדב</th>
                  <th>שיוך לקבוצה</th>
                  <th>טלפון</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedVolunteers.length > 0 ? (
                  filteredAndSortedVolunteers.map((volunteer) => (
                    <tr key={volunteer.id}>
                      <td data-label="שם המתנדב"><strong>{getVolunteerName(volunteer)}</strong></td>
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
                  <label>תאריך לידה:</label>
                  <BirthDatePicker
                    key={editingVolunteer ? editingVolunteer.id : 'new'}
                    value={formData.birthDate}
                    onChange={(birthDate) => setFormData({ ...formData, birthDate })}
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