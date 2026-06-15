// RegistrationScreen — public volunteer sign-up. Collects a volunteer's
// details, saves them to the "registrants" collection, then shows a summary
// the volunteer can send to the association by WhatsApp or email.

// React hooks: state, an effect, and refs (mount-safety + duplicate-submit guard).
import { useEffect, useRef, useState } from "react";

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
// `status` is NOT here — it's a system value, not something the volunteer edits.
const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  age: "",
  birthDate: "",
  experience: "",
  address: "",
  school: "",
};


// The status every new registrant starts with (added when building the payload,
// never edited in the form). The Firestore rules must still enforce this — the
// client value is only for convenience.
const DEFAULT_STATUS = "ממתין לאישור";


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


// Show a dash for empty values — but NOT for valid falsy ones like the number 0.
const formatSummaryValue = (value) =>
  value === "" || value === null || value === undefined ? "—" : String(value);


// Trim every text field so stray spaces aren't saved (HTML "required" still lets
// through a value that is only spaces).
const getCleanFormData = (data) => ({
  firstName: data.firstName.trim(),
  lastName: data.lastName.trim(),
  email: data.email.trim(),
  phone: data.phone.trim(),
  age: data.age,
  birthDate: data.birthDate,
  experience: data.experience.trim(),
  address: data.address.trim(),
  school: data.school.trim(),
});


// Validate the cleaned data and build the payload. Returns a friendly error
// string instead of the payload if something is missing — so the screen doesn't
// rely solely on the browser's (or a child component's) own validation.
const preparePayload = (data) => {
  const cleanData = getCleanFormData(data);
  const ageNumber = Number(cleanData.age);

  if (!cleanData.firstName || !cleanData.lastName || !cleanData.email || !cleanData.phone) {
    return { payload: null, error: "יש למלא שם פרטי, שם משפחה, אימייל וטלפון." };
  }

  if (cleanData.age === "" || !Number.isFinite(ageNumber) || ageNumber < 0) {
    return { payload: null, error: "יש להזין גיל תקין." };
  }

  if (!cleanData.birthDate) {
    return { payload: null, error: "יש לבחור תאריך לידה." };
  }

  return {
    payload: { ...cleanData, age: ageNumber, status: DEFAULT_STATUS },
    error: "",
  };
};


