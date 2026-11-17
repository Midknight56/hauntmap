import { newId } from "../shared/ids";
export type { Price } from "./price";

export const TAX_CLASSES = ["standard", "reduced", "zero"] as const;

export interface Product {
  id: string;
  name: string;
  taxClass: (typeof TAX_CLASSES)[number];
}

export function createProduct(name: string): Product {
  return { id: newId("prd"), name, taxClass: "standard" };
}
