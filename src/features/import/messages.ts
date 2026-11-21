import { DEFAULT_ANALYSIS_OPTIONS } from "../../contracts/options";

// Every string of the local route and of the landing and comparison buttons (design.md, Messages).
// Words rule: no text joins two words with a hyphen or dash.

type Kind = "local" | "github";
type Purpose = "open" | "after";

function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

export const LANDING_LOCAL = "Analyze a local folder";
export const LANDING_GITHUB = "Load a GitHub repository";
export const COMPARE_LOCAL = "Local folder as the newer snapshot";
export const COMPARE_GITHUB = "GitHub repository as the newer snapshot";
export const heading = (kind: Kind, purpose: Purpose) =>
  `${kind === "local" ? "Analyze a local folder" : "Load a GitHub repository"}${purpose === "after" ? " as the newer snapshot" : ""}`;
export const NO_DIRECTORY_INPUT = "Folder selection is not available in this browser. Import a graph file instead.";
/** Under the folder field of the first screen (blind test fixes of 20 November 2026). */
export const CHOOSE_FOLDER_NOTE = "Choose the folder of the whole project. Its files are read in this browser and are not uploaded.";
export const REVIEW_SENTENCE = "Included files are read in this browser and kept in memory.";
export const tooManyFiles = (n: number) => `This folder has ${n.toLocaleString("en-US")} included files; the limit is 1,000. Choose a subfolder.`;
export const tooManyBytes = (size: string) => `This folder has ${size} of included text; the limit is 25 MiB. Choose a subfolder.`;
export const noFiles = (folder: string, k: number) => `No JavaScript or TypeScript files were found in ${folder} (${k} files skipped).`;
export const readingStarted = (n: number, folder: string) => `Reading ${n} files from ${folder}.`;
export const reading = (done: number, total: number) => `Reading ${done} of ${total} files`;
export const analyzing = (done: number, total: number) => `Analyzing ${done} of ${total} files`;
export const cancelled = (label: string | null) => (label ? `Analysis cancelled. ${label} is still open.` : "Analysis cancelled.");
export const summary = (folder: string, m: number, r: number, d: number, k: number, b: number, f: number) =>
  summarySentence(
    `Analyzed ${folder}`,
    [
      [m, (n) => plural(n, "module")],
      [r, (n) => plural(n, "relation")],
      [d, (n) => plural(n, "diagnostic")],
    ],
    [
      [k, (n) => `${plural(n, "file")} skipped before reading`],
      [b, (n) => `${plural(n, "binary file")} skipped`],
      [f, (n) => `${plural(n, "file")} failed to parse`],
    ],
  );
/** A part whose count is 0 is left out (13.1): the words rule is that a number shows only while it changes what the person does next. */
type Part = readonly [number, (n: number) => string];
function summarySentence(head: string, counts: readonly Part[], notes: readonly Part[]): string {
  const say = (parts: readonly Part[]): string[] => parts.filter(([n]) => n !== 0).map(([n, words]) => words(n));
  const first = say(counts);
  const second = say(notes);
  const body = [first.length > 0 ? first.join(", ") : null, second.length > 0 ? second.join(", ") : null].filter((part): part is string => part !== null);
  return body.length === 0 ? `${head}.` : `${head}: ${body.join("; ")}.`;
}
export const analyzeFailed = (message: string) => `The folder could not be analyzed (${message}).`;
export const PRESERVED = "The previous investigation is unchanged.";
export const SAVE_BUTTON = "Save investigation on this device";
export const SAVE_SENTENCE = "Saved investigations stay in this browser's storage until you forget them.";
export const savedMessage = (label: string, size: string, included: boolean) => `Saved ${label} on this device (${size}, source text ${included ? "included" : "left out"}).`;
export const SAVE_UNAVAILABLE = "Saving is not available in this browser.";
export const saveFailed = (name: string) => `The investigation could not be saved (${name}).`;
export const opened = (label: string) => `Opened ${label} from this device.`;
export const forgot = (label: string) => `Forgot ${label}.`;
export const savedInvalid = (label: string, err: string) => `The saved investigation ${label} is not valid (${err}) and was removed.`;
export const GRAPH_TOO_LARGE = "The graph file is larger than 25 MiB.";
export const graphNotJson = (message: string) => `The graph file is not JSON (${message}).`;
export const graphInvalid = (err: string) => `The graph file is not valid: ${err}.`;
export const imported = (label: string, m: number, r: number) => `Imported ${label}: ${plural(m, "module")}, ${plural(r, "relation")}. A graph file holds no source text.`;

// The review of Requirement 2.4. The counts keep the plural words of the requirement (`1 other file types`).
export const folderLine = (name: string) => `Folder: ${name}`;
export const includedLine = (n: number, size: string) => `Included: ${n} files, ${size}`;
export const skippedLine = (k: number) => `Skipped: ${k}`;
export const excludedDirsLine = (n: number) => `${n} in excluded directories (${DEFAULT_ANALYSIS_OPTIONS.excludeDirectories.join(", ")})`;
export const secretLine = (n: number) => `${n} secret or environment files`;
export const extensionLine = (n: number) => `${n} other file types`;
export const oversizedLine = (n: number) => `${n} over 1 MiB`;
export const includedListTitle = (n: number) => `Included files (${n})`;
export const skippedListTitle = (k: number) => `Skipped files (${k})`;
export const skippedEntry = (path: string, reasonInWords: string) => `${path} \u00b7 ${reasonInWords}`;
export const moreEntries = (m: number) => `\u2026 and ${m} more`;

// The saved list of Requirement 5.
export const savedListTitle = (n: number) => `Saved on this device (${n})`;
export const openSaved = (label: string) => `Open ${label}`;
export const forgetSaved = (label: string) => `Forget ${label}`;
export const savedItem = (label: string, modules: number, savedOn: string, included: boolean) => `${label} \u00b7 ${plural(modules, "module")} \u00b7 saved ${savedOn} \u00b7 source text ${included ? "included" : "left out"}`;
export const INCLUDE_SOURCE = "Include source text";

// Labels of the dialog controls and sections (Requirements 2, 5, 6 and 10.2).
export const CHOOSE_FOLDER = "Choose a folder";
export const CHOOSE_GRAPH_FILE = "Choose a graph file";
export const IMPORT_GRAPH_HEADING = "Import a graph file";
export const BUTTON_ANALYZE = "Analyze";
export const BUTTON_BACK = "Back";
export const BUTTON_CLOSE = "Close";
export const BUTTON_CANCEL = "Cancel";
