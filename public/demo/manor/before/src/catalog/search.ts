import { listCategory } from "./category";
import { expandTerms } from "./synonyms";

export function searchCatalog(term: string, category: string): string[] {
  const words = expandTerms(term);
  return listCategory(category).filter((id) => words.some((word) => id.includes(word)));
}
