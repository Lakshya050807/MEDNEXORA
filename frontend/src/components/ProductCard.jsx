import Icon from './Icon.jsx';
import ProductCover from './ProductCover.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { useCart } from '../context/CartContext.jsx';

export default function ProductCard({ product }) {
  const { addProduct, hasProduct } = useCart();
  const detailHref = product.course?.id
    ? `/courses/${encodeURIComponent(product.course.id)}`
    : `/products/${encodeURIComponent(product.id)}`;
  return (
    <article className="product-card" id={`item-${product.id}`}>
      <ProductCover product={product} />

      <div className="product-info">
        <div className="product-meta">
          <span>{[product.subjectName || product.subject?.name, product.chapterName || product.chapter?.name].filter(Boolean).join(' · ') || 'Exam preparation'}</span>
          <span className="meta-divider" aria-hidden="true">·</span>
          <span>{product.categoryLabel || product.resourceTypeLabel || 'Study material'}</span>
        </div>
        <h3>{product.title}</h3>
        <div className="product-access-badges"><span>{product.isFree ? 'Free' : 'Paid'}</span>{product.freePreview && <span>Preview available</span>}</div>
        <div className="product-bottom">
          <span className="product-price-block">
            <span className="product-price">{product.isFree ? 'Free' : formatPricePaise(product.currentPricePaise) ?? 'Price unavailable'}</span>
            {product.discountPaise > 0 && <span className="product-original-price"><s>{formatPricePaise(product.pricePaise)}</s><small>{product.discountPercent}% off</small></span>}
          </span>
          <div className="product-card-actions">
            {!product.isFree && <button className="product-add-button" type="button" onClick={() => addProduct(product)}>{hasProduct(product.id) ? 'In cart' : 'Add to cart'}</button>}
            <a className="details-button" href={detailHref}>{product.course?.id ? 'View course' : 'View details'} <Icon name="arrowUpRight" size={15} /></a>
          </div>
        </div>
      </div>
    </article>
  );
}

