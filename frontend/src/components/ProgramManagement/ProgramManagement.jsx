import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../firebase';
import CoverImageField from '../GroupManagement/CoverImageField';
import '../shared/ManagementScreen.css';
import '../GroupManagement/GroupManagement.css';

const toRecord = (documentSnapshot) => ({
  id: documentSnapshot.id,
  ...documentSnapshot.data(),
});

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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

const uploadProgramImage = async (file, programId) => {
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const storageRef = ref(storage, `programs/${programId}/cover-${Date.now()}.${extension}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
};

const ProgramManagement = ({ registerBack }) => {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  // Add modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newProgramId, setNewProgramId] = useState('');
  const [uploadingNewImage, setUploadingNewImage] = useState(false);

  // Edit modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [programToEdit, setProgramToEdit] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', imageUrl: '' });
  const [uploadingImage, setUploadingImage] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'programs'));
      setPrograms(snap.docs.map(toRecord));
    } catch (error) {
      console.error('שגיאה בשליפת תוכניות:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle opening add modal
  const openAddModal = () => {
    setNewName('');
    setNewDescription('');
    setNewImageUrl('');
    setNewProgramId(doc(collection(db, 'programs')).id);
    setIsAddModalOpen(true);
  };

  // Handle image upload for new program
  const handleNewImageUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file || !newProgramId || !isValidImage(file)) {
      event.target.value = '';
      return;
    }
    setUploadingNewImage(true);
    try {
      const downloadUrl = await uploadProgramImage(file, newProgramId);
      setNewImageUrl(downloadUrl);
    } catch (error) {
      console.error('שגיאה בהעלאת התמונה:', error);
      alert('אירעה שגיאה בהעלאת התמונה.');
    } finally {
      setUploadingNewImage(false);
      event.target.value = '';
    }
  };

  // Handle creating new program
  const handleCreateProgram = async (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    try {
      await setDoc(doc(db, 'programs', newProgramId), {
        name,
        description: newDescription.trim(),
        imageUrl: newImageUrl,
        createdAt: new Date(),
      });
      setIsAddModalOpen(false);
      await fetchData();
    } catch (error) {
      console.error('שגיאה ביצירת תוכנית:', error);
      alert('אירעה שגיאה ביצירת התוכנית');
    }
  };

  // Handle opening edit modal
  const openEditModal = (program) => {
    setProgramToEdit(program);
    setEditForm({
      name: program.name || '',
      description: program.description || '',
      imageUrl: program.imageUrl || '',
    });
    setIsEditModalOpen(true);
  };

  // Handle image upload for edited program
  const handleImageUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file || !programToEdit || !isValidImage(file)) {
      event.target.value = '';
      return;
    }
    setUploadingImage(true);
    try {
      const downloadUrl = await uploadProgramImage(file, programToEdit.id);
      setEditForm((prev) => ({ ...prev, imageUrl: downloadUrl }));
    } catch (error) {
      console.error('שגיאה בהעלאת התמונה:', error);
      alert('אירעה שגיאה בהעלאת התמונה.');
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  };

  // Handle updating program
  const handleUpdateProgram = async (event) => {
    event.preventDefault();
    if (!programToEdit) return;
    const name = editForm.name.trim();
    if (!name) return;

    try {
      await setDoc(doc(db, 'programs', programToEdit.id), {
        name,
        description: editForm.description.trim(),
        imageUrl: editForm.imageUrl,
        createdAt: programToEdit.createdAt || new Date(),
      }, { merge: true });
      setIsEditModalOpen(false);
      setProgramToEdit(null);
      await fetchData();
    } catch (error) {
      console.error('שגיאה בעדכון תוכנית:', error);
      alert('אירעה שגיאה בעדכון התוכנית');
    }
  };

  // Handle deleting program
  const handleDeleteProgram = async () => {
    if (!programToEdit) return;
    if (!window.confirm(`האם למחוק את התוכנית "${programToEdit.name}"?`)) return;

    try {
      await deleteDoc(doc(db, 'programs', programToEdit.id));
      setIsEditModalOpen(false);
      setProgramToEdit(null);
      await fetchData();
    } catch (error) {
      console.error('שגיאה במחיקת תוכנית:', error);
      alert('אירעה שגיאה במחיקת התוכנית');
    }
  };

  const toggleSort = () => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));

  const filteredPrograms = useMemo(() => {
    const queryStr = searchQuery.trim().toLowerCase();
    const result = programs.filter((p) => {
      if (!queryStr) return true;
      const text = `${p.name} ${p.description}`.toLowerCase();
      return text.includes(queryStr);
    });
    return result.sort((a, b) => {
      const nameA = (a.name || '').trim();
      const nameB = (b.name || '').trim();
      const comparison = nameA.localeCompare(nameB, 'he');
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [programs, searchQuery, sortDir]);

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">
        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{filteredPrograms.length}</span>
            <small>תוכניות</small>
          </div>
          <div className="mgmt-toolbar">
            <button className="mgmt-primary-btn" onClick={openAddModal}>
              + צור תוכנית חדשה
            </button>
          </div>
        </header>

        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>רשימת תוכניות</h2>
            <input
              type="text"
              className="mgmt-search"
              placeholder="🔍 חיפוש תוכנית לפי שם או תיאור..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="mgmt-table-wrap">
            <table className="mgmt-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>תמונה</th>
                  <th>
                    <button type="button" className="mgmt-sort is-active" onClick={toggleSort}>
                      שם התוכנית
                      <span className="mgmt-sort-arrow" aria-hidden="true">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    </button>
                  </th>
                  <th>תיאור</th>
                  <th style={{ width: '150px' }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="4" className="mgmt-loading">
                      טוען תוכניות...
                    </td>
                  </tr>
                ) : filteredPrograms.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="mgmt-empty">
                      לא נמצאו תוכניות
                    </td>
                  </tr>
                ) : (
                  filteredPrograms.map((program) => (
                    <tr key={program.id}>
                      <td>
                        {program.imageUrl ? (
                          <img
                            src={program.imageUrl}
                            alt={program.name}
                            style={{
                              width: '50px',
                              height: '50px',
                              objectFit: 'cover',
                              borderRadius: '8px',
                              border: '1px solid var(--border)',
                              display: 'block',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '50px',
                              height: '50px',
                              borderRadius: '8px',
                              backgroundColor: 'var(--surface-2)',
                              border: '1px dashed var(--border-strong)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '20px',
                            }}
                          >
                            🖼️
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 'bold' }}>{program.name}</td>
                      <td className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                        {program.description}
                      </td>
                      <td className="mgmt-actions-cell">
                        <div className="mgmt-row-actions">
                          <button type="button" onClick={() => openEditModal(program)}>
                            עריכה
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {/* Add Program Modal */}
      {isAddModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">צור תוכנית חדשה</div>
            <form onSubmit={handleCreateProgram} className="mgmt-form">
              <div className="mgmt-field">
                <label>שם התוכנית *</label>
                <input
                  type="text"
                  className="mgmt-input"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="הקלד/י את שם התוכנית"
                />
              </div>

              <div className="mgmt-field">
                <label>תיאור</label>
                <textarea
                  className="mgmt-input"
                  rows="3"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="הקלד/י תיאור קצר"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <CoverImageField
                label="תמונת התוכנית"
                imageUrl={newImageUrl}
                uploading={uploadingNewImage}
                onSelect={handleNewImageUpload}
                onRemove={() => setNewImageUrl('')}
              />

              <div className="mgmt-form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setIsAddModalOpen(false)}>
                  ביטול
                </button>
                <button type="submit" className="mgmt-primary-btn" disabled={uploadingNewImage}>
                  שמור תוכנית
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Program Modal */}
      {isEditModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">עריכת תוכנית</div>
            <form onSubmit={handleUpdateProgram} className="mgmt-form">
              <div className="mgmt-field">
                <label>שם התוכנית *</label>
                <input
                  type="text"
                  className="mgmt-input"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="mgmt-field">
                <label>תיאור</label>
                <textarea
                  className="mgmt-input"
                  rows="3"
                  value={editForm.description}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <CoverImageField
                label="תמונת התוכנית"
                imageUrl={editForm.imageUrl}
                uploading={uploadingImage}
                onSelect={handleImageUpload}
                onRemove={() => setEditForm((prev) => ({ ...prev, imageUrl: '' }))}
              />

              <div className="mgmt-form-actions">
                <button
                  type="button"
                  className="mgmt-danger-btn group-delete-btn"
                  onClick={handleDeleteProgram}
                >
                  מחק תוכנית
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setIsEditModalOpen(false)}>
                  ביטול
                </button>
                <button type="submit" className="mgmt-primary-btn" disabled={uploadingImage}>
                  עדכן תוכנית
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default ProgramManagement;
