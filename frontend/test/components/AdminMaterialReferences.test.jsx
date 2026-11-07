import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminResourcePanel from '../../src/components/admin/AdminResourcePanel.jsx';
import { productFields } from '../../src/pages/AdminDashboardPage.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), uploadPdf: vi.fn() },
}));

const examId = '507f1f77bcf86cd799439101';
const secondExamId = '507f1f77bcf86cd799439102';
const physicsId = '507f1f77bcf86cd799439103';
const otherPhysicsId = '507f1f77bcf86cd799439104';
const options = {
  exams: [
    { _id: examId, name: 'Configured entrance examination' },
    { _id: secondExamId, name: 'Another configured examination' },
  ],
  subjects: [
    { _id: physicsId, name: 'Physics', exam: { _id: examId, name: 'Configured entrance examination' }, publicationStatus: 'draft' },
    { _id: otherPhysicsId, name: 'Physics', exam: { _id: secondExamId, name: 'Another configured examination' }, publicationStatus: 'draft' },
  ],
  chapters: [], topics: [], products: [], questionBanks: [], courses: [],
};

function renderMaterialEditor() {
  return render(<AdminResourcePanel
    resource="products"
    title="Study materials"
    description="Manage study material resources."
    fields={productFields}
    columns={[]}
    options={options}
    filters={[]}
  />);
}

function setField(field, value) {
  fireEvent.change(document.getElementById(`admin-field-products-${field}`), { target: { value } });
}

describe('admin study material examination and subject references', () => {
  beforeEach(() => {
    adminApi.list.mockReset().mockResolvedValue({ items: [], pagination: { page: 1, pages: 1, total: 0 } });
    adminApi.create.mockReset().mockResolvedValue({ product: { id: '507f1f77bcf86cd799439105' } });
  });

  afterEach(() => cleanup());

  it('submits the selected examination and matching draft Physics subject as MongoDB IDs', async () => {
    renderMaterialEditor();
    setField('exam', examId);
    const subjectSelect = screen.getByLabelText(/Subject \(not required for multi-subject courses\)/i);
    expect(Array.from(subjectSelect.options).map((option) => option.value)).toContain(physicsId);
    expect(Array.from(subjectSelect.options).map((option) => option.value)).not.toContain(otherPhysicsId);
    setField('subject', physicsId);
    setField('title', 'Draft Physics PDF notes');
    setField('slug', 'draft-physics-pdf-notes');
    setField('description', 'Draft material mapped to the selected exam and subject.');
    setField('format', 'PDF');
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() => expect(adminApi.create).toHaveBeenCalledTimes(1));
    const [resource, payload] = adminApi.create.mock.calls[0];
    expect(resource).toBe('products');
    expect(payload).toMatchObject({ exam: examId, subject: physicsId, resourceType: 'notes', publicationStatus: 'draft', format: 'PDF' });
    expect(Object.hasOwn(payload, 'paperClassification')).toBe(false);
    expect(payload.exam).toMatch(/^[a-f\d]{24}$/iu);
    expect(payload.subject).toMatch(/^[a-f\d]{24}$/iu);
  });

  it('offers only the verified previous-year enum and sends it when selected', async () => {
    renderMaterialEditor();
    setField('exam', examId);
    setField('subject', physicsId);
    setField('resourceType', 'previous-year-paper');
    const classification = document.getElementById('admin-field-products-paperClassification');
    expect(Array.from(classification.options).filter((option) => option.value).map((option) => option.value)).toEqual(['verified-previous-year']);
    setField('paperClassification', 'verified-previous-year');
    setField('title', 'Verified previous-year paper');
    setField('slug', 'verified-previous-year-paper');
    setField('description', 'A previous-year paper with its verification details recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() => expect(adminApi.create).toHaveBeenCalledTimes(1));
    const payload = adminApi.create.mock.calls[0][1];
    expect(payload.paperClassification).toBe('verified-previous-year');
    expect(payload.paperClassification).not.toBe('');
  });

  it('clears a previously selected subject when the examination changes', async () => {
    renderMaterialEditor();
    const examSelect = document.getElementById('admin-field-products-exam');
    const subjectSelect = document.getElementById('admin-field-products-subject');
    setField('exam', examId);
    setField('subject', physicsId);
    fireEvent.change(examSelect, { target: { value: secondExamId } });

    expect(subjectSelect.value).toBe('');
    expect(Array.from(subjectSelect.options).map((option) => option.value)).toContain(otherPhysicsId);
    expect(Array.from(subjectSelect.options).map((option) => option.value)).not.toContain(physicsId);
  });

  it('shows the safe backend validation message instead of replacing it with a generic error', async () => {
    adminApi.create.mockRejectedValueOnce(new Error('The selected subject was not found. Refresh the subject list and select an existing record.'));
    renderMaterialEditor();
    setField('exam', examId);
    setField('subject', physicsId);
    setField('title', 'Draft Physics PDF notes');
    setField('slug', 'draft-physics-pdf-notes');
    setField('description', 'Draft material description.');
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The selected subject was not found. Refresh the subject list and select an existing record.');
  });
});
