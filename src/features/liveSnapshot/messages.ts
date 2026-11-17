export const LIVE_PATH = "demo/live.json";

export const MSG_MISSING = "No live snapshot yet. Run `pnpm hauntmap analyze haunts/manor --out public/demo/live.json`, or let the Kiro hook write it.";

export const msgMalformed = (firstError: string): string => `The live snapshot at demo/live.json is not valid: ${firstError}. The current view is unchanged.`;

export const msgFetchFailed = (reason: string): string => `The live snapshot could not be fetched (${reason}). The current view is unchanged.`;

export const MSG_NO_COMPARE = "Comparison is not available in this build.";

export const msgLoaded = (afterLabel: string, modules: number, beforeLabel: string): string =>
  `Live snapshot loaded: ${afterLabel} (${modules} modules) is the newer snapshot; ${beforeLabel} is the older one.`;

export const msgSampleAnalyzeFailed = (message: string): string => `The manor sample could not be analyzed (${message}). Reload the page.`;