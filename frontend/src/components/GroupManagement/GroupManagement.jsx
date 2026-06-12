// GroupManagement — admin screen for managing community groups. Create groups,
// assign / remove a guide, edit a group's name and time, and open its details.
// Data is kept in sync across the "groups" and "guides" collections.

// React hooks for state, effects, memoization, stable callbacks and refs.
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

// Firestore helpers for reading and writing documents.
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';

// Storage helpers for uploading a group's cover image.
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

// Our Firestore database + Storage instances.
import { db, storage } from '../../firebase';

// The per-group details view.
import GroupDetails from './GroupDetails';

// The styled cover-image picker used in the create / edit modals.
import CoverImageField from './CoverImageField';

// The closed list of activity times (בוקר / צהריים / ערב).
import { GROUP_TIMES } from '../../utils/groupOptions';

// Downloads the empty groups template (dropdowns for time/guide/day).
import { downloadGroupsTemplate } from '../../utils/excelTemplates';

// Shared management-screen styles + this screen's own styles.
import '../shared/ManagementScreen.css';
import './GroupManagement.css';


// Turn a Firestore document snapshot into a plain object that keeps its id.
const toRecord = (documentSnapshot) => ({
  id: documentSnapshot.id,
  ...documentSnapshot.data(),
});


// Image types we allow uploading (kept in sync with storage.rules).
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Basic client-side check before uploading a cover image. Returns true when
// the file is an allowed image type and small enough; otherwise warns.
const isValidImage = (file) => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    alert('יש לבחור תמונה מסוג JPG, PNG או WEBP.');
    return false;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert('התמונה גדולה מדי (מקסימום 5MB).');
    return false;
  }

  return true;
};


// Upload a cover image to Storage under the group's own folder and return its
// public download URL. The timestamp in the name avoids stale-cache issues
// when an image is replaced.
const uploadCoverImage = async (file, groupId) => {
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const storageRef = ref(storage, `groups/${groupId}/cover-${Date.now()}.${extension}`);

  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
};


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


const GroupManagement = ({ registerBack }) => {
  // The group currently opened in the details view (null = list view).
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  // The loaded data.
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [guides, setGuides] = useState([]);

  // Excel import: in-flight flag + the hidden file input.
  const [isImporting, setIsImporting] = useState(false);
  const importFileRef = useRef(null);

  // Dashboard back button: close the details view first, then leave.
  useEffect(() => {
    if (!registerBack) return;
    registerBack(() => {
      if (selectedGroupId) {
        setSelectedGroupId(null);
        return true;
      }
      return false;
    });
  }, [registerBack, selectedGroupId]);

  // "Add group" form fields + modal visibility.
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupTime, setNewGroupTime] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // The new group's id is generated up front so its cover image can be uploaded
  // (to groups/{id}/...) before the document itself is created on submit.
  const [newGroupId, setNewGroupId] = useState('');
  const [newGroupImageUrl, setNewGroupImageUrl] = useState('');
  const [uploadingNewImage, setUploadingNewImage] = useState(false);

  // Search text for filtering the list.
  const [searchQuery, setSearchQuery] = useState('');

  // "Assign guide" modal state.
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [groupToAssign, setGroupToAssign] = useState(null);
  const [selectedGuideId, setSelectedGuideId] = useState('');

  // "Edit group" modal state.
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [groupToEdit, setGroupToEdit] = useState(null);
  const [editForm, setEditForm] = useState({ groupName: '', time: '', description: '', imageUrl: '' });

  // True while a cover image is uploading to Storage.
  const [uploadingImage, setUploadingImage] = useState(false);

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

  // Open the "add group" modal with empty fields. We pre-generate the new
  // group's id so its cover image can be uploaded before the group is created.
  const openAddModal = () => {
    setNewGroupName('');
    setNewGroupTime('');
    setNewGroupDescription('');
    setNewGroupImageUrl('');
    setNewGroupId(doc(collection(db, 'groups')).id);
    setIsAddModalOpen(true);
  };

  // Create a new group document (at the pre-generated id, so it matches any
  // image already uploaded to that id's folder).
  const handleCreateGroup = async (event) => {
    event.preventDefault();

    // Name is required.
    const groupName = newGroupName.trim();
    if (!groupName) return;

    try {
      // Create the group (no guide assigned yet), cover image included.
      await setDoc(doc(db, 'groups', newGroupId), {
        groupName,
        guideId: '',
        guideName: '',
        time: newGroupTime.trim(),
        description: newGroupDescription.trim(),
        imageUrl: newGroupImageUrl,
        createdAt: new Date(),
      });

      // Reset the form and refresh the list.
      setNewGroupName('');
      setNewGroupTime('');
      setNewGroupDescription('');
      setNewGroupImageUrl('');
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
      // All the related writes go in one atomic batch, so a group and a guide
      // mapping never disagree about who leads what.
      const batch = writeBatch(db);

      // Free any other group this guide already leads (a guide leads one group
      // at a time), so the same guide never shows up in two groups at once.
      const previousGroups = await getDocs(query(collection(db, 'groups'), where('guideId', '==', selectedGuideId)));
      previousGroups.docs.forEach((previousGroup) => {
        if (previousGroup.id !== groupToAssign.id) {
          batch.update(doc(db, 'groups', previousGroup.id), { guideId: '', guideName: '' });
        }
      });

      // If THIS group already had a (different) guide, clear that old guide's
      // mapping too — otherwise the old guide keeps seeing the group in their
      // dashboard (which reads guides/{uid}).
      if (groupToAssign.guideId && groupToAssign.guideId !== selectedGuideId) {
        batch.set(
          doc(db, 'guides', groupToAssign.guideId),
          { groupId: '', groupName: 'Unassigned' },
          { merge: true },
        );
      }

      // Record the guide on the group document.
      batch.update(doc(db, 'groups', groupToAssign.id), {
        guideId: selectedGuideId,
        guideName,
      });

      // Record the group on the guide's mapping document.
      batch.set(
        doc(db, 'guides', selectedGuideId),
        {
          groupId: groupToAssign.id,
          groupName,
        },
        { merge: true },
      );

      await batch.commit();

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
      // Clear both sides in one atomic batch.
      const batch = writeBatch(db);

      // Clear the guide on the group document.
      batch.update(doc(db, 'groups', group.id), {
        guideId: '',
        guideName: '',
      });

      // Clear the group on the guide's mapping document.
      if (group.guideId) {
        batch.set(
          doc(db, 'guides', group.guideId),
          {
            groupId: '',
            groupName: 'Unassigned',
          },
          { merge: true },
        );
      }

      await batch.commit();
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
      // Legacy free-text times (e.g. "8") are dropped — only the closed list
      // is valid, so saving the form also cleans the old value.
      time: GROUP_TIMES.includes(group.time) ? group.time : '',
      description: group.description || '',
      imageUrl: group.imageUrl || '',
    });
    setIsEditModalOpen(true);
  };

  // Upload a chosen image for the group being EDITED. The URL is kept on the
  // form and written to Firestore when the admin saves.
  const handleImageUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file || !groupToEdit || !isValidImage(file)) {
      event.target.value = '';
      return;
    }

    setUploadingImage(true);

    try {
      const downloadUrl = await uploadCoverImage(file, groupToEdit.id);
      setEditForm((previous) => ({ ...previous, imageUrl: downloadUrl }));
    } catch (error) {
      console.error('שגיאה בהעלאת התמונה:', error);
      alert('אירעה שגיאה בהעלאת התמונה. ודא/י שחוקי ה-Storage נפרסו.');
    } finally {
      setUploadingImage(false);

      // Reset the input so the same file can be re-selected if needed.
      event.target.value = '';
    }
  };

  // Clear the edited group's image (takes effect when the form is saved).
  const handleRemoveImage = () => {
    setEditForm((previous) => ({ ...previous, imageUrl: '' }));
  };

  // Upload a chosen image for the NEW group (to its pre-generated id folder).
  const handleNewImageUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file || !newGroupId || !isValidImage(file)) {
      event.target.value = '';
      return;
    }

    setUploadingNewImage(true);

    try {
      const downloadUrl = await uploadCoverImage(file, newGroupId);
      setNewGroupImageUrl(downloadUrl);
    } catch (error) {
      console.error('שגיאה בהעלאת התמונה:', error);
      alert('אירעה שגיאה בהעלאת התמונה. ודא/י שחוקי ה-Storage נפרסו.');
    } finally {
      setUploadingNewImage(false);
      event.target.value = '';
    }
  };

  // Clear the new group's chosen image.
  const handleRemoveNewImage = () => {
    setNewGroupImageUrl('');
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
    const imageUrl = editForm.imageUrl || '';

    try {
      // Update the group and the guide's denormalized name together (atomic).
      const batch = writeBatch(db);

      // Update the group document (the cover image included).
      batch.update(doc(db, 'groups', groupToEdit.id), {
        groupName,
        time,
        description,
        imageUrl,
      });

      // Keep the assigned guide's denormalized group name in sync.
      if (groupToEdit.guideId) {
        batch.set(
          doc(db, 'guides', groupToEdit.guideId),
          { groupName },
          { merge: true },
        );
      }

      await batch.commit();

      // Close the modal and refresh.
      setIsEditModalOpen(false);
      setGroupToEdit(null);
      await fetchData();
    } catch (error) {
      console.error('שגיאה בעדכון הקבוצה:', error);
      alert('אירעה שגיאה בעדכון הקבוצה');
    }
  };

  // Delete the group entirely: remove the group document, free its assigned
  // guide, and detach its volunteers (they stay in the system, just with no
  // group). Everything happens in one atomic batch.
  const handleDeleteGroup = async () => {
    if (!groupToEdit) return;

    const groupName = groupToEdit.groupName || groupToEdit.name || 'קבוצה ללא שם';

    // The volunteers that belong to this group (matched like the list count).
    const groupVolunteers = volunteers.filter((volunteer) => (
      volunteer.groupId === groupToEdit.id ||
      volunteer.groupName === groupToEdit.groupName ||
      volunteer.groupName === groupToEdit.name
    ));

    // Confirm, spelling out exactly what will happen.
    const message = groupVolunteers.length > 0
      ? `למחוק את הקבוצה "${groupName}"?\n${groupVolunteers.length} מתנדבים ינותקו מהקבוצה (יישארו במערכת ללא שיוך).\nהפעולה אינה הפיכה.`
      : `למחוק את הקבוצה "${groupName}"? הפעולה אינה הפיכה.`;
    if (!window.confirm(message)) return;

    try {
      const batch = writeBatch(db);

      // Remove the group document.
      batch.delete(doc(db, 'groups', groupToEdit.id));

      // Free the assigned guide, if any.
      if (groupToEdit.guideId) {
        batch.set(doc(db, 'guides', groupToEdit.guideId), { groupId: '', groupName: 'Unassigned' }, { merge: true });
      }

      // Detach the group's volunteers (keep them, clear their group fields).
      groupVolunteers.forEach((volunteer) => {
        batch.update(doc(db, 'volunteers', volunteer.id), { groupId: '', groupName: '', group: '' });
      });

      await batch.commit();

      // Close the modal and refresh.
      setIsEditModalOpen(false);
      setGroupToEdit(null);
      await fetchData();
    } catch (error) {
      console.error('שגיאה במחיקת הקבוצה:', error);
      alert('אירעה שגיאה במחיקת הקבוצה');
    }
  };

  // Open a group's details view.
  // Bulk-import groups from the Excel template. Each row creates a NEW group
  // (existing names are skipped); only valid activity times are kept, a
  // matched guide is linked on both sides, and volunteers listed by name are
  // assigned to the new group — all in one atomic batch.
  const handleGroupsFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsImporting(true);

    try {
      // Parse the workbook (the Excel reader loads on demand).
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      // Never create a duplicate of an existing group name.
      const existingNames = new Set(groups.map((g) => (g.groupName || g.name || '').trim()));

      const batch = writeBatch(db);
      let added = 0;
      let skipped = 0;

      rows.forEach((row) => {
        const groupName = String(row['שם קבוצה *'] || row['שם קבוצה'] || '').trim();
        if (!groupName) return;

        if (existingNames.has(groupName)) {
          skipped += 1;
          return;
        }
        existingNames.add(groupName);

        // Only the closed list of times is accepted (no "8"-style values).
        const rawTime = String(row['זמן פעילות'] || '').trim();

        // Match the responsible guide by display name.
        const guideNameRaw = String(row['מדריך אחראי'] || '').trim();
        const matchedGuide = guides.find((guide) => getGuideName(guide).trim() === guideNameRaw);

        const newGroupRef = doc(collection(db, 'groups'));

        batch.set(newGroupRef, {
          groupName,
          time: GROUP_TIMES.includes(rawTime) ? rawTime : '',
          location: String(row['מיקום / חדר'] || '').trim(),
          activityDay: String(row['יום פעילות'] || '').trim(),
          notes: String(row['הערות'] || '').trim(),
          guideId: matchedGuide?.id || '',
          guideName: matchedGuide ? getGuideName(matchedGuide) : '',
          createdAt: new Date(),
        });

        // Mirror the assignment on the guide's side (the attendance screen
        // finds the guide's group through guides/{uid}.groupId).
        if (matchedGuide) {
          batch.set(
            doc(db, 'guides', matchedGuide.id),
            { groupId: newGroupRef.id, groupName },
            { merge: true },
          );
        }

        // Assign listed volunteers (comma-separated names) to the new group.
        String(row['מתנדבים משויכים (שמות, מופרדים בפסיק)'] || row['מתנדבים משויכים'] || '')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
          .forEach((volunteerName) => {
            const match = volunteers.find((volunteer) => (
              (volunteer.name || `${volunteer.firstName || ''} ${volunteer.lastName || ''}`.trim()) === volunteerName
            ));

            if (match) {
              batch.update(doc(db, 'volunteers', match.id), { groupId: newGroupRef.id, groupName });
            }
          });

        added += 1;
      });

      if (added > 0) {
        await batch.commit();
        await fetchData();
      }

      alert(`יובאו ${added} קבוצות חדשות${skipped ? `, דולגו ${skipped} שכבר קיימות` : ''}.`);
    } catch (error) {
      console.error('שגיאה בייבוא קבוצות:', error);
      alert('אירעה שגיאה בייבוא הקובץ. ודאו שזהו קובץ התבנית.');
    } finally {
      setIsImporting(false);
      if (importFileRef.current) {
        importFileRef.current.value = null;
      }
    }
  };

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

            {/* Hidden file input + Excel import / empty-template buttons. */}
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              style={{ display: 'none' }}
              ref={importFileRef}
              onChange={handleGroupsFileUpload}
            />
            <button
              className="mgmt-secondary-btn"
              onClick={() => importFileRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? '⏳ מייבא...' : '📥 ייבוא מאקסל'}
            </button>
            <button
              className="mgmt-secondary-btn"
              onClick={() => downloadGroupsTemplate(guides, volunteers)}
            >
              ⬇️ הורדת תבנית אקסל
            </button>
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

              {/* Activity time — a closed list, not free text. */}
              <div className="form-group">
                <label>זמן פעילות:</label>
                <select
                  className="styled-input full-width-input"
                  value={newGroupTime}
                  onChange={(event) => setNewGroupTime(event.target.value)}
                >
                  <option value="">-- בחר זמן פעילות --</option>
                  {GROUP_TIMES.map((timeOption) => (
                    <option key={timeOption} value={timeOption}>{timeOption}</option>
                  ))}
                </select>
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

              {/* Cover image for the new group. */}
              <CoverImageField
                label="תמונת הקבוצה:"
                imageUrl={newGroupImageUrl}
                uploading={uploadingNewImage}
                onSelect={handleNewImageUpload}
                onRemove={handleRemoveNewImage}
              />

              {/* Cancel / create. */}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setIsAddModalOpen(false)}>ביטול</button>
                <button type="submit" className="btn btn-success" disabled={!newGroupName.trim() || uploadingNewImage}>צור קבוצה</button>
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

              {/* Activity time — strictly the closed list (a legacy free-text
                  value shows as unselected and must be replaced). */}
              <div className="form-group">
                <label>זמן פעילות:</label>
                <select
                  className="styled-input full-width-input"
                  value={GROUP_TIMES.includes(editForm.time) ? editForm.time : ''}
                  onChange={(event) => setEditForm({ ...editForm, time: event.target.value })}
                >
                  <option value="">-- בחר זמן פעילות --</option>
                  {GROUP_TIMES.map((timeOption) => (
                    <option key={timeOption} value={timeOption}>{timeOption}</option>
                  ))}
                </select>
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

              {/* Cover image — uploaded to Storage, shown on the public showcase. */}
              <CoverImageField
                label="תמונת הקבוצה:"
                imageUrl={editForm.imageUrl}
                uploading={uploadingImage}
                onSelect={handleImageUpload}
                onRemove={handleRemoveImage}
              />

              {/* Delete (pushed to the far side) · Cancel / save. */}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-danger group-delete-btn"
                  onClick={handleDeleteGroup}
                >
                  מחיקת קבוצה
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setIsEditModalOpen(false)}>ביטול</button>
                <button type="submit" className="btn btn-success" disabled={!editForm.groupName.trim() || uploadingImage}>שמור שינויים</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default GroupManagement;
