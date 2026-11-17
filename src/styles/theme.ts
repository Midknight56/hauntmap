// The three palettes of the manor and the one live copy of the active palette. `src/scene/styles.ts` exports
// that live copy as TOKENS, and `src/styles/tokens.css` is written from the same data by `themeCss()`
// (tests/ui/theme.test.ts compares them). Colors are names for the look of the place; none of them
// encodes risk, failure, coverage or churn.

export const TOKEN_NAMES = [
  "floor",
  "wing",
  "wingInk",
  "room",
  "roomInk",
  "roomSubdued",
  "roomSubduedInk",
  "door",
  "corridor",
  "sealed",
  "light",
  "panel",
  "ink",
  "inkMuted",
  "focus",
  "changed",
  "removed",
  "added",
  "wall",
  "joint",
  "plate",
  "plateInk",
  "passage",
  "ghost",
  "edge",
  "onFill",
  "selectedFill",
  "mapGlow",
  "wallLine",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Palette = Record<TokenName, string>;

export const THEME_NAMES = ["candlelit-manor", "moonlit-crypt", "graveyard-fog"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export interface Theme {
  name: ThemeName;
  title: string;
  colors: Palette;
}

export const THEMES: Record<ThemeName, Theme> = {
  // The owner's design (.design-ref README, "Design tokens"): oxblood dark, brass candle, bone ink, an ecto green loop.
  // `wall` is the design's `edge` (4.21:1 on the page colour, so a wall that carries meaning can be seen); the design's own
  // wall colour is `wallLine`, used for the borders of rooms and wings and for dividers, which draw nothing the text does not also say.
  "candlelit-manor": {
    name: "candlelit-manor",
    title: "Candlelit manor",
    colors: {
      floor: "#170d10",
      wing: "#1e1115",
      wingInk: "#ede3d0",
      room: "#2a181e",
      roomInk: "#ede3d0",
      roomSubdued: "#2a181e",
      roomSubduedInk: "#ede3d0",
      door: "#8c6f74",
      corridor: "#7df2c6",
      sealed: "#bba9a6",
      light: "#ffd98f",
      panel: "#22141a",
      ink: "#ede3d0",
      inkMuted: "#bba9a6",
      focus: "#f2b24c",
      changed: "#f2b24c",
      removed: "#ede3d0",
      added: "#a6e06a",
      wall: "#8c6f74",
      joint: "#120a0d",
      plate: "#22141a",
      plateInk: "#ede3d0",
      passage: "#8c6f74",
      ghost: "#f2fff8",
      edge: "#8c6f74",
      onFill: "#3a232a",
      selectedFill: "#3b2616",
      mapGlow: "#2c171d",
      wallLine: "#6b464c",
    },
  },
  // Deep blue black, moon silver ink, lantern gold doors, a violet loop corridor.
  "moonlit-crypt": {
    name: "moonlit-crypt",
    title: "Moonlit crypt",
    colors: {
      floor: "#080c16",
      wing: "#131b2e",
      wingInk: "#dbe3f2",
      room: "#243250",
      roomInk: "#eef3fb",
      roomSubdued: "#111827",
      roomSubduedInk: "#b9c6dd",
      door: "#f0c04a",
      corridor: "#b48cff",
      sealed: "#aebbd3",
      light: "#7fe3f5",
      panel: "#0f1524",
      ink: "#e8eef8",
      inkMuted: "#aab8d0",
      focus: "#ffd75e",
      changed: "#f0b429",
      removed: "#a9b4c8",
      added: "#5ad48a",
      wall: "#7388ad",
      joint: "#1a2438",
      plate: "#1d2a46",
      plateInk: "#e8eef8",
      passage: "#6c7fa4",
      ghost: "#f2f6ff",
      edge: "#8497bd",
      onFill: "#24304a",
      selectedFill: "#2d3350",
      mapGlow: "#17203a",
      wallLine: "#4a5c82",
    },
  },
  // Moss and slate, parchment ink, ember orange doors, a pale cyan loop corridor.
  "graveyard-fog": {
    name: "graveyard-fog",
    title: "Graveyard fog",
    colors: {
      floor: "#0c150e",
      wing: "#1f2b23",
      wingInk: "#ece4cc",
      room: "#35453b",
      roomInk: "#f5efd9",
      roomSubdued: "#19221c",
      roomSubduedInk: "#c9c3a8",
      door: "#ff8a3d",
      corridor: "#8fe8ee",
      sealed: "#c2c0a4",
      light: "#ffe9a8",
      panel: "#131d16",
      ink: "#f2ecd6",
      inkMuted: "#bdb797",
      focus: "#ffd166",
      changed: "#f0b429",
      removed: "#b3b8a0",
      added: "#7ed957",
      wall: "#7e9484",
      joint: "#26332a",
      plate: "#2c3b31",
      plateInk: "#f5efd9",
      passage: "#6f8576",
      ghost: "#f0fbf8",
      edge: "#8fa595",
      onFill: "#2c3b31",
      selectedFill: "#3a3a28",
      mapGlow: "#1c2a20",
      wallLine: "#55695c",
    },
  },
};

/** The background of the map area, as the design README states it. `app.css` writes it with `var(--map-glow)`, which is `#2C171D` in the default palette. */
export const MAP_BACKGROUND = "radial-gradient(900px 620px at 44% 40%, #2C171D, transparent 72%)";

export const DEFAULT_THEME: ThemeName = "candlelit-manor";

/** The live palette. Everything that draws reads it at draw time; `setTheme` rewrites it in place. */
export const liveTokens: Palette = { ...THEMES[DEFAULT_THEME].colors };

let current: ThemeName = DEFAULT_THEME;
const listeners = new Set<(name: ThemeName) => void>();

export function currentTheme(): ThemeName {
  return current;
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_NAMES as readonly string[]).includes(value);
}

/** Switch palette: TOKENS change in place, `data-theme` follows, and every listener (the scene) redraws. A name that is not a palette is ignored. */
export function setTheme(name: ThemeName): void {
  if (!isThemeName(name)) return;
  current = name;
  Object.assign(liveTokens, THEMES[name].colors);
  if (typeof document !== "undefined") document.documentElement.dataset["theme"] = name;
  for (const listener of [...listeners]) listener(name);
}

export function onThemeChange(listener: (name: ThemeName) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function block(selector: string, colors: Palette): string {
  const lines = TOKEN_NAMES.map((key) => `  --${kebab(key)}: ${colors[key]};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

/** The custom properties of every palette. `src/styles/tokens.css` starts with exactly this text. */
export function themeCss(): string {
  const parts = [
    "/* Design tokens, written from src/styles/theme.ts by themeCss(); tests/ui/theme.test.ts and tests/ui/styles.test.ts compare them. */\n",
    block(":root", THEMES[DEFAULT_THEME].colors),
    ...THEME_NAMES.filter((n) => n !== DEFAULT_THEME).map((n) => block(`[data-theme="${n}"]`, THEMES[n].colors)),
  ];
  return parts.join("\n");
}
