import { createProduct } from "./product";

const byCategory = new Map<string, string[]>();

export function addToCategory(category: string, name: string) {
  const product = createProduct(name);
  byCategory.set(category, [...(byCategory.get(category) ?? []), product.id]);
  return product;
}

export function listCategory(category: string): string[] {
  return byCategory.get(category) ?? [];
}
