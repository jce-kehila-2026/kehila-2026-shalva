import { useCallback, useEffect, useState } from 'react';
import { addDoc, collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

import { db } from '../firebase';
import GroupDetails from './GroupDetails';
import './GroupManagement.css';

const getGuideName = (guide) => {
  if (!guide) return '';

  return (
    guide.name ||
    [guide.firstName, guide.lastName].filter(Boolean).join(' ').trim() ||
    guide.email ||
    guide.id ||
    'מדריך ללא שם'
  );
};

const GroupManagement = ({ onOpenVolunteers }) => {
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [guides, setGuides] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [groupToAssign, setGroupToAssign] = useState(null);
  const [selectedGuideId, setSelectedGuideId] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [groupsSnap, volunteersSnap, guidesSnap] = await Promise.all([
        getDocs(collection(db, 'groups')),
        getDocs(collection(db, 'volunteers')),
        getDocs(collection(db, 'guides')),
      ]);

      setGroups(groupsSnap.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() })));
      setVolunteers(volunteersSnap.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() })));
      setGuides(guidesSnap.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() })));
    } catch (error) {
      console.error('שגיאה בשליפת הנתונים:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateGroup = async () => {
    const groupName = newGroupName.trim();
    if (!groupName) return;

    try {
      await addDoc(collection(db, 'groups'), {
        groupName,
        guideId: '',
        guideName: '',
        time: '',
        createdAt: new Date(),
      });
      setNewGroupName('');
      await fetchData();
    } catch (error) {
      console.error('שגיאה ביצירת קבוצה:', error);
      alert('אירעה שגיאה ביצירת הקבוצה');
    }
  };

  const openAssignModal = (group) => {
    setGroupToAssign(group);
    setSelectedGuideId(group.guideId || '');
    setIsAssignModalOpen(true);
  };

  const handleSaveGuideAssignment = async () => {
    if (!selectedGuideId || !groupToAssign) return;

    const selectedGuide = guides.find((guide) => guide.id === selectedGuideId);
    const guideName = getGuideName(selectedGuide);
    const groupName = groupToAssign.groupName || groupToAssign.name || '';

    try {
      await updateDoc(doc(db, 'groups', groupToAssign.id), {
        guideId: selectedGuideId,
        guideName,
      });

      await setDoc(
        doc(db, 'guides', selectedGuideId),
        {
          groupId: groupToAssign.id,
          groupName,
        },
        { merge: true },
      );

      setIsAssignModalOpen(false);
      setGroupToAssign(null);
      setSelectedGuideId('');
      await fetchData();
    } catch (error) {
      console.error('שגיאה בשיוך מדריך:', error);
      alert('אירעה שגיאה בשיוך המדריך');
    }
  };

  const handleRemoveGuide = async (group) => {
    if (!window.confirm('האם להסיר את המדריך מהקבוצה?')) return;

    try {
      await updateDoc(doc(db, 'groups', group.id), {
        guideId: '',
        guideName: '',
      });

      if (group.guideId) {
        await setDoc(
          doc(db, 'guides', group.guideId),
          {
            groupId: '',
            groupName: 'Unassigned',
          },
          { merge: true },
        );
      }

      await fetchData();
    } catch (error) {
      console.error('שגיאה בהסרת מדריך:', error);
      alert('אירעה שגיאה בהסרת המדריך');
    }
  };

  const handleManageVolunteers = () => {
    if (typeof onOpenVolunteers === 'function') {
      onOpenVolunteers();
    }
  };

  const handleViewDetails = (groupId) => {
    setSelectedGroupId(groupId);
  };

  const getGuideDisplayName = (group) => {
    if (group.guideName) return group.guideName;
    if (!group.guideId) return null;

    const guide = guides.find((item) => item.id === group.guideId);
    return getGuideName(guide) || 'מדריך לא ידוע';
  };

  const getGroupVolunteersCount = (group) => (
    volunteers.filter((volunteer) => (
      volunteer.groupId === group.id ||
      volunteer.groupName === group.groupName ||
      volunteer.groupName === group.name
    )).length
  );

  if (selectedGroupId) {
    return (
      <GroupDetails
        groupId={selectedGroupId}
        onBack={() => setSelectedGroupId(null)}
      />
    );
  }

  return (
    <div className="admin-container">
      <h2 className="admin-title">ניהול קבוצות</h2>

      <div className="action-bar">
        <input
          type="text"
          className="styled-input"
          value={newGroupName}
          onChange={(event) => setNewGroupName(event.target.value)}
          placeholder="הכנס שם קבוצה חדשה..."
        />
        <button className="btn btn-primary" onClick={handleCreateGroup}>צור קבוצה</button>
        {typeof onOpenVolunteers === 'function' && (
          <button className="btn btn-success" onClick={handleManageVolunteers}>ניהול מתנדבים</button>
        )}
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
            {groups.length === 0 ? (
              <tr>
                <td colSpan="4" className="empty-table-cell">לא נמצאו קבוצות.</td>
              </tr>
            ) : (
              groups.map((group) => {
                const groupName = group.groupName || group.name || 'קבוצה ללא שם';
                const guideDisplayName = getGuideDisplayName(group);

                return (
                  <tr key={group.id}>
                    <td><strong>{groupName}</strong></td>
                    <td>{guideDisplayName || <span className="muted-text">טרם שויך</span>}</td>
                    <td>{getGroupVolunteersCount(group)}</td>
                    <td className="actions-cell">
                      {group.guideId ? (
                        <button
                          className="btn btn-outline danger-outline"
                          onClick={() => handleRemoveGuide(group)}
                        >
                          הסר מדריך
                        </button>
                      ) : (
                        <button className="btn btn-outline" onClick={() => openAssignModal(group)}>שייך מדריך</button>
                      )}

                      <button className="btn btn-primary" onClick={() => handleViewDetails(group.id)}>פרטי קבוצה</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isAssignModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">שיוך מדריך לקבוצה: {groupToAssign?.groupName || groupToAssign?.name}</div>

            <div className="form-group">
              <label>בחר מדריך מהרשימה:</label>
              <select
                className="styled-input full-width-input"
                value={selectedGuideId}
                onChange={(event) => setSelectedGuideId(event.target.value)}
              >
                <option value="">-- בחר מדריך --</option>
                {guides.map((guide) => (
                  <option key={guide.id} value={guide.id}>{getGuideName(guide)}</option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setIsAssignModalOpen(false)}>ביטול</button>
              <button className="btn btn-success" onClick={handleSaveGuideAssignment} disabled={!selectedGuideId}>שמור שיוך</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupManagement;
