import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ProductCover from '../components/ProductCover.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { catalogApi } from '../services/catalogApi.js';
import { paymentApi } from '../services/paymentApi.js';

function loadCheckoutSdk() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-razorpay-checkout]');
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function getIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `checkout_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

export default function CartPage() {
  const { items, removeProduct, removeProducts } = useCart();
  const { status: authStatus, user } = useAuth();
  const [products, setProducts] = useState([]);
  const [loadState, setLoadState] = useState('ready');
  const [message, setMessage] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const keyRef = useRef({ cartKey: '', value: '' });
  const cartKey = items.map((item) => item.productId).sort().join('|');

  useEffect(() => {
    let active = true;
    if (!items.length) {
      setProducts([]);
      setLoadState('ready');
      return () => { active = false; };
    }
    setLoadState('loading');
    Promise.all(items.map(async (item) => {
      try {
        const { product } = await catalogApi.getProduct(item.productId);
        return { productId: item.productId, product, error: '' };
      } catch (error) {
        return { productId: item.productId, product: null, error: error.message || 'This resource is unavailable.' };
      }
    })).then((rows) => {
      if (!active) return;
      setProducts(rows);
      setLoadState('ready');
    });
    return () => { active = false; };
  }, [cartKey]);

  const lines = useMemo(() => items.map((item) => {
    const loaded = products.find((row) => row.productId === item.productId);
    return { ...item, product: loaded?.product ?? null, error: loaded?.error ?? '' };
  }), [items, products]);
  const subtotal = lines.reduce((total, line) => total + (Number(line.product?.currentPricePaise) || 0) * line.quantity, 0);
  const discount = lines.reduce((total, line) => total + (Number(line.product?.discountPaise) || 0) * line.quantity, 0);
  const hasUnavailableProducts = lines.some((line) => !line.product || !line.product.id || line.product.isFree);
  const isEmpty = items.length === 0;

  const startCheckout = async () => {
    setMessage('');
    if (!user) {
      window.location.assign('/login?next=%2Fcart');
      return;
    }
    if (authStatus !== 'authenticated') {
      setMessage(authStatus === 'loading' ? 'Checking your account… please try again in a moment.' : 'Your account session is unavailable. Refresh the page or sign in again.');
      return;
    }
    if (loadState !== 'ready' || hasUnavailableProducts || subtotal <= 0) {
      setMessage('Refresh or remove unavailable resources before checkout.');
      return;
    }
    setCheckoutBusy(true);
    try {
      if (keyRef.current.cartKey !== cartKey || !keyRef.current.value) {
        keyRef.current = { cartKey, value: getIdempotencyKey() };
      }
      const created = await paymentApi.createCheckout({
        idempotencyKey: keyRef.current.value,
        items: items.map(({ productId, quantity }) => ({ productId, quantity })),
      });
      if (!created.checkout) {
        window.location.assign(`/orders/${encodeURIComponent(created.order.id)}`);
        return;
      }
      if (created.order.amountPaise !== subtotal) {
        const serverItems = new Map(created.order.items.map((item) => [item.productId, item]));
        setProducts((current) => current.map((row) => {
          const item = serverItems.get(row.productId);
          if (!item || !row.product) return row;
          const currentPricePaise = item.unitPricePaise;
          return {
            ...row,
            product: {
              ...row.product,
              pricePaise: item.listPricePaise,
              discountPaise: item.discountPaise,
              currentPricePaise,
              isFree: currentPricePaise === 0,
              discountPercent: item.listPricePaise > 0 ? Math.round((item.discountPaise / item.listPricePaise) * 100) : 0,
            },
          };
        }));
        setMessage(`The catalogue price changed. Your updated total is ${formatPricePaise(created.order.amountPaise)}; review it above and continue again to confirm.`);
        return;
      }
      const sdkAvailable = await loadCheckoutSdk();
      if (!sdkAvailable) {
        setMessage('Razorpay Checkout could not be loaded. Your order is pending and no payment was confirmed. Check your connection, then try again.');
        return;
      }
      const checkout = new window.Razorpay({
        key: created.checkout.keyId,
        amount: created.checkout.amount,
        currency: created.checkout.currency,
        name: created.checkout.name,
        description: created.checkout.description,
        order_id: created.checkout.providerOrderId,
        prefill: { name: user.name ?? '', email: user.email ?? '' },
        theme: { color: '#087f82' },
        handler: async (gatewayResponse) => {
          try {
            const result = await paymentApi.verifyPayment(created.order.id, gatewayResponse);
            if (result.order.status === 'paid') removeProducts(result.order.items.map((item) => item.productId));
            window.location.assign(`/orders/${encodeURIComponent(created.order.id)}`);
          } catch (error) {
            setMessage(`${error.message} The order remains unconfirmed until the server checks the payment.`);
            window.location.assign(`/orders/${encodeURIComponent(created.order.id)}`);
          }
        },
        modal: {
          ondismiss: () => setMessage('Checkout was closed. The order is still pending until payment status is confirmed.'),
        },
      });
      checkout.on('payment.failed', async (gatewayEvent) => {
        const paymentId = gatewayEvent?.error?.metadata?.payment_id;
        try {
          const result = await paymentApi.reconcileOrder(created.order.id, paymentId ? { paymentId } : {});
          if (result.order.status === 'paid') removeProducts(result.order.items.map((item) => item.productId));
          window.location.assign(`/orders/${encodeURIComponent(created.order.id)}`);
        } catch {
          window.location.assign(`/orders/${encodeURIComponent(created.order.id)}`);
        }
      });
      checkout.open();
    } catch (error) {
      setMessage(error.message || 'Checkout could not be started. Your card or bank details were not submitted here.');
    } finally {
      setCheckoutBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader activePage="cart" />
      <main className="commerce-page">
        <div className="page-width">
          <nav className="catalog-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">Your cart</span></nav>
          <div className="commerce-heading"><div><p className="eyebrow">YOUR STUDY BAG</p><h1>Review your resources</h1><p>Prices and publication status are checked again on the server when you start checkout.</p></div><a className="commerce-back-link" href="/study-material">Continue browsing <Icon name="arrow" size={16} /></a></div>

          {message && <div className="commerce-alert" role="alert">{message}</div>}
          {loadState === 'loading' && <div className="commerce-state" role="status"><span className="loading-mark" /><h2>Checking resource availability</h2><p>Refreshing current catalogue details for your cart.</p></div>}
          {loadState === 'ready' && isEmpty && <div className="commerce-state"><span className="empty-icon"><Icon name="bag" size={24} /></span><h2>Your cart is empty</h2><p>Add exam preparation resources and they’ll appear here.</p><a className="commerce-primary-link" href="/study-material">Browse study materials <Icon name="arrow" size={16} /></a></div>}

          {loadState === 'ready' && !isEmpty && <div className="cart-layout">
            <section className="cart-items-panel" aria-label="Cart items">
              {lines.map((line) => {
                const product = line.product;
                return <article className={`cart-line${!product ? ' cart-line-unavailable' : ''}`} key={line.productId}>
                  {product ? <ProductCover product={product} className="cart-line-cover" /> : <div className="cart-line-cover cart-line-cover-missing"><Icon name="file" size={21} /></div>}
                  <div className="cart-line-info">
                    <div className="cart-line-labels"><span>{product?.resourceTypeLabel || 'Study resource'}</span>{product?.subjectName && <span>{product.subjectName}</span>}</div>
                    <h2>{product?.title || 'Unavailable resource'}</h2>
                    {line.error && <p className="cart-unavailable-note" role="alert">{line.error}</p>}
                    {product?.isFree && <p className="cart-unavailable-note">This resource is free and does not require checkout.</p>}
                    <button className="cart-remove-button" type="button" onClick={() => removeProduct(line.productId)}>Remove</button>
                  </div>
                  <div className="cart-line-pricing">
                    <strong>{product ? formatPricePaise(product.currentPricePaise) ?? 'Price unavailable' : 'Unavailable'}</strong>
                    {product?.discountPaise > 0 && <><s>{formatPricePaise(product.pricePaise)}</s><small>Save {formatPricePaise(product.discountPaise)}</small></>}
                    <span>Qty 1 · digital resource</span>
                  </div>
                </article>;
              })}
            </section>

            <aside className="cart-summary" aria-label="Order summary">
              <p className="eyebrow">ORDER SUMMARY</p><h2>Checkout total</h2>
              <div className="cart-summary-row"><span>Items</span><strong>{lines.length}</strong></div>
              {discount > 0 && <div className="cart-summary-row cart-saving-row"><span>Discounts</span><strong>−{formatPricePaise(discount)}</strong></div>}
              <div className="cart-summary-total"><span>Total</span><strong>{formatPricePaise(subtotal) ?? '—'}</strong></div>
              <button className="commerce-primary-button" type="button" disabled={checkoutBusy || loadState !== 'ready' || hasUnavailableProducts || authStatus === 'loading'} onClick={startCheckout}>{checkoutBusy ? 'Preparing secure checkout…' : user ? 'Continue to Razorpay' : 'Sign in to checkout'} <Icon name="arrow" size={16} /></button>
              <p className="cart-security-note"><Icon name="shield" size={15} /> Payment details are entered in Razorpay Checkout. This website does not store card details.</p>
              <p className="cart-server-check-note">The server recalculates the amount using the current published catalogue. Access is granted only after a captured payment is verified.</p>
              {user && <a className="cart-orders-link" href="/orders">View order history</a>}
            </aside>
          </div>}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
