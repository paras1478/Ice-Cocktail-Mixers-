import { createContext, useContext } from "react";
import type { Mode } from "../lib/theme";

interface ThemeApi {
  mode: Mode;
  toggle: () => void;
}
/** Provided by App.tsx, which owns the theme state (App re-rendering is what repaints the whole tree). */
export const ThemeContext = createContext<ThemeApi>({ mode: "dark", toggle: () => undefined });
export const useTheme = () => useContext(ThemeContext);
