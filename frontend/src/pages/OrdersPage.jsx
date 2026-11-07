import { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { paymentApi } from '../services/paymentApi.js';
import { useCart } from '../context/CartContext.jsx';

function StatusLabel({ status }) {
  const labels = { pending: 'Payment pending', paid: 'Paid and verified', partially_refunded: 'Partially refunded', failed: 'Payment failed', refunded: 'Refunded', cancelled: 'Cancelled' };
  return <span className={`order-status-badge status-${status}`}>{labels[status] || 'Status unavailable'}</span>;
}

export default function OrdersPage({ orderId = '' }) {
  const { removeProducts } = useCart();
  const [orders, setOrders] = useState([]);
  const [order, setOrder] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      if (orderId) {
        const result = await paymentApi.getOrder(orderId);
        setOrder(result.order);
      } else {
        const result = await paymentApi.listOrders();
        setOrders(result.items ?? []);
      }
      setState('ready');
    } catch (requestError) {
      setError(requestError.message || 'Orders could not be loaded.');
      setState(requestError.status === 404 ? 'missing' : 'error');
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  const reconcile = async () => {
    if (!orderId) return;
    setRefreshing(true);
    setError('');
    try {
      const result = await paymentApi.reconcileOrder(orderId);
      setOrder(result.order);
      if (['paid', 'partially_refunded', 'refunded'].includes(result.order.status)) removeProducts(result.order.items.map((item) => item.productId));
    } catch (requestError) {
      setError(requestError.message || 'Payment status could not be checked.');
    } finally { setRefreshing(false); }
  };

  return (
    <div className="site-shell">
      <SiteHeader activePage="orders" />
      <main className="commerce-page">
        <div className="page-width">
          <nav className="catalog-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/orders">My orders</a>{orderId && <><span aria-hidden="true">/</span><span aria-current="page">Receipt</span></>}</nav>
          <div className="commerce-heading"><div><p className="eyebrow">STUDENT PURCHASES</p><h1>{orderId ? 'Order receipt' : 'Order history'}</h1><p>Order status is based on server-verified payment records.</p></div><a className="commerce-back-link" href="/study-material">Browse resources <Icon name="arrow" size={16} /></a></div>
          {error && <div className="commerce-alert" role="alert">{error}</div>}
          {state === 'loading' && <div className="commerce-state" role="status"><span className="loading-mark" /><h2>Loading orders</h2><p>Retrieving purchases linked to your student account.</p></div>}
          {state === 'missing' && <div className="commerce-state"><span className="empty-icon"><Icon name="file" size={24} /></span><h2>Order not found</h2><p>This receipt is unavailable or does not belong to this account.</p><a className="commerce-primary-link" href="/orders">Open order history <Icon name="arrow" size={16} /></a></div>}
          {state === 'error' && <div className="commerce-state"><h2>Orders are unavailable</h2><p>{error}</p><button className="commerce-secondary-button" type="button" onClick={() => void load()}>Try again</button></div>}
          {state === 'ready' && !orderId && <section className="order-list" aria-label="Order history">
            {orders.length === 0 ? <div className="commerce-state"><span className="empty-icon"><Icon name="bag" size={24} /></span><h2>No orders yet</h2><p>Completed and pending purchases will appear here.</p><a className="commerce-primary-link" href="/study-material">Browse entrance resources <Icon name="arrow" size={16} /></a></div> : orders.map((item) => <a className="order-list-card" href={`/orders/${encodeURIComponent(item.id)}`} key={item.id}><div><span className="order-reference">Order #{item.id.slice(-8).toUpperCase()}</span><strong>{item.items?.length ?? 0} study resource{item.items?.length === 1 ? '' : 's'}</strong><small>{item.createdAt ? new Date(item.createdAt).toLocaleString('en-IN') : 'Date unavailable'}</small></div><div><StatusLabel status={item.status} /><strong className="order-list-total">{formatPricePaise(item.amountPaise)}</strong></div><Icon name="arrow" size={18} /></a>)}
          </section>}
          {state === 'ready' && orderId && order && <section className="receipt-card" aria-labelledby="receipt-title">
            <header className="receipt-header"><div><span className="order-reference">ORDER #{order.id.slice(-8).toUpperCase()}</span><h2 id="receipt-title">Purchase summary</h2><p>{order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : 'Date unavailable'}</p></div><StatusLabel status={order.status} /></header>
            {order.status === 'pending' && <div className="order-state-message pending-message"><strong>We’re waiting for payment confirmation.</strong><p>Access stays locked while Razorpay confirms the payment. You can check the latest provider status below.</p><button className="commerce-secondary-button" type="button" disabled={refreshing} onClick={reconcile}>{refreshing ? 'Checking with Razorpay…' : 'Check payment status'}</button></div>}
            {order.status === 'failed' && <div className="order-state-message failed-message"><strong>Payment was not completed.</strong><p>{order.paymentFailureReason || 'No access was granted for this order. You can return to the catalogue and start a new checkout.'}</p><a className="commerce-primary-link" href="/study-material">Browse resources <Icon name="arrow" size={16} /></a></div>}
            {order.status === 'paid' && <div className="order-state-message success-message"><strong>{order.accessGrantedAt ? 'Payment verified. Your purchased access is active.' : 'Payment verified. Access is being reconciled.'}</strong><p>This order was confirmed by the server after Razorpay reported a captured payment.{!order.accessGrantedAt && ' Refresh this receipt shortly to check access status.'}</p></div>}
            {order.status === 'partially_refunded' && <div className="order-state-message pending-message"><strong>A partial refund has been processed.</strong><p>{order.refundReviewStatus === 'revoke-access' ? 'An administrator reviewed the refund and revoked access.' : 'Access remains active while an administrator reviews the partial refund.'}</p><p>Refunded {formatPricePaise(order.totalRefundedPaise ?? 0)} · remaining captured amount {formatPricePaise(order.remainingCapturedPaise ?? order.amountPaise)}.</p></div>}
            {order.status === 'refunded' && <div className="order-state-message failed-message"><strong>Full refund processed.</strong><p>The paid entitlement associated with this order has been revoked.</p><p>Refunded {formatPricePaise(order.totalRefundedPaise ?? order.amountPaise)}.</p></div>}
            <ul className="receipt-items">{order.items?.map((item, index) => <li key={`${item.productId}-${index}`}><div><strong>{item.title}</strong><span>Digital resource{item.quantity > 1 ? ` · Qty ${item.quantity}` : ''}</span>{item.discountPaise > 0 && <small>List {formatPricePaise(item.listPricePaise)} · saved {formatPricePaise(item.discountPaise)}</small>}</div><strong>{formatPricePaise(item.unitPricePaise * item.quantity)}</strong></li>)}</ul>
            <div className="receipt-total"><span>Total paid</span><strong>{formatPricePaise(order.amountPaise)}</strong></div>
            {order.totalRefundedPaise > 0 && <div className="receipt-total"><span>Processed refunds</span><strong>{formatPricePaise(order.totalRefundedPaise)}</strong></div>}
            {order.paymentVerifiedAt && <p className="receipt-verified-at">Verified {new Date(order.paymentVerifiedAt).toLocaleString('en-IN')} · Razorpay</p>}
            <div className="receipt-footer"><a href="/orders">Back to order history</a>{['paid', 'partially_refunded'].includes(order.status) && <a href="/my-courses">Open purchased courses</a>}</div>
          </section>}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
