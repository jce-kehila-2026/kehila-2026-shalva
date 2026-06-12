// Messages — the admin messaging hub. Compose a message once, pick the
// audience (everyone / specific groups / a single volunteer), and send it
// person-by-person over WhatsApp. There is no sending server: each recipient
// gets a one-tap WhatsApp button with the message pre-filled, plus a
// copy-message button for any other channel.

// React hooks for state, effects and derived values.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading the collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// One-tap WhatsApp button (disabled chip when there's no phone).
import WhatsAppButton from '../shared/WhatsAppButton/WhatsAppButton';

// Shared people helpers + message templates.
import { getDisplayName } from '../../utils/people';
import { greetingMessage, birthdayMessage, hasValidPhone } from '../../utils/whatsapp';

// Shared management-screen styles + this screen's own styles.
import '../shared/ManagementScreen.css';
import './Messages.css';


// The audience modes the admin can pick from.
const AUDIENCE_MODES = [
  { id: 'all', label: 'כל המתנדבים' },
  { id: 'groups', label: 'לפי קבוצות' },
  { id: 'single', label: 'מתנדב בודד' },
];


function Messages() {
  // The raw collections.
  const [volunteers, setVolunteers] = useState([]);
  const [groups, setGroups] = useState([]);

  // The message text being composed.
  const [messageText, setMessageText] = useState('');

  // The chosen audience mode + its selections.
  const [audienceMode, setAudienceMode] = useState('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [singleSearch, setSingleSearch] = useState('');
  const [singleVolunteerId, setSingleVolunteerId] = useState('');

  // Load volunteers + groups once.
  useEffect(() => {
    const load = async () => {
      try {
        const [volunteersSnap, groupsSnap] = await Promise.all([
          getDocs(collection(db, 'volunteers')),
          getDocs(collection(db, 'groups')),
        ]);

        setVolunteers(volunteersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setGroups(groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('שגיאה בטעינת נתונים:', error);
      }
    };

    load();
  }, []);

  // Toggle one group in the multi-select.
  const toggleGroup = (groupId) => {
    setSelectedGroupIds((current) => (
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    ));
  };

  // Does this volunteer belong to one of the selected groups?
  const volunteerInSelectedGroups = (volunteer) => {
    const selectedNames = groups
      .filter((group) => selectedGroupIds.includes(group.id))
      .map((group) => (group.groupName || group.name || '').trim());

    return (
      selectedGroupIds.includes(volunteer.groupId) ||
      selectedNames.includes((volunteer.groupName || '').trim())
    );
  };

  // The recipients matching the chosen audience.
  const recipients = useMemo(() => {
    if (audienceMode === 'all') {
      return volunteers;
    }

    if (audienceMode === 'groups') {
      return volunteers.filter(volunteerInSelectedGroups);
    }

    // Single mode: just the picked volunteer (if any).
    return volunteers.filter((volunteer) => volunteer.id === singleVolunteerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceMode, volunteers, selectedGroupIds, singleVolunteerId, groups]);

  // How many of the recipients actually have a usable phone.
  const reachableCount = recipients.filter((volunteer) => hasValidPhone(volunteer.phone)).length;

  // Volunteers matching the single-mode search box.
  const singleMatches = useMemo(() => {
    const text = singleSearch.trim().toLowerCase();
    if (!text) return [];

    return volunteers
      .filter((volunteer) => getDisplayName(volunteer).toLowerCase().includes(text))
      .slice(0, 8);
  }, [singleSearch, volunteers]);

  // Copy the composed message for use in any other channel.
  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      alert('ההודעה הועתקה!');
    } catch {
      alert('ההעתקה נכשלה — סמנו והעתיקו ידנית.');
    }
  };

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        <header className="mgmt-header">
          <div>
            <h1 className="msg-title">מערכת הודעות</h1>
            <p className="mgmt-subtitle">
              כותבים פעם אחת, בוחרים נמענים — ולכל נמען נפתחת וואטסאפ עם ההודעה מוכנה.
            </p>
          </div>
        </header>

        {/* ---------- Step 1: compose ---------- */}
        <section className="mgmt-section">
          <h2>1. כתיבת ההודעה</h2>

          {/* Quick templates fill the textarea; everything stays editable. */}
          <div className="msg-templates">
            <button type="button" className="mgmt-secondary-btn" onClick={() => setMessageText(greetingMessage(''))}>
              תבנית: מה שלומך
            </button>
            <button type="button" className="mgmt-secondary-btn" onClick={() => setMessageText(birthdayMessage(''))}>
              תבנית: יום הולדת
            </button>
            <button type="button" className="mgmt-secondary-btn" onClick={() => setMessageText('')}>
              ניקוי
            </button>
          </div>

          <textarea
            className="styled-input msg-textarea"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder="כתבו כאן את ההודעה (עדכון, תזכורת, ברכה...)"
            rows={5}
          />
        </section>

        {/* ---------- Step 2: audience ---------- */}
        <section className="mgmt-section">
          <h2>2. בחירת נמענים</h2>

          {/* Mode tabs. */}
          <div className="msg-modes">
            {AUDIENCE_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`msg-mode-btn ${audienceMode === mode.id ? 'is-active' : ''}`}
                onClick={() => setAudienceMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Group multi-select (only in groups mode). */}
          {audienceMode === 'groups' && (
            <div className="msg-groups">
              {groups.map((group) => (
                <label key={group.id} className="msg-group-check">
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                  />
                  {group.groupName || group.name || 'קבוצה ללא שם'}
                </label>
              ))}
            </div>
          )}

          {/* Single-volunteer picker (only in single mode). */}
          {audienceMode === 'single' && (
            <div className="msg-single">
              <input
                type="search"
                className="mgmt-search"
                value={singleSearch}
                onChange={(event) => setSingleSearch(event.target.value)}
                placeholder="🔍 חיפוש מתנדב לפי שם..."
              />
              {singleMatches.map((volunteer) => (
                <button
                  key={volunteer.id}
                  type="button"
                  className={`msg-single-option ${singleVolunteerId === volunteer.id ? 'is-active' : ''}`}
                  onClick={() => setSingleVolunteerId(volunteer.id)}
                >
                  {getDisplayName(volunteer)}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ---------- Step 3: send ---------- */}
        <section className="mgmt-section">
          <h2>3. שליחה</h2>

          <div className="msg-summary">
            <span><strong>{recipients.length}</strong> נמענים נבחרו</span>
            <span><strong>{reachableCount}</strong> עם מספר וואטסאפ תקין</span>
            <button type="button" className="mgmt-secondary-btn" onClick={handleCopyMessage} disabled={!messageText.trim()}>
              📋 העתקת ההודעה
            </button>
          </div>

          {/* One row per recipient with a pre-filled WhatsApp button. */}
          <div className="mgmt-table-wrap">
            <table className="mgmt-table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>קבוצה</th>
                  <th>שליחה</th>
                </tr>
              </thead>
              <tbody>
                {recipients.length > 0 ? (
                  recipients.map((volunteer) => (
                    <tr key={volunteer.id}>
                      <td data-label="שם">{getDisplayName(volunteer)}</td>
                      <td data-label="קבוצה">{volunteer.groupName || 'ללא קבוצה'}</td>
                      <td data-label="שליחה">
                        <WhatsAppButton
                          phone={volunteer.phone}
                          message={messageText}
                          label="שליחה"
                          compact
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" className="mgmt-empty">בחרו נמענים כדי לשלוח.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

export default Messages;
