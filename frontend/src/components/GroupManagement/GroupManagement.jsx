// GroupManagement — admin screen for managing community groups. Create groups,
// assign / remove a guide, edit a group's name and time, and open its details.
// Data is kept in sync across the "groups" and "guides" collections.

// React hooks for state, effects, memoization and stable callbacks.
import { useCallback, useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading and writing documents.
import { addDoc, collection, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// The per-group details view.
import GroupDetails from './GroupDetails';

// Shared management-screen styles + this screen's own styles.
import '../shared/ManagementScreen.css';
import './GroupManagement.css';


// Turn a Firestore document snapshot into a plain object that keeps its id.
const toRecord = (documentSnapshot) => ({
  id: documentSnapshot.id,
  ...documentSnapshot.data(),
});


// Best available display name for a guide, with graceful fallbacks.
const getGuideName = (guide) => {
  // No guide.
  if (!guide) return '';

  return (
    guide.name ||
    [guide.firstName, guide.lastName].filter(Boolean).join(' ').trim() ||
    guide.email ||
    'מדריך ללא שם'
  );
};


const GroupManagement = () => {
  // The group currently opened in the details view (null = list view).
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  // The loaded data.
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [guides, setGuides] = useState([]);

  // "Add group" form fields + modal visibility.
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupTime, setNewGroupTime] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Search text for filtering the list.
  const [searchQuery, setSearchQuery] = useState('');

  // "Assign guide" modal state.
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [groupToAssign, setGroupToAssign] = useState(null);
  const [selectedGuideId, setSelectedGuideId] = useState('');

  // "Edit group" modal state.
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [groupToEdit, setGroupToEdit] = useState(null);
  const [editForm, setEditForm] = useState({ groupName: '', time: '', description: '' });

  // Load groups, volunteers and guides together.
  const fetchData = useCallback(async () => {
    try {
      // Read all three collections in parallel.
      const [groupsSnap, volunteersSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'groups')),
        getDocs(collection(db, 'volunteers')),
        getDocs(collection(db, 'users')),
      ]);

      setGroups(groupsSnap.docs.map(toRecord));
      setVolunteers(volunteersSnap.docs.map(toRecord));

      // Guide names live in the "users" collection (role === "guide"); the
      // "guides" collection only holds the group mapping, so it has no names.
      // Removed (disabled) guides are left out so they can't be assigned.
      setGuides(usersSnap.docs.map(toRecord).filter((user) => user.role === 'guide' && !user.disabled));
    } catch (error) {
      console.error('שגיאה בשליפת הנתונים:', error);
    }
  }, []);

  // Load everything once on mount.
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Open the "add group" modal with empty fields.
  const openAddModal = () => {
    setNewGroupName('');
    setNewGroupTime('');
    setIsAddModalOpen(true);
  };

  // Create a new group document.
  const handleCreateGroup = async (event) => {
    event.preventDefault();

    // Name is required.
    const groupName = newGroupName.trim();
    if (!groupName) return;

    try {
      // Add the group (no guide assigned yet).
      await addDoc(collection(db, 'groups'), {
        groupName,
        guideId: '',
        guideName: '',
        time: newGroupTime.trim(),
        description: newGroupDescription.trim(),
        createdAt: new Date(),
      });

      // Reset the form and refresh the list.
      setNewGroupName('');
      setNewGroupTime('');
      setNewGroupDescription('');
      setIsAddModalOpen(false);
      await fetchData();
    } catch (error) {
      console.error('שגיאה ביצירת קבוצה:', error);
      alert('אירעה שגיאה ביצירת הקבוצה');
    }
  };

  // Open the "assign guide" modal for a group.
  const openAssignModal = (group) => {
    setGroupToAssign(group);
    setSelectedGuideId(group.guideId || '');
    setIsAssignModalOpen(true);
  };

  // Assign the chosen guide to the group (updating both sides).
  const handleSaveGuideAssignment = async () => {
    // Need both a guide and a target group.
    if (!selectedGuideId || !groupToAssign) return;

    // Resolve the guide's name and the group's name.
    const selectedGuide = guides.find((guide) => guide.id === selectedGuideId);
    const guideName = getGuideName(selectedGuide);
    const groupName = groupToAssign.groupName || groupToAssign.name || '';

    try {
      // Free any other group this guide already leads (a guide leads one group
      // at a time), so the same guide never shows up in two groups at once.
      const previousGroups = await getDocs(query(collection(db, 'groups'), where('guideId', '==', selectedGuideId)));
      for (const previousGroup of previousGroups.docs) {
        if (previousGroup.id !== groupToAssign.id) {
          await updateDoc(doc(db, 'groups', previousGroup.id), { guideId: '', guideName: '' });
        }
      }

      // Record the guide on the group document.
      await updateDoc(doc(db, 'groups', groupToAssign.id), {
        guideId: selectedGuideId,
        guideName,
      });

      // Record the group on the guide's mapping document.
      await setDoc(
        doc(db, 'guides', selectedGuideId),
        {
          groupId: groupToAssign.id,
          groupName,
        },
        { merge: true },
      );

      // Close the modal and refresh.
      setIsAssignModalOpen(false);
      setGroupToAssign(null);
      setSelectedGuideId('');
      await fetchData();
    } catch (error) {
      console.error('שגיאה בשיוך מדריך:', error);
      alert('אירעה שגיאה בשיוך המדריך');
    }
  };

  // Remove the assigned guide from a group (clearing both sides).
  const handleRemoveGuide = async (group) => {
    // Confirm first.
    if (!window.confirm('האם להסיר את המדריך מהקבוצה?')) return;

    try {
      // Clear the guide on the group document.
      await updateDoc(doc(db, 'groups', group.id), {
        guideId: '',
        guideName: '',
      });

      // Clear the group on the guide's mapping document.
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

  // Open the "edit group" modal pre-filled with the group's values.
  const openEditModal = (group) => {
    setGroupToEdit(group);
    setEditForm({
      groupName: group.groupName || group.name || '',
      time: group.time || '',
      description: group.description || '',
    });
    setIsEditModalOpen(true);
  };

  // Save edits to a group's name and time.
  const handleUpdateGroup = async (event) => {
    event.preventDefault();

    // Need a target group.
    if (!groupToEdit) return;

    // Name is required.
    const groupName = editForm.groupName.trim();
    if (!groupName) return;

    const time = editForm.time.trim();
    const description = editForm.description.trim();

    try {
      // Update the group document.
      await updateDoc(doc(db, 'groups', groupToEdit.id), {
        groupName,
        time,
        description,
      });

      // Keep the assigned guide's denormalized group name in sync.
      if (groupToEdit.guideId) {
        await setDoc(
          doc(db, 'guides', groupToEdit.guideId),
          { groupName },
          { merge: true },
        );
      }

      // Close the modal and refresh.
      setIsEditModalOpen(false);
      setGroupToEdit(null);
      await fetchData();
    } catch (error) {
      console.error('שגיאה בעדכון הקבוצה:', error);
      alert('אירעה שגיאה בעדכון הקבוצה');
    }
  };

  // Open a group's details view.
  const handleViewDetails = (groupId) => {
    setSelectedGroupId(groupId);
  };

  // Resolve the guide name to show for a group.
  const getGuideDisplayName = (group) => {
    // Prefer the live guide record if one is assigned.
    if (group.guideId) {
      const guide = guides.find((item) => item.id === group.guideId);
      return guide ? getGuideName(guide) : 'מדריך לא ידוע';
    }

    // Otherwise fall back to the denormalized name (or none).
    return group.guideName || null;
  };

  // Count how many volunteers belong to a group.
  const getGroupVolunteersCount = (group) => (
    volunteers.filter((volunteer) => (
      volunteer.groupId === group.id ||
      volunteer.groupName === group.groupName ||
      volunteer.groupName === group.name
    )).length
  );

  // Groups filtered by the search box.
  const filteredGroups = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    if (!search) return groups;
    return groups.filter((group) =>
      (group.groupName || group.name || '').toLowerCase().includes(search),
    );
  }, [groups, searchQuery]);

  // When a group is opened, show its details view instead of the list.
  if (selectedGroupId) {
    return (
      <GroupDetails
        groupId={selectedGroupId}
        onBack={() => setSelectedGroupId(null)}
      />
    );
  }

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        {/* Header: just the group count (the sidebar labels the screen). */}
        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{filteredGroups.length}</span>
            <small>קבוצות</small>
          </div>
        </header>

        {/* Toolbar: add button, search, optional volunteers shortcut. */}
        <section className="mgmt-section">
          <div className="mgmt-toolbar">
            <button className="mgmt-primary-btn" onClick={openAddModal}>+ צור קבוצה חדשה</button>
            <input
              type="search"
              className="mgmt-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="🔍 חפש קבוצה לפי שם..."
            />
          </div>
        </section>

        {/* The groups table. */}
        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>רשימת קבוצות</h2>
          </div>

          <div className="mgmt-table-wrap">
            <table className="mgmt-table">

              {/* Column headers. */}
              <thead>
                <tr>
                  <th>שם הקבוצה</th>
                  <th>מדריך משויך</th>
                  <th className="mgmt-col-num">כמות מתנדבים</th>
                  <th>פעולות</th>
                </tr>
              </thead>

              <tbody>
                {/* Empty-state row, or a row per group. */}
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="mgmt-empty">
                      {groups.length === 0 ? 'לא נמצאו קבוצות.' : 'לא נמצאו קבוצות התואמות לחיפוש.'}
                    </td>
                  </tr>
                ) : (
                  filteredGroups.map((group) => {
                    // Resolve display values for this row.
                    const groupName = group.groupName || group.name || 'קבוצה ללא שם';
                    const guideDisplayName = getGuideDisplayName(group);

                    return (
                      <tr key={group.id}>
                        <td data-label="שם הקבוצה"><strong>{groupName}</strong></td>

                        {/* Assigned guide badge (or "not assigned"). */}
                        <td data-label="מדריך משויך">
                          {guideDisplayName
                            ? <span className="mgmt-badge">{guideDisplayName}</span>
                            : <span className="mgmt-badge muted">טרם שויך</span>}
                        </td>

                        <td data-label="כמות מתנדבים" className="mgmt-col-num">{getGroupVolunteersCount(group)}</td>

                        {/* Row actions: assign/remove guide, edit, details. */}
                        <td data-label="פעולות" className="mgmt-actions-cell">
                          <div className="mgmt-row-actions">
                            {group.guideId ? (
                              <button className="danger" onClick={() => handleRemoveGuide(group)}>הסר מדריך</button>
                            ) : (
                              <button onClick={() => openAssignModal(group)}>שייך מדריך</button>
                            )}

                            <button onClick={() => openEditModal(group)}>ערוך</button>

                            <button className="primary" onClick={() => handleViewDetails(group.id)}>פרטים</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {/* ----- Modal: create a new group ----- */}
      {isAddModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">יצירת קבוצה חדשה</div>

            <form onSubmit={handleCreateGroup} className="volunteer-form">

              {/* Group name. */}
              <div className="form-group">
                <label>שם הקבוצה:</label>
                <input
                  type="text"
                  className="styled-input full-width-input"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="שם הקבוצה"
                  required
                />
              </div>

              {/* Meeting time. */}
              <div className="form-group">
                <label>שעת מפגש:</label>
                <input
                  type="text"
                  className="styled-input full-width-input"
                  value={newGroupTime}
                  onChange={(event) => setNewGroupTime(event.target.value)}
                  placeholder="לדוגמה: יום ראשון 17:00"
                />
              </div>

              {/* Group description (shown on the public home; admin-editable). */}
              <div className="form-group">
                <label>תיאור הקבוצה:</label>
                <textarea
                  className="styled-input full-width-input"
                  value={newGroupDescription}
                  onChange={(event) => setNewGroupDescription(event.target.value)}
                  placeholder="תיאור קצר על הקבוצה (יוצג בעמוד הבית)"
                  rows="3"
                />
              </div>

              {/* Cancel / create. */}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setIsAddModalOpen(false)}>ביטול</button>
                <button type="submit" className="btn btn-success" disabled={!newGroupName.trim()}>צור קבוצה</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----- Modal: assign a guide ----- */}
      {isAssignModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">שיוך מדריך לקבוצה: {groupToAssign?.groupName || groupToAssign?.name}</div>

            {/* Guide picker. */}
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

            {/* Cancel / save. */}
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setIsAssignModalOpen(false)}>ביטול</button>
              <button className="btn btn-success" onClick={handleSaveGuideAssignment} disabled={!selectedGuideId}>שמור שיוך</button>
            </div>
          </div>
        </div>
      )}

      {/* ----- Modal: edit a group ----- */}
      {isEditModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">עריכת קבוצה</div>

            <form onSubmit={handleUpdateGroup} className="volunteer-form">

              {/* Group name. */}
              <div className="form-group">
                <label>שם הקבוצה:</label>
                <input
                  type="text"
                  className="styled-input full-width-input"
                  value={editForm.groupName}
                  onChange={(event) => setEditForm({ ...editForm, groupName: event.target.value })}
                  placeholder="שם הקבוצה"
                  required
                />
              </div>

              {/* Meeting time. */}
              <div className="form-group">
                <label>שעת מפגש:</label>
                <input
                  type="text"
                  className="styled-input full-width-input"
                  value={editForm.time}
                  onChange={(event) => setEditForm({ ...editForm, time: event.target.value })}
                  placeholder="לדוגמה: יום ראשון 17:00"
                />
              </div>

              {/* Group description (shown on the public home; admin-editable). */}
              <div className="form-group">
                <label>תיאור הקבוצה:</label>
                <textarea
                  className="styled-input full-width-input"
                  value={editForm.description}
                  onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
                  placeholder="תיאור קצר על הקבוצה (יוצג בעמוד הבית)"
                  rows="3"
                />
              </div>

              {/* Cancel / save. */}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setIsEditModalOpen(false)}>ביטול</button>
                <button type="submit" className="btn btn-success" disabled={!editForm.groupName.trim()}>שמור שינויים</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default GroupManagement;
