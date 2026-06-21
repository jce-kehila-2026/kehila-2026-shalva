// SignatureForm — the digital version of Shalva's new-volunteer signing form
// ("טופס חתימה מלא למתנדבים חדשים"). It keeps the original document's structure:
// the ten volunteer commandments, the personal-details section, and the
// confidentiality undertaking — finished with a real drawn signature. The admin
// shares a link to this form (via WhatsApp) from the registrations screen, and
// the volunteer fills + signs it before being approved.

// React hooks for local state + the signature canvas ref.
import { useEffect, useRef, useState } from 'react';

// Firestore helpers to store the submitted form (best-effort).
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

// Storage helpers: the signed PDF is uploaded as a real file for admins.
import { ref as storageRef, uploadBytes } from 'firebase/storage';

// Our Firestore database instance.
import { db, storage } from '../../firebase';

// Allowed activity-day short labels (ראשון–שישי; Saturday is not selectable).
import { ACTIVITY_DAY_SHORT_LABELS } from '../../utils/activityDays';

// Shared day / month / year date selector.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker';

// Component styles.
import './SignatureForm.css';


// The ten volunteer "commandments" (condensed from the original form).
const COMMANDMENTS = [
  'לא משאירים חניך לבד — כל חניך נמצא כל הזמן בפיקוח ובאחריות איש צוות.',
  'הגוף שלי הוא רק שלי — חום ואהבה אפשר לתת גם ללא מגע. לא מרימים חניכים, חיבוקים רק מהצד, ועזרה במקלחות ובשירותים נעשית בתיווך מילולי.',
  'עזרה — עִזרו לצוות לנהל את הקבוצה ולשמור על חדר הקבוצה מסודר בסוף יום הפעילות.',
  'דיווח על כל אירוע חריג — יש לדווח לצוות או לרכזים מיידית בכל שעה. לא להתמודד לבד.',
  'ציוד אישי — שמרו על ציודו האישי של כל חניך כאילו היה ציודכם.',
  'אלימות פיזית ומילולית — מחוץ לתחום! אין משחקי מים. שומרים על אווירה שקטה, רגועה ומכבדת.',
  'זמנים וקביעות — מהשעה 15:00 עד 18:00. מקדישים את הזמן לחניכים (לא בפלאפון), ויש להודיע לצוות מראש על היעדרות.',
  'מתנדבים — מתנדב בשלוה הוא חבר לחניך, לא מדריך. לא מחלקים עונשים; על כל בעיה פונים לצוות הקבוצה.',
  'חיסיון — חלה חובת סודיות ושמירה על פרטיות החניכים. אסור לפרסם מידע או תמונות של החניכים.',
  'לשמוח ולעשות אווירה טובה — שמרו על הכללים והבטיחו את ביטחונם של חניכינו.',
];

// The confidentiality undertaking text (from the original form).
const CONFIDENTIALITY_TEXT =
  'המתנדב/ת מתחייב/ת שלא לפרסם או להביא לידיעת כל אדם, רשות או ארגון, בכתב או בעל פה, מידע שהגיע אליו עקב התנדבותו — אלא אם כן קיבל/ה אישור מפורש לכך מהממונה על הנושא בארגון. אני החתום/ה מטה מצהיר/ה כי ידוע לי שכמתנדב/ת בארגון שלוה חלה עליי חובת הסודיות בכל הנוגע למידע שהגיע אליי. כמו כן, ידוע לי כי אני צפוי/ה לעונשים הקבועים בחוק — אם אמסור שלא כדין וללא סמכות ידיעה שהגיעה אליי בתוקף עבודתי זו, לאדם שאינו מוסמך לקבלה.';

// Closed lists used by the form.
const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];


const REQUIRED_TEXT_FIELDS = [
  ['firstName', 'שם פרטי'],
  ['lastName', 'שם משפחה'],
  ['birthDateGreg', 'תאריך לידה לועזי'],
  ['idNumber', 'מספר תעודת זהות'],
  ['age', 'גיל'],
  ['address', 'כתובת'],
  ['phone', 'פלאפון'],
  ['email', 'מייל'],
  ['school', 'בית ספר / עיסוק נוכחי'],
  ['shirtSize', 'מידה בחולצה'],
  ['groupName', 'הקבוצה בה אני מתנדב/ת'],
];


function formatIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return value || '—';

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}


function validateSignatureForm({ form, activityDays, agreed, signature }) {
  const missing = REQUIRED_TEXT_FIELDS
    .filter(([key]) => !String(form[key] || '').trim())
    .map(([, label]) => label);

  if (missing.length > 0) {
    return `יש למלא את שדות החובה: ${missing.join(', ')}. תאריך עברי אינו חובה.`;
  }

  const idDigits = String(form.idNumber).replace(/\D/g, '');
  if (idDigits.length !== 9) {
    return 'יש להזין מספר תעודת זהות תקין בן 9 ספרות.';
  }

  const age = Number(form.age);
  if (!Number.isFinite(age) || age < 0 || age > 120) {
    return 'יש להזין גיל תקין בין 0 ל-120.';
  }

  const phoneDigits = String(form.phone).replace(/\D/g, '');
  if (phoneDigits.length < 9 || phoneDigits.length > 10) {
    return 'יש להזין מספר פלאפון תקין.';
  }

  const email = String(form.email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'יש להזין כתובת מייל תקינה.';
  }

  if (activityDays.length === 0) {
    return 'יש לבחור לפחות יום התנדבות אחד.';
  }

  if (!agreed) {
    return 'יש לאשר את עשרת הדיברות וכתב שמירת הסודיות.';
  }

  if (!signature) {
    return 'יש לחתום במקום המיועד.';
  }

  return '';
}


