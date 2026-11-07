import { useEffect } from 'react';
import HomePage from '../pages/HomePage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import ProductDetailPage from '../pages/ProductDetailPage.jsx';
import ProtectedStudentRoute from '../pages/ProtectedStudentRoute.jsx';
import RegisterPage from '../pages/RegisterPage.jsx';
import StudyMaterialPage from '../pages/StudyMaterialPage.jsx';
import AdminDashboardPage from '../pages/AdminDashboardPage.jsx';
import AdminLoginPage from '../pages/AdminLoginPage.jsx';
import PracticePage from '../pages/PracticePage.jsx';
import CourseCatalogPage from '../pages/CourseCatalogPage.jsx';
import CourseDetailPage from '../pages/CourseDetailPage.jsx';
import CourseLearningPage from '../pages/CourseLearningPage.jsx';
import FlagshipCourseOverviewPage from '../pages/FlagshipCourseOverviewPage.jsx';
import MyCoursesPage from '../pages/MyCoursesPage.jsx';
import CartPage from '../pages/CartPage.jsx';
import OrdersPage from '../pages/OrdersPage.jsx';
import TargetExamsPage from '../pages/TargetExamsPage.jsx';
import InformationPage from '../pages/InformationPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import { applyPageMetadata } from '../utils/pageMetadata.js';

export default function AppRoutes() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  useEffect(() => {
    applyPageMetadata(document, window.location, path);
  }, [path]);

  if (path === '/login') return <LoginPage />;
  if (path === '/register') return <RegisterPage />;
  if (path === '/about') return <InformationPage page="about" />;
  if (path === '/contact') return <InformationPage page="contact" />;
  if (path === '/faq') return <InformationPage page="faq" />;
  if (path === '/privacy-policy') return <InformationPage page="privacy" />;
  if (path === '/terms-and-conditions') return <InformationPage page="terms" />;
  if (path === '/refund-cancellation-policy') return <InformationPage page="refunds" />;
  if (path === '/admin/login') return <AdminLoginPage />;
  if (path === '/admin' || path.startsWith('/admin/')) return <AdminDashboardPage />;
  if (path === '/student/dashboard') return <ProtectedStudentRoute />;
  if (path === '/my-courses') return <ProtectedStudentRoute><MyCoursesPage /></ProtectedStudentRoute>;
  if (path === '/cart') return <CartPage />;
  if (path === '/orders') return <ProtectedStudentRoute><OrdersPage /></ProtectedStudentRoute>;
  if (path.startsWith('/orders/')) return <ProtectedStudentRoute><OrdersPage orderId={path.slice('/orders/'.length)} /></ProtectedStudentRoute>;
  if (path === '/courses') return <CourseCatalogPage />;
  if (path === '/courses/bsc-nursing-entrance-preparation/overview') return <FlagshipCourseOverviewPage />;
  if (path.startsWith('/courses/')) {
    const encodedPath = path.slice('/courses/'.length).split('/');
    let courseId = null;
    try { courseId = decodeURIComponent(encodedPath[0] ?? ''); } catch { courseId = null; }
    if (encodedPath[1] === 'learn') return <ProtectedStudentRoute><CourseLearningPage courseId={courseId} /></ProtectedStudentRoute>;
    if (encodedPath.length === 1) return <CourseDetailPage courseId={courseId} />;
  }
  if (path === '/practice' || path === '/mock-tests') return <ProtectedStudentRoute><PracticePage /></ProtectedStudentRoute>;
  if (path === '/practice/attempts') return <ProtectedStudentRoute><PracticePage view="history" /></ProtectedStudentRoute>;
  if (path.startsWith('/practice/attempts/')) {
    let encodedAttemptId = path.slice('/practice/attempts/'.length);
    if (encodedAttemptId.endsWith('/results')) encodedAttemptId = encodedAttemptId.slice(0, -'/results'.length);
    let attemptId = encodedAttemptId;
    try { attemptId = decodeURIComponent(encodedAttemptId); } catch { attemptId = ''; }
    return <ProtectedStudentRoute><PracticePage attemptId={attemptId} /></ProtectedStudentRoute>;
  }
  if (path === '/study-material') return <StudyMaterialPage />;
  if (path === '/target-exams') return <TargetExamsPage />;
  if (path === '/products' || path.startsWith('/products/')) {
    const encodedId = path.startsWith('/products/') ? path.slice('/products/'.length) : '';
    let productId = null;
    try {
      productId = encodedId ? decodeURIComponent(encodedId) : null;
    } catch {
      productId = null;
    }
    return <ProductDetailPage productId={productId} />;
  }

  if (path === '/') return <HomePage />;
  return <NotFoundPage />;
}

