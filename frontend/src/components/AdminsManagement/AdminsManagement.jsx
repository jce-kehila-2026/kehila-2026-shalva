// AdminsManagement — the OWNER-only screen. The single owner can:
//   - promote any user to admin ("add admin"),
//   - remove an admin (demote back to viewer),
//   - hand ownership to another admin (transfer).
// There is always exactly ONE owner: the transfer demotes the current owner and
// promotes the target in one atomic batch. The server rules in firestore.rules
// enforce the same contract (this UI only mirrors it).

import { useEffect, useMemo, useState } from 'react';

// Firestore: read users, update single roles, create a new admin doc, and run
// the atomic ownership transfer.
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

// Auth: create a new admin's login (and remove an orphan account on failure).
import { createUserWithEmailAndPassword, deleteUser } from 'firebase/auth';

// Tear down the throwaway secondary app used to create the account.
import { deleteApp } from 'firebase/app';

// db for queries, auth to know which user (the owner) is signed in, and a
// secondary auth app so creating an account doesn't sign the owner out.
import { db, auth, createSecondaryAuth } from '../../firebase';

// Phone validator for the new-admin form.
import { isValidIsraeliPhone } from '../../utils/validators';

// Reuse the shared management-screen styling + this screen's own styles.
import '../shared/ManagementScreen.css';
import './AdminsManagement.css';


// Turn a Firestore user document into a plain object that keeps its id.
const toRecord = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });


// Best display name for a user document, with graceful fallbacks.
function userName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.name || user.email || 'משתמש ללא שם';
}


