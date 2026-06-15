// Messages — the admin messaging hub. Write a message once, choose who gets it
// (every volunteer / by group / a single person found by search), then send it
// person-by-person over WhatsApp. There is no sending server: each recipient
// gets a one-tap WhatsApp button that opens the chat with the message ready,
// so the admin can tweak the wording before it goes out. The search covers
// BOTH volunteers and guides, so anyone can be reached in a couple of taps.

// React hooks for state, effects and derived values.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading the collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// One-tap WhatsApp button (opens an edit-before-send modal; disabled chip when
// there's no phone).
import WhatsAppButton from '../shared/WhatsAppButton/WhatsAppButton';

// Shared people helpers + message templates.
import { getDisplayName } from '../../utils/people';
import { greetingMessage, birthdayMessage, hasValidPhone, buildWhatsAppUrl } from '../../utils/whatsapp';

// Shared management-screen styles + this screen's own styles.
import '../shared/ManagementScreen.css';
import './Messages.css';


// The audience modes the admin can pick from.
const AUDIENCE_MODES = [
  { id: 'all', label: 'כל המתנדבים' },
  { id: 'groups', label: 'לפי קבוצה' },
  { id: 'search', label: 'חיפוש אדם' },
];


// First letter of a name, for the avatar circle.
const initialOf = (name) => {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};


