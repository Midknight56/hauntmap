import { findProduct, listPrice } from "../catalog";
import { newId } from "../shared/ids";
import { limits } from "../config/limits";

export interface CartLine {
  productId: string;
  net: number;
}

const carts = new Map<string, CartLine[]>();

export function loadCart(cartId: string): CartLine[] {
  return carts.get(cartId) ?? [];
}

export function addLine(cartId: string, name: string, category: string, net: number): CartLine[] {
  const productId = findProduct(name, category) ?? newId("prd");
  const lines = loadCart(cartId);
  if (lines.length >= limits.maxCartLines) return lines;
  const next = [...lines, { productId, net: listPrice(net, 0.2) }];
  carts.set(cartId, next);
  return next;
}

export function clearCart(cartId: string): void {
  carts.delete(cartId);
}