export default function AdminsManagement() {
  // Every user document (we derive owner / admins / candidates from this).
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // True while a write is in flight, to block double-clicks.
  const [busy, setBusy] = useState(false);

  // The user chosen in the "promote existing user" dropdown.
  const [selectedToPromote, setSelectedToPromote] = useState('');

  // Fields for creating a brand-new admin account from scratch.
  const [newAdmin, setNewAdmin] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [creating, setCreating] = useState(false);

  // The signed-in user's uid — used to tell "this is you" and to confirm the
  // current owner before a transfer.
  const myUid = auth.currentUser?.uid || '';

  // (Re)load the users collection.
  const load = async () => {
    setLoading(true);

    try {
      const snapshot = await getDocs(collection(db, 'users'));
      setUsers(snapshot.docs.map(toRecord));
    } catch (error) {
      console.error('שגיאה בטעינת משתמשים:', error);
      alert('לא ניתן לטעון את רשימת המשתמשים.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // The single owner (or null until one is designated).
  const owner = useMemo(
    () => users.find((user) => user.role === 'owner') || null,
    [users],
  );

  // The current admins, sorted by name.
  const admins = useMemo(
    () => users
      .filter((user) => user.role === 'admin')
      .sort((a, b) => userName(a).localeCompare(userName(b), 'he')),
    [users],
  );

  // Users that can be promoted: active accounts that aren't already privileged.
  const candidates = useMemo(
    () => users
      .filter((user) => user.role !== 'admin' && user.role !== 'owner' && user.disabled !== true)
      .sort((a, b) => userName(a).localeCompare(userName(b), 'he')),
    [users],
  );

  // True only when the signed-in user really is the current owner.
  const iAmOwner = Boolean(owner) && owner.id === myUid;

  // Promote the chosen user to admin.
  const promoteToAdmin = async () => {
    if (!selectedToPromote || busy) {
      return;
    }

    const target = users.find((user) => user.id === selectedToPromote);
    if (!target) {
      return;
    }

    if (!window.confirm(`להפוך את ${userName(target)} לאדמין?`)) {
      return;
    }

    setBusy(true);

    try {
      await updateDoc(doc(db, 'users', target.id), { role: 'admin' });
      setSelectedToPromote('');
      await load();
      alert(`${userName(target)} הוא/היא עכשיו אדמין.`);
    } catch (error) {
      console.error('שגיאה בהוספת אדמין:', error);
      alert(`הפעולה נכשלה: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Create a BRAND-NEW admin account from filled-in details (email + password +
  // profile). Validates every field, then creates the login in a throwaway
  // secondary app so the owner stays signed in, and writes the users/{uid}
  // document (role: 'admin') as the owner.
  const createAdmin = async (event) => {
    event.preventDefault();
    if (creating) {
      return;
    }

    const firstName = newAdmin.firstName.trim();
    const lastName = newAdmin.lastName.trim();
    const email = newAdmin.email.trim();
    const phone = newAdmin.phone.trim();
    const password = newAdmin.password;

    // Every field is required and must be valid.
    if (!firstName || !lastName) {
      alert('יש למלא שם פרטי ושם משפחה.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('יש להזין כתובת אימייל תקינה.');
      return;
    }
    if (!isValidIsraeliPhone(phone)) {
      alert('יש להזין מספר טלפון ישראלי תקין (לדוגמה: 052-1234567).');
      return;
    }
    if (password.length < 6) {
      alert('הסיסמה חייבת להכיל לפחות 6 תווים.');
      return;
    }

    setCreating(true);

    // Declared out here so the finally block can always tear the app down.
    let secondaryApp = null;
    // The just-created Auth user — removed if the Firestore write then fails, so
    // a failed attempt never leaves an orphan login behind.
    let createdUser = null;

    try {
      const secondary = createSecondaryAuth('OwnerCreateAdminApp');
      secondaryApp = secondary.secondaryApp;
      const secondaryAuth = secondary.secondaryAuth;

      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      createdUser = credential.user;

      // Written as the OWNER (the primary db) — the rules allow the owner to
      // create an admin document. The password itself is never stored here;
      // Firebase Authentication keeps it hashed.
      await setDoc(doc(db, 'users', createdUser.uid), {
        firstName,
        lastName,
        email,
        phone,
        role: 'admin',
      });

      setNewAdmin({ firstName: '', lastName: '', email: '', phone: '', password: '' });
      await load();
      alert(`האדמין ${firstName} ${lastName} נוצר בהצלחה.`);
    } catch (error) {
      // Remove the orphan auth account if the profile write failed.
      if (createdUser) {
        try {
          await deleteUser(createdUser);
        } catch (cleanupError) {
          console.error('ניקוי חשבון יתום נכשל:', cleanupError);
        }
      }
      console.error('שגיאה ביצירת אדמין:', error);
      alert(`היצירה נכשלה: ${error.message}`);
    } finally {
      // Always tear down the secondary app (after any orphan cleanup above).
      if (secondaryApp) {
        await deleteApp(secondaryApp);
      }
      setCreating(false);
    }
  };

  // Remove an admin: demote them back to a plain viewer.
  const removeAdmin = async (admin) => {
    if (busy) {
      return;
    }

    if (!window.confirm(`להסיר את הרשאת האדמין מ-${userName(admin)}? התפקיד יורד ל"צופה".`)) {
      return;
    }

    setBusy(true);

    try {
      await updateDoc(doc(db, 'users', admin.id), { role: 'viewer' });
      await load();
    } catch (error) {
      console.error('שגיאה בהסרת אדמין:', error);
      alert(`הפעולה נכשלה: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Hand ownership to an admin. Atomic: the current owner becomes an admin and
  // the target becomes the owner in ONE batch, so there's never two owners.
  const transferOwnership = async (admin) => {
    if (busy || !iAmOwner) {
      return;
    }

    const confirmText =
      `להעביר את הבעלות ל-${userName(admin)}?\n\n` +
      `אתה תהפוך לאדמין רגיל, ו-${userName(admin)} יהפוך/תהפוך ל-Owner.\n` +
      `תמיד יש בעלים אחד בלבד. הפעולה תיכנס לתוקף מיד.`;

    if (!window.confirm(confirmText)) {
      return;
    }

    setBusy(true);

    try {
      const batch = writeBatch(db);
      // Demote the current owner (me) -> admin, and promote the target -> owner.
      batch.update(doc(db, 'users', owner.id), { role: 'admin' });
      batch.update(doc(db, 'users', admin.id), { role: 'owner' });
      await batch.commit();

      alert(`הבעלות הועברה ל-${userName(admin)}. המסך ייטען מחדש.`);

      // I'm no longer the owner — reload so the app re-reads my (now admin) role.
      window.location.reload();
    } catch (error) {
      console.error('שגיאה בהעברת בעלות:', error);
      alert(`העברת הבעלות נכשלה: ${error.message}`);
      setBusy(false);
    }
  };

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{admins.length}</span>
            <small>אדמינים</small>
          </div>
        </header>

        {loading ? (
          <section className="mgmt-section">
            <div className="mgmt-loading">טוען משתמשים...</div>
          </section>
        ) : (
          <>
            {/* The single owner. */}
            <section className="mgmt-section">
              <div className="mgmt-list-header">
                <h2>בעל המערכת (Owner)</h2>
              </div>

              {owner ? (
                <div className="adm-owner-card">
                  <span className="adm-owner-name">{userName(owner)}</span>
                  <span className="adm-owner-email" dir="ltr">{owner.email}</span>
                  {owner.id === myUid && <span className="mgmt-badge">זה אתה</span>}
                </div>
              ) : (
                <div className="mgmt-empty">
                  עדיין לא הוגדר Owner. כדי להתחיל, הגדירו תפקיד "owner" למשתמש אחד ב-Firebase Console.
                </div>
              )}
            </section>

            {/* Add an admin. */}
            <section className="mgmt-section">
              <div className="mgmt-list-header">
                <h2>קידום משתמש קיים לאדמין</h2>
              </div>

              <div className="adm-add-row">
                <select
                  className="adm-select"
                  value={selectedToPromote}
                  onChange={(event) => setSelectedToPromote(event.target.value)}
                  disabled={busy || !iAmOwner}
                >
                  <option value="">בחרו משתמש להפיכה לאדמין…</option>
                  {candidates.map((user) => (
                    <option key={user.id} value={user.id}>
                      {userName(user)} — {user.email}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="mgmt-primary-btn"
                  onClick={promoteToAdmin}
                  disabled={busy || !iAmOwner || !selectedToPromote}
                >
                  הפוך לאדמין
                </button>
              </div>

              {candidates.length === 0 && (
                <p className="mgmt-subtitle-inline">אין משתמשים זמינים לקידום כרגע.</p>
              )}
            </section>

            {/* Create a brand-new admin account from filled-in details. */}
            <section className="mgmt-section">
              <div className="mgmt-list-header">
                <h2>יצירת אדמין חדש</h2>
              </div>

              <form className="adm-create-form" onSubmit={createAdmin}>
                <div className="adm-create-grid">
                  <div className="adm-field">
                    <label>שם פרטי</label>
                    <input
                      className="adm-input"
                      value={newAdmin.firstName}
                      onChange={(event) => setNewAdmin({ ...newAdmin, firstName: event.target.value })}
                    />
                  </div>

                  <div className="adm-field">
                    <label>שם משפחה</label>
                    <input
                      className="adm-input"
                      value={newAdmin.lastName}
                      onChange={(event) => setNewAdmin({ ...newAdmin, lastName: event.target.value })}
                    />
                  </div>

                  <div className="adm-field adm-field--wide">
                    <label>אימייל (לכניסה למערכת)</label>
                    <input
                      className="adm-input"
                      type="email"
                      dir="ltr"
                      value={newAdmin.email}
                      onChange={(event) => setNewAdmin({ ...newAdmin, email: event.target.value })}
                    />
                  </div>

                  <div className="adm-field">
                    <label>טלפון</label>
                    <input
                      className="adm-input"
                      type="tel"
                      dir="ltr"
                      placeholder="050-0000000"
                      value={newAdmin.phone}
                      onChange={(event) => setNewAdmin({ ...newAdmin, phone: event.target.value })}
                    />
                  </div>

                  <div className="adm-field">
                    <label>סיסמה (לפחות 6 תווים)</label>
                    <input
                      className="adm-input"
                      type="password"
                      dir="ltr"
                      value={newAdmin.password}
                      onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })}
                    />
                  </div>
                </div>

                <div className="adm-create-actions">
                  <button type="submit" className="mgmt-primary-btn" disabled={creating || !iAmOwner}>
                    {creating ? 'יוצר...' : 'צור אדמין'}
                  </button>
                </div>
              </form>
            </section>

            {/* The admins, each with remove + transfer-ownership actions. */}
            <section className="mgmt-section">
              <div className="mgmt-list-header">
                <h2>מנהלים</h2>
              </div>

              {admins.length === 0 ? (
                <div className="mgmt-empty">אין אדמינים כרגע.</div>
              ) : (
                <div className="adm-list">
                  {admins.map((admin) => (
                    <div className="adm-row" key={admin.id}>
                      <div className="adm-row-info">
                        <span className="adm-row-name">
                          {userName(admin)}{admin.id === myUid ? ' (אתה)' : ''}
                        </span>
                        <span className="adm-row-email" dir="ltr">{admin.email}</span>
                      </div>

                      <div className="adm-row-actions">
                        {/* Only the current owner can hand off ownership. */}
                        <button
                          type="button"
                          className="mgmt-secondary-btn"
                          onClick={() => transferOwnership(admin)}
                          disabled={busy || !iAmOwner}
                          title={iAmOwner ? '' : 'רק ה-Owner הנוכחי יכול להעביר בעלות'}
                        >
                          העבר בעלות
                        </button>

                        <button
                          type="button"
                          className="mgmt-danger-btn"
                          onClick={() => removeAdmin(admin)}
                          disabled={busy || !iAmOwner}
                        >
                          הסר הרשאת אדמין
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
