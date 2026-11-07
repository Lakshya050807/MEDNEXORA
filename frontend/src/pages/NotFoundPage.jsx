import Icon from '../components/Icon.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import SiteHeader from '../components/SiteHeader.jsx';

export default function NotFoundPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="not-found-page">
        <div className="not-found-card">
          <span className="not-found-code">404</span>
          <p className="eyebrow">PAGE NOT FOUND</p>
          <h1>This page isn’t here.</h1>
          <p>Check the address or return to the MEDNEXORA homepage.</p>
          <div className="not-found-actions"><a className="primary-button" href="/">Go to homepage <Icon name="arrow" size={16} /></a><a className="secondary-button" href="/study-material">Browse study materials</a></div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
