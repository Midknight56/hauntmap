import { createProduct } from "./product";
import { reserve } from "./stock";

const onHand = new Map<string, number>();

export function stockNewProduct(name: string, quantity: number) {
  const product = createProduct(name);
  onHand.set(product.id, quantity);
  return product;
}

export function takeStock(productId: string, wanted: number) {
  const result = reserve(onHand.get(productId) ?? 0, wanted);
  if (result.ok) onHand.set(productId, result.value);
  return result;
}