function Messages() {
  // The raw collections.
  const [volunteers, setVolunteers] = useState([]);
  const [guides, setGuides] = useState([]);
  const [groups, setGroups] = useState([]);

  // The message text being composed.
  const [messageText, setMessageText] = useState('');

  // The chosen audience mode + its selections.
  const [audienceMode, setAudienceMode] = useState('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [searchText, setSearchText] = useState('');

  // A short-lived "copied!" confirmation on the copy button.
  const [copied, setCopied] = useState(false);

  // Load volunteers + guides + groups once.
  useEffect(() => {
    const load = async () => {
      try {
        const [volunteersSnap, guidesSnap, groupsSnap] = await Promise.all([
          getDocs(collection(db, 'volunteers')),
          getDocs(collection(db, 'guides')),
          getDocs(collection(db, 'groups')),
        ]);

        setVolunteers(volunteersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setGuides(guidesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setGroups(groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('שגיאה בטעינת נתונים:', error);
      }
    };

    load();
  }, []);

  // Tag a person with their role + a stable React key, so volunteers and guides
  // can share one list without their ids clashing.
  const tagPerson = (person, kind) => ({
    ...person,
    _kind: kind,
    _role: kind === 'guide' ? 'מדריך' : 'מתנדב',
    _key: `${kind}_${person.id}`,
  });

  // Everyone (volunteers + guides) — the pool the "search" mode runs over.
  const everyone = useMemo(
    () => [
      ...volunteers.map((person) => tagPerson(person, 'volunteer')),
      ...guides.map((person) => tagPerson(person, 'guide')),
    ],
    [volunteers, guides],
  );

  // Toggle one group in the multi-select.
  const toggleGroup = (groupId) => {
    setSelectedGroupIds((current) => (
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    ));
  };

  // Does this volunteer belong to one of the selected groups? (matched by id or
  // by the group's name, since older records store one or the other).
  const volunteerInSelectedGroups = (volunteer) => {
    const selectedNames = groups
      .filter((group) => selectedGroupIds.includes(group.id))
      .map((group) => (group.groupName || group.name || '').trim());

    return (
      selectedGroupIds.includes(volunteer.groupId) ||
      selectedNames.includes((volunteer.groupName || '').trim())
    );
  };

  // A person matches the search when the text appears in their name, phone or
  // group — so the admin can find someone by any of them.
  const matchesSearch = (person, text) => {
    const haystack = [getDisplayName(person), person.phone, person.groupName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(text);
  };

  // The recipients matching the chosen audience.
  const recipients = useMemo(() => {
    if (audienceMode === 'all') {
      return volunteers.map((person) => tagPerson(person, 'volunteer'));
    }

    if (audienceMode === 'groups') {
      return volunteers
        .filter(volunteerInSelectedGroups)
        .map((person) => tagPerson(person, 'volunteer'));
    }

    // Search mode: match volunteers AND guides; empty until the admin types.
    const text = searchText.trim().toLowerCase();
    if (!text) {
      return [];
    }

    return everyone.filter((person) => matchesSearch(person, text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceMode, volunteers, everyone, selectedGroupIds, searchText, groups]);

  // The recipients that actually have a usable phone (the send queue).
  const reachableRecipients = recipients.filter((person) => hasValidPhone(person.phone));
  const reachableCount = reachableRecipients.length;

  // How far the one-button "send to everyone" has progressed through the queue.
  const [sendIndex, setSendIndex] = useState(0);

  // Changing the audience or the message restarts the queue.
  useEffect(() => {
    setSendIndex(0);
  }, [audienceMode, selectedGroupIds, searchText, messageText]);

  // One button sends to everyone selected: each press opens the NEXT recipient's
  // WhatsApp chat with the message ready (browsers block opening many chats at
  // once, so the queue advances press by press).
  const handleSendToAll = () => {
    if (sendIndex >= reachableRecipients.length) {
      setSendIndex(0);
      return;
    }

    const recipient = reachableRecipients[sendIndex];
    window.open(buildWhatsAppUrl(recipient.phone, messageText), '_blank');
    setSendIndex(sendIndex + 1);
  };

  // Copy the composed message for use in any other channel.
  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — leave the button as-is; the text is still on screen.
    }
  };

  // The label on the "send to everyone" button, which reflects queue progress.
  const sendAllLabel = sendIndex === 0
    ? `שליחה לכולם (${reachableCount})`
    : sendIndex >= reachableCount
      ? 'נשלח לכולם — התחלה מחדש'
      : `לנמען הבא (${sendIndex}/${reachableCount})`;

  // The empty-state line under the recipients, tailored to the current mode.
  const emptyMessage = audienceMode === 'search'
    ? (searchText.trim() ? 'לא נמצאו אנשים תואמים לחיפוש.' : 'הקלידו שם, טלפון או קבוצה כדי לחפש מתנדב או מדריך.')
    : audienceMode === 'groups'
      ? 'בחרו קבוצה אחת או יותר כדי לראות נמענים.'
      : 'עדיין אין מתנדבים.';

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        <header className="mgmt-header">
          <div>
            <h1 className="msg-title">מערכת הודעות</h1>
            <p className="mgmt-subtitle">
              כותבים הודעה פעם אחת, בוחרים למי לשלוח — ולכל אדם נפתחת וואטסאפ עם ההודעה מוכנה.
            </p>
          </div>
        </header>

        {/* ---------- Step 1: compose ---------- */}
        <section className="msg-step">
          <div className="msg-step-head">
            <span className="msg-step-num">1</span>
            <h2 className="msg-step-title">כתיבת ההודעה</h2>
          </div>

          {/* Quick templates fill the textarea; everything stays editable. */}
          <div className="msg-templates">
            <button type="button" className="msg-chip" onClick={() => setMessageText(greetingMessage(''))}>
              מה שלומך
            </button>
            <button type="button" className="msg-chip" onClick={() => setMessageText(birthdayMessage(''))}>
              יום הולדת
            </button>
            {messageText && (
              <button type="button" className="msg-chip msg-chip--clear" onClick={() => setMessageText('')}>
                ניקוי
              </button>
            )}
          </div>

          <textarea
            className="msg-textarea"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder="כתבו כאן את ההודעה (עדכון, תזכורת, ברכה...)"
            rows={5}
          />

          <div className="msg-charcount">{messageText.length} תווים</div>
        </section>

        {/* ---------- Step 2: audience ---------- */}
        <section className="msg-step">
          <div className="msg-step-head">
            <span className="msg-step-num">2</span>
            <h2 className="msg-step-title">בחירת נמענים</h2>
          </div>

          {/* Mode tabs. */}
          <div className="msg-modes" role="tablist" aria-label="בחירת קהל">
            {AUDIENCE_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={audienceMode === mode.id}
                className={`msg-mode-btn ${audienceMode === mode.id ? 'is-active' : ''}`}
                onClick={() => setAudienceMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Group multi-select (only in groups mode). */}
          {audienceMode === 'groups' && (
            groups.length > 0 ? (
              <div className="msg-groups">
                {groups.map((group) => (
                  <label key={group.id} className="msg-group-check">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(group.id)}
                      onChange={() => toggleGroup(group.id)}
                    />
                    <span>{group.groupName || group.name || 'קבוצה ללא שם'}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="msg-hint">עדיין אין קבוצות.</p>
            )
          )}

          {/* Person search (only in search mode) — finds volunteers AND guides. */}
          {audienceMode === 'search' && (
            <input
              type="search"
              className="msg-search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="🔍 חיפוש מתנדב או מדריך לפי שם, טלפון או קבוצה..."
            />
          )}
        </section>

        {/* ---------- Step 3: send ---------- */}
        <section className="msg-step">
          <div className="msg-step-head">
            <span className="msg-step-num">3</span>
            <h2 className="msg-step-title">שליחה</h2>
          </div>

          {/* Counts + the bulk send / copy actions. */}
          <div className="msg-summary">
            <span className="msg-stat"><strong>{recipients.length}</strong> נמענים</span>
            <span className="msg-stat msg-stat--ok"><strong>{reachableCount}</strong> עם וואטסאפ</span>

            <div className="msg-summary-actions">
              <button
                type="button"
                className="msg-send-all-btn"
                onClick={handleSendToAll}
                disabled={!messageText.trim() || reachableCount === 0}
              >
                {sendAllLabel}
              </button>
              <button
                type="button"
                className="msg-copy-btn"
                onClick={handleCopyMessage}
                disabled={!messageText.trim()}
              >
                {copied ? '✓ הועתק' : 'העתקת ההודעה'}
              </button>
            </div>
          </div>

          {/* One card per recipient, each with a pre-filled WhatsApp button. */}
          {recipients.length > 0 ? (
            <div className="msg-recipients">
              {recipients.map((person) => (
                <article className="msg-recipient" key={person._key}>
                  <span className="msg-recipient-avatar">{initialOf(getDisplayName(person))}</span>

                  <div className="msg-recipient-info">
                    <span className="msg-recipient-name">{getDisplayName(person)}</span>
                    <span className="msg-recipient-meta">
                      <span className={`msg-role ${person._kind === 'guide' ? 'msg-role--guide' : 'msg-role--vol'}`}>
                        {person._role}
                      </span>
                      {person.groupName && <span className="msg-recipient-group">{person.groupName}</span>}
                    </span>
                  </div>

                  <WhatsAppButton
                    phone={person.phone}
                    message={messageText}
                    label="שליחה"
                    compact
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className="msg-empty">{emptyMessage}</div>
          )}
        </section>
      </section>
    </main>
  );
}

export default Messages;
