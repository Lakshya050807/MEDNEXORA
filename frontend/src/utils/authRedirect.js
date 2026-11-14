const exactPaths = new Set(['/student/dashboard', '/practice', '/mock-tests', '/practice/attempts', '/my-courses', '/cart', '/orders']);

export function postAuthenticationPath(search = window.location.search) {
  const next = new URLSearchParams(search).get('next');
  if (exactPaths.has(next)) return next;
  const safePatterns = [
    [/^\/orders\/([a-f\d]{24})$/iu, (id) => `/orders/${id}`],
    [/^\/courses\/([a-f\d]{24})\/learn$/iu, (id) => `/courses/${id}/learn`],
    [/^\/courses\/([a-f\d]{24})$/iu, (id) => `/courses/${id}`],
    [/^\/practice\/attempts\/([a-f\d]{24})$/iu, (id) => `/practice/attempts/${id}`],
  ];
  for (const [pattern, buildPath] of safePatterns) {
    const match = next?.match(pattern);
    if (match) return buildPath(match[1]);
  }
  return '/student/dashboard';
}
