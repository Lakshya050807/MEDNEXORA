import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../services/adminApi.js';

function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export default function AdminRegistrationInvitationPanel() {
  const [email, setEmail] = useState('');
  const [invitations, setInvitations] = useState([]);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.listStagingRegistrationInvitations();
      setInvitations(result.invitations ?? []);
      setUnavailable(false);
    } catch (error) {
      setInvitations([]);
      setUnavailable(error.status === 404);
      if (error.status !== 404) setMessage({ kind: 'error', text: error.message || 'Could not load invitation records.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadInvitations(); }, [loadInvitations]);

  const issue = async (event) => {
    event.preventDefault();
    setMessage(null);
    setToken('');
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage({ kind: 'error', text: 'Enter the invited student’s email address.' });
      return;
    }
    setSubmitting(true);
    try {
      const result = await adminApi.issueStagingRegistrationInvitation(normalizedEmail);
      setToken(result.token || '');
      setEmail('');
      setMessage({ kind: 'success', text: `Invitation created for ${result.invitation?.email || normalizedEmail}. Copy the code now; it is shown only once.` });
      await loadInvitations();
    } catch (error) {
      setMessage({ kind: 'error', text: error.message || 'The invitation could not be created.' });
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (invitation) => {
    if (!window.confirm(`Revoke the unused invitation for ${invitation.email}?`)) return;
    setMessage(null);
    try {
      await adminApi.revokeStagingRegistrationInvitation(invitation.id);
      setMessage({ kind: 'success', text: 'Unused invitation revoked.' });
      await loadInvitations();
    } catch (error) {
      setMessage({ kind: 'error', text: error.message || 'The invitation could not be revoked.' });
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setMessage({ kind: 'success', text: 'Invitation code copied. Share it only with the invited student through a private channel.' });
    } catch {
      setMessage({ kind: 'error', text: 'Copy is unavailable. Select and copy the displayed code manually.' });
    }
  };

  return (
    <article className="admin-settings-card admin-registration-invitations" aria-labelledby="staging-invitations-title">
      <p className="eyebrow">RESTRICTED STAGING TESTING</p>
      <h3 id="staging-invitations-title">Student registration invitations</h3>
      <p className="admin-settings-note">This control works only when the backend staging-only flag is enabled. It does not open public registration. Each invited student must still verify their email with a one-time code.</p>
      {message && <p className={`admin-message is-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      {token && (
        <div className="admin-invitation-token" aria-label="One-time invitation code">
          <p>Copy this code now. It will not be available again after you leave this screen.</p>
          <code>{token}</code>
          <button className="admin-secondary-button" type="button" onClick={copyToken}>Copy invitation code</button>
        </div>
      )}
      {unavailable ? (
        <p className="admin-settings-note" role="status">Restricted invitation management is unavailable in this environment.</p>
      ) : (
        <>
          <form className="admin-resource-form" onSubmit={issue} noValidate>
            <label className="admin-field" htmlFor="staging-invitation-email"><span>Invited student email</span><input id="staging-invitation-email" type="email" autoComplete="off" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <div className="admin-form-actions"><button className="admin-primary-button" type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Issue invitation'}</button><button className="admin-secondary-button" type="button" onClick={() => void loadInvitations()} disabled={loading}>Refresh list</button></div>
          </form>
          <div className="admin-invitation-list" aria-live="polite">
            <h4>Recent invitation records</h4>
            {loading ? <p className="admin-settings-note">Loading invitation records…</p>
              : invitations.length === 0 ? <p className="admin-settings-note">No invitation records are available.</p>
                : invitations.map((invitation) => (
                  <div className="admin-invitation-row" key={invitation.id}>
                    <div><strong>{invitation.email}</strong><span>{invitation.status} · expires {displayDate(invitation.expiresAt)}</span></div>
                    {invitation.status === 'active' && <button className="admin-secondary-button" type="button" onClick={() => void revoke(invitation)}>Revoke</button>}
                  </div>
                ))}
          </div>
        </>
      )}
    </article>
  );
}
