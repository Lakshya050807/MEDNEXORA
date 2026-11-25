import { lazy, Suspense, useEffect } from 'react';
import ProtectedStudentRoute from '../pages/ProtectedStudentRoute.jsx';
import { applyPageMetadata } from '../utils/pageMetadata.js';

const HomePage = lazy(() => import('../pages/HomePage.jsx'));
const LoginPage = lazy(() => import('../pages/LoginPage.jsx'));
const RegisterPage = lazy(() => import('../pages/RegisterPage.jsx'));
const PasswordRecoveryPage = lazy(() => import('../pages/PasswordRecoveryPage.jsx'));
const InformationPage = lazy(() => import('../pages/InformationPage.jsx'));
const AdminDashboardPage = lazy(() => import('../pages/AdminDashboardPage.jsx'));
const AdminLoginPage = lazy(() => import('../pages/AdminLoginPage.jsx'));
const PracticePage = lazy(() => import('../pages/PracticePage.jsx'));
const CourseCatalogPage = lazy(() => import('../pages/CourseCatalogPage.jsx'));
const CourseDetailPage = lazy(() => import('../pages/CourseDetailPage.jsx'));
const CourseLearningPage = lazy(() => import('../pages/CourseLearningPage.jsx'));
const FlagshipCourseOverviewPage = lazy(() => import('../pages/FlagshipCourseOverviewPage.jsx'));
const MyCoursesPage = lazy(() => import('../pages/MyCoursesPage.jsx'));
const CartPage = lazy(() => import('../pages/CartPage.jsx'));
const OrdersPage = lazy(() => import('../pages/OrdersPage.jsx'));
const TargetExamsPage = lazy(() => import('../pages/TargetExamsPage.jsx'));
const StudyMaterialPage = lazy(() => import('../pages/StudyMaterialPage.jsx'));
const ProductDetailPage = lazy(() => import('../pages/ProductDetailPage.jsx'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage.jsx'));

function withSuspense(page) {
  return <Suspense fallback={<div className="route-loading-state" role="status">Loading page…</div>}>{page}</Suspense>;
}

export default function AppRoutes() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  useEffect(() => {
    applyPageMetadata(document, window.location, path);
  }, [path]);

  if (path === '/login') return withSuspense(<LoginPage />);
  if (path === '/register') return withSuspense(<RegisterPage />);
  if (path === '/forgot-password') return withSuspense(<PasswordRecoveryPage mode="forgot" />);
  if (path === '/reset-password') return withSuspense(<PasswordRecoveryPage mode="reset" />);
  if (path === '/about') return withSuspense(<InformationPage page="about" />);
  if (path === '/contact') return withSuspense(<InformationPage page="contact" />);
  if (path === '/faq') return withSuspense(<InformationPage page="faq" />);
  if (path === '/privacy-policy') return withSuspense(<InformationPage page="privacy" />);
  if (path === '/terms-and-conditions') return withSuspense(<InformationPage page="terms" />);
  if (path === '/refund-cancellation-policy') return withSuspense(<InformationPage page="refunds" />);
  if (path === '/admin/login') return withSuspense(<AdminLoginPage />);
  if (path === '/admin' || path.startsWith('/admin/')) return withSuspense(<AdminDashboardPage />);
  if (path === '/student/dashboard') return withSuspense(<ProtectedStudentRoute />);
  if (path === '/my-courses') return withSuspense(<ProtectedStudentRoute><MyCoursesPage /></ProtectedStudentRoute>);
  if (path === '/cart') return withSuspense(<CartPage />);
  if (path === '/orders') return withSuspense(<ProtectedStudentRoute><OrdersPage /></ProtectedStudentRoute>);
  if (path.startsWith('/orders/')) return withSuspense(<ProtectedStudentRoute><OrdersPage orderId={path.slice('/orders/'.length)} /></ProtectedStudentRoute>);
  if (path === '/courses') return withSuspense(<CourseCatalogPage />);
  if (path === '/courses/bsc-nursing-entrance-preparation/overview') return withSuspense(<FlagshipCourseOverviewPage />);
  if (path.startsWith('/courses/')) {
    const encodedPath = path.slice('/courses/'.length).split('/');
    let courseId = null;
    try { courseId = decodeURIComponent(encodedPath[0] ?? ''); } catch { courseId = null; }
    if (encodedPath[1] === 'learn') return withSuspense(<ProtectedStudentRoute><CourseLearningPage courseId={courseId} /></ProtectedStudentRoute>);
    if (encodedPath.length === 1) return withSuspense(<CourseDetailPage courseId={courseId} />);
  }
  if (path === '/practice' || path === '/mock-tests') return withSuspense(<ProtectedStudentRoute><PracticePage /></ProtectedStudentRoute>);
  if (path === '/practice/attempts') return withSuspense(<ProtectedStudentRoute><PracticePage view="history" /></ProtectedStudentRoute>);
  if (path.startsWith('/practice/attempts/')) {
    let encodedAttemptId = path.slice('/practice/attempts/'.length);
    if (encodedAttemptId.endsWith('/results')) encodedAttemptId = encodedAttemptId.slice(0, -'/results'.length);
    let attemptId = encodedAttemptId;
    try { attemptId = decodeURIComponent(encodedAttemptId); } catch { attemptId = ''; }
    return withSuspense(<ProtectedStudentRoute><PracticePage attemptId={attemptId} /></ProtectedStudentRoute>);
  }
  if (path === '/study-material') return withSuspense(<StudyMaterialPage />);
  if (path === '/target-exams') return withSuspense(<TargetExamsPage />);
  if (path === '/products' || path.startsWith('/products/')) {
    const encodedId = path.startsWith('/products/') ? path.slice('/products/'.length) : '';
    let productId = null;
    try {
      productId = encodedId ? decodeURIComponent(encodedId) : null;
    } catch {
      productId = null;
    }
    return withSuspense(<ProductDetailPage productId={productId} />);
  }

  if (path === '/') return withSuspense(<HomePage />);
  return withSuspense(<NotFoundPage />);
}

