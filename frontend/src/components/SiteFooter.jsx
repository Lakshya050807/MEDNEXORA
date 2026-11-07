import BrandLink from './BrandLink.jsx';

const currentYear = new Date().getFullYear();

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-width footer-main">
        <div className="footer-brand-block">
          <BrandLink />
          <p>Business and service information is awaiting owner confirmation.</p>
        </div>
        <nav className="footer-link-group" aria-label="Explore MEDNEXORA">
          <strong>Explore</strong>
          <a href="/target-exams">Target examinations</a>
          <a href="/study-material">Study materials</a>
          <a href="/courses">Courses</a>
          <a href="/practice">Practice and mock tests</a>
        </nav>
        <nav className="footer-link-group" aria-label="About and support">
          <strong>About &amp; support</strong>
          <a href="/about">About us</a>
          <a href="/contact">Contact us</a>
          <a href="/faq">Frequently asked questions</a>
        </nav>
        <nav className="footer-link-group" aria-label="Policies">
          <strong>Policies</strong>
          <a href="/privacy-policy">Privacy policy</a>
          <a href="/terms-and-conditions">Terms and conditions</a>
          <a href="/refund-cancellation-policy">Refund and cancellation</a>
        </nav>
      </div>
      <div className="page-width footer-bottom">
        <span>© {currentYear} MEDNEXORA</span>
        <span>Examination information, sources and limitations are awaiting owner confirmation.</span>
        <a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Back to top</a>
      </div>
    </footer>
  );
}
