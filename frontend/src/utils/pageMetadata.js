const metadata = {
  '/': ['MEDNEXORA — Government Competitive Exam Preparation', 'Study materials, courses, MCQ practice and mock tests for Government Competitive Examinations.'],
  '/about': ['About MEDNEXORA — Owner Confirmation Required', 'Business identity, service description and educational-content details are awaiting owner confirmation.'],
  '/contact': ['Contact MEDNEXORA — Owner Confirmation Required', 'A monitored support contact and any public business address are awaiting owner confirmation.'],
  '/faq': ['Frequently Asked Questions — Owner Confirmation Required', 'Answers about registration, access, purchases, refunds and support are awaiting owner confirmation.'],
  '/privacy-policy': ['Privacy Policy — MEDNEXORA', 'Draft privacy policy page requiring owner confirmation before public launch.'],
  '/terms-and-conditions': ['Terms and Conditions — MEDNEXORA', 'Draft terms page requiring owner and legal review before public launch.'],
  '/refund-cancellation-policy': ['Refund and Cancellation Policy — MEDNEXORA', 'Draft refund and cancellation policy awaiting owner confirmation.'],
  '/login': ['Student Login — MEDNEXORA', 'Sign in to your MEDNEXORA student account.'],
  '/register': ['Create a Student Account — MEDNEXORA', 'Create a student account to use MEDNEXORA study and practice resources.'],
  '/admin/login': ['Admin Login — MEDNEXORA', 'Administrator access for the MEDNEXORA content workspace.'],
  '/admin': ['Admin Workspace — MEDNEXORA', 'Manage MEDNEXORA educational content and platform records.'],
  '/student/dashboard': ['Student Dashboard — MEDNEXORA', 'View your MEDNEXORA resources, courses and recorded practice activity.'],
  '/my-courses': ['My Courses — MEDNEXORA', 'Continue courses available to your MEDNEXORA student account.'],
  '/study-material': ['Study Materials — MEDNEXORA', 'Browse published study materials and practice resources for Government Competitive Examinations.'],
  '/target-exams': ['Target Examinations — MEDNEXORA', 'Browse published examination details and configured subject outlines.'],
  '/courses': ['Courses — MEDNEXORA', 'Explore published MEDNEXORA courses and preparation programmes.'],
  '/practice': ['Practice and Mock Tests — MEDNEXORA', 'Use published MCQ practice and mock tests available to your student account.'],
  '/cart': ['Your Cart — MEDNEXORA', 'Review study resources selected for checkout.'],
  '/orders': ['Order History — MEDNEXORA', 'Review purchase orders and payment status for your student account.'],
};

export function pageMetadataFor(pathname = '/') {
  const path = pathname.replace(/\/+$/u, '') || '/';
  if (metadata[path]) return { title: metadata[path][0], description: metadata[path][1], robots: isPrivatePath(path) || isUnconfirmedPage(path) ? 'noindex, nofollow, noarchive' : 'index, follow' };
  if (path.startsWith('/products/')) return { title: 'Study Material Details — MEDNEXORA', description: 'View the details and configured preview for a published MEDNEXORA study resource.', robots: 'index, follow' };
  if (path.startsWith('/courses/')) return { title: 'Course Details — MEDNEXORA', description: 'View available MEDNEXORA course information and access details.', robots: isPrivatePath(path) ? 'noindex, nofollow, noarchive' : 'index, follow' };
  if (path.startsWith('/practice/')) return { title: 'Practice Results — MEDNEXORA', description: 'View the practice attempt information available to your student account.', robots: 'noindex, nofollow, noarchive' };
  return { title: 'Page Not Found — MEDNEXORA', description: 'The requested MEDNEXORA page could not be found.', robots: 'noindex, nofollow, noarchive' };
}

function isPrivatePath(path) {
  return /^\/(?:admin|student|my-courses|orders|cart|practice)(?:\/|$)/u.test(path)
    || /^\/courses\/[^/]+\/learn$/u.test(path)
    || path === '/login' || path === '/register';
}

function isUnconfirmedPage(path) {
  return ['/about', '/contact', '/faq', '/privacy-policy', '/terms-and-conditions', '/refund-cancellation-policy'].includes(path);
}

function setMeta(documentRef, selector, attribute, key, value) {
  let element = documentRef.head.querySelector(selector);
  if (!element) {
    element = documentRef.createElement('meta');
    element.setAttribute(attribute, key);
    documentRef.head.appendChild(element);
  }
  element.setAttribute('content', value);
}

export function applyPageMetadata(documentRef, locationRef, pathname) {
  const page = pageMetadataFor(pathname);
  documentRef.title = page.title;
  setMeta(documentRef, 'meta[name="description"]', 'name', 'description', page.description);
  setMeta(documentRef, 'meta[name="robots"]', 'name', 'robots', page.robots);
  setMeta(documentRef, 'meta[property="og:site_name"]', 'property', 'og:site_name', 'MEDNEXORA');
  setMeta(documentRef, 'meta[property="og:type"]', 'property', 'og:type', 'website');
  setMeta(documentRef, 'meta[property="og:title"]', 'property', 'og:title', page.title);
  setMeta(documentRef, 'meta[property="og:description"]', 'property', 'og:description', page.description);
  setMeta(documentRef, 'meta[property="og:url"]', 'property', 'og:url', `${locationRef.origin}${pathname}`);
  setMeta(documentRef, 'meta[property="og:image"]', 'property', 'og:image', `${locationRef.origin}/mednexora-logo.png`);
  setMeta(documentRef, 'meta[property="og:image:alt"]', 'property', 'og:image:alt', 'MEDNEXORA emerald and gold logo');
  setMeta(documentRef, 'meta[name="twitter:card"]', 'name', 'twitter:card', 'summary');
  let canonical = documentRef.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = documentRef.createElement('link');
    canonical.rel = 'canonical';
    documentRef.head.appendChild(canonical);
  }
  canonical.href = `${locationRef.origin}${pathname}`;
}
