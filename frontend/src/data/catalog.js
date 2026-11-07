export const categories = [
  {
    id: 'mock-tests',
    title: 'Mock tests',
    description: 'Timed practice resources mapped to a configured entrance exam.',
    icon: 'checklist',
    resourceTypes: ['mock-test'],
  },
  {
    id: 'previous-year-papers',
    title: 'Verified previous-year papers',
    description: 'Shown only with source and legal-availability verification.',
    icon: 'file',
    resourceTypes: ['previous-year-paper'],
  },
  {
    id: 'subject-material',
    title: 'Subject notes',
    description: 'Exam-specific notes organized by database-configured subjects and topics.',
    icon: 'book',
    resourceTypes: ['notes'],
  },
  {
    id: 'mcqs',
    title: 'Practice papers & MCQs',
    description: 'Original practice resources with answers and explanations when available.',
    icon: 'clipboard',
    resourceTypes: ['practice-paper'],
  },
  {
    id: 'courses',
    title: 'Video & crash courses',
    description: 'Recorded lessons and focused revision courses.',
    icon: 'play',
    resourceTypes: ['video-course', 'crash-course'],
  },
  {
    id: 'preparation-bundles',
    title: 'Preparation bundles',
    description: 'A configurable combination of notes, practice and lessons.',
    icon: 'bookmark',
    resourceTypes: ['bundle'],
  },
];

export const resourceTypes = [
  { id: 'notes', label: 'Notes' },
  { id: 'practice-paper', label: 'Practice papers & MCQs' },
  { id: 'previous-year-paper', label: 'Verified previous-year papers' },
  { id: 'mock-test', label: 'Mock tests' },
  { id: 'video-course', label: 'Recorded video courses' },
  { id: 'crash-course', label: 'Crash courses' },
  { id: 'bundle', label: 'Preparation bundles' },
];

export const materialCategories = [
  { id: 'chapter-notes', label: 'Chapter notes' },
  { id: 'revision-notes', label: 'Revision notes' },
  { id: 'important-questions', label: 'Important questions' },
  { id: 'previous-year-papers', label: 'Previous-year papers' },
  { id: 'formula-sheets', label: 'Formula sheets' },
  { id: 'practice-worksheets', label: 'Practice worksheets' },
  { id: 'reference-materials', label: 'Reference materials' },
];

export const sortOptions = [
  { id: 'newest', label: 'Newest first' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
];

export function formatPricePaise(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) return null;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) / 100);
}

export function normalizeProduct(product) {
  const money = (value) => value == null || value === '' ? null : Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const pricePaise = money(product.pricePaise);
  const discountPaise = money(product.discountPaise) ?? 0;
  const currentPricePaise = money(product.currentPricePaise) ?? (pricePaise === null ? null : pricePaise - discountPaise);
  const topics = (product.topics ?? []).map((topic) => typeof topic === 'string' ? topic : topic?.name).filter(Boolean);
  if (product.topic?.name && !topics.includes(product.topic.name)) topics.unshift(product.topic.name);
  return {
    ...product,
    id: product.id ?? product._id,
    type: product.resourceType,
    categoryLabel: product.paperLabel || materialCategories.find((category) => category.id === product.category)?.label || product.resourceTypeLabel || 'Study material',
    subjectName: product.subject?.name ?? '',
    chapterName: product.chapter?.name ?? '',
    examName: product.exam?.name ?? '',
    topicName: product.topic?.name ?? '',
    topics,
    outcomes: product.learningOutcomes ?? [],
    freePreview: product.preview ? { kind: 'sample-pages', ...product.preview } : null,
    duration: product.course?.durationMinutes
      ? `${product.course.durationMinutes} minutes`
      : product.durationMinutes ? `${product.durationMinutes} minutes` : '',
    pricePaise,
    discountPaise,
    currentPricePaise,
    price: currentPricePaise === null ? null : currentPricePaise / 100,
    originalPrice: pricePaise === null ? null : pricePaise / 100,
    isFree: currentPricePaise === 0,
    discountPercent: pricePaise > 0 ? Math.round((discountPaise / pricePaise) * 100) : 0,
    cover: product.thumbnailUrl ? '' : product.resourceType === 'video-course' || product.resourceType === 'crash-course' ? 'video' : product.resourceType.includes('paper') || product.resourceType === 'mock-test' ? 'papers' : 'foundations',
  };
}
