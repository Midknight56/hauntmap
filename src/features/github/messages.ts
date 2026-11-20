// Every string of the GitHub route (design.md, Messages). Words rule: no text joins two words with a hyphen or dash.
// Parts that come from data (owner, repository, ref, paths, status text, error names) are exempt.

function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

export const PRIVACY_NOTE = "The repository name and file paths are sent to the jsDelivr CDN to fetch the files. Local folder analysis sends nothing.";
export const SUBFOLDER_REJECTED = "Subfolders are not supported yet. Paste the address of the repository itself.";
export const URL_FORMAT = "Enter an address like https://github.com/owner/repo or https://github.com/owner/repo/tree/branch.";
export const TYPE_REF = "Type the branch or tag to load.";
export const LABEL_URL = "Repository URL";
export const LABEL_REF = "Branch or tag";
export const BUTTON_LOAD = "Load";
export const RESOLVING = "Looking up the version of the repository";
export const LISTING = "Listing the files of the repository";
export const listFailed = (o: string, r: string, ref: string, status: string) => `Could not list ${o}/${r}@${ref}: ${status}. Only public repositories are supported.`;
export const cap = (o: string, r: string, ref: string, n: number, first: string) => `${o}/${r}@${ref} has ${n} included files; the limit is 400. First excluded: ${first}.`;
export const capBytes = (o: string, r: string, ref: string, size: string) => `${o}/${r}@${ref} has ${size} of included text; the limit is 25 MiB.`;
export const noFilesGh = (o: string, r: string, ref: string) => `No JavaScript or TypeScript files were found in ${o}/${r}@${ref}.`;
export const loadingStarted = (o: string, r: string, ref: string, n: number) => `Fetching ${n} files from ${o}/${r}@${ref}.`;
export const progress = (done: number, total: number) => `Fetched ${done} of ${total} files`;
export const loadCancelled = (label: string | null) => (label ? `Loading cancelled. ${label} is still open.` : "Loading cancelled.");
export const fetchFailed = (path: string, o: string, r: string, ref: string, status: string) => `Could not fetch ${path} from ${o}/${r}@${ref} (${status}). Nothing was loaded.`;
export const analyzeFailedGh = (message: string) => `The repository could not be analyzed (${message}).`;
export const loaded = (o: string, r: string, ref: string, n: number, m: number, rel: number, d: number) =>
  `Loaded ${o}/${r}@${ref}: ${plural(n, "file")}, ${plural(m, "module")}, ${plural(rel, "relation")}, ${plural(d, "diagnostic")}.`;
