import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import RegisterPage from '../../src/pages/RegisterPage.jsx';
import CartPage from '../../src/pages/CartPage.jsx';
import { useAuth } from '../../src/context/AuthContext.jsx';
import { useCart } from '../../src/context/CartContext.jsx';
import { catalogApi } from '../../src/services/catalogApi.js';
import { launchApi } from '../../src/services/launchApi.js';

vi.mock('../../src/context/AuthContext.jsx', () => ({ useAuth: vi.fn() }));
vi.mock('../../src/context/CartContext.jsx', () => ({ useCart: vi.fn() }));
vi.mock('../../src/services/catalogApi.js', () => ({ catalogApi: { getProduct: vi.fn() } }));
vi.mock('../../src/services/launchApi.js', () => ({ launchApi: { getStatus: vi.fn() } }));
vi.mock('../../src/services/paymentApi.js', () => ({ paymentApi: { createCheckout: vi.fn() } }));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteFooter.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/ProductCover.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));

const product = {
  id: 'resource-1',
  title: 'Configured paid notes',
  description: 'A configured product.',
  currentPricePaise: 25000,
  pricePaise: 25000,
  discountPaise: 0,
  isFree: false,
};

describe('public launch controls', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: null, status: 'anonymous', register: vi.fn() });
    useCart.mockReturnValue({ items: [], removeProduct: vi.fn(), removeProducts: vi.fn() });
    catalogApi.getProduct.mockResolvedValue({ product });
    launchApi.getStatus.mockResolvedValue({ registrationEnabled: false, paidPurchasesEnabled: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('does not render registration fields while public registration is closed', async () => {
    render(<RegisterPage />);
    expect(await screen.findByRole('heading', { name: 'Registration is not available.' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/required public information and policies/i);
    expect(screen.queryByLabelText('Full name')).toBeNull();
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login');
  });

  it('fails closed when registration status cannot be loaded', async () => {
    launchApi.getStatus.mockRejectedValue(new Error('network unavailable'));
    render(<RegisterPage />);
    expect(await screen.findByRole('heading', { name: 'Registration is not available.' })).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    expect(screen.getByText(/could not verify registration availability/i)).toBeTruthy();
  });

  it('renders registration only after the server reports it open', async () => {
    launchApi.getStatus.mockResolvedValue({ registrationEnabled: true, paidPurchasesEnabled: false });
    render(<RegisterPage />);
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
  });

  it('keeps paid checkout disabled while policy readiness is closed', async () => {
    useAuth.mockReturnValue({ user: { name: 'Student', email: 'student@example.test' }, status: 'authenticated' });
    useCart.mockReturnValue({
      items: [{ productId: 'resource-1', quantity: 1 }],
      removeProduct: vi.fn(),
      removeProducts: vi.fn(),
    });
    render(<CartPage />);
    await waitFor(() => expect(screen.getByText('Configured paid notes')).toBeTruthy());
    expect(await screen.findByText(/paid purchases are not open yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Purchases unavailable/i }).disabled).toBe(true);
  });
});
