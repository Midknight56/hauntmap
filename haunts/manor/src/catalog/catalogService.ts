import { createProduct } from "./product";
import { withTax } from "./price";
import { stockNewProduct, takeStock } from "./inventory";
import { searchCatalog } from "./search";

export function findProduct(name: string, category: string) {
  const [first] = searchCatalog(name, category);
  return first ?? null;
}

export function listPrice(net: number, rate: number): number {
  return withTax({ net, taxClass: "standard" }, rate);
}

export function makeProduct(name: string, quantity: number) {
  return quantity > 0 ? stockNewProduct(name, quantity) : createProduct(name);
}

export function reserveProduct(productId: string, wanted: number) {
  return takeStock(productId, wanted);
}