async function createPdfBlobFromElement(element) {
  if (!element) {
    throw new Error('PDF document was not ready for export.');
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const imageData = canvas.toDataURL('image/jpeg', 0.92);
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imageHeight = (canvas.height * pageWidth) / canvas.width;

  let y = 0;
  let remainingHeight = imageHeight;

  pdf.addImage(imageData, 'JPEG', 0, y, pageWidth, imageHeight);
  remainingHeight -= pageHeight;

  while (remainingHeight > 0) {
    y = remainingHeight - imageHeight;
    pdf.addPage();
    pdf.addImage(imageData, 'JPEG', 0, y, pageWidth, imageHeight);
    remainingHeight -= pageHeight;
  }

  return pdf.output('blob');
}


function PdfField({ label, value, optional = false }) {
  return (
    <div className="sig-pdf-field">
      <span>{label}</span>
      <strong>{value || (optional ? 'לא צוין' : '—')}</strong>
    </div>
  );
}


function SignedFormPdfDocument({ form, fullName, activityDays, signature }) {
  return (
    <div className="sig-pdf-page" dir="rtl">
      <header className="sig-pdf-head">
        <h1>טופס מתנדב חדש - עמותת שלוה</h1>
        <p>טופס מלא וחתום דיגיטלית</p>
      </header>

      <section className="sig-pdf-section">
        <h2>פרטי המתנדב/ת</h2>
        <div className="sig-pdf-grid">
          <PdfField label="שם מלא" value={fullName} />
          <PdfField label="תעודת זהות" value={form.idNumber} />
          <PdfField label="גיל" value={form.age} />
          <PdfField label="תאריך לידה (לועזי)" value={formatIsoDate(form.birthDateGreg)} />
          <PdfField label="תאריך לידה (עברי)" value={form.birthDateHeb} optional />
          <PdfField label="פלאפון" value={form.phone} />
          <PdfField label="מייל" value={form.email} />
          <PdfField label="כתובת" value={form.address} />
          <PdfField label="בית ספר / עיסוק נוכחי" value={form.school} />
          <PdfField label="מידה בחולצה" value={form.shirtSize} />
          <PdfField label="קבוצה" value={form.groupName} />
          <PdfField label="ימי התנדבות" value={activityDays.join(', ')} />
        </div>
      </section>

      <section className="sig-pdf-section">
        <h2>עשרת הדיברות למתנדבים בשלוה</h2>
        <ol className="sig-pdf-commandments">
          {COMMANDMENTS.map((rule, index) => (
            <li key={index}>{rule}</li>
          ))}
        </ol>
      </section>

      <section className="sig-pdf-section">
        <h2>כתב שמירת סודיות למתנדבים</h2>
        <p className="sig-pdf-legal">{CONFIDENTIALITY_TEXT}</p>
      </section>

      <section className="sig-pdf-section sig-pdf-sign">
        <h2>אישור וחתימה</h2>
        <p>קראתי ואני מאשר/ת את עשרת הדיברות ואת כתב שמירת הסודיות.</p>
        {signature && <img src={signature} alt="חתימת המתנדב/ת" />}
      </section>
    </div>
  );
}


// A drawing surface for the signature. Works with both mouse and touch, and
// reports the drawn image (a PNG data-URL) up to the parent on every change.
function SignaturePad({ onChange }) {
  // The canvas element + small bits of drawing state kept in refs (no re-render).
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef({ x: 0, y: 0 });
  const hasInk = useRef(false);

  // Translate a mouse/touch event into a point inside the canvas pixels.
  const getPoint = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches ? event.touches[0] : event;

    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  // Start a new stroke.
  const startStroke = (event) => {
    event.preventDefault();
    isDrawing.current = true;
    lastPoint.current = getPoint(event);
  };

  // Draw a line segment as the pointer moves.
  const drawStroke = (event) => {
    if (!isDrawing.current) {
      return;
    }

    event.preventDefault();

    const context = canvasRef.current.getContext('2d');
    const point = getPoint(event);

    context.strokeStyle = '#081726';
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(lastPoint.current.x, lastPoint.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();

    lastPoint.current = point;
    hasInk.current = true;
  };

  // Finish the stroke and report the signature image (only once there's ink).
  const endStroke = () => {
    if (!isDrawing.current) {
      return;
    }

    isDrawing.current = false;

    if (hasInk.current) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  };

  // Wipe the canvas and clear the reported signature.
  const clearPad = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    onChange('');
  };

  return (
    <div className="sig-pad-wrap">
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="sig-pad"
        onMouseDown={startStroke}
        onMouseMove={drawStroke}
        onMouseUp={endStroke}
        onMouseLeave={endStroke}
        onTouchStart={startStroke}
        onTouchMove={drawStroke}
        onTouchEnd={endStroke}
      />
      <div className="sig-pad-actions">
        <button type="button" className="sig-clear" onClick={clearPad}>ניקוי חתימה</button>
      </div>
    </div>
  );
}


function SignatureForm({ registrantId = '', prefillName = '' }) {
  // Hidden, clean document used only for generating the PDF file.
  const pdfDocumentRef = useRef(null);

  // Split a prefilled full name into first + last (rest) for the fields.
  const nameParts = prefillName.trim().split(/\s+/);
  const initialFirstName = nameParts[0] || '';
  const initialLastName = nameParts.slice(1).join(' ');

  // All the form's text fields in one object.
  const [form, setForm] = useState({
    firstName: initialFirstName,
    lastName: initialLastName,
    idNumber: '',
    age: '',
    birthDateGreg: '',
    birthDateHeb: '',
    address: '',
    phone: '',
    email: '',
    school: '',
    shirtSize: '',
    groupName: '',
  });

  // Which activity days were ticked.
  const [activityDays, setActivityDays] = useState([]);

  // Available groups loaded from Firestore.
  const [groupOptions, setGroupOptions] = useState([]);

  useEffect(() => {
    let active = true;
    const fetchGroups = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'groups'));
        const names = snapshot.docs
          .map((doc) => doc.data().groupName || doc.data().name || '')
          .filter(Boolean);
        if (active) {
          setGroupOptions([...new Set(names)].sort((a, b) => a.localeCompare(b, 'he')));
        }
      } catch (error) {
        console.error('שגיאה בטעינת קבוצות:', error);
      }
    };
    fetchGroups();
    return () => {
      active = false;
    };
  }, []);

  // The agreement checkbox + the drawn signature (PNG data-URL).
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState('');

  // Submit state + a friendly error message.
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdf, setSubmittedPdf] = useState(null);
  const [errorText, setErrorText] = useState('');

  // Update one text field by name.
  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  // Toggle one activity day on/off.
  const toggleDay = (day) => {
    setActivityDays((current) => (
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day]
    ));
  };

  // The volunteer's full name, derived from the two name fields.
  const fullName = `${form.firstName} ${form.lastName}`.trim();

  // Validate, then store the signed form (best-effort) and show the thank-you.
  const handleSubmit = async (event) => {
    event.preventDefault();

    const validationError = validateSignatureForm({ form, activityDays, agreed, signature });
    if (validationError) {
      setErrorText(validationError);
      return;
    }

    setErrorText('');
    setSubmitting(true);

    const trimmedForm = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      idNumber: form.idNumber.replace(/\D/g, ''),
      age: form.age.trim(),
      birthDateGreg: form.birthDateGreg.trim(),
      birthDateHeb: form.birthDateHeb.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      school: form.school.trim(),
      shirtSize: form.shirtSize,
      groupName: form.groupName.trim(),
    };

    const formDocRef = doc(collection(db, 'signedForms'));
    const pdfFileName = `shalva-signed-form-${formDocRef.id}.pdf`;

    try {
      const pdfBlob = await createPdfBlobFromElement(pdfDocumentRef.current);
      const pdfStoragePath = `signedForms/${formDocRef.id}/${pdfFileName}`;

      await uploadBytes(storageRef(storage, pdfStoragePath), pdfBlob, {
        contentType: 'application/pdf',
      });

      // The document we store. Kept to the fields the security rule allows.
      const payload = {
        registrantId,
        fullName: `${trimmedForm.firstName} ${trimmedForm.lastName}`.trim(),
        ...trimmedForm,
        age: Number(trimmedForm.age),
        activityDays,
        agreed,
        signature,
        pdfStoragePath,
        pdfFileName,
        createdAt: serverTimestamp(),
      };

      // Store the signed form record after the PDF is already available.
      await setDoc(formDocRef, payload);

      setSubmittedPdf({
        url: URL.createObjectURL(pdfBlob),
        fileName: pdfFileName,
      });
      setSubmitted(true);
    } catch (error) {
      console.error('שמירת הטופס החתום נכשלה:', error);
      if (error && error.stack) {
        console.error('שגיאה מלאה:', error.stack);
      }
      setErrorText('לא הצלחנו לשמור את הטופס כ-PDF. בדקו חיבור ונסו שוב.');
    } finally {
      setSubmitting(false);
    }
  };

  // After submitting: a thank-you screen, with a link to the generated PDF.
  if (submitted) {
    return (
      <div className="sig-form" dir="rtl">
        <div className="sig-done">
          <span className="sig-done-mark" aria-hidden="true">✓</span>
          <h2>תודה{form.firstName ? `, ${form.firstName}` : ''}!</h2>
          <p>הטופס המלא נחתם, נשמר כ-PDF ונשלח לניהול הנרשמים.</p>
          {submittedPdf && (
            <a className="sig-print-btn" href={submittedPdf.url} download={submittedPdf.fileName}>
              הורדת עותק PDF
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="sig-form" dir="rtl" onSubmit={handleSubmit}>

      {/* Title. */}
      <header className="sig-head">
        <h1 className="sig-title">טופס מתנדב חדש — עמותת שלווה</h1>
        <p className="sig-subtitle">אנא קראו, מלאו את הפרטים, וחתמו דיגיטלית בתחתית הטופס.</p>
      </header>

      {/* Section 1: the ten commandments. */}
      <section className="sig-section">
        <h2 className="sig-section-title">עשרת הדיברות למתנדבים בשלוה</h2>
        <ol className="sig-commandments">
          {COMMANDMENTS.map((rule, index) => (
            <li key={index}>{rule}</li>
          ))}
        </ol>
      </section>

      {/* Section 2: personal details. */}
      <section className="sig-section">
        <h2 className="sig-section-title">פרטי המתנדב/ת</h2>

        <div className="sig-grid">
          <label className="sig-field">
            <span>שם פרטי</span>
            <input name="firstName" value={form.firstName} onChange={updateField} required />
          </label>
          <label className="sig-field">
            <span>שם משפחה</span>
            <input name="lastName" value={form.lastName} onChange={updateField} required />
          </label>
          <div className="sig-field">
            <BirthDatePicker
              value={form.birthDateGreg}
              onChange={(birthDateGreg) => setForm((current) => ({ ...current, birthDateGreg }))}
              label="תאריך לידה (לועזי)"
              required
              showPreview
            />
          </div>
          <div className="sig-field">
            <div className="birth-date-picker">
              <div className="bdp-label">תאריך לידה (עברי)</div>
              <input
                className="bdp-text-input"
                name="birthDateHeb"
                value={form.birthDateHeb}
                onChange={updateField}
                placeholder="לדוגמה: כ״ג בתמוז"
              />
            </div>
          </div>
          <label className="sig-field">
            <span>מספר תעודת זהות</span>
            <input name="idNumber" value={form.idNumber} onChange={updateField} inputMode="numeric" dir="ltr" maxLength="9" required />
          </label>
          <label className="sig-field">
            <span>גיל</span>
            <input name="age" type="number" value={form.age} onChange={updateField} inputMode="numeric" dir="ltr" min="0" max="120" required />
          </label>
          <label className="sig-field sig-field--wide">
            <span>כתובת</span>
            <input name="address" value={form.address} onChange={updateField} required />
          </label>
          <label className="sig-field">
            <span>פלאפון</span>
            <input name="phone" type="tel" value={form.phone} onChange={updateField} dir="ltr" placeholder="050-0000000" required />
          </label>
          <label className="sig-field">
            <span>מייל</span>
            <input name="email" type="email" value={form.email} onChange={updateField} dir="ltr" required />
          </label>
          <label className="sig-field sig-field--wide">
            <span>בית ספר / עיסוק נוכחי</span>
            <input name="school" value={form.school} onChange={updateField} required />
          </label>
          <label className="sig-field">
            <span>מידה בחולצה</span>
            <select name="shirtSize" value={form.shirtSize} onChange={updateField} required>
              <option value="">— בחירה —</option>
              {SHIRT_SIZES.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <label className="sig-field">
            <span>הקבוצה בה אני מתנדב/ת</span>
            <select name="groupName" value={form.groupName} onChange={updateField} required>
              <option value="">— בחירה —</option>
              {groupOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Which days the volunteer attends. */}
        <div className="sig-days">
          <span className="sig-days-label">באיזה יום אני מתנדב/ת?</span>
          <div className="sig-days-options">
            {ACTIVITY_DAY_SHORT_LABELS.map((day) => (
              <button
                type="button"
                key={day}
                className={`sig-day ${activityDays.includes(day) ? 'is-on' : ''}`}
                onClick={() => toggleDay(day)}
                aria-pressed={activityDays.includes(day)}
              >
                {day}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Section 3: confidentiality undertaking. */}
      <section className="sig-section">
        <h2 className="sig-section-title">כתב שמירת סודיות למתנדבים</h2>
        <p className="sig-legal">{CONFIDENTIALITY_TEXT}</p>
      </section>

      {/* Agreement + signature. */}
      <section className="sig-section sig-sign-section">
        <label className="sig-agree">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span>קראתי ואני מאשר/ת את עשרת הדיברות ואת כתב שמירת הסודיות.</span>
        </label>

        <div className="sig-sign-block">
          <span className="sig-sign-label">חתימת המתנדב/ת:</span>
          <SignaturePad onChange={setSignature} />
        </div>

        {/* Validation / submit error. */}
        {errorText && <p className="sig-error" role="alert">{errorText}</p>}

        <button type="submit" className="sig-submit" disabled={submitting}>
          {submitting ? 'שולח...' : 'חתימה ושליחת הטופס'}
        </button>
      </section>

      <div className="sig-pdf-document" ref={pdfDocumentRef} aria-hidden="true">
        <SignedFormPdfDocument
          form={form}
          fullName={fullName}
          activityDays={activityDays}
          signature={signature}
        />
      </div>
    </form>
  );
}

export default SignatureForm;
