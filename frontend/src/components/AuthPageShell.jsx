import Icon from './Icon.jsx';
import BrandLink from './BrandLink.jsx';

export default function AuthPageShell({ eyebrow = 'STUDENT ACCOUNT', title, description, children, footer, footerNote = 'Student access for Government Competitive Exam Preparation.' }) {
  return (
    <div className="auth-page-shell">
      <header className="auth-page-header page-width">
        <BrandLink />
        <a className="auth-home-link" href="/">Back to home <Icon name="arrowUpRight" size={15} /></a>
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="auth-title">{title}</h1>
          {description && <p className="auth-description">{description}</p>}
          {children}
          {footer && <div className="auth-card-footer">{footer}</div>}
        </section>
      </main>
      <footer className="auth-page-footer">{footerNote}</footer>
    </div>
  );
}
