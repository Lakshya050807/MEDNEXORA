import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SiteHeader from '../../src/components/SiteHeader.jsx';

vi.mock('../../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'anonymous', user: null, logout: vi.fn() }) }));
vi.mock('../../src/context/CartContext.jsx', () => ({ useCart: () => ({ count: 0 }) }));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => <span aria-hidden="true" /> }));

describe('site navigation', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('sends Home and Mock Tests back to the homepage sections from a detail page', () => {
    window.history.replaceState({}, '', '/products/example-resource');
    render(<SiteHeader />);

    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Mock tests' }).getAttribute('href')).toBe('/#mock-tests');
  });

  it('keeps the compact navigation usable through its accessible menu button', () => {
    render(<SiteHeader />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });

    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('navigation', { name: 'Main navigation' }).className).toContain('is-open');
    const studyMaterialsLink = screen.getByRole('link', { name: 'Study materials' });
    studyMaterialsLink.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(studyMaterialsLink);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
