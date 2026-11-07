import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AdminOrderPanel from '../../src/components/admin/AdminOrderPanel.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: { list: vi.fn(), create: vi.fn() },
  formatRupees: (value) => `₹${(value / 100).toFixed(2)}`,
}));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));

const partialOrder = {
  id: '507f1f77bcf86cd799439099',
  student: { name: 'Test Student', email: 'student@example.com' },
  items: [{ title: 'Biology notes', unitPricePaise: 12000, quantity: 1 }],
  amountPaise: 12000,
  totalRefundedPaise: 3000,
  remainingCapturedPaise: 9000,
  status: 'partially_refunded',
  paymentProvider: 'razorpay',
  paymentVerifiedAt: '2026-10-06T00:00:00.000Z',
  refundReviewStatus: 'pending',
  entitlementStatus: 'active',
  refunds: [{ refundId: 'rfnd_test_admin_review', amountPaise: 3000, status: 'processed', reconciliationStatus: 'verified' }],
};

describe('admin refund reconciliation panel', () => {
  beforeEach(() => {
    adminApi.list.mockReset().mockResolvedValue({ items: [partialOrder], pagination: { page: 1, pages: 1, total: 1 } });
    adminApi.create.mockReset().mockResolvedValue({ decision: 'revoke-access' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the refund reconciliation details and submits an explicit access decision', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminOrderPanel />);

    expect(await screen.findByText('partially refunded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Original payment: ₹120.00')).toBeTruthy();
    expect(screen.getByText('Total refunded: ₹30.00')).toBeTruthy();
    expect(screen.getByText('Remaining captured amount: ₹90.00')).toBeTruthy();
    expect(screen.getByText('Entitlement status:')).toBeTruthy();
    expect(screen.getByText('rfnd_test_admin_review')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await vi.waitFor(() => expect(adminApi.create).toHaveBeenCalledWith(
      `orders/${partialOrder.id}/refund-review`, { decision: 'revoke-access' },
    ));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
