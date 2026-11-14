import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AppRoutes from '../../src/routes/AppRoutes.jsx';
import { pageMetadataFor } from '../../src/utils/pageMetadata.js';

vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));

describe('public information and fallback routes', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('shows clearly marked owner-confirmation placeholders for policy pages', async () => {
    window.history.replaceState({}, '', '/refund-cancellation-policy');
    render(<AppRoutes />);

    expect(await screen.findByRole('heading', { name: 'Refund and cancellation policy' })).toBeTruthy();
    expect(screen.getByText('DRAFT — NOT APPROVED FOR PUBLIC USE')).toBeTruthy();
    expect(screen.getByText(/Draft placeholder/u)).toBeTruthy();
    expect(screen.getByText(/no refund period, eligibility rule or promise is stated here/u)).toBeTruthy();
  });

  it('does not present checklist prompts as finalized About, Contact, or FAQ answers', async () => {
    window.history.replaceState({}, '', '/about');
    const { unmount } = render(<AppRoutes />);
    expect(await screen.findByText('DRAFT — OWNER CONFIRMATION REQUIRED')).toBeTruthy();
    expect(screen.getByText(/The owner launch checklist does not yet include the business and service answers/i)).toBeTruthy();
    unmount();

    window.history.replaceState({}, '', '/contact');
    const contact = render(<AppRoutes />);
    expect(await screen.findByText(/does not contain a confirmed support contact/i)).toBeTruthy();
    contact.unmount();

    window.history.replaceState({}, '', '/faq');
    render(<AppRoutes />);
    expect(await screen.findByText(/no approved answers/i)).toBeTruthy();
    expect(screen.getByText(/Owner confirmation required: provide the actual registration requirements/i)).toBeTruthy();
  });

  it('marks all six owner-information pages as drafts that are not approved for public use', async () => {
    const paths = ['/about', '/contact', '/faq', '/privacy-policy', '/terms-and-conditions', '/refund-cancellation-policy'];
    for (const path of paths) {
      window.history.replaceState({}, '', path);
      const page = render(<AppRoutes />);
      expect(await screen.findByRole('note', { name: 'Page approval status' })).toBeTruthy();
      expect(screen.getByText('DRAFT — NOT APPROVED FOR PUBLIC USE')).toBeTruthy();
      expect(pageMetadataFor(path).robots).toBe('noindex, nofollow, noarchive');
      page.unmount();
    }
  });

  it('shows a real not-found page instead of silently returning the homepage', async () => {
    window.history.replaceState({}, '', '/this-route-does-not-exist');
    render(<AppRoutes />);

    expect(await screen.findByRole('heading', { name: 'This page isn’t here.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Go to homepage/u }).getAttribute('href')).toBe('/');
  });
});
