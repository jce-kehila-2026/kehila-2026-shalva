// React state hook.
import { useState } from 'react';

// Firebase email/password sign-in + password-reset email.
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';

// Our Firebase auth instance.
import { auth } from '../../firebase';

// Styles for this screen.
import './Login.css';


// Firebase error codes mapped to friendly Hebrew messages.
const ERROR_MESSAGES = {
  'auth/invalid-email': 'כתובת האימייל אינה תקינה.',
  'auth/user-disabled': 'המשתמש חסום. פנו למנהל המערכת.',
  'auth/user-not-found': 'לא נמצא משתמש עם פרטים אלו.',
  'auth/wrong-password': 'הסיסמה שגויה.',
  'auth/invalid-credential': 'אימייל או סיסמה שגויים.',
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.',
};


const Login = () => {
  // The email and password fields.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // The current error message (empty when none).
  const [error, setError] = useState('');

  // A success/info notice (e.g. after sending a reset email).
  const [notice, setNotice] = useState('');

  // True while the sign-in request is in flight.
  const [loading, setLoading] = useState(false);

  // Attempt to sign in with the entered credentials.
  const handleSubmit = async (event) => {
    // Don't let the form reload the page.
    event.preventDefault();

    // Reset to the loading state (clear any previous messages).
    setError('');
    setNotice('');
    setLoading(true);

    try {
      // On success, the auth listener in App handles the redirect.
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      // Show a friendly message for the returned error code.
      console.error('Error logging in:', err.code, err.message);
      setError(ERROR_MESSAGES[err.code] || 'ההתחברות נכשלה. נסו שוב.');
    } finally {
      // Always clear the loading state.
      setLoading(false);
    }
  };

  // Email a password-reset link to the address in the email field.
  const handleForgotPassword = async () => {
    // We need an email address to send the reset link to.
    if (!email.trim()) {
      setNotice('');
      setError('יש להזין כתובת אימייל כדי לאפס סיסמה.');
      return;
    }

    try {
      // Ask Firebase to send the reset email.
      await sendPasswordResetEmail(auth, email.trim());
      setError('');
      setNotice('שלחנו קישור לאיפוס סיסמה לאימייל שלך. בדקו גם בתיבת ה"ספאם".');
    } catch (err) {
      // Show a friendly message for the returned error code.
      console.error('Error sending reset email:', err.code, err.message);
      setNotice('');
      setError(ERROR_MESSAGES[err.code] || 'שליחת איפוס הסיסמה נכשלה. נסו שוב.');
    }
  };

  return (
    <div className="login-form" dir="rtl">

      {/* Title. */}
      <h2>כניסה למערכת</h2>

      <form onSubmit={handleSubmit}>

        {/* Email field. */}
        <div className="login-field">
          <label htmlFor="email">אימייל</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            required
          />
        </div>

        {/* Password field. */}
        <div className="login-field">
          <label htmlFor="password">סיסמה</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="הזינו סיסמה"
            autoComplete="current-password"
            required
          />
        </div>

        {/* Forgot-password link: emails a reset link to the address above. */}
        <button type="button" className="login-forgot" onClick={handleForgotPassword}>
          שכחתי סיסמה
        </button>

        {/* Success / info notice (e.g. reset email sent). */}
        {notice && <div className="login-notice" role="status">{notice}</div>}

        {/* Error message (only when there is one). */}
        {error && <div className="login-error" role="alert">{error}</div>}

        {/* Submit button (shows a spinner label while loading). */}
        <button type="submit" className="login-submit" disabled={loading}>
          {loading ? 'מתחבר...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
};

export default Login;
