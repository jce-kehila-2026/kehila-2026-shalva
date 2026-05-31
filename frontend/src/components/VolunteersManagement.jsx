import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';

import { db } from '../firebase';
import './VolunteersManagement.css';

const getVolunteerName = (volunteer) => (
  volunteer?.name ||
  [volunteer?.firstName, volunteer?.lastName].filter(Boolean).join(' ').trim() ||
  volunteer?.email ||
  'מתנדב ללא שם'
);

const VolunteersManagement = ({ initialGroup = null, onBack }) => {
  const passedGroup = initialGroup?.id || initialGroup?.groupName ? initialGroup : null;

  const [volunteers, setVolunteers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVolunteer, setEditingVolunteer] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    groupId: passedGroup?.id || '',
  });

  const fetchData = useCallback(async () => {
    try {
      const [volunteersSnap, groupsSnap] = await Promise.all([
        getDocs(collection(db, 'volunteers')),
        getDocs(collection(db, 'groups')),
      ]);

      setVolunteers(volunteersSnap.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() })));
      setGroups(groupsSnap.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() })));
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
        ].filter(Boolean).join(' ').toLowerCase();

        return matchesGroup && (!search || searchableText.includes(search));
      })
      .sort((a, b) => getGroupName(a.groupId, a.groupName).localeCompare(getGroupName(b.groupId, b.groupName), 'he'));
  }, [getGroupName, passedGroup, searchQuery, volunteers]);

  const handleOpenAdd = () => {
    setEditingVolunteer(null);
    setFormData({ name: '', groupId: passedGroup?.id || '' });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (volunteer) => {
    setEditingVolunteer(volunteer);
    setFormData({
      name: getVolunteerName(volunteer),
      groupId: volunteer.groupId || passedGroup?.id || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();

    const name = formData.name.trim();
    if (!name) return;

    const selectedGroup = groups.find((group) => group.id === formData.groupId);
    const payload = {
      name,
      groupId: formData.groupId,
      groupName: selectedGroup?.groupName || selectedGroup?.name || passedGroup?.groupName || '',
    };

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
    }
  };

  const handleDelete = async (volunteerId) => {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק מתנדב זה?')) return;

    try {
      await deleteDoc(doc(db, 'volunteers', volunteerId));
      await fetchData();
    } catch (error) {
      console.error('שגיאה במחיקת מתנדב:', error);
      alert('אירעה שגיאה במחיקת המתנדב');
    }
  };

  return (
    <div className="admin-container">
      <header className="page-header">
        <div>
          <h2 className="admin-title no-border-title">ניהול מתנדבים</h2>
          {passedGroup && (
            <p className="subtitle">מסונן עבור קבוצה: <strong>{passedGroup.groupName || getGroupName(passedGroup.id)}</strong></p>
          )}
        </div>
        {typeof onBack === 'function' && (
          <button className="btn btn-outline" onClick={onBack}>חזרה</button>
        )}
      </header>

      <div className="action-bar vertical-action-bar">
        <button className="btn btn-primary" onClick={handleOpenAdd}>+ הוסף מתנדב חדש</button>
        <input
          type="text"
          className="styled-input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="🔍 חפש מתנדב לפי שם..."
        />
      </div>

      <div className="table-container">
        <table className="styled-table">
          <thead>
            <tr>
              <th>שם המתנדב</th>
              <th>שיוך לקבוצה</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedVolunteers.length > 0 ? (
              filteredAndSortedVolunteers.map((volunteer) => (
                <tr key={volunteer.id}>
                  <td><strong>{getVolunteerName(volunteer)}</strong></td>
                  <td>{getGroupName(volunteer.groupId, volunteer.groupName)}</td>
                  <td className="actions-cell">
                    <button className="btn btn-outline" onClick={() => handleOpenEdit(volunteer)}>ערוך / שייך</button>
                    <button className="btn btn-outline danger-outline" onClick={() => handleDelete(volunteer.id)}>מחק</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3" className="empty-table-cell">לא נמצאו מתנדבים.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">{editingVolunteer ? 'עריכת מתנדב' : 'הוספת מתנדב חדש'}</div>
            <form onSubmit={handleSave} className="volunteer-form">
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

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>ביטול</button>
                <button type="submit" className="btn btn-success">{editingVolunteer ? 'שמור שינויים' : 'הוסף מתנדב'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default VolunteersManagement;
