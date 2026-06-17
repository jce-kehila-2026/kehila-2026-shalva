import { useState } from 'react';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../firebase';
import '../SignatureForm/SignatureForm.css';

function DocumentUploadForm({ registrantId = '', prefillName = '', docType = '' }) {
  const [fullName, setFullName] = useState(prefillName);
  const [idNumber, setIdNumber] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorText, setErrorText] = useState('');

  const docTitle = docType === 'police' ? 'טופס משטרתי' : 'טופס רפואי';
  const collectionName = docType === 'police' ? 'policeForms' : 'medicalForms';

  const handleFileChange = (e) => {
    const selectedFile = e.target.files && e.target.files[0];
    if (!selectedFile) return;

    // Limit file size to 8MB
    if (selectedFile.size > 8 * 1024 * 1024) {
      alert('הקובץ גדול מדי (עד 8MB).');
      e.target.value = '';
      return;
    }
    setFile(selectedFile);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!fullName.trim()) {
      setErrorText('יש למלא שם מלא.');
      return;
    }

    const cleanId = idNumber.replace(/\D/g, '');
    if (cleanId.length !== 9) {
      setErrorText('יש להזין מספר תעודת זהות תקין בן 9 ספרות.');
      return;
    }

    if (!file) {
      setErrorText('יש לבחור קובץ להעלאה.');
      return;
    }

    setErrorText('');
    setSubmitting(true);

    try {
      const fileExtension = file.name.split('.').pop();
      const storagePath = `${collectionName}/${registrantId}/shalva-${docType}-form-${registrantId}.${fileExtension}`;

      // Upload the file to Firebase Storage
      await uploadBytes(storageRef(storage, storagePath), file, {
        contentType: file.type || 'application/octet-stream',
      });

      // Write document reference to Firestore
      const formDocRef = doc(db, collectionName, registrantId);
      await setDoc(formDocRef, {
        registrantId,
        fullName: fullName.trim(),
        idNumber: cleanId,
        fileStoragePath: storagePath,
        fileName: file.name,
        createdAt: serverTimestamp(),
      });

      setSubmitted(true);
    } catch (err) {
      console.error('שגיאה בהעלאת המסמך:', err);
      setErrorText('לא הצלחנו להעלות את הקובץ. בדקו חיבור ונסו שוב.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="sig-form" dir="rtl">
        <div className="sig-done">
          <span className="sig-done-mark" aria-hidden="true">✓</span>
          <h2>תודה!</h2>
          <p>ה{docTitle} הועלה בהצלחה ונשלח לניהול הנרשמים.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="sig-form" dir="rtl" onSubmit={handleSubmit}>
      <header className="sig-head">
        <h1 className="sig-title">העלאת {docTitle} — עמותת שלווה</h1>
        <p className="sig-subtitle">אנא מלאו את הפרטים והעלו את הקובץ המבוקש.</p>
      </header>

      <section className="sig-section">
        <h2 className="sig-section-title">פרטי המתנדב/ת</h2>
        <div className="sig-grid">
          <label className="sig-field sig-field--wide">
            <span>שם מלא</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>
          <label className="sig-field sig-field--wide">
            <span>מספר תעודת זהות</span>
            <input
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              maxLength="9"
              inputMode="numeric"
              dir="ltr"
              required
            />
          </label>
        </div>
      </section>

      <section className="sig-section">
        <h2 className="sig-section-title">העלאת קובץ (PDF או תמונה)</h2>
        <div className="sig-field sig-field--wide">
          <input
            type="file"
            accept=".pdf,image/*"
            onChange={handleFileChange}
            required
            style={{ border: 'none', padding: '10px 0' }}
          />
        </div>

        {errorText && <p className="sig-error" role="alert">{errorText}</p>}

        <button type="submit" className="sig-submit" disabled={submitting} style={{ width: '100%', marginTop: '16px' }}>
          {submitting ? 'מעלה...' : `העלאת ${docTitle}`}
        </button>
      </section>
    </form>
  );
}

export default DocumentUploadForm;
