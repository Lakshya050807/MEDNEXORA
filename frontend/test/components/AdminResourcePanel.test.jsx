import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminResourcePanel from '../../src/components/admin/AdminResourcePanel.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: {
    list: vi.fn(), overview: vi.fn(), profile: vi.fn(), login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(),
    create: vi.fn(), update: vi.fn(), remove: vi.fn(), uploadPdf: vi.fn(),
  },
  formatRupees: (value) => `₹${value}`,
}));

describe('Admin study material creation errors', () => {
  beforeEach(() => {
    adminApi.list.mockReset().mockResolvedValue({ items: [], pagination: { page: 1, pages: 1, total: 0 } });
    adminApi.create.mockReset();
  });
  afterEach(() => cleanup());

  it('shows the safe backend message for an unexpected database create failure', async () => {
    const message = 'Something went wrong. Please try again later.';
    adminApi.create.mockRejectedValueOnce(new Error(message));
    const fields = [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'URL slug', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: true },
    ];
    const { container } = render(<AdminResourcePanel resource="products" title="Study Materials" description="Manage resources." fields={fields} columns={[]} />);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Draft notes' } });
    fireEvent.change(screen.getByLabelText(/URL slug/), { target: { value: 'draft-notes' } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'A draft resource description.' } });
    fireEvent.submit(container.querySelector('form.admin-resource-form'));

    await waitFor(() => expect(adminApi.create).toHaveBeenCalledWith('products', expect.objectContaining({ slug: 'draft-notes' })));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(screen.queryByText(/MongoServerError|keyPattern|E11000/)).toBeNull();
  });
});
