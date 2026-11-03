/**
 * Dark and light palettes, taken from the website's design tokens (client/src/index.css).
 * `c` is ONE mutable object: switching theme overwrites its values, and App re-renders the tree, so every screen simply reads `c.something`.
 */
export type Mode = "dark" | "light";

const dark = {
  bg: "#30261f", // page background
  card: "#000000", // product cards, inputs, tab bar
  tint: "#3d3128", // soft wells and panels
  text: "#f8f5ed",
  muted: "#c9bdaf",
  border: "#4a3f36",
  line: "rgba(248,245,237,0.35)",
  brand: "#e5ad52", // buttons
  onBrand: "#30261f",
  accent: "#e5ad52", // amber used as TEXT / icon colour on the page background
  hero: "#6e4700", // hero panel and cart strip
  tile: "#000000", // category tiles
  strip: "#000000", // "how it works" band
  cta: "#000000", // "get your place stocked" band
  topbar: "#000000", // announcement bar / status bar area
  footer: "#6e4700",
  feature: "#6e4700", // ice feature panel
  chipBg: "#f6e8c4", // selected filter chip
  chipText: "#30261f",
  imgWell: "#f3ede0",
  danger: "#ff8f86",
  ok: "#7fd39b",
  warn: "#f2b866",
  /** The website's light theme keeps footer / feature / announcement bar dark, so text on them is always light. */
  onDark: "#f8f5ed",
  onDarkMuted: "#c9bdaf",
};

const light: typeof dark = {
  bg: "#f8f5ed",
  card: "#fffcf7",
  tint: "#ece5d7",
  text: "#30261f",
  muted: "#776d61",
  border: "#dfd8ca",
  line: "rgba(48,38,31,0.3)",
  brand: "#e5ad52",
  onBrand: "#30261f",
  accent: "#7a4e0e",
  hero: "#dfd8ca",
  tile: "#e8e1d2",
  strip: "#eee8dd",
  cta: "#f6e8c4",
  topbar: "#30261f",
  footer: "#30261f",
  feature: "#30261f",
  chipBg: "#30261f",
  chipText: "#f8f5ed",
  imgWell: "#f3ede0",
  danger: "#b3261e",
  ok: "#1d6a39",
  warn: "#8a5200",
  onDark: "#f8f5ed",
  onDarkMuted: "#c9bdaf",
};

export const PALETTES: Record<Mode, typeof dark> = { dark, light };

export const c: typeof dark & { brandDark: string } = { ...dark, brandDark: dark.brand };

let current: Mode = "dark";
let version = 0;
export const currentMode = () => current;
/** Bumped on every switch, so cached StyleSheets know to rebuild. */
export const themeVersion = () => version;

export function applyTheme(mode: Mode) {
  current = mode;
  version++;
  Object.assign(c, PALETTES[mode], { brandDark: PALETTES[mode].brand });
}

/** Satisfy (script) is used for the logo and headings, Instrument Serif for bundle names. Loaded in App.tsx. */
export const script = "Satisfy_400Regular";
export const serif = "InstrumentSerif_400Regular";
/** Always-cream surfaces (ice feature cards, step icons, progress bar). */
export const cream = "#f6e8c4";
/** Always-dark ink, for text that sits on cream / amber surfaces. */
export const ink = "#30261f";
