"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { slotLabel } from "../lib/date";

interface HalfHourTimePickerProps {
  value: number;
  onChange: (slot: number) => void;
  minSlot?: number;
  maxSlot?: number;
  includeNextMidnight?: boolean;
  ariaLabel?: string;
}

const HALF_HOUR_SLOTS = Array.from({ length: 48 }, (_, slot) => slot);
const timeLabel = (slot: number) => slot === 48 ? "00:00" : slotLabel(slot);

export function HalfHourTimePicker({ value, onChange, minSlot = 0, maxSlot = 47, includeNextMidnight = false, ariaLabel = "Chọn giờ" }: HalfHourTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const highestSlot = includeNextMidnight ? 48 : 47;
  const safeValue = Math.max(0, Math.min(highestSlot, value));
  const slots = includeNextMidnight ? [...HALF_HOUR_SLOTS, 48] : HALF_HOUR_SLOTS;
  const availableSlots = slots.filter((slot) => slot >= minSlot && slot <= maxSlot);

  const togglePicker = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 112;
    const menuHeight = 224;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left + rect.width / 2 - menuWidth / 2));
    const top = rect.bottom + menuHeight + 8 <= window.innerHeight
      ? rect.bottom + 8
      : Math.max(8, rect.top - menuHeight - 8);
    setMenuPosition({ left, top });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={togglePicker}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded px-0.5 py-0.5 tabular-nums transition hover:bg-white/10"
      >
        {timeLabel(safeValue)}
      </button>

      {open && menuPosition && createPortal(
        <div ref={menuRef} role="listbox" aria-label={ariaLabel} className="fixed z-[100] max-h-56 w-28 overflow-y-auto rounded-xl border border-white/15 bg-zinc-800 p-1.5 shadow-2xl" style={menuPosition}>
          {availableSlots.map((slot) => {
            const selected = slot === safeValue;
            return (
              <button
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
                {timeLabel(slot)}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
