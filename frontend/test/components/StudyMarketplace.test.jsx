import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StudyMaterialPage from '../../src/pages/StudyMaterialPage.jsx';
import ProductDetailPage from '../../src/pages/ProductDetailPage.jsx';
import { catalogApi } from '../../src/services/catalogApi.js';
import { authApi } from '../../src/services/authApi.js';

vi.mock('../../src/services/catalogApi.js', () => ({
  catalogApi: { listProducts: vi.fn(), getProduct: vi.fn(), listExams: vi.fn(), listSubjects: vi.fn(), listChapters: vi.fn(), listTopics: vi.fn() },
}));
vi.mock('../../src/services/authApi.js', () => {
  class AuthApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  return { AuthApiError, authApi: { claimFreeMaterial: vi.fn() } };
});
vi.mock('../../src/context/CartContext.jsx', () => ({
  useCart: () => ({ addProduct: vi.fn(() => ({ reason: 'Added to your cart.' })), hasProduct: () => false }),
}));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => <div aria-label="MEDNEXORA navigation" /> }));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/BrandLink.jsx', () => ({ default: () => <span>MEDNEXORA</span> }));
vi.mock('../../src/components/ProductCard.jsx', () => ({ default: ({ product }) => <article>{product.title}</article> }));
vi.mock('../../src/components/ProductCover.jsx', () => ({ default: ({ product }) => <div aria-label={`${product.title} cover artwork`} /> }));

const freeMaterial = {
  id: 'free-biology-worksheet',
  title: 'Biology practice worksheet',
  description: 'A short description for a configured free practice worksheet.',
  detailedDescription: 'A longer administrator-authored description for students.',
  resourceType: 'practice-paper',
  resourceTypeLabel: 'Practice paper',
  categoryLabel: 'Practice worksheets',
  category: 'practice-worksheets',
  subject: { id: 'biology', name: 'Biology' },
  chapter: { id: 'chapter-1', name: 'Configured chapter' },
  exam: { id: 'exam-1', name: 'Configured entrance examination' },
  isFree: true,
  pricePaise: 0,
  currentPricePaise: 0,
  discountPaise: 0,
  format: 'PDF',
  language: 'Hindi',
  fileSizeBytes: 2048,
  freePreview: { title: 'Public excerpt', excerpt: 'Only this approved excerpt is visible before access.' },
  topics: [],
  outcomes: [],
};

describe('study material marketplace', () => {
  beforeEach(() => {
    catalogApi.listExams.mockResolvedValue([{ id: 'exam-1', name: 'Configured entrance examination' }]);
    catalogApi.listSubjects.mockResolvedValue([{ id: 'biology', name: 'Biology' }]);
    catalogApi.listChapters.mockResolvedValue([{ id: 'chapter-1', name: 'Configured chapter' }]);
    catalogApi.listTopics.mockResolvedValue([]);
    catalogApi.listProducts.mockResolvedValue({ items: [freeMaterial], pagination: { page: 1, pages: 1, total: 1 } });
    catalogApi.getProduct.mockResolvedValue({ product: freeMaterial });
    authApi.claimFreeMaterial.mockReset().mockResolvedValue({ access: { source: 'free' } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('combines category, search, price sorting and actual catalogue results', async () => {
    render(<StudyMaterialPage />);
    expect(await screen.findByText('Biology practice worksheet')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Material category'), { target: { value: 'practice-worksheets' } });
    fireEvent.change(screen.getByLabelText('Search titles, subjects and topics'), { target: { value: 'biology' } });
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'price-asc' } });

    await waitFor(() => expect(catalogApi.listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'practice-worksheets', q: 'biology', sort: 'price-asc' }),
      expect.anything(),
    ));
  });

  it('shows configured details and claims a free PDF through the authenticated library API', async () => {
    render(<ProductDetailPage productId={freeMaterial.id} />);
    expect(await screen.findByRole('heading', { name: freeMaterial.title })).toBeTruthy();
    expect(screen.getByText('A longer administrator-authored description for students.')).toBeTruthy();
    expect(screen.getByText('Hindi')).toBeTruthy();
    expect(screen.getByText('Configured chapter')).toBeTruthy();
    expect(screen.getByText('Only this approved excerpt is visible before access.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add to My Library' }));
    await waitFor(() => expect(authApi.claimFreeMaterial).toHaveBeenCalledWith(freeMaterial.id));
    expect(await screen.findByRole('link', { name: 'Open My Library' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Buy Now|Add to Cart|Checkout/i })).toBeNull();
  });
});
