import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminRegistrationInvitationPanel from '../../src/components/admin/AdminRegistrationInvitationPanel.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: {
    listStagingRegistrationInvitations: vi.fn(),
    issueStagingRegistrationInvitation: vi.fn(),
    revokeStagingRegistrationInvitation: vi.fn(),
  },
}));

describe('restricted staging registration invitation admin UI', () => {
  beforeEach(() => {
    adminApi.listStagingRegistrationInvitations.mockReset().mockResolvedValue({ invitations: [] });
    adminApi.issueStagingRegistrationInvitation.mockReset();
    adminApi.revokeStagingRegistrationInvitation.mockReset();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('creates an email-bound invitation and shows the returned token once', async () => {
    const token = 'B'.repeat(43);
    adminApi.issueStagingRegistrationInvitation.mockResolvedValue({
      token,
      invitation: { id: 'invite-1', email: 'student@example.test', expiresAt: '2026-11-19T10:00:00Z' },
    });
    render(<AdminRegistrationInvitationPanel />);
    fireEvent.change(await screen.findByLabelText('Invited student email'), { target: { value: ' Student@Example.Test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue invitation' }));
    expect(await screen.findByText(token)).toBeTruthy();
    expect(adminApi.issueStagingRegistrationInvitation).toHaveBeenCalledWith('student@example.test');
    expect(screen.getByText(/does not open public registration/u)).toBeTruthy();
  });

  it('allows revoking an active invitation after explicit confirmation', async () => {
    adminApi.listStagingRegistrationInvitations
      .mockResolvedValueOnce({ invitations: [{ id: 'invite-2', email: 'student@example.test', status: 'active', expiresAt: '2026-11-19T10:00:00Z' }] })
      .mockResolvedValueOnce({ invitations: [] });
    adminApi.revokeStagingRegistrationInvitation.mockResolvedValue({ message: 'Unused invitation revoked.' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminRegistrationInvitationPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(adminApi.revokeStagingRegistrationInvitation).toHaveBeenCalledWith('invite-2'));
    expect(await screen.findByText('No invitation records are available.')).toBeTruthy();
  });

  it('handles the feature being disabled without treating it as a successful empty list', async () => {
    adminApi.listStagingRegistrationInvitations.mockRejectedValue({ status: 404, message: 'Not found' });
    render(<AdminRegistrationInvitationPanel />);
    expect(await screen.findByText('Restricted invitation management is unavailable in this environment.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Issue invitation' })).toBeNull();
  });
});