// Build the plain-text "document" that is sent by WhatsApp / email.
function buildSummaryText(data) {
  // One "label: value" line per summary field.
  const lines = SUMMARY_FIELDS.map(
    ([key, label]) => `${label}: ${formatSummaryValue(data[key])}`,
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

  // A submit error to show inline (empty when none) — replaces a blocking alert().
  const [errorMessage, setErrorMessage] = useState("");

  // Lets us move keyboard focus to the success heading once the form is sent,
  // so screen-reader users are told the view changed.
  const successHeadingRef = useRef(null);

  // Async-safety guard (the app's convention in MainScreen / Login): never update
  // state if the screen unmounted while the save was in flight.
  const isMountedRef = useRef(true);

  // Blocks a second Firestore write before the disabled button has re-rendered
  // — otherwise a fast double-click would create two registrant documents.
  const savingRef = useRef(false);

  // Keep the mount flag accurate, including React Strict Mode's dev re-runs.
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // After a successful submit, focus the "saved" heading.
  useEffect(() => {
    if (submitted) {
      successHeadingRef.current?.focus();
    }
  }, [submitted]);

  // Update a single field by its input "name" attribute (functional update, so
  // it's always based on the latest state).
  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Save the registration to Firestore.
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Stop a duplicate write if a save is already running.
    if (savingRef.current) {
      return;
    }

    // Validate + clean the data; bail out with a friendly message if needed.
    const { payload, error } = preparePayload(formData);
    if (error) {
      setErrorMessage(error);
      return;
    }

    // Enter the saving state (and clear any previous error).
    savingRef.current = true;
    setErrorMessage("");
    setSaving(true);

    try {
      // Add the registrant document (server timestamp, validated by the rules).
      await addDoc(collection(db, "registrants"), {
        ...payload,
        createdAt: serverTimestamp(),
      });

      if (!isMountedRef.current) {
        return;
      }

      // Show the confirmation summary with everything the volunteer entered.
      setSubmitted(payload);
    } catch (saveError) {
      // Show the failure inline (and assertively) instead of a blocking alert().
      console.error("Error saving registration:", saveError);

      if (!isMountedRef.current) {
        return;
      }

      setErrorMessage("אירעה שגיאה בשליחת ההרשמה. נסו שוב.");
    } finally {
      // Always release the duplicate-write lock; only touch state if still mounted.
      savingRef.current = false;
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  // Reset back to a blank form for another registration.
  const handleNewRegistration = () => {
    setSubmitted(null);
    setErrorMessage("");
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
          {/* tabIndex={-1} lets us focus this heading so a screen reader
              announces that the form was saved and the view changed. */}
          <h1 ref={successHeadingRef} tabIndex={-1}>ההרשמה נשמרה ✅</h1>
          <p>אלו הפרטים שמילאת. אפשר לשלוח אותם לעמותה בוואטסאפ או במייל.</p>

          {/* Summary of every entered field. */}
          <dl className="registration-summary">
            {SUMMARY_FIELDS.map(([key, label]) => (
              <div className="registration-summary-row" key={key}>
                <dt>{label}</dt>
                <dd dir="auto">{formatSummaryValue(submitted[key])}</dd>
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
        <h1 id="registration-title">הרשמה להתנדבות</h1>
        <p>אנא מלאו את הפרטים לצורך הרשמה להתנדבות.</p>

        {/* aria-labelledby names the form by its heading; aria-busy marks it as
            mid-request while saving. */}
        <form
          onSubmit={handleSubmit}
          aria-labelledby="registration-title"
          aria-busy={saving}
        >

          {/* First name. */}
          <div className="regform-field">
            <label htmlFor="reg-firstName">שם פרטי</label>
            <input
              id="reg-firstName"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              autoComplete="given-name"
              required
            />
          </div>

          {/* Last name. */}
          <div className="regform-field">
            <label htmlFor="reg-lastName">שם משפחה</label>
            <input
              id="reg-lastName"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              autoComplete="family-name"
              required
            />
          </div>

          {/* Email. dir="ltr" because an email is Latin text inside an RTL form. */}
          <div className="regform-field">
            <label htmlFor="reg-email">אימייל</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="name@example.com"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck="false"
              inputMode="email"
              dir="ltr"
              required
            />
          </div>

          {/* Phone — digits, so also left-to-right; inputMode opens the dialpad. */}
          <div className="regform-field">
            <label htmlFor="reg-phone">טלפון</label>
            <input
              id="reg-phone"
              name="phone"
              type="tel"
              value={formData.phone}
              onChange={handleChange}
              placeholder="050-0000000"
              autoComplete="tel"
              inputMode="tel"
              dir="ltr"
              required
            />
          </div>

          {/* Age. */}
          <div className="regform-field">
            <label htmlFor="reg-age">גיל</label>
            <input
              id="reg-age"
              name="age"
              type="number"
              min="0"
              value={formData.age}
              onChange={handleChange}
              inputMode="numeric"
              required
            />
          </div>

          {/* Birth date — a fieldset so the day/month/year selects share one
              group label (legend). */}
          <fieldset className="reg-bday">
            <legend className="reg-bday-label reg-bday-label-hidden">תאריך לידה</legend>
            <BirthDatePicker
              value={formData.birthDate}
              onChange={(birthDate) => setFormData((prev) => ({ ...prev, birthDate }))}
              label="תאריך לידה"
              required
              showPreview
            />
          </fieldset>

          {/* Previous experience (optional). */}
          <div className="regform-field">
            <label htmlFor="reg-experience">
              ניסיון קודם <span className="reg-optional">(לא חובה)</span>
            </label>
            <input
              id="reg-experience"
              name="experience"
              value={formData.experience}
              onChange={handleChange}
              autoComplete="off"
            />
          </div>

          {/* Address (optional). */}
          <div className="regform-field">
            <label htmlFor="reg-address">
              כתובת <span className="reg-optional">(לא חובה)</span>
            </label>
            <input
              id="reg-address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              autoComplete="street-address"
            />
          </div>

          {/* School / institution (optional). */}
          <div className="regform-field">
            <label htmlFor="reg-school">
              בית ספר / מוסד לימודים <span className="reg-optional">(לא חובה)</span>
            </label>
            <input
              id="reg-school"
              name="school"
              value={formData.school}
              onChange={handleChange}
              autoComplete="organization"
            />
          </div>

          {/* Submit error (only when validation or a save fails). */}
          {errorMessage && (
            <div className="reg-error" role="alert">{errorMessage}</div>
          )}

          {/* Submit. */}
          <button type="submit" className="reg-submit-btn" disabled={saving}>
            {saving ? "שומר..." : "שליחת הרשמה"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default RegistrationScreen;
