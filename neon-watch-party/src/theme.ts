export type NeonPreset = {
  id: string;
  label: string;
  primary: string;
  light: string;
  dim: string;
};

export const NEON_PRESETS: NeonPreset[] = [
  { id: "crimson", label: "Crimson", primary: "#ff2a6d", light: "#ff6b9d", dim: "#7a0a2a" },
  { id: "cyan", label: "Cyber Cyan", primary: "#00e5ff", light: "#7af0ff", dim: "#0a4a52" },
  { id: "violet", label: "Violet", primary: "#b44dff", light: "#d49bff", dim: "#3d1266" },
  { id: "lime", label: "Toxic Lime", primary: "#b8ff2e", light: "#d4ff7a", dim: "#3a520a" },
  { id: "amber", label: "Amber", primary: "#ff9f1a", light: "#ffc266", dim: "#5c3a08" },
  { id: "ice", label: "Ice Blue", primary: "#6eb5ff", light: "#a8d4ff", dim: "#1a3a5c" },
];

const STORAGE_KEY = "neon-watch-party-theme";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function applyNeonTheme(primary: string, light: string, dim: string) {
  const rgb = hexToRgb(primary);
  const root = document.documentElement;
  root.style.setProperty("--neon-primary", primary);
  root.style.setProperty("--neon-light", light);
  root.style.setProperty("--neon-dim", dim);
  if (rgb) {
    root.style.setProperty("--neon-glow", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.55)`);
    root.style.setProperty("--neon-glow-soft", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
    root.style.setProperty("--neon-glow-faint", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`);
    root.style.setProperty("--neon-border", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`);
    root.style.setProperty("--neon-border-soft", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`);
    root.style.setProperty("--neon-bg-tint", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
    root.style.setProperty("--neon-chat-own", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
  }
}

export function loadSavedTheme(): NeonPreset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { presetId?: string; custom?: NeonPreset };
      if (parsed.custom) {
        applyNeonTheme(parsed.custom.primary, parsed.custom.light, parsed.custom.dim);
        return parsed.custom;
      }
      const preset = NEON_PRESETS.find((p) => p.id === parsed.presetId);
      if (preset) {
        applyNeonTheme(preset.primary, preset.light, preset.dim);
        return preset;
      }
    }
  } catch {
    /* ignore */
  }
  const def = NEON_PRESETS[0];
  applyNeonTheme(def.primary, def.light, def.dim);
  return def;
}

export function saveThemePreset(preset: NeonPreset) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: preset.id }));
  applyNeonTheme(preset.primary, preset.light, preset.dim);
}

export function saveCustomTheme(primary: string, light: string, dim: string) {
  const custom: NeonPreset = { id: "custom", label: "Custom", primary, light, dim };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ custom }));
  applyNeonTheme(primary, light, dim);
  return custom;
}

/** Slightly lighten hex for secondary accent */
export function lightenHex(hex: string, amount = 0.35): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(rgb.r))}${toHex(mix(rgb.g))}${toHex(mix(rgb.b))}`;
}

export function darkenHex(hex: string, amount = 0.55): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(rgb.r))}${toHex(mix(rgb.g))}${toHex(mix(rgb.b))}`;
}
