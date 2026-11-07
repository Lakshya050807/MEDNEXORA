import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { BrandSymbol } from './BrandLink.jsx';

const validCovers = new Set(['anatomy', 'foundations', 'papers', 'pharmacology', 'video', 'practical']);

export default function ProductCover({ product, className = '' }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const hasThumbnail = Boolean(product.thumbnailUrl) && !thumbnailFailed;
  useEffect(() => setThumbnailFailed(false), [product.thumbnailUrl]);
  const cover = validCovers.has(product.cover) ? product.cover : 'foundations';
  const coverTitle = typeof product.coverTitle === 'string' && product.coverTitle.trim()
    ? product.coverTitle
    : product.title || 'Study material';
  const coverIndex = product.coverIndex || product.examName || product.exam?.name || product.subjectName || 'COMPETITIVE EXAM PREP';
  const iconName = cover === 'video'
    ? 'play'
    : cover === 'papers'
      ? 'file'
      : cover === 'practical'
        ? 'clipboard'
        : cover === 'pharmacology'
          ? 'checklist'
          : 'book';

  return (
    <div className={`product-cover cover-${cover}${hasThumbnail ? ' has-thumbnail' : ''} ${className}`.trim()} role="img" aria-label={`${product.title || 'Study resource'} cover artwork`}>
      {hasThumbnail && <img className="product-thumbnail" src={product.thumbnailUrl} alt="" loading="lazy" decoding="async" onError={() => setThumbnailFailed(true)} />}
      <div className="cover-topline">
        <span className="cover-brand"><BrandSymbol className="cover-brand-emblem" /> MEDNEXORA</span>
        <span className="cover-format">{product.paperLabel || product.resourceTypeLabel || 'STUDY RESOURCE'}</span>
      </div>
      <div className="cover-art" aria-hidden="true"><Icon name={iconName} size={31} /></div>
      <div className="cover-copy">
        <span className="cover-kicker">{product.coverKicker || 'STUDY RESOURCE'}</span>
        <span className="cover-title">{coverTitle.split('\n').map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</span>
      </div>
      <span className="cover-index">{coverIndex}</span>
    </div>
  );
}
