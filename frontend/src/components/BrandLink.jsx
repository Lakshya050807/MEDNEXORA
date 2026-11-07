export function BrandSymbol({ className = '' }) {
  return (
    <span className={`brand-emblem ${className}`.trim()} aria-hidden="true">
      <img src="/mednexora-logo.png" alt="" />
    </span>
  );
}

export default function BrandLink({ href = '/', ariaLabel = 'MEDNEXORA home', onClick, className = 'brand' }) {
  return (
    <a className={className} href={href} aria-label={ariaLabel} onClick={onClick}>
      <BrandSymbol />
      <span className="brand-name">MEDNEXORA</span>
    </a>
  );
}
