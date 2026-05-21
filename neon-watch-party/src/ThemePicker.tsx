import { NEON_PRESETS, type NeonPreset } from "./theme";

type Props = {
  themePreset: NeonPreset;
  customHex: string;
  onPickPreset: (p: NeonPreset) => void;
  onCustomHex: (hex: string) => void;
  compact?: boolean;
};

export function ThemePicker({ themePreset, customHex, onPickPreset, onCustomHex, compact }: Props) {
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <p className="text-xs text-zinc-500 uppercase tracking-wider">Neon color</p>
      <div className="flex flex-wrap gap-2">
        {NEON_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            onClick={() => onPickPreset(p)}
            className={`h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 ${
              themePreset.id === p.id ? "border-white scale-110" : "border-zinc-700"
            }`}
            style={{ backgroundColor: p.primary, boxShadow: `0 0 12px ${p.primary}` }}
          />
        ))}
        <label
          className={`relative h-9 w-9 rounded-full border-2 border-dashed border-zinc-600 cursor-pointer overflow-hidden ${
            themePreset.id === "custom" ? "border-white" : ""
          }`}
          title="Custom color"
        >
          <input
            type="color"
            value={customHex}
            onChange={(e) => onCustomHex(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
          <span
            className="absolute inset-0 rounded-full"
            style={{ background: customHex, boxShadow: `0 0 10px ${customHex}` }}
          />
        </label>
      </div>
      <p className="text-[11px] text-zinc-600">Active: {themePreset.label}</p>
    </div>
  );
}
