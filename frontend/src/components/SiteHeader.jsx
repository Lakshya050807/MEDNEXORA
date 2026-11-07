import { useState } from 'react';
import Icon from './Icon.jsx';
import BrandLink from './BrandLink.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const { status, user, logout } = useAuth();
  const { count: cartCount } = useCart();
  const currentPath = window.location.pathname.replace(/\/+$/u, '') || '/';
  const isHomePage = currentPath === '/';

  const closeMenu = () => setMenuOpen(false);
  const handleLogout = async () => {
    setLogoutError('');
    try {
      await logout();
      window.location.replace('/');
    } catch (error) {
      setLogoutError(error.message || 'We couldn’t log you out. Please try again.');
    }
  };
  const links = [
    { href: isHomePage ? '#home' : '/', label: 'Home', current: isHomePage },
    { href: '/target-exams', label: 'Target exams', current: currentPath === '/target-exams' },
    { href: '/study-material', label: 'Study materials', current: currentPath === '/study-material' },
    { href: isHomePage ? '#mock-tests' : '/#mock-tests', label: 'Mock tests', current: ['/practice', '/mock-tests', '/practice/attempts'].includes(currentPath) },
    { href: '/courses', label: 'Courses', current: currentPath === '/courses' || currentPath.startsWith('/courses/') },
    { href: '/about', label: 'About', current: currentPath === '/about' },
  ];

  return (
    <header className="site-header">
      <div className="page-width header-inner">
        <BrandLink href={isHomePage ? '#home' : '/'} onClick={closeMenu} />

        <button
          className="mobile-menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} size={22} />
        </button>

        <nav id="primary-navigation" className={`header-nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">
          {links.map((link) => <a key={link.label} href={link.href} onClick={closeMenu} aria-current={link.current ? 'page' : undefined}>{link.label}</a>)}
        </nav>

        <div className="header-actions">
          {status === 'loading' ? (
            <span className="auth-checking" role="status">Checking account…</span>
          ) : user ? (
            <>
              <a className="login-button account-dashboard-link" href="/student/dashboard" aria-label="Open student dashboard">
                <Icon name="user" size={18} /><span className="account-action-label">Dashboard</span>
              </a>
              <button className="login-button logout-button" type="button" onClick={handleLogout} aria-label="Log out">
                <Icon name="arrowUpRight" size={17} /><span className="account-action-label">Log out</span>
              </button>
            </>
          ) : (
            <a className="login-button" href="/login"><Icon name="user" size={18} /><span>Log in</span></a>
          )}
          <button className="cart-button" type="button" onClick={() => { closeMenu(); window.location.assign('/cart'); }} aria-label={`Open shopping cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
            <Icon name="bag" size={18} />
            <span className="cart-label">Cart</span>
            <span className="cart-count" aria-label={`${cartCount} items`}>{cartCount}</span>
          </button>
        </div>
      </div>
      {logoutError && <span className="header-auth-error" role="alert">{logoutError}</span>}
    </header>
  );
}

