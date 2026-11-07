import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AppRoutes from '../../src/routes/AppRoutes.jsx';

vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));

describe('public information and fallback routes', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('shows clearly marked owner-confirmation placeholders for policy pages', () => {
    window.history.replaceState({}, '', '/refund-cancellation-policy');
    render(<AppRoutes />);

    expect(screen.getByRole('heading', { name: 'Refund and cancellation policy' })).toBeTruthy();
    expect(screen.getByText(/Draft placeholder/u)).toBeTruthy();
    expect(screen.getByText(/no refund period, eligibility rule or promise is stated here/u)).toBeTruthy();
  });

  it('does not present checklist prompts as finalized About, Contact, or FAQ answers', () => {
    window.history.replaceState({}, '', '/about');
    const { unmount } = render(<AppRoutes />);
    expect(screen.getByText('OWNER CONFIRMATION REQUIRED')).toBeTruthy();
    expect(screen.getByText(/The owner launch checklist does not yet include the business and service answers/i)).toBeTruthy();
    unmount();

    window.history.replaceState({}, '', '/contact');
    const contact = render(<AppRoutes />);
    expect(screen.getByText(/does not contain a confirmed support contact/i)).toBeTruthy();
    contact.unmount();

    window.history.replaceState({}, '', '/faq');
    render(<AppRoutes />);
    expect(screen.getByText(/no approved answers/i)).toBeTruthy();
    expect(screen.getByText(/Owner confirmation required: provide the actual registration requirements/i)).toBeTruthy();
  });

  it('shows a real not-found page instead of silently returning the homepage', () => {
    window.history.replaceState({}, '', '/this-route-does-not-exist');
    render(<AppRoutes />);

    expect(screen.getByRole('heading', { name: 'This page isn’t here.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Go to homepage/u }).getAttribute('href')).toBe('/');
  });
});
