import { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { adminApi, formatRupees } from '../../services/adminApi.js';

export default function AdminOrderPanel() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [reviewBusyId, setReviewBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    adminApi.list('orders', { page, limit: 15, status, q: appliedSearch }, { signal: controller.signal }).then((result) => {
      setItems(result.items ?? []);
      setPagination(result.pagination ?? { page, pages: 1, total: (result.items ?? []).length });
      setError('');
      setState('ready');
    }).catch((requestError) => {
      if (requestError?.name === 'AbortError') return;
      setError(requestError.message || 'Orders could not be loaded.');
      setState('error');
    });
    return () => controller.abort();
  }, [page, status, appliedSearch, retryCount]);

  const reviewRefund = async (order, decision) => {
    if (decision === 'revoke-access' && !window.confirm('Revoke this student’s access to the resources in this partially refunded order?')) return;
    setReviewBusyId(order.id);
    setMessage('');
    setError('');
    try {
      await adminApi.create(`orders/${encodeURIComponent(order.id)}/refund-review`, { decision });
      setMessage(decision === 'revoke-access' ? 'Access was revoked for this partially refunded order.' : 'Access will remain active for this partially refunded order.');
      setRetryCount((count) => count + 1);
    } catch (requestError) {
      setError(requestError.message || 'The refund review could not be saved.');
    } finally {
      setReviewBusyId('');
    }
  };

  return (
    <section className="admin-resource-panel" aria-labelledby="admin-orders-title">
      <div className="admin-panel-heading"><div><h2 id="admin-orders-title">Orders</h2><p>Review order records, payment state, refunds and the student and products recorded on each order.</p></div></div>
      <div className="admin-list-card">
        <div className="admin-list-toolbar">
          <form className="admin-search-form" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); }}>
            <label className="sr-only" htmlFor="admin-order-search">Search orders or students</label>
            <input id="admin-order-search" type="search" placeholder="Search student, email or item…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button className="admin-quiet-button" type="submit"><Icon name="search" size={16} /> Search</button>
          </form>
          <label className="admin-status-filter" htmlFor="admin-order-status"><span>Payment status</span>
            <select id="admin-order-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">All orders</option><option value="pending">Pending</option><option value="paid">Paid and verified</option>
              <option value="partially_refunded">Partially refunded</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option>
            </select>
          </label>
        </div>
        {message && <div className="admin-state" role="status">{message}</div>}
        {error && <div className="admin-state is-error" role="alert"><p>{error}</p>{state === 'error' && <button className="admin-quiet-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>}</div>}
        {state === 'loading' && <div className="admin-state" role="status"><span className="loading-mark" /> Loading order records…</div>}
        {state === 'ready' && !items.length && <div className="admin-state"><Icon name="file" size={21} /><p>No order records match these filters.</p></div>}
        {state === 'ready' && items.length > 0 && <div className="admin-table-scroll"><table className="admin-table admin-orders-table">
          <thead><tr><th>Order</th><th>Student</th><th>Purchase</th><th>Amount</th><th>Payment</th><th>Verified</th><th>Date</th><th /></tr></thead>
          <tbody>{items.map((order) => <tr key={order.id}>
            <td><span className="admin-order-id">{order.id.slice(-8).toUpperCase()}</span></td>
            <td><strong>{order.student?.name || 'Student record unavailable'}</strong><small>{order.student?.email || '—'}</small></td>
            <td>{order.items?.length ?? 0} item{order.items?.length === 1 ? '' : 's'}</td>
            <td>{formatRupees(order.amountPaise)}</td>
            <td><span className={`admin-status-pill status-${order.status}`}>{order.status.replaceAll('_', ' ')}</span><small>{order.paymentProvider || 'No provider recorded'}</small></td>
            <td>{order.paymentVerifiedAt ? new Date(order.paymentVerifiedAt).toLocaleString('en-IN') : '—'}</td>
            <td>{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN') : '—'}</td>
            <td>
              <button className="admin-quiet-button" type="button" aria-expanded={expandedId === order.id} onClick={() => setExpandedId((current) => current === order.id ? '' : order.id)}>{expandedId === order.id ? 'Hide' : 'Details'}</button>
              {expandedId === order.id && <div className="admin-order-detail">
                <strong>Payment and purchase details</strong>
                <ul>{order.items?.map((item, index) => <li key={`${item.title}-${index}`}><span>{item.title}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</span><span>{formatRupees(item.unitPricePaise * item.quantity)}</span></li>)}</ul>
                <p>Original payment: {formatRupees(order.amountPaise)}</p>
                <p>Total refunded: {formatRupees(order.totalRefundedPaise ?? 0)}</p>
                <p>Remaining captured amount: {formatRupees(order.remainingCapturedPaise ?? order.amountPaise)}</p>
                <p>Entitlement status: <strong>{order.entitlementStatus || 'not-granted'}</strong></p>
                <p>Partial-refund review: <strong>{order.refundReviewStatus || 'not-required'}</strong></p>
                {order.refunds?.length > 0 && <><strong>Refund transactions</strong><ul>{order.refunds.map((refund) => <li key={refund.refundId}><span>{refund.refundId}<small>{refund.status} · {refund.reconciliationStatus}</small></span><span>{formatRupees(refund.amountPaise)}</span></li>)}</ul></>}
                {order.status === 'partially_refunded' && order.refundReviewStatus === 'pending' && <div className="admin-refund-review-actions">
                  <p>Review the partial refund and choose the access decision.</p>
                  <button className="admin-secondary-button" type="button" disabled={reviewBusyId === order.id} onClick={() => reviewRefund(order, 'keep-access')}>{reviewBusyId === order.id ? 'Saving…' : 'Keep access'}</button>
                  <button className="admin-quiet-button" type="button" disabled={reviewBusyId === order.id} onClick={() => reviewRefund(order, 'revoke-access')}>Revoke access</button>
                </div>}
                <p>Only verified captured payments are counted; processed refunds are subtracted from net verified revenue.</p>
              </div>}
            </td>
          </tr>)}</tbody>
        </table></div>}
        {state === 'ready' && pagination.pages > 1 && <div className="admin-pagination"><span>{pagination.total} orders · page {page} of {pagination.pages}</span><div><button type="button" className="admin-quiet-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button type="button" className="admin-quiet-button" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>}
      </div>
    </section>
  );
}
