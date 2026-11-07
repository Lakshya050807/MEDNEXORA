export function publishedExamFilter(extra = {}) {
  return { publicationStatus: 'published', ...extra };
}
