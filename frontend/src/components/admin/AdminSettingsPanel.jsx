import { useState } from 'react';
import Icon from '../Icon.jsx';
import { adminApi } from '../../services/adminApi.js';

export default function AdminSettingsPanel({ admin, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setMessage(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ kind: 'error', text: 'Enter all three password fields.' });
      return;
    }
    if (new TextEncoder().encode(newPassword).length > 72) {
      setMessage({ kind: 'error', text: 'Password must be no more than 72 UTF-8 bytes.' });
      return;
    }
    if (newPassword.length < 12) {
      setMessage({ kind: 'error', text: 'Password must be at least 12 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setSubmitting(true);
    try {
      const result = await adminApi.changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({ kind: 'success', text: result.message || 'Administrator password updated.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error.message || 'The password could not be changed.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="admin-resource-panel" aria-labelledby="admin-settings-title">
      <div className="admin-panel-heading"><div><h2 id="admin-settings-title">Settings</h2><p>Review your administrator profile, update your password, and end this admin session securely.</p></div></div>
      <div className="admin-settings-grid">
        <article className="admin-settings-card">
          <p className="eyebrow">ADMINISTRATOR PROFILE</p>
          <h3>{admin?.name || 'Administrator'}</h3>
          <dl><div><dt>Admin username</dt><dd>{admin?.username || 'Not configured for this legacy account'}</dd></div><div><dt>Email address</dt><dd>{admin?.email || '—'}</dd></div><div><dt>Access</dt><dd>Administrator</dd></div></dl>
          {!admin?.username && <p className="admin-settings-note">An administrator with no username can sign in using its email in the username field. Use the trusted server-side account setup process to assign a username.</p>}
        </article>
        <article className="admin-settings-card">
          <p className="eyebrow">SECURITY</p>
          <h3>Change password</h3>
          <p className="admin-settings-note">Passwords need at least 12 characters. Updating your password signs out other admin sessions.</p>
          <form className="admin-resource-form" onSubmit={submit} noValidate>
            <label className="admin-field" htmlFor="admin-current-password"><span>Current password</span><input id="admin-current-password" type="password" autoComplete="current-password" maxLength={72} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label className="admin-field" htmlFor="admin-new-password"><span>New password</span><input id="admin-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label className="admin-field" htmlFor="admin-confirm-password"><span>Confirm new password</span><input id="admin-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {message && <p className={`admin-message is-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
            <div className="admin-form-actions"><button className="admin-primary-button" type="submit" disabled={submitting}>{submitting ? 'Updating…' : 'Update password'}</button></div>
          </form>
        </article>
        <article className="admin-settings-card admin-settings-logout">
          <p className="eyebrow">SESSION</p><h3>Sign out of MEDNEXORA Admin</h3><p className="admin-settings-note">This ends the administrator session and clears its separate secure cookie.</p>
          <button className="admin-secondary-button" type="button" onClick={onLogout}><Icon name="lock" size={16} /> Secure logout</button>
        </article>
      </div>
    </section>
  );
}
