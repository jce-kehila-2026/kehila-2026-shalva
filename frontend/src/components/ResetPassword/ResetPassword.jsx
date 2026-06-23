// ResetPassword — a custom, Hebrew, styled handler for Firebase's password-reset
// links. Firebase's built-in reset page is English and plain; pointing Firebase's
// "action URL" at the app (so the link arrives as ?mode=resetPassword&oobCode=...)
// lets us handle it ourselves: verify the code, let the user pick a new password,
// and confirm it — all in Hebrew and matching the app's design.

// React hooks for state and the initial code check.
import { useEffect, useRef, useState } from 'react';

// Firebase helpers: validate the reset code and set the new password.
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';

// Our Firebase auth instance.
import { auth } from '../../firebase';

// Styles for this screen.
import './ResetPassword.css';


// Friendly Hebrew messages for the common Firebase error codes.
const ERROR_MESSAGES = {
  'auth/expired-action-code': 'הקישור לאיפוס הסיסמה פג תוקף. בקשו קישור חדש.',
  'auth/invalid-action-code': 'הקישור לאיפוס הסיסמה אינו תקין או שכבר נוצל.',
  'auth/weak-password': 'הסיסמה חלשה מדי. בחרו לפחות 6 תווים.',
};


// `oobCode` is Firebase's one-time reset code from the link; `onDone` returns to
// the normal app once finished.
function ResetPassword({ oobCode, onDone }) {
  const isMountedRef = useRef(true);

  // The email the reset code belongs to (shown to the user once verified).
  const [email, setEmail] = useState('');

  // The new password + its confirmation.
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Flow flags: verifying the link, whether it's valid, saving, and finished.
  const [verifying, setVerifying] = useState(true);
  const [validCode, setValidCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // The current error message (empty when none).
  const [error, setError] = useState('');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // On mount, verify the reset code and fetch the email it belongs to.
  useEffect(() => {
    let isActive = true;

    const verifyCode = async () => {
      setVerifying(true);
      setValidCode(false);
      setEmail('');
      setError('');

      try {
        // Throws if the code is invalid / expired; otherwise returns the email.
        const resolvedEmail = await verifyPasswordResetCode(auth, oobCode);
        if (!isActive || !isMountedRef.current) {
          return;
        }
        setEmail(resolvedEmail);
        setValidCode(true);
      } catch (err) {
        if (!isActive || !isMountedRef.current) {
          return;
        }
        // Show a friendly message for the returned error code.
        console.error('Invalid reset code:', err.code);
        setError(ERROR_MESSAGES[err.code] || 'הקישור לאיפוס הסיסמה אינו תקין.');
      } finally {
        if (isActive && isMountedRef.current) {
          setVerifying(false);
        }
      }
    };

    verifyCode();

    return () => {
      isActive = false;
    };
  }, [oobCode]);

  // Save the new password.
  const handleSubmit = async (event) => {
    // Don't let the form reload the page.
    event.preventDefault();

    // The two password fields must match.
    if (password !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.');
      return;
    }

    // Reset to the saving state.
    setError('');
    setSaving(true);

    try {
      // Apply the new password for this reset code.
      await confirmPasswordReset(auth, oobCode, password);
      if (!isMountedRef.current) {
        return;
      }
      setDone(true);
    } catch (err) {
      if (!isMountedRef.current) {
        return;
      }
      // Show a friendly message for the returned error code.
      console.error('Reset failed:', err.code);
      setError(ERROR_MESSAGES[err.code] || 'איפוס הסיסמה נכשל. נסו שוב.');
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  return (
    <div className="reset-wrap" dir="rtl">
      <div className="reset-card">

        {/* Shalva logo. */}
        <img
          src="https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png"
          alt="שלוה"
          className="reset-logo"
        />

        {/* Title. */}
        <h1 className="reset-title">איפוס סיסמה</h1>

        {/* 1) While verifying the link. */}
        {verifying && (
          <p className="reset-status">בודק את הקישור...</p>
        )}

        {/* 2) Invalid / expired link. */}
        {!verifying && !validCode && (
          <>
            <div className="reset-error" role="alert">{error}</div>
            <button type="button" className="reset-submit" onClick={onDone}>
              חזרה לדף הבית
            </button>
          </>
        )}

        {/* 3) Success — the password was changed. */}
        {done && (
          <>
            <div className="reset-notice" role="status">הסיסמה עודכנה בהצלחה! אפשר להתחבר עכשיו.</div>
            <button type="button" className="reset-submit" onClick={onDone}>
              מעבר לכניסה
            </button>
          </>
        )}

        {/* 4) The reset form (valid link, not finished yet). */}
        {!verifying && validCode && !done && (
          <form onSubmit={handleSubmit}>

            {/* Which account this resets. */}
            <p className="reset-subtitle">
              עבור החשבון: <strong dir="ltr">{email}</strong>
            </p>

            {/* New password. */}
            <div className="reset-field">
              <label htmlFor="reset-password">סיסמה חדשה</label>
              <input
                id="reset-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="לפחות 6 תווים"
                autoComplete="new-password"
                required
              />
            </div>

            {/* Confirm password. */}
            <div className="reset-field">
              <label htmlFor="reset-confirm">אימות סיסמה</label>
              <input
                id="reset-confirm"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="הקלידו שוב את הסיסמה"
                autoComplete="new-password"
                required
              />
            </div>

            {/* Error message (only when there is one). */}
            {error && <div className="reset-error" role="alert">{error}</div>}

            {/* Submit (shows a label while saving). */}
            <button type="submit" className="reset-submit" disabled={saving}>
              {saving ? 'שומר...' : 'שמירת סיסמה חדשה'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default ResetPassword;
