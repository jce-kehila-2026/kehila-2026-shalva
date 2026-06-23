import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../firebase';
import CoverImageField from '../GroupManagement/CoverImageField';
import SearchFilters from '../shared/SearchFilters/SearchFilters';
import '../shared/ManagementScreen.css';
import '../GroupManagement/GroupManagement.css';
import './ProgramManagement.css';

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

const ProgramManagement = () => {
  const isMountedRef = useRef(true);

  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  // The program shown in the full-details view (null = none open).
  const [viewingProgram, setViewingProgram] = useState(null);

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
    if (!isMountedRef.current) {
      return false;
    }

    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'programs'));
      if (!isMountedRef.current) {
        return false;
      }
      setPrograms(snap.docs.map(toRecord));
      return true;
    } catch (error) {
      console.error('שגיאה בשליפת תוכניות:', error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
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
      if (!isMountedRef.current) {
        return;
      }
      setNewImageUrl(downloadUrl);
    } catch (error) {
      console.error('שגיאה בהעלאת התמונה:', error);
      alert('אירעה שגיאה בהעלאת התמונה.');
    } finally {
      if (isMountedRef.current) {
        setUploadingNewImage(false);
        event.target.value = '';
      }
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
      if (!isMountedRef.current) {
        return;
      }
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
      if (!isMountedRef.current) {
        return;
      }
      setEditForm((prev) => ({ ...prev, imageUrl: downloadUrl }));
    } catch (error) {
      console.error('שגיאה בהעלאת התמונה:', error);
      alert('אירעה שגיאה בהעלאת התמונה.');
    } finally {
      if (isMountedRef.current) {
        setUploadingImage(false);
        event.target.value = '';
      }
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
      if (!isMountedRef.current) {
        return;
      }
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
      if (!isMountedRef.current) {
        return;
      }
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
          {/* Search — the SAME shared bar (and size) used by the volunteers
              screen and the rest. No advanced filters here, just free text. */}
          <div className="mgmt-filters-row">
            <SearchFilters
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="🔍 חיפוש תוכנית לפי שם או תיאור..."
            />
          </div>

          <div className="mgmt-list-header">
            <h2>רשימת תוכניות</h2>
            {/* Sort by name (the table's sortable header moved here). */}
            <button type="button" className="mgmt-secondary-btn prog-sort-btn" onClick={toggleSort}>
              מיון לפי שם {sortDir === 'asc' ? '▲' : '▼'}
            </button>
          </div>

          {/* Programs are visual — each has a cover image — so they read better
              as a card gallery than as a cramped table row. Clicking a card opens
              the full details view. */}
          {loading ? (
            <div className="mgmt-loading">טוען תוכניות...</div>
          ) : filteredPrograms.length === 0 ? (
            <div className="mgmt-empty">לא נמצאו תוכניות</div>
          ) : (
            <div className="prog-grid">
              {filteredPrograms.map((program) => (
                <article className="prog-card" key={program.id}>

                  {/* Cover + text are one clickable, keyboard-accessible area that
                      opens the big details view. */}
                  <div
                    className="prog-card-open"
                    role="button"
                    tabIndex={0}
                    onClick={() => setViewingProgram(program)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setViewingProgram(program);
                      }
                    }}
                    aria-label={`הצגת התוכנית ${program.name}`}
                  >
                    {/* Cover image, or a placeholder when none was uploaded. */}
                    <div className="prog-card-cover">
                      {program.imageUrl ? (
                        <img src={program.imageUrl} alt={program.name} />
                      ) : (
                        <div className="prog-card-cover-empty" aria-hidden="true">🖼️</div>
                      )}
                    </div>

                    {/* Name + a short (clamped) description preview. */}
                    <div className="prog-card-body">
                      <h3 className="prog-card-name">{program.name}</h3>
                      {program.description ? (
                        <p className="prog-card-desc">{program.description}</p>
                      ) : (
                        <p className="prog-card-desc prog-card-desc--empty">אין תיאור</p>
                      )}
                    </div>
                  </div>

                  {/* Edit opens the same modal as before (delete lives inside it). */}
                  <div className="prog-card-foot">
                    <button type="button" className="mgmt-secondary-btn" onClick={() => openEditModal(program)}>
                      עריכה
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
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

      {/* Full-details view — opens when a program card is clicked. Shows the
          cover image large, the name, and the complete (un-clamped) description. */}
      {viewingProgram && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setViewingProgram(null)}>
          <div className="modal-content prog-view-modal" onClick={(e) => e.stopPropagation()}>

            <div className="prog-view-head">
              <h2 className="prog-view-title">{viewingProgram.name}</h2>
              <button
                type="button"
                className="prog-view-close"
                aria-label="סגירה"
                onClick={() => setViewingProgram(null)}
              >
                ✕
              </button>
            </div>

            {viewingProgram.imageUrl ? (
              <img className="prog-view-image" src={viewingProgram.imageUrl} alt={viewingProgram.name} />
            ) : (
              <div className="prog-view-image prog-view-image--empty" aria-hidden="true">🖼️</div>
            )}

            <div className="prog-view-desc">
              {viewingProgram.description ? viewingProgram.description : 'אין תיאור'}
            </div>

            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              {/* Jump straight from viewing into editing this program. */}
              <button
                type="button"
                className="mgmt-secondary-btn"
                onClick={() => {
                  const program = viewingProgram;
                  setViewingProgram(null);
                  openEditModal(program);
                }}
              >
                עריכה
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setViewingProgram(null)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default ProgramManagement;
