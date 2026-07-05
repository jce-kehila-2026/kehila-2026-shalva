// React hooks: state, a mount ref, and an effect to track mounting.
import { useEffect, useRef, useState } from 'react';

// Firebase email/password sign-in + password-reset email.
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';

// Our Firebase auth instance.
import { auth } from '../../firebase';

// Styles for this screen.
import './Login.css';


// One generic message for "bad credentials". We deliberately do NOT say whether
// the email or the password was wrong — revealing which one exists would let an
// attacker probe for valid accounts (this is called "email enumeration").
const INVALID_CREDENTIALS_MESSAGE = 'אימייל או סיסמה שגויים.';

// A deliberately vague reset notice: it never confirms whether the address has
// an account, for the same privacy reason as above.
const RESET_EMAIL_SENT_MESSAGE =
  'אם קיים חשבון עם האימייל הזה, יישלח אליו קישור לאיפוס סיסמה. בדקו גם בתיבת ה"ספאם".';

// Sign-in error codes → friendly Hebrew. "No user" and "wrong password" both map
// to the same generic message on purpose (see INVALID_CREDENTIALS_MESSAGE).
const SIGN_IN_ERROR_MESSAGES = {
  'auth/invalid-email': 'כתובת האימייל אינה תקינה.',
  'auth/user-disabled': 'המשתמש חסום. פנו למנהל המערכת.',
  'auth/user-not-found': INVALID_CREDENTIALS_MESSAGE,
  'auth/wrong-password': INVALID_CREDENTIALS_MESSAGE,
  'auth/invalid-credential': INVALID_CREDENTIALS_MESSAGE,
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.',
  'auth/network-request-failed': 'יש בעיית רשת. בדקו את החיבור לאינטרנט ונסו שוב.',
  'auth/invalid-api-key': 'שגיאת תצורת מערכת: מפתח API לא תקין. פנו למנהל המערכת.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'שגיאת תצורת מערכת: מפתח API חסום או לא תקין (בדקו הגבלות דומיין ב-GCP).',
};

// Password-reset error codes → friendly Hebrew. A smaller set of codes is
// relevant here than for sign-in, so it gets its own map.
const RESET_ERROR_MESSAGES = {
  'auth/invalid-email': 'כתובת האימייל אינה תקינה.',
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.',
  'auth/network-request-failed': 'יש בעיית רשת. בדקו את החיבור לאינטרנט ונסו שוב.',
  'auth/invalid-api-key': 'שגיאת תצורת מערכת: מפתח API לא תקין. פנו למנהל המערכת.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'שגיאת תצורת מערכת: מפתח API חסום או לא תקין (בדקו הגבלות דומיין ב-GCP).',
};


// Pick a friendly message for a Firebase error, falling back to a generic one.
const getAuthErrorMessage = (error, messages, fallbackMessage) =>
  messages[error?.code] || fallbackMessage;


const Login = () => {
  // Tracks whether the screen is still mounted. A successful sign-in makes App
  // swap this view away, so the async handlers below check this before updating
  // state — the same guard pattern we use in MainScreen.
  const isMountedRef = useRef(true);

  // The email and password fields.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // The current error message (empty when none).
  const [error, setError] = useState('');

  // A success/info notice (e.g. after sending a reset email).
  const [notice, setNotice] = useState('');

  // Separate "in flight" flags: signing in vs. sending a reset email.
  const [signInLoading, setSignInLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // True while EITHER auth request runs — used to lock both buttons so they
  // can't overlap or be double-clicked.
  const isBusy = signInLoading || resetLoading;

  // Point screen readers from the inputs to whichever feedback line is showing.
  // Undefined when there's nothing to describe, so React omits the attribute.
  const feedbackId = error || notice ? 'login-feedback' : undefined;

  // Keep the mount flag in sync. Re-arming it to true on every setup matters:
  // React Strict Mode runs an extra setup → cleanup → setup cycle in dev, so
  // without this line the cleanup would leave the flag false while we're still
  // on screen — and the async guards below would then wrongly skip their state
  // updates (leaving the button stuck on "מתחבר...").
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Attempt to sign in with the entered credentials.
  const handleSubmit = async (event) => {
    // Don't let the form reload the page.
    event.preventDefault();

    // Ignore the submit if another auth request is already running.
    if (isBusy) {
      return;
    }

    // Trim the email: mobile keyboards and autofill often tack on a trailing
    // space, which would otherwise fail as "wrong credentials" even though the
    // address looks correct. The PASSWORD is left as-is — a space can be a
    // legitimate character in it, so trimming it could lock a user out.
    const trimmedEmail = email.trim();

    // Enter the loading state (clear any previous messages).
    setError('');
    setNotice('');
    setSignInLoading(true);

    try {
      // On success, the auth listener in App handles the redirect.
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
    } catch (err) {
      console.error('Error logging in:', err.code, err.message);

      // The view may already be gone (a slow failure after navigating away).
      if (!isMountedRef.current) {
        return;
      }

      setError(getAuthErrorMessage(err, SIGN_IN_ERROR_MESSAGES, 'ההתחברות נכשלה. נסו שוב.'));
    } finally {
      // Clear the loading flag — unless the screen already unmounted on success.
      if (isMountedRef.current) {
        setSignInLoading(false);
      }
    }
  };

  // Email a password-reset link to the address in the email field.
  const handleForgotPassword = async () => {
    // Ignore the click if another auth request is already running.
    if (isBusy) {
      return;
    }

    // Trim for the same reason as in handleSubmit.
    const trimmedEmail = email.trim();

    // We need an email address to send the reset link to.
    if (!trimmedEmail) {
      setNotice('');
      setError('יש להזין כתובת אימייל כדי לאפס סיסמה.');
      return;
    }

    setError('');
    setNotice('');
    setResetLoading(true);

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);

      if (!isMountedRef.current) {
        return;
      }

      // Generic notice — see RESET_EMAIL_SENT_MESSAGE.
      setNotice(RESET_EMAIL_SENT_MESSAGE);
    } catch (err) {
      console.error('Error sending reset email:', err.code, err.message);

      if (!isMountedRef.current) {
        return;
      }

      // If email-enumeration protection is OFF, Firebase can still report
      // "user-not-found". We show the SAME generic notice so the UI never
      // reveals whether this address has an account.
      if (err?.code === 'auth/user-not-found') {
        setNotice(RESET_EMAIL_SENT_MESSAGE);
        return;
      }

      setError(getAuthErrorMessage(err, RESET_ERROR_MESSAGES, 'שליחת איפוס הסיסמה נכשלה. נסו שוב.'));
    } finally {
      if (isMountedRef.current) {
        setResetLoading(false);
      }
    }
  };

  return (
    <div className="login-form" dir="rtl">

      {/* Title — also names the form for assistive tech (aria-labelledby). */}
      <h2 id="login-title">כניסה למערכת</h2>

      {/* aria-busy tells assistive tech the form is mid-request. */}
      <form onSubmit={handleSubmit} aria-labelledby="login-title" aria-busy={isBusy}>

        {/* Email field. dir="ltr" because an email is Latin text inside an RTL
            screen — without it the caret and punctuation behave oddly. */}
        <div className="login-field">
          <label htmlFor="login-email">אימייל</label>
          <input
            type="email"
            id="login-email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck="false"
            inputMode="email"
            dir="ltr"
            aria-describedby={feedbackId}
            required
          />
        </div>

        {/* Password field. */}
        <div className="login-field">
          <label htmlFor="login-password">סיסמה</label>
          <input
            type="password"
            id="login-password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="הזינו סיסמה"
            autoComplete="current-password"
            aria-describedby={feedbackId}
            required
          />
        </div>

        {/* Forgot-password: emails a reset link to the address above. Locked
            (and shows progress) while either auth request is running. */}
        <button
          type="button"
          className="login-forgot"
          onClick={handleForgotPassword}
          disabled={isBusy}
        >
          {resetLoading ? 'שולח קישור...' : 'שכחתי סיסמה'}
        </button>

        {/* Success / info notice (e.g. reset email sent). Only one of notice /
            error is ever set, so #login-feedback is never duplicated. */}
        {notice && (
          <div id="login-feedback" className="login-notice" role="status">
            {notice}
          </div>
        )}

        {/* Error message (only when there is one). */}
        {error && (
          <div id="login-feedback" className="login-error" role="alert">
            {error}
          </div>
        )}

        {/* Submit (shows progress text while signing in). */}
        <button type="submit" className="login-submit" disabled={isBusy}>
          {signInLoading ? 'מתחבר...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
};

export default Login;
