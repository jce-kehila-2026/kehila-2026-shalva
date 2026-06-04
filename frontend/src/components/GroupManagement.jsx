import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase'; 
import './GroupManagement.css'; 

const GroupManagement = () => {
  const navigate = useNavigate();
  
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [guides, setGuides] = useState([]); 
  
  const [newGroupName, setNewGroupName] = useState('');
  
  const [assigningGroupId, setAssigningGroupId] = useState(null);
  const [selectedGuideId, setSelectedGuideId] = useState('');

  const fetchData = async () => {
    try {
      const groupsSnap = await getDocs(collection(db, 'groups'));
      const groupsData = groupsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGroups(groupsData);

      const volunteersSnap = await getDocs(collection(db, 'volunteers'));
      const volunteersData = volunteersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVolunteers(volunteersData);

      const guidesQuery = query(collection(db, 'users'), where('role', '==', 'guide'));
      const guidesSnap = await getDocs(guidesQuery);
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
      await addDoc(collection(db, 'groups'), { 
        groupName: newGroupName, 
        guideId: '',
        guideName: '',         
        time: '',              
        createdAt: new Date()  
      });
      
      setNewGroupName(''); 
      fetchData(); 
    } catch (error) {
      console.error("שגיאה ביצירת קבוצה:", error);
    }
  };

  const handleOpenAssignInline = (groupId, currentGuideId) => {
    if (assigningGroupId === groupId) {
      setAssigningGroupId(null);
    } else {
      setAssigningGroupId(groupId);
      setSelectedGuideId(currentGuideId || ''); 
    }
  };

  const handleSaveGuideAssignment = async (groupId) => {
    if (!selectedGuideId) return;
    try {
      const targetGroup = groups.find(g => g.id === groupId);
      const oldGuideId = targetGroup?.guideId;

      if (oldGuideId && oldGuideId !== selectedGuideId) {
        const oldGuideRef = doc(db, 'guides', oldGuideId);
        await updateDoc(oldGuideRef, { groupName: 'Unassigned' });
      }

      const groupRef = doc(db, 'groups', groupId);
      await updateDoc(groupRef, { guideId: selectedGuideId });

      if (targetGroup) {
        const newGuideRef = doc(db, 'guides', selectedGuideId);
        await updateDoc(newGuideRef, { groupName: targetGroup.groupName });
      }

      setAssigningGroupId(null); 
      fetchData(); 
    } catch (error) {
      console.error("שגיאה בשיוך מדריך:", error);
    }
  };

  const handleRemoveGuide = async (groupId) => {
    if (!window.confirm("האם אתה בטוח שברצונך למחוק את המדריך מקבוצה זו?")) return;
    try {
      const targetGroup = groups.find(g => g.id === groupId);
      const oldGuideId = targetGroup?.guideId;

      const groupRef = doc(db, 'groups', groupId);
      await updateDoc(groupRef, { guideId: '' });

      if (oldGuideId) {
        const guideRef = doc(db, 'guides', oldGuideId);
        await updateDoc(guideRef, { groupName: 'Unassigned' });
      }

      setAssigningGroupId(null);
      fetchData(); 
    } catch (error) {
      console.error("שגיאה במחיקת מדריך:", error);
    }
  };

  const handleViewDetails = (groupId) => {
    navigate(`/group-details/${groupId}`);
  };

  const getGuideDisplayName = (guideId) => {
    if (!guideId) return null;
    const guide = guides.find(g => g.id === guideId);
    if (!guide) return 'מדריך לא ידוע';
    
    if (guide.firstName && guide.lastName) {
      return `${guide.firstName} ${guide.lastName}`;
    }
    
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
              const isAssigning = assigningGroupId === group.id;

              return (
                <React.Fragment key={group.id}>
                  <tr>
                    <td><strong>{group.groupName}</strong></td>
                    <td>{getGuideDisplayName(group.guideId) || <span style={{color: '#94a3b8'}}>טרם שויך</span>}</td>
                    <td>{groupVolunteersCount}</td>
                    <td className="actions-cell">
                      
                      <button className="btn btn-primary" onClick={() => handleViewDetails(group.id)}>
                        פרטי קבוצה
                      </button>

                      {/* כפתור הפעולה הדינמי - הטקסט והצבע משתנים לפי המצב */}
                      <button 
                        className="btn btn-outline" 
                        style={
                          isAssigning 
                            ? { borderColor: '#ef4444', color: '#ef4444' } // אדום במצב סגירה
                            : group.guideId 
                              ? {} // אפור ברירת מחדל במצב "עריכה"
                              : { borderColor: '#10b981', color: '#10b981' } // ירוק כשהקבוצה ריקה ממדריך
                        }
                        onClick={() => handleOpenAssignInline(group.id, group.guideId)}
                      >
                        {isAssigning ? 'סגור שיוך' : group.guideId ? 'עריכה' : 'שייך מדריך'}
                      </button>
                    </td>
                  </tr>

                  {isAssigning && (
                    <tr className="assign-inline-row">
                      <td colSpan="4">
                        <div className="assign-inline-container">
                          <span>
                            {group.guideId ? `עריכת מדריך עבור ` : `בחר מדריך עבור `} 
                            <strong>{group.groupName}</strong>:
                          </span>
                          <select 
                            className="styled-input" 
                            style={{ width: '250px' }}
                            value={selectedGuideId}
                            onChange={(e) => setSelectedGuideId(e.target.value)}
                          >
                            <option value="">-- בחר מדריך מרשימה --</option>
                            {guides.map(guide => {
                              const displayName = guide.firstName && guide.lastName 
                                ? `${guide.firstName} ${guide.lastName}` 
                                : (guide.name || guide.firstName || guide.email || guide.id);
                                
                              return (
                                <option key={guide.id} value={guide.id}>
                                  {displayName}
                                </option>
                              );
                            })}
                          </select>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                              className="btn btn-success" 
                              onClick={() => handleSaveGuideAssignment(group.id)}
                              disabled={!selectedGuideId || selectedGuideId === group.guideId}
                            >
                              שמור שיוך
                            </button>
                            {group.guideId && (
                              <button 
                                className="btn btn-outline" 
                                style={{ borderColor: '#ef4444', color: '#ef4444' }} 
                                onClick={() => handleRemoveGuide(group.id)}
                              >
                                הסר מדריך מהקבוצה
                              </button>
                            )}
                            <button 
                              className="btn btn-outline" 
                              onClick={() => setAssigningGroupId(null)}
                            >
                              ביטול
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default GroupManagement;