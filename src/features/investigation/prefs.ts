import type { Preset } from "../../contracts/types";

export interface Prefs {
  version: 1;
  motion: "system" | "reduce" | "allow";
  legendOpen: boolean;
  preset: Preset;
}

export const PREFS_KEY = "hauntmap.prefs.v1";
export const DEFAULT_PREFS: Prefs = { version: 1, motion: "system", legendOpen: true, preset: "static-value" };

export interface PrefsStore {
  read(): Prefs;
  write(prefs: Prefs): void;
}

const MOTIONS = ["system", "reduce", "allow"] as const;
const PRESETS = ["static-value", "type-inclusive", "dynamic-inclusive"] as const;

function parse(raw: string | null): Prefs {
  if (raw === null) return { ...DEFAULT_PREFS };
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...DEFAULT_PREFS };
  const record = value as Record<string, unknown>;
  const motion = MOTIONS.find((m) => m === record["motion"]);
  const preset = PRESETS.find((p) => p === record["preset"]);
  if (record["version"] !== 1 || motion === undefined || preset === undefined || typeof record["legendOpen"] !== "boolean") {
    return { ...DEFAULT_PREFS };
  }
  return { version: 1, motion, legendOpen: record["legendOpen"], preset };
}

/**
 * The preferences record. Every call is wrapped: a missing, throwing or unreadable storage gives
 * the defaults on read and is silent on write. The record holds no path, label or source text.
 */
export function createPrefsStore(storage: Pick<Storage, "getItem" | "setItem"> | null): PrefsStore {
  return {
    read() {
      try {
        if (storage === null) return { ...DEFAULT_PREFS };
        return parse(storage.getItem(PREFS_KEY));
      } catch {
        return { ...DEFAULT_PREFS };
      }
    },
    write(prefs) {
      try {
        storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        // A storage that refuses writes leaves the preference unsaved; nothing else depends on it.
      }
    },
  };
}

/** `reduce` is always reduced, `allow` never, `system` follows the media query. */
export function effectiveReducedMotion(prefs: Prefs, mediaMatches: boolean): boolean {
  if (prefs.motion === "reduce") return true;
  if (prefs.motion === "allow") return false;
  return mediaMatches;
}
