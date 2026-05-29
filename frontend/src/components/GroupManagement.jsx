import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase'; 
import './GroupManagement.css'; 
import GroupDetails from './GroupDetails';

const GroupManagement = () => {
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [newVolunteerName, setNewVolunteerName] = useState('');

  const fetchData = async () => {
    try {
      const groupsSnap = await getDocs(collection(db, 'groups'));
      const groupsData = groupsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGroups(groupsData);

      const volunteersSnap = await getDocs(collection(db, 'volunteers'));
      const volunteersData = volunteersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVolunteers(volunteersData);
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

  const handleAssignGuide = async (groupId) => {
    const newGuideId = prompt("הכנס את מזהה המדריך (UID) שברצונך לשייך לקבוצה:");
    if (!newGuideId) return;
    try {
      const groupRef = doc(db, 'groups', groupId);
      await updateDoc(groupRef, { guideId: newGuideId });
      fetchData(); 
    } catch (error) {
      console.error("שגיאה בשיוך מדריך:", error);
    }
  };

  // --- הפונקציה החדשה: מחיקת מדריך מהקבוצה (איפוס השדה) ---
  const handleRemoveGuide = async (groupId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק את המדריך מקבוצה זו?")) return;
    
    try {
      const groupRef = doc(db, 'groups', groupId);
      // מעדכנים את השדה guideId חזרה למחרוזת ריקה
      await updateDoc(groupRef, { guideId: '' });
      fetchData(); // מרעננים את הנתונים במסך
    } catch (error) {
      console.error("שגיאה במחיקת מדריך:", error);
    }
  };

  const openVolunteersModal = (group) => {
    setCurrentGroup(group);
    setIsModalOpen(true);
  };

  const handleAddVolunteer = async () => {
    if (newVolunteerName.trim() === '') return;
    try {
      await addDoc(collection(db, 'volunteers'), {
        name: newVolunteerName,
        groupId: currentGroup.id 
      });
      setNewVolunteerName(''); 
      fetchData(); 
    } catch (error) {
      console.error("שגיאה בהוספת מתנדב:", error);
    }
  };

  const handleRemoveVolunteer = async (volunteerId) => {
    try {
      await deleteDoc(doc(db, 'volunteers', volunteerId));
      fetchData();
    } catch (error) {
      console.error("שגיאה בהסרת מתנדב:", error);
    }
  };

  const handleViewDetails = (groupId) => {
    setSelectedGroupId(groupId);
  };

  const currentGroupVolunteers = currentGroup 
    ? volunteers.filter(v => v.groupId === currentGroup.id) 
    : [];

if (selectedGroupId) {
  return (
    <GroupDetails 
      groupId={selectedGroupId} 
      onBack={() => setSelectedGroupId(null)} // פונקציה שמאפסת את הבחירה וחוזרת לטבלה
    />
  );
}

  return (
    <div className="admin-container">
      <h2 className="admin-title">ניהול קבוצות (Admin)</h2>

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
      </div>

      <div className="table-container">
        <table className="styled-table">
          <thead>
            <tr>
              <th>שם הקבוצה</th>
              <th>מזהה מדריך (UID)</th>
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
                  <td>{group.guideId || <span style={{color: '#94a3b8'}}>טרם שויך</span>}</td>
                  <td>{groupVolunteersCount}</td>
                  <td className="actions-cell">
                    
                    {/* כפתור שיוך / מחיקת מדריך דינמי בהתאם למצב השדה */}
                    {group.guideId ? (
                      <button 
                        className="btn btn-outline" 
                        style={{ borderColor: '#ef4444', color: '#ef4444' }} 
                        onClick={() => handleRemoveGuide(group.id)}
                      >
                        מחק מדריך
                      </button>
                    ) : (
                      <button className="btn btn-outline" onClick={() => handleAssignGuide(group.id)}>
                        שייך מדריך
                      </button>
                    )}

                    <button className="btn btn-success" onClick={() => openVolunteersModal(group)}>
                      ניהול מתנדבים
                    </button>
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

      {isModalOpen && currentGroup && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              ניהול מתנדבים - {currentGroup.groupName}
            </div>
            
            <div className="action-bar" style={{ padding: 0, boxShadow: 'none' }}>
              <input 
                type="text" 
                className="styled-input"
                style={{ flex: 1 }}
                value={newVolunteerName}
                onChange={(e) => setNewVolunteerName(e.target.value)}
                placeholder="הכנס שם מתנדב..."
              />
              <button className="btn btn-primary" onClick={handleAddVolunteer}>
                הוסף מתנדב
              </button>
            </div>

            <div className="volunteers-list">
              {currentGroupVolunteers.length > 0 ? (
                currentGroupVolunteers.map((vol) => (
                  <div key={vol.id} className="volunteer-item">
                    <span>{vol.name}</span>
                    <button className="btn-danger-text" onClick={() => handleRemoveVolunteer(vol.id)}>
                      הסר ✖
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">אין מתנדבים בקבוצה זו.</div>
              )}
            </div>

            <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>
              סגור חלונית
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupManagement;