import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ProductCard from '../components/ProductCard.jsx';
import ProductCover from '../components/ProductCover.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { catalogApi } from '../services/catalogApi.js';
import { useCart } from '../context/CartContext.jsx';
import { AuthApiError, authApi } from '../services/authApi.js';

const freePdfTypes = new Set(['notes', 'practice-paper', 'previous-year-paper']);

function fileSizeLabel(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProductDetailPage({ productId }) {
  const [cartMessage, setCartMessage] = useState('');
  const { addProduct, hasProduct } = useCart();
  const [product, setProduct] = useState(null);
  const [relatedMaterials, setRelatedMaterials] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimComplete, setClaimComplete] = useState(false);
  const [claimMessage, setClaimMessage] = useState('');
  const [claimNeedsLogin, setClaimNeedsLogin] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');
    setLoadError('');
    catalogApi.getProduct(productId, { signal: controller.signal }).then(async ({ product: item }) => {
      if (!item) {
        setLoadState('missing');
        return;
      }
      setProduct(item);
      setLoadState('ready');
      try {
        const related = await catalogApi.listProducts({
          examId: item.exam?.id,
          subjectId: item.subject?.id,
          excludeId: item.id,
          limit: 3,
          sort: 'newest',
        }, { signal: controller.signal });
        setRelatedMaterials(related.items);
      } catch (error) {
        if (error?.name !== 'AbortError') setRelatedMaterials([]);
      }
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      setLoadError(error.message || 'The resource could not be loaded.');
      setLoadState(error.status === 404 ? 'missing' : 'error');
    });
    return () => controller.abort();
  }, [productId, retryCount]);

  const header = <SiteHeader activePage="study-material" />;

  if (loadState !== 'ready' || !product) {
    return (
      <div className="site-shell">
        {header}
        <main className="missing-product-page">
          <div className="missing-product-card">
            {loadState === 'loading' ? <><span className="loading-mark" /><p className="eyebrow">GOVERNMENT EXAM CATALOGUE</p><h1>Loading resource</h1><p>Checking the published catalogue.</p></> : <><span className="empty-icon"><Icon name="file" size={25} /></span><p className="eyebrow">GOVERNMENT COMPETITIVE EXAM PREPARATION</p><h1>{loadState === 'missing' ? 'We couldn’t find that resource.' : 'Resource unavailable.'}</h1><p>{loadError || 'The resource may not exist or may no longer be published.'}</p>{loadState === 'error' && <button className="secondary-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again <Icon name="arrow" size={16} /></button>}<a className="secondary-button" href="/study-material">Browse study resources <Icon name="arrow" size={16} /></a></>}
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const displayPrice = product.isFree ? 'Free' : formatPricePaise(product.currentPricePaise) ?? 'Price unavailable';
  const hasFreeLibraryClaim = product.isFree && freePdfTypes.has(product.resourceType);
  const claimFreeMaterial = async () => {
    setClaimBusy(true);
    setClaimMessage('');
    setClaimNeedsLogin(false);
    try {
      await authApi.claimFreeMaterial(product.id);
      setClaimComplete(true);
    } catch (error) {
      const needsLogin = error instanceof AuthApiError && error.status === 401;
      setClaimNeedsLogin(needsLogin);
      setClaimMessage(needsLogin ? 'Please log in to add this resource to your library.' : error.message || 'Free access could not be added. Please try again.');
    } finally {
      setClaimBusy(false);
    }
  };
  const topics = product.topics ?? [];
  const outcomes = product.outcomes ?? [];

  return (
    <div className="site-shell">
      {header}
      <main className="product-detail-page">
        <div className="page-width">
          <nav className="catalog-breadcrumb detail-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/study-material">Government exam resources</a><span aria-hidden="true">/</span><span aria-current="page">{product.title}</span></nav>

          <section className="product-detail-hero" aria-labelledby="product-title">
            <div className="product-detail-art-column"><ProductCover product={product} className="product-detail-cover" /><p className="product-art-caption"><Icon name="shield" size={14} /> Published catalogue resource</p></div>
            <div className="product-detail-summary">
              <div className="detail-badges"><span className="detail-type-badge">{product.resourceTypeLabel}</span>{product.paperLabel && <span className="paper-verification-badge">{product.paperLabel}</span>}</div>
              <h1 id="product-title">{product.title}</h1>
              <p className="product-detail-description">{product.description}</p>
              <dl className="product-facts">
                <div><dt>Target exam</dt><dd>{product.exam?.name || 'Government Competitive Examination'}</dd></div>
                <div><dt>Subject</dt><dd>{product.subject?.name || 'Not specified'}</dd></div>
                {product.chapter?.name && <div><dt>Chapter</dt><dd>{product.chapter.name}</dd></div>}
                {product.topic?.name && <div><dt>Topic</dt><dd>{product.topic.name}</dd></div>}
                <div><dt>Category</dt><dd>{product.categoryLabel}</dd></div>
                <div><dt>Format</dt><dd>{product.format || 'PDF document'}</dd></div>
                {fileSizeLabel(product.fileSizeBytes) && <div><dt>File size</dt><dd>{fileSizeLabel(product.fileSizeBytes)}</dd></div>}
                {product.language && <div><dt>Language</dt><dd>{product.language}</dd></div>}
                {product.difficultyLevel && <div><dt>Difficulty</dt><dd>{product.difficultyLevel}</dd></div>}
                {product.duration && <div><dt>Duration</dt><dd>{product.duration}</dd></div>}
              </dl>

              <div className="product-purchase-panel">
                <div><span className="detail-price-label">Current price</span><strong className="detail-price">{displayPrice}</strong>{product.discountPaise > 0 && <span className="detail-original-price"><s>{formatPricePaise(product.pricePaise)}</s> · {product.discountPercent}% off</span>}</div>
                <div className="product-purchase-actions">{hasFreeLibraryClaim ? (claimComplete ? <a className="purchase-button purchase-primary" href="/student/dashboard">Open My Library</a> : <button className="purchase-button purchase-primary" type="button" disabled={claimBusy} onClick={claimFreeMaterial}>{claimBusy ? 'Adding to My Library…' : 'Add to My Library'}</button>) : product.isFree ? <span className="free-resource-label">Free resource</span> : <><button className="purchase-button purchase-primary" type="button" onClick={() => setCartMessage(addProduct(product).reason || 'Added to your cart.')}>{hasProduct(product.id) ? 'In Cart' : 'Add to Cart'}</button><button className="purchase-button purchase-secondary" type="button" onClick={() => { addProduct(product); window.location.assign('/cart'); }}>Buy Now</button></>}</div>
                <p className="purchase-notice" role={claimMessage || cartMessage ? 'status' : undefined}>{claimMessage || cartMessage || (hasFreeLibraryClaim ? 'Free access is recorded to your student account. The PDF remains protected behind your login.' : product.isFree ? 'This free resource does not need checkout.' : 'Checkout uses current server pricing and verifies payment before access is granted.')}</p>
                {claimNeedsLogin && <a className="student-library-login-link" href="/login">Sign in to continue</a>}
              </div>
            </div>
          </section>

          <div className="product-detail-content">
            <div className="product-detail-main-column">
              <section className="detail-content-card" aria-labelledby="overview-title"><p className="eyebrow">GOVERNMENT EXAM PREPARATION RESOURCE</p><h2 id="overview-title">About this resource</h2><p className="detail-body-copy">{product.detailedDescription || product.description}</p></section>
              <section className="detail-content-card" aria-labelledby="outcomes-title"><p className="eyebrow">LEARNING SUPPORT</p><h2 id="outcomes-title">What it is designed to help with</h2>{outcomes.length ? <ul className="detail-check-list">{outcomes.map((outcome) => <li key={outcome}><span aria-hidden="true">✓</span>{outcome}</li>)}</ul> : <p className="detail-body-copy">Learning outcomes are not listed for this resource.</p>}</section>
              <section className="detail-content-card" aria-labelledby="contents-title"><p className="eyebrow">CONTENTS</p><h2 id="contents-title">Topics covered</h2>{topics.length ? <ul className="topic-list">{topics.map((topic, index) => <li key={`${topic}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{topic}</li>)}</ul> : <p className="detail-body-copy">Topic details are not listed for this resource.</p>}</section>
              {product.resourceType === 'bundle' && <section className="detail-content-card" aria-labelledby="bundle-contents-title"><p className="eyebrow">BUNDLE CONTENTS</p><h2 id="bundle-contents-title">Resources included</h2>{product.bundleItems?.length ? <ul className="bundle-included-list">{product.bundleItems.map((item) => { const isCourse = ['video-course', 'crash-course'].includes(item.resourceType) && item.courseId; const href = isCourse ? `/courses/${encodeURIComponent(item.courseId)}` : `/products/${encodeURIComponent(item.id)}`; return <li key={item.id}><Icon name={isCourse ? 'play' : 'file'} size={16} /><a href={href}>{item.name || item.title}</a>{isCourse && <span className="bundle-course-label">Course</span>}</li>; })}</ul> : <p className="detail-body-copy">Included resources have not been published for this bundle.</p>}</section>}
              {product.course?.id && <section className="detail-content-card" aria-labelledby="course-content-link-title"><p className="eyebrow">RECORDED LEARNING</p><h2 id="course-content-link-title">Open course lessons</h2><p className="detail-body-copy">Review the module outline, configured free previews and course access requirements.</p><a className="course-primary-link" href={`/courses/${encodeURIComponent(product.course.id)}`}>View course details <Icon name="arrow" size={15} /></a></section>}
              <section className="detail-content-card preview-content-card" aria-labelledby="preview-title"><p className="eyebrow">FREE PREVIEW</p><h2 id="preview-title">Preview this resource</h2>{product.freePreview ? <div className="free-preview-panel"><div className="preview-panel-label"><Icon name="file" size={17} /><span>SAMPLE PREVIEW</span></div><h3>{product.freePreview.title}</h3><p>{product.freePreview.excerpt}</p><span className="preview-limit-note">This is the public sample only. Paid resource files are not included in the catalogue response.</span></div> : <div className="preview-unavailable"><Icon name="file" size={18} /><p>A free preview is not available for this resource.</p></div>}</section>
            </div>
            <aside className="product-detail-aside" aria-label="Resource information"><div className="detail-content-card quick-facts-card"><p className="eyebrow">AT A GLANCE</p><h2>Resource details</h2><dl><div><dt>Type</dt><dd>{product.resourceTypeLabel}</dd></div><div><dt>Exam</dt><dd>{product.exam?.name || 'Government Competitive Examination'}</dd></div><div><dt>Subject</dt><dd>{product.subject?.name || 'Not specified'}</dd></div><div><dt>Availability</dt><dd>{product.isFree ? 'Free resource' : 'Paid resource'}</dd></div>{product.paperLabel && <div><dt>Paper label</dt><dd>{product.paperLabel}</dd></div>}</dl>{product.previousYearSource?.url && <p className="detail-demo-note">Verified source: <a href={product.previousYearSource.url} target="_blank" rel="noreferrer">{product.previousYearSource.title || 'View paper source'}</a>{product.previousYearSource.verifiedAt && ` · Verified ${new Date(product.previousYearSource.verifiedAt).toLocaleDateString('en-IN')}`}</p>}<p className="detail-demo-note">Exam eligibility, syllabus and pattern are managed in exam configuration. Check the current official notice for the latest details.</p></div></aside>
          </div>

          <section className="related-materials-section" aria-labelledby="related-title"><div className="related-heading"><div><p className="eyebrow">KEEP PREPARING</p><h2 id="related-title">Related entrance resources</h2></div><a href="/study-material">Browse all <Icon name="arrow" size={16} /></a></div>{relatedMaterials.length ? <div className="product-grid related-product-grid">{relatedMaterials.map((material) => <ProductCard key={material.id} product={material} />)}</div> : <p className="progress-placeholder-note">No related published resources are available yet.</p>}</section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
