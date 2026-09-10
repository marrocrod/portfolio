"use client";

import { useId } from "react";

interface SegmentedProps<T extends string> {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

/** Mutually exclusive choice rendered as a joined button row. Uses native radios for a11y. */
export function Segmented<T extends string>({ legend, value, options, onChange }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-[14px] text-ink-muted">{legend}</legend>
      <div className="inline-flex rounded-[3px] border border-ink/25 p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className="cursor-pointer rounded-[2px] px-3.5 py-1.5 text-[15px] text-ink-muted has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-2 has-focus-visible:outline-accent"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface ChoiceListProps<T extends string> {
  legend: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  onChange: (v: T) => void;
}

/** Vertical radio list with a one-line explanation under each option. */
export function ChoiceList<T extends string>({ legend, value, options, onChange }: ChoiceListProps<T>) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-[14px] text-ink-muted">{legend}</legend>
      <div className="space-y-1">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer gap-3 rounded-[3px] px-2 py-2 -mx-2 hover:bg-ink/[0.04] has-checked:bg-ink/[0.06]"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-[5px] accent-accent"
            />
            <span>
              <span className="block text-[16px] text-ink">{o.label}</span>
              <span className="block text-[14px] leading-[1.45] text-ink-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Log scale maps the slider linearly onto log10(value). */
  log?: boolean;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function Slider({ label, value, min, max, step = 1, log = false, format = String, onChange }: SliderProps) {
  const id = useId();
  const toSlider = (v: number) => (log ? Math.log10(v) : v);
  const fromSlider = (s: number) => (log ? Number((10 ** s).toPrecision(2)) : s);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[15px] text-ink">
          {label}
        </label>
        <output htmlFor={id} className="text-[15px] tabular-nums text-ink-muted">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={toSlider(min)}
        max={toSlider(max)}
        step={log ? 0.01 : step}
        value={toSlider(value)}
        onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
        className="w-full accent-accent"
      />
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  pressed,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
  pressed?: boolean;
}) {
  const base = "rounded-[3px] px-3.5 py-1.5 text-[15px] transition-colors";
  const styles =
    variant === "primary"
      ? "bg-ink text-paper hover:bg-accent-strong"
      : "border border-ink/25 text-ink hover:border-ink/60 aria-pressed:border-ink aria-pressed:bg-ink/[0.06]";
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}
