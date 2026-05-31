import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase'; 
import './GroupManagement.css'; 
import GroupDetails from './GroupDetails';

const GroupManagement = () => {
  const navigate = useNavigate();
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [guides, setGuides] = useState([]); // הוספנו סטייט למדריכים
  
  const [newGroupName, setNewGroupName] = useState('');
  
  // סטייטים לחלונית שיוך המדריך
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [groupToAssign, setGroupToAssign] = useState(null);
  const [selectedGuideId, setSelectedGuideId] = useState('');

  const fetchData = async () => {
    try {
      const groupsSnap = await getDocs(collection(db, 'groups'));
      const groupsData = groupsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGroups(groupsData);

      const volunteersSnap = await getDocs(collection(db, 'volunteers'));
      const volunteersData = volunteersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVolunteers(volunteersData);

      // שליפת רשימת המדריכים מהמסד
      const guidesSnap = await getDocs(collection(db, 'guides'));
      const guidesData = guidesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGuides(guidesData);
    } catch (error) {
      console.error("שגיאה בשליפת הנתונים:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateGroup = async () => {
    if (newGroupName.trim() === '') return; 
    try {
      await addDoc(collection(db, 'groups'), { groupName: newGroupName, guideId: '' });
      setNewGroupName(''); 
      fetchData(); 
    } catch (error) {
      console.error("שגיאה ביצירת קבוצה:", error);
    }
  };

  // פתיחת חלונית השיוך במקום Prompt
  const openAssignModal = (group) => {
    setGroupToAssign(group);
    setSelectedGuideId(''); // איפוס הבחירה הקודמת
    setIsAssignModalOpen(true);
  };

  // שמירת השיוך שבחרנו ברשימה
  const handleSaveGuideAssignment = async () => {
    if (!selectedGuideId) return;
    try {
      const groupRef = doc(db, 'groups', groupToAssign.id);
      await updateDoc(groupRef, { guideId: selectedGuideId });
      setIsAssignModalOpen(false);
      fetchData(); 
    } catch (error) {
      console.error("שגיאה בשיוך מדריך:", error);
    }
  };

  const handleRemoveGuide = async (groupId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק את המדריך מקבוצה זו?")) return;
    try {
      const groupRef = doc(db, 'groups', groupId);
      await updateDoc(groupRef, { guideId: '' });
      fetchData(); 
    } catch (error) {
      console.error("שגיאה במחיקת מדריך:", error);
    }
  };

  const handleManageVolunteers = () => {
    navigate('/admin/volunteers');
  };

  const handleViewDetails = (groupId) => {
    navigate(`/group-details/${groupId}`);
  };

  // פונקציית עזר להצגת שם המדריך בטבלה
  const getGuideDisplayName = (guideId) => {
    if (!guideId) return null;
    const guide = guides.find(g => g.id === guideId);
    if (!guide) return 'מדריך לא ידוע';
    // ננסה להציג שם, או אימייל אם אין שם
    return guide.name || guide.firstName || guide.email || 'מדריך ללא שם';
  };

  return (
    <div className="admin-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="admin-title">ניהול קבוצות (Admin)</h2>
        <button className="btn btn-outline" onClick={() => navigate('/admin')}>
          חזור ללוח בקרה ↩
        </button>
      </div>

      <div className="action-bar">
        <input 
          type="text" 
          className="styled-input"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="הכנס שם קבוצה חדשה..."
        />
        <button className="btn btn-primary" onClick={handleCreateGroup}>
          צור קבוצה
        </button>
        <button className="btn btn-success" onClick={handleManageVolunteers}>
          ניהול מתנדבים
        </button>
      </div>

      <div className="table-container">
        <table className="styled-table">
          <thead>
            <tr>
              <th>שם הקבוצה</th>
              <th>מדריך משויך</th>
              <th>כמות מתנדבים</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const groupVolunteersCount = volunteers.filter(v => v.groupId === group.id).length;

              return (
                <tr key={group.id}>
                  <td><strong>{group.groupName}</strong></td>
                  <td>{getGuideDisplayName(group.guideId) || <span style={{color: '#94a3b8'}}>טרם שויך</span>}</td>
                  <td>{groupVolunteersCount}</td>
                  <td className="actions-cell">
                    
                    {group.guideId ? (
                      <button 
                        className="btn btn-outline" 
                        style={{ borderColor: '#ef4444', color: '#ef4444' }} 
                        onClick={() => handleRemoveGuide(group.id)}
                      >
                        מחק מדריך
                      </button>
                    ) : (
                      <button className="btn btn-outline" onClick={() => openAssignModal(group)}>
                        שייך מדריך
                      </button>
                    )}

                    <button className="btn btn-primary" onClick={() => handleViewDetails(group.id)}>
                      פרטי קבוצה
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* חלונית Modal לשיוך מדריך */}
      {isAssignModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              שיוך מדריך לקבוצת: {groupToAssign?.groupName}
            </div>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>בחר מדריך מהרשימה:</label>
              <select 
                className="styled-input" 
                style={{ width: '100%' }}
                value={selectedGuideId}
                onChange={(e) => setSelectedGuideId(e.target.value)}
              >
                <option value="">-- בחר מדריך --</option>
                {guides.map(guide => (
                  <option key={guide.id} value={guide.id}>
                    {guide.name || guide.firstName || guide.email || guide.id}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-outline" onClick={() => setIsAssignModalOpen(false)}>
                ביטול
              </button>
              <button 
                className="btn btn-success" 
                onClick={handleSaveGuideAssignment}
                disabled={!selectedGuideId}
              >
                שמור שיוך
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default GroupManagement;