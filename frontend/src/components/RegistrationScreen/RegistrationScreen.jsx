// RegistrationScreen — public volunteer sign-up. Collects a volunteer's
// details, saves them to the "registrants" collection, then shows a summary
// the volunteer can send to the association by WhatsApp or email.

// React state hook.
import { useState } from "react";

// Firestore helpers for adding a document.
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

// Our Firestore database instance.
import { db } from "../../firebase";

// Date picker for the birth date field.
import BirthDatePicker from "../shared/BirthDatePicker/BirthDatePicker";

// Styles for this screen.
import "./RegistrationScreen.css";


// Where the registration "document" is sent. Fill with the association's
// details (WhatsApp in international digits, e.g. '9725XXXXXXXX'). Left empty
// -> the user picks the contact when sending.
const ORG_WHATSAPP = "";
const ORG_EMAIL = "";


// Blank form, used for the initial state and for resetting after submit.
const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  status: "ממתין לאישור",
  age: "",
  birthDate: "",
  experience: "",
  address: "",
  school: "",
};


// Fields shown in the confirmation summary (and in the sent message), in order.
const SUMMARY_FIELDS = [
  ["firstName", "שם פרטי"],
  ["lastName", "שם משפחה"],
  ["email", "אימייל"],
  ["phone", "טלפון"],
  ["age", "גיל"],
  ["birthDate", "תאריך לידה"],
  ["address", "כתובת"],
  ["school", "בית ספר / מוסד לימודים"],
  ["experience", "ניסיון קודם"],
  ["status", "סטטוס"],
];


// Build the plain-text "document" that is sent by WhatsApp / email.
function buildSummaryText(data) {
  // One "label: value" line per summary field.
  const lines = SUMMARY_FIELDS.map(
    ([key, label]) => `${label}: ${data[key] || "—"}`,
  );

  // Prefix with a title + blank line.
  return ["הרשמה להתנדבות — עמותת שלווה", "", ...lines].join("\n");
}


function RegistrationScreen() {
  // The form values.
  const [formData, setFormData] = useState(EMPTY_FORM);

  // The saved details once submitted (null while still filling the form).
  const [submitted, setSubmitted] = useState(null);

  // True while the submission is being saved.
  const [saving, setSaving] = useState(false);

  // Update a single field by its input "name" attribute.
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Save the registration to Firestore.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    // Store age as a number, not a string.
    const payload = {
      ...formData,
      age: Number(formData.age),
    };

    try {
      // Add the registrant document (server timestamp, validated by the rules).
      await addDoc(collection(db, "registrants"), {
        ...payload,
        createdAt: serverTimestamp(),
      });

      // Show the confirmation summary with everything the volunteer entered.
      setSubmitted(payload);
    } catch (error) {
      console.error("Error saving registration:", error);
      alert("אירעה שגיאה בשליחת ההרשמה");
    } finally {
      setSaving(false);
    }
  };

  // Reset back to a blank form for another registration.
  const handleNewRegistration = () => {
    setSubmitted(null);
    setFormData(EMPTY_FORM);
  };

  // ----- Confirmation summary (after a successful submit) -----
  if (submitted) {
    // Build the message text and the send links.
    const summaryText = buildSummaryText(submitted);
    const encoded = encodeURIComponent(summaryText);

    // WhatsApp link (to the org's number if set, otherwise let the user choose).
    const whatsappHref = ORG_WHATSAPP
      ? `https://wa.me/${ORG_WHATSAPP}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;

    // Email link with subject + body.
    const emailHref = `mailto:${ORG_EMAIL}?subject=${encodeURIComponent(
      "הרשמה להתנדבות — עמותת שלווה",
    )}&body=${encoded}`;

    return (
      <div className="registration-page" dir="rtl">
        <div className="registration-card">
          <h1>ההרשמה נשמרה ✅</h1>
          <p>אלו הפרטים שמילאת. אפשר לשלוח אותם לעמותה בוואטסאפ או במייל.</p>

          {/* Summary of every entered field. */}
          <dl className="registration-summary">
            {SUMMARY_FIELDS.map(([key, label]) => (
              <div className="registration-summary-row" key={key}>
                <dt>{label}</dt>
                <dd>{submitted[key] ? String(submitted[key]) : "—"}</dd>
              </div>
            ))}
          </dl>

          {/* Send via WhatsApp or email. */}
          <div className="registration-send-actions">
            <a
              className="reg-send-btn reg-send-whatsapp"
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
            >
              שליחה בוואטסאפ
            </a>
            <a
              className="reg-send-btn reg-send-email"
              href={emailHref}
            >
              שליחה במייל
            </a>
          </div>

          {/* Start another registration. */}
          <button
            type="button"
            className="reg-secondary-btn"
            onClick={handleNewRegistration}
          >
            הרשמה נוספת
          </button>
        </div>
      </div>
    );
  }

  // ----- Registration form -----
  return (
    <div className="registration-page" dir="rtl">
      <div className="registration-card">
        <h1>הרשמה להתנדבות</h1>
        <p>אנא מלאו את הפרטים לצורך הרשמה להתנדבות.</p>

        <form onSubmit={handleSubmit}>

          {/* First name. */}
          <input
            name="firstName"
            placeholder="שם פרטי"
            value={formData.firstName}
            onChange={handleChange}
            required
          />

          {/* Last name. */}
          <input
            name="lastName"
            placeholder="שם משפחה"
            value={formData.lastName}
            onChange={handleChange}
            required
          />

          {/* Email. */}
          <input
            name="email"
            type="email"
            placeholder="אימייל"
            value={formData.email}
            onChange={handleChange}
            required
          />

          {/* Phone. */}
          <input
            name="phone"
            placeholder="טלפון"
            value={formData.phone}
            onChange={handleChange}
            required
          />

          {/* Age. */}
          <input
            name="age"
            type="number"
            placeholder="גיל"
            value={formData.age}
            onChange={handleChange}
            required
          />

          {/* Birth date (custom picker). */}
          <div className="reg-bday">
            <span className="reg-bday-label">תאריך לידה</span>
            <BirthDatePicker
              value={formData.birthDate}
              onChange={(birthDate) => setFormData((prev) => ({ ...prev, birthDate }))}
              required
              showPreview
            />
          </div>

          {/* Previous experience. */}
          <input
            name="experience"
            placeholder="ניסיון קודם"
            value={formData.experience}
            onChange={handleChange}
          />

          {/* Address. */}
          <input
            name="address"
            placeholder="כתובת"
            value={formData.address}
            onChange={handleChange}
          />

          {/* School / institution. */}
          <input
            name="school"
            placeholder="בית ספר / מוסד לימודים"
            value={formData.school}
            onChange={handleChange}
          />

          {/* Submit. */}
          <button type="submit" disabled={saving}>
            {saving ? "שומר..." : "שליחת הרשמה"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default RegistrationScreen;
