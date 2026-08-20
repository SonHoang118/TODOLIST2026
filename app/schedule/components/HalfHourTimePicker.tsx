"use client";

import { useEffect, useRef, useState } from "react";
import { slotLabel } from "../lib/date";

interface HalfHourTimePickerProps {
  value: number;
  onChange: (slot: number) => void;
  minSlot?: number;
  maxSlot?: number;
  ariaLabel?: string;
}

const HALF_HOUR_SLOTS = Array.from({ length: 48 }, (_, slot) => slot);

export function HalfHourTimePicker({ value, onChange, minSlot = 0, maxSlot = 47, ariaLabel = "Chọn giờ" }: HalfHourTimePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const safeValue = Math.max(0, Math.min(47, value));
  const availableSlots = HALF_HOUR_SLOTS.filter((slot) => slot >= minSlot && slot <= maxSlot);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: "center" }));
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 tabular-nums transition hover:bg-white/10"
      >
        <span>{slotLabel(safeValue)}</span>
        <svg viewBox="0 0 20 20" fill="none" className={`h-4 w-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div role="listbox" aria-label={ariaLabel} className="absolute left-1/2 top-full z-30 mt-2 max-h-56 w-28 -translate-x-1/2 overflow-y-auto rounded-xl border border-white/15 bg-zinc-800 p-1.5 shadow-2xl">
          {availableSlots.map((slot) => {
            const selected = slot === safeValue;
            return (
              <button
                ref={selected ? selectedRef : undefined}
                key={slot}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(slot);
                  setOpen(false);
                }}
                className={`block w-full rounded-lg px-3 py-2 text-center text-sm tabular-nums transition ${selected ? "bg-violet-600 font-bold text-white" : "text-zinc-100 hover:bg-white/10"}`}
              >
                {slotLabel(slot)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
