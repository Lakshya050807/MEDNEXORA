import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'clinica-study-cart-v1';
const CartContext = createContext(null);

function readCart() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.productId === 'string' && item.productId.length <= 100)
      .map((item) => ({ productId: item.productId, quantity: 1 }));
  } catch {
    return [];
  }
}

function writeCart(items) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* In-memory cart still works when storage is unavailable. */ }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readCart);

  useEffect(() => {
    writeCart(items);
  }, [items]);

  const addProduct = useCallback((product) => {
    const productId = product?.id ?? product?._id;
    if (!productId) return { added: false, reason: 'This resource has no valid catalogue ID.' };
    if (!Number.isSafeInteger(product?.currentPricePaise)) return { added: false, reason: 'Pricing is not available for this resource yet.' };
    if (product.isFree || product.currentPricePaise === 0) return { added: false, reason: 'This resource is free and does not need checkout.' };
    const next = items.some((item) => item.productId === String(productId))
      ? items
      : [...items, { productId: String(productId), quantity: 1 }];
    writeCart(next);
    setItems(next);
    return { added: true };
  }, [items]);

  const removeProduct = useCallback((productId) => {
    const next = items.filter((item) => item.productId !== String(productId));
    writeCart(next);
    setItems(next);
  }, [items]);

  const removeProducts = useCallback((productIds) => {
    const removeIds = new Set(productIds.map(String));
    const next = items.filter((item) => !removeIds.has(item.productId));
    writeCart(next);
    setItems(next);
  }, [items]);

  const clearCart = useCallback(() => { writeCart([]); setItems([]); }, []);
  const hasProduct = useCallback((productId) => items.some((item) => item.productId === String(productId)), [items]);
  const value = useMemo(() => ({ items, count: items.length, addProduct, removeProduct, removeProducts, clearCart, hasProduct }), [items, addProduct, removeProduct, removeProducts, clearCart, hasProduct]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider.');
  return context;
}
