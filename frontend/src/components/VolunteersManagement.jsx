import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import './VolunteersManagement.css';

const VolunteersManagement = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // תופסים את הקבוצה שהועברה מהמסך הקודם (אם יש כזו)
  const passedGroup = location.state?.group || null;

  const [volunteers, setVolunteers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // State עבור החלונית (Modal) של הוספה/עריכה
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVolunteer, setEditingVolunteer] = useState(null);
  
  // נתוני הטופס
  const [formData, setFormData] = useState({
    name: '',
    groupId: passedGroup ? passedGroup.id : '' // ברירת מחדל: הקבוצה ממנה הגענו
  });

  // שליפת נתונים מ-Firebase
  const fetchData = async () => {
    try {
      const volSnap = await getDocs(collection(db, 'volunteers'));
      const volData = volSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVolunteers(volData);

      const groupsSnap = await getDocs(collection(db, 'groups'));
      const groupsData = groupsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGroups(groupsData);
    } catch (error) {
      console.error("שגיאה בשליפת נתונים:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // פונקציית עזר למציאת שם הקבוצה לפי ה-ID
  // (הזזתי אותה למעלה כדי שנוכל להשתמש בה במיון)
  const getGroupName = (groupId) => {
    if (!groupId) return 'ללא קבוצה';
    const group = groups.find(g => g.id === groupId);
    return group ? group.groupName : 'קבוצה לא ידועה';
  };

  // סינון מתנדבים לפי חיפוש + מיון לפי שם הקבוצה באלפבית
  const filteredAndSortedVolunteers = volunteers
    .filter(vol => vol.name?.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const groupNameA = getGroupName(a.groupId);
      const groupNameB = getGroupName(b.groupId);
      // שימוש ב-localeCompare כדי למיין נכון בעברית
      return groupNameA.localeCompare(groupNameB, 'he'); 
    });


  // פתיחת חלונית להוספת מתנדב חדש
  const handleOpenAdd = () => {
    setEditingVolunteer(null);
    setFormData({ name: '', groupId: passedGroup ? passedGroup.id : '' });
    setIsModalOpen(true);
  };

  // פתיחת חלונית לעריכת מתנדב קיים
  const handleOpenEdit = (volunteer) => {
    setEditingVolunteer(volunteer);
    setFormData({ name: volunteer.name, groupId: volunteer.groupId || '' });
    setIsModalOpen(true);
  };

  // שמירת מתנדב (הוספה או עדכון)
  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      if (editingVolunteer) {
        // עדכון מתנדב קיים
        const volRef = doc(db, 'volunteers', editingVolunteer.id);
        await updateDoc(volRef, formData);
      } else {
        // יצירת מתנדב חדש
        await addDoc(collection(db, 'volunteers'), formData);
      }
      setIsModalOpen(false);
      fetchData(); // רענון הטבלה
    } catch (error) {
      console.error("שגיאה בשמירת מתנדב:", error);
    }
  };

  // מחיקת מתנדב
  const handleDelete = async (volunteerId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק מתנדב זה?")) return;
    try {
      await deleteDoc(doc(db, 'volunteers', volunteerId));
      fetchData();
    } catch (error) {
      console.error("שגיאה במחיקת מתנדב:", error);
    }
  };

  return (
    <div className="admin-container">
      <header className="page-header">
        <div>
          <h2 className="admin-title" style={{ borderBottom: 'none', marginBottom: '5px' }}>ניהול מתנדבים</h2>
          {passedGroup && (
            <p className="subtitle">מסונן עבור קבוצה: <strong>{passedGroup.groupName}</strong></p>
          )}
        </div>
        <button className="btn btn-outline" onClick={() => navigate(-1)}>
          חזור לקבוצות
        </button>
      </header>

      {/* אזור הפעולות עודכן להיות בטור במקום בשורה */}
      <div className="action-bar" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '15px' }}>
        <button className="btn btn-primary" onClick={handleOpenAdd}>
          + הוסף מתנדב חדש
        </button>
        <input 
          type="text" 
          className="styled-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 חפש מתנדב לפי שם..."
          style={{ width: '300px' }}
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
              filteredAndSortedVolunteers.map((vol) => (
                <tr key={vol.id}>
                  <td><strong>{vol.name}</strong></td>
                  <td>{getGroupName(vol.groupId)}</td>
                  <td className="actions-cell">
                    <button className="btn btn-primary" onClick={() => navigate(`/volunteer-details/${vol.id}`, { state: { volunteer: vol } })}>
                      פרטים
                    </button>
                    <button className="btn btn-outline" onClick={() => handleOpenEdit(vol)}>
                      ערוך / שייך
                    </button>
                    <button 
                      className="btn btn-outline" 
                      style={{ borderColor: '#ef4444', color: '#ef4444' }}
                      onClick={() => handleDelete(vol.id)}
                    >
                      מחק
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3" style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                  לא נמצאו מתנדבים.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* חלונית הוספה / עריכה */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              {editingVolunteer ? 'עריכת מתנדב' : 'הוספת מתנדב חדש'}
            </div>
            <form onSubmit={handleSave} className="volunteer-form">
              <div className="form-group">
                <label>שם המתנדב:</label>
                <input 
                  type="text" 
                  className="styled-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>שיוך לקבוצה:</label>
                <select 
                  className="styled-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={formData.groupId}
                  onChange={(e) => setFormData({...formData, groupId: e.target.value})}
                >
                  <option value="">-- ללא קבוצה --</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.groupName}</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
                  ביטול
                </button>
                <button type="submit" className="btn btn-success">
                  {editingVolunteer ? 'שמור שינויים' : 'הוסף מתנדב'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default VolunteersManagement;