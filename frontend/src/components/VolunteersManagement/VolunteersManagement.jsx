// VolunteersManagement — admin/guide screen for managing volunteers: add,
// edit, delete, search and assign them to a group. When opened from the guide
// dashboard it's pre-filtered to the guide's own group (the `initialGroup` prop).

// React hooks for state, effects, memoization and stable callbacks.
import { useCallback, useEffect, useMemo, useState } from 'react';

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


const VolunteersManagement = ({ initialGroup = null, onBack }) => {
  // The group this screen is locked to (when opened from the guide dashboard).
  const passedGroup = initialGroup?.id || initialGroup?.groupName ? initialGroup : null;

  // The loaded volunteers and groups.
  const [volunteers, setVolunteers] = useState([]);
  const [groups, setGroups] = useState([]);

  // Search text for filtering the list.
  const [searchQuery, setSearchQuery] = useState('');

  // Modal visibility + which volunteer is being edited (null = adding).
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVolunteer, setEditingVolunteer] = useState(null);

  // True while a save is in flight (guards against double-submit).
  const [saving, setSaving] = useState(false);

  // The add/edit form fields.
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    birthDate: '',
    groupId: passedGroup?.id || '',
  });

  // Load volunteers and groups together.
  const fetchData = useCallback(async () => {
    try {
      // Read both collections in parallel.
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

  // Load everything once on mount.
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Resolve a group's display name from its id (with fallbacks).
  const getGroupName = useCallback((groupId, fallbackName = '') => {
    if (!groupId) return fallbackName || 'ללא קבוצה';
    const group = groups.find((item) => item.id === groupId);
    return group ? (group.groupName || group.name || 'קבוצה ללא שם') : (fallbackName || 'קבוצה לא ידועה');
  }, [groups]);

  // Volunteers filtered by group + search, sorted by group name.
  const filteredAndSortedVolunteers = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    return volunteers
      .filter((volunteer) => {
        // When locked to a group, keep only that group's volunteers.
        const matchesGroup = !passedGroup || (
          volunteer.groupId === passedGroup.id ||
          volunteer.groupName === passedGroup.groupName
        );

        // Build the searchable text for this volunteer.
        const searchableText = [
          volunteer.name,
          volunteer.firstName,
          volunteer.lastName,
          volunteer.email,
          volunteer.phone,
        ].filter(Boolean).join(' ').toLowerCase();

        // Keep it if it matches both the group and the search.
        return matchesGroup && (!search || searchableText.includes(search));
      })
      .sort((a, b) => getGroupName(a.groupId, a.groupName).localeCompare(getGroupName(b.groupId, b.groupName), 'he'));
  }, [getGroupName, passedGroup, searchQuery, volunteers]);

  // Open the modal in "add" mode with empty fields.
  const handleOpenAdd = () => {
    setEditingVolunteer(null);
    setFormData({ name: '', phone: '', birthDate: '', groupId: passedGroup?.id || '' });
    setIsModalOpen(true);
  };

  // Open the modal in "edit" mode pre-filled with a volunteer's data.
  const handleOpenEdit = (volunteer) => {
    setEditingVolunteer(volunteer);
    setFormData({
      name: getVolunteerName(volunteer),
      phone: volunteer.phone || '',
      birthDate: volunteer.birthDate || '',
      groupId: volunteer.groupId || passedGroup?.id || '',
    });
    setIsModalOpen(true);
  };

  // Save a new or edited volunteer.
  const handleSave = async (event) => {
    event.preventDefault();

    // Ignore extra submits while a save is already running (no duplicates).
    if (saving) return;

    // Name is required.
    const name = formData.name.trim();
    if (!name) return;

    // Birth date is required.
    const birthDate = formData.birthDate.trim();
    if (!birthDate) {
      alert('יש להזין תאריך לידה למתנדב');
      return;
    }

    // Build the volunteer payload (with a resolved group name).
    const selectedGroup = groups.find((group) => group.id === formData.groupId);
    const payload = {
      name,
      phone: formData.phone.trim(),
      birthDate,
      groupId: formData.groupId,
      groupName: selectedGroup?.groupName || selectedGroup?.name || passedGroup?.groupName || '',
    };

    setSaving(true);

    try {
      // Update the existing volunteer, or add a new one.
      if (editingVolunteer) {
        await updateDoc(doc(db, 'volunteers', editingVolunteer.id), payload);
      } else {
        await addDoc(collection(db, 'volunteers'), {
          ...payload,
          createdAt: new Date(),
        });
      }

      // Close the modal and refresh.
      setIsModalOpen(false);
      await fetchData();
    } catch (error) {
      console.error('שגיאה בשמירת מתנדב:', error);
      alert('אירעה שגיאה בשמירת המתנדב');
    } finally {
      setSaving(false);
    }
  };

  // Delete a volunteer after confirmation — together with their attendance
  // history, so reports / charts aren't left with orphaned records.
  const handleDelete = async (volunteerId) => {
    // Confirm first.
    if (!window.confirm('למחוק מתנדב זה? גם היסטוריית הנוכחות שלו תימחק. הפעולה אינה הפיכה.')) return;

    try {
      const batch = writeBatch(db);

      // Remove every attendance record that points at this volunteer.
      const attendanceSnap = await getDocs(
        query(collection(db, 'attendance'), where('volunteerId', '==', volunteerId)),
      );
      attendanceSnap.docs.forEach((attendanceDoc) => batch.delete(attendanceDoc.ref));

      // Remove the volunteer document itself.
      batch.delete(doc(db, 'volunteers', volunteerId));

      await batch.commit();
      await fetchData();
    } catch (error) {
      console.error('שגיאה במחיקת מתנדב:', error);
      alert('אירעה שגיאה במחיקת המתנדב');
    }
  };

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        {/* Header: optional group-filter note + back button + count.
            The page title is omitted — the sidebar already labels the screen. */}
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

        {/* Toolbar: add button + search. */}
        <section className="mgmt-section">
          <div className="mgmt-toolbar">
            <button className="mgmt-primary-btn" onClick={handleOpenAdd}>+ הוסף מתנדב חדש</button>
            <input
              type="search"
              className="mgmt-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="🔍 חפש מתנדב לפי שם..."
            />
          </div>
        </section>

        {/* The volunteers table. */}
        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>רשימת מתנדבים</h2>
          </div>

          <div className="mgmt-table-wrap">
            <table className="mgmt-table">

              {/* Column headers. */}
              <thead>
                <tr>
                  <th>שם המתנדב</th>
                  <th>שיוך לקבוצה</th>
                  <th>טלפון</th>
                  <th>פעולות</th>
                </tr>
              </thead>

              <tbody>
                {/* A row per volunteer, or an empty-state row. */}
                {filteredAndSortedVolunteers.length > 0 ? (
                  filteredAndSortedVolunteers.map((volunteer) => (
                    <tr key={volunteer.id}>
                      <td data-label="שם המתנדב"><strong>{getVolunteerName(volunteer)}</strong></td>
                      <td data-label="שיוך לקבוצה">{getGroupName(volunteer.groupId, volunteer.groupName)}</td>

                      {/* Phone as a tel: link (or a dash). */}
                      <td data-label="טלפון">
                        {volunteer.phone
                          ? <a href={`tel:${String(volunteer.phone).replace(/[^\d+]/g, '')}`} dir="ltr">{volunteer.phone}</a>
                          : <span className="mgmt-muted">—</span>}
                      </td>

                      {/* Row actions: WhatsApp, edit/assign, delete. */}
                      <td data-label="פעולות" className="mgmt-actions-cell">
                        <div className="mgmt-row-actions">
                          <WhatsAppButton
                            phone={volunteer.phone}
                            message={greetingMessage(getVolunteerName(volunteer))}
                            label="וואטסאפ"
                            compact
                          />
                          <button onClick={() => handleOpenEdit(volunteer)}>ערוך / שייך</button>
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

      {/* Add / edit volunteer modal. */}
      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">{editingVolunteer ? 'עריכת מתנדב' : 'הוספת מתנדב חדש'}</div>
            <form onSubmit={handleSave} className="volunteer-form">

              {/* Name. */}
              <div className="form-group">
                <label>שם המתנדב:</label>
                <input
                  type="text"
                  className="styled-input full-width-input"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  required
                />
              </div>

              {/* Phone (for WhatsApp). */}
              <div className="form-group">
                <label>טלפון (לשליחה בוואטסאפ):</label>
                <input
                  type="tel"
                  className="styled-input full-width-input"
                  value={formData.phone}
                  onChange={(event) => setFormData({ ...formData, phone: event.target.value })}
                  placeholder="לדוגמה: 052-1234567"
                  dir="ltr"
                />
              </div>

              {/* Birth date. */}
              <div className="form-group">
                <label>תאריך לידה:</label>
                <BirthDatePicker
                  key={editingVolunteer ? editingVolunteer.id : 'new'}
                  value={formData.birthDate}
                  onChange={(birthDate) => setFormData({ ...formData, birthDate })}
                  required
                  showPreview
                />
              </div>

              {/* Group assignment (disabled when locked to a group). */}
              <div className="form-group">
                <label>שיוך לקבוצה:</label>
                <select
                  className="styled-input full-width-input"
                  value={formData.groupId}
                  onChange={(event) => setFormData({ ...formData, groupId: event.target.value })}
                  disabled={Boolean(passedGroup)}
                >
                  <option value="">-- ללא קבוצה --</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.groupName || group.name || 'קבוצה ללא שם'}</option>
                  ))}
                </select>
              </div>

              {/* Cancel / save. */}
              <div className="modal-actions">
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
