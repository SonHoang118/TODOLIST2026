"use client";

import { useState, useRef, useEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLS          = 3;
const ROWS          = 4;
const PAGE_SIZE     = COLS * ROWS; // 12 cells / page
const TOTAL_PAGES   = 3;
const LONG_PRESS_MS = 350;
const SWIPE_MIN     = 50;   // px horizontal to trigger page change
const DRAG_DELTA    = 8;    // px movement that cancels long-press

const PALETTE = [
  "bg-violet-600", "bg-emerald-600", "bg-amber-500",  "bg-sky-600",
  "bg-rose-600",   "bg-teal-600",    "bg-orange-500", "bg-indigo-600",
  "bg-pink-600",   "bg-cyan-600",    "bg-lime-600",   "bg-fuchsia-600",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Block { id: number; label: string; cellIndex: number; color: string; }

// ─── Component ────────────────────────────────────────────────────────────────

export default function GridPage() {
  const [page, setPage]             = useState(0);
  const [blocks, setBlocks]         = useState<Block[]>([]);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const [badge, setBadge]           = useState<{ text: string; kind: "swipe" | "touch" | "drag" } | null>(null);

  // Stable refs so imperative listeners never capture stale state
  const blockIdRef  = useRef(0);
  const colorRef    = useRef(0);
  const blocksRef   = useRef<Block[]>([]);
  blocksRef.current = blocks;

  const fn = useRef({
    setPage, setBlocks, setDraggingId, setHoveredCell, setBadge,
    nextId:    () => ++blockIdRef.current,
    nextColor: () => { const c = PALETTE[colorRef.current % PALETTE.length]; colorRef.current++; return c; },
  });
  // Reassign every render so handlers always call the current setter
  fn.current.setPage        = setPage;
  fn.current.setBlocks      = setBlocks;
  fn.current.setDraggingId  = setDraggingId;
  fn.current.setHoveredCell = setHoveredCell;
  fn.current.setBadge       = setBadge;

  // Mutable gesture state (no renders needed)
  const gs = useRef({
    sx: 0, sy: 0, t0: 0,
    timer:          null as ReturnType<typeof setTimeout> | null,
    isDragging:     false,
    draggingItemId: null as number | null,
    touchedCellEl:  null as HTMLElement | null,  // cell element the finger started on
    touchedItemId:  null as number | null,        // block id if finger started on a block
  });

  const clearTimer = () => {
    if (gs.current.timer) { clearTimeout(gs.current.timer); gs.current.timer = null; }
  };

  // ── Single unified touch handler on the carousel ──────────────────────────
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      gs.current.sx = t.clientX;
      gs.current.sy = t.clientY;
      gs.current.t0 = Date.now();

      // Identify what was touched via data attributes
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
      const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
      gs.current.touchedCellEl  = cell;
      gs.current.touchedItemId  = item ? Number(item.dataset.itemId) : null;

      // Begin long-press countdown if a block was touched
      if (gs.current.touchedItemId !== null) {
        const id = gs.current.touchedItemId;
        gs.current.draggingItemId = id;
        gs.current.timer = setTimeout(() => {
          gs.current.isDragging = true;
          fn.current.setDraggingId(id);
          fn.current.setBadge({ text: "DRAG", kind: "drag" });
        }, LONG_PRESS_MS);
      }
    };

    const onMove = (e: TouchEvent) => {
      const t  = e.touches[0];
      const dx = Math.abs(t.clientX - gs.current.sx);
      const dy = Math.abs(t.clientY - gs.current.sy);

      // Any significant movement cancels the long-press → drag won't start
      if ((dx > DRAG_DELTA || dy > DRAG_DELTA) && !gs.current.isDragging) {
        clearTimer();
      }

      if (gs.current.isDragging) {
        e.preventDefault(); // block scroll while dragging
        const under = document.elementFromPoint(t.clientX, t.clientY);
        const cell  = under?.closest<HTMLElement>("[data-cell]");
        fn.current.setHoveredCell(cell ? Number(cell.dataset.cell) : null);
      } else if (dx > dy && dx > 5) {
        e.preventDefault(); // block horizontal browser scroll during swipe
      }
    };

    const onEnd = (e: TouchEvent) => {
      clearTimer();

      const t   = e.changedTouches[0];
      const dx  = t.clientX - gs.current.sx;
      const dy  = t.clientY - gs.current.sy;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // ── Case 1: dragging block ──────────────────────────────────────────
      if (gs.current.isDragging && gs.current.draggingItemId !== null) {
        const srcId    = gs.current.draggingItemId;
        const srcBlock = blocksRef.current.find(b => b.id === srcId);
        const under    = document.elementFromPoint(t.clientX, t.clientY);
        const destCell = under?.closest<HTMLElement>("[data-cell]");

        if (destCell && srcBlock) {
          const destIdx = Number(destCell.dataset.cell);
          const occupant = blocksRef.current.find(b => b.cellIndex === destIdx && b.id !== srcId);

          if (occupant) {
            // Swap source and occupant
            const srcIdx = srcBlock.cellIndex;
            fn.current.setBlocks(prev => prev.map(b => {
              if (b.id === srcId)       return { ...b, cellIndex: destIdx };
              if (b.id === occupant.id) return { ...b, cellIndex: srcIdx };
              return b;
            }));
            fn.current.setBadge({ text: `DRAG swap`, kind: "drag" });
          } else {
            fn.current.setBlocks(prev =>
              prev.map(b => b.id === srcId ? { ...b, cellIndex: destIdx } : b)
            );
            fn.current.setBadge({ text: `DRAG → cell ${destIdx}`, kind: "drag" });
          }
        } else {
          fn.current.setBadge({ text: "DRAG cancelled", kind: "drag" });
        }

        fn.current.setDraggingId(null);
        fn.current.setHoveredCell(null);
        gs.current.isDragging     = false;
        gs.current.draggingItemId = null;

      // ── Case 2: swipe to change page ────────────────────────────────────
      } else if (adx > SWIPE_MIN && adx > ady) {
        if (dx < 0) {
          fn.current.setPage(p => Math.min(TOTAL_PAGES - 1, p + 1));
          fn.current.setBadge({ text: "SWIPE →", kind: "swipe" });
        } else {
          fn.current.setPage(p => Math.max(0, p - 1));
          fn.current.setBadge({ text: "SWIPE ←", kind: "swipe" });
        }

      // ── Case 3: tap on an empty cell → create block ─────────────────────
      } else if (adx < 12 && ady < 12 && Date.now() - gs.current.t0 < 600) {
        const cell = gs.current.touchedCellEl;
        if (cell && gs.current.touchedItemId === null) {
          const cellIdx = Number(cell.dataset.cell);
          if (!blocksRef.current.find(b => b.cellIndex === cellIdx)) {
            const id    = fn.current.nextId();
            const color = fn.current.nextColor();
            fn.current.setBlocks(prev => [...prev, { id, label: `Task ${id}`, cellIndex: cellIdx, color }]);
            fn.current.setBadge({ text: `TOUCH cell ${cellIdx}`, kind: "touch" });
          }
        }
      }

      gs.current.touchedCellEl = null;
      gs.current.touchedItemId = null;
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove",  onMove,  { passive: false });
    el.addEventListener("touchend",   onEnd,   { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, []);

  // Auto-clear gesture badge after 1.5 s
  useEffect(() => {
    if (!badge) return;
    const t = setTimeout(() => setBadge(null), 1500);
    return () => clearTimeout(t);
  }, [badge]);

  // Desktop: click on empty cell to create block
  const handleCellClick = (cellIdx: number) => {
    if (!blocksRef.current.find(b => b.cellIndex === cellIdx)) {
      const id    = ++blockIdRef.current;
      const color = PALETTE[colorRef.current % PALETTE.length];
      colorRef.current++;
      setBlocks(prev => [...prev, { id, label: `Task ${id}`, cellIndex: cellIdx, color }]);
      setBadge({ text: `TOUCH cell ${cellIdx}`, kind: "touch" });
    }
  };

  const badgeColor = badge
    ? badge.kind === "swipe" ? "bg-violet-600"
    : badge.kind === "touch" ? "bg-emerald-600"
    : "bg-amber-500"
    : "";

  return (
    <div className="flex flex-col h-dvh bg-zinc-950 text-white select-none overflow-hidden">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <h1 className="font-bold text-base">Grid</h1>
        {/* Live gesture badge */}
        <div className="flex-1 flex justify-center">
          {badge && (
            <span className={`text-xs font-bold px-3 py-1 rounded-full text-white ${badgeColor}`}>
              {badge.text}
            </span>
          )}
        </div>
        <button
          onClick={() => setBlocks([])}
          className="text-xs text-zinc-500 px-2 py-1 rounded-lg bg-zinc-800 active:bg-zinc-700"
        >
          Clear
        </button>
        <a href="/" className="text-xs text-zinc-500 underline underline-offset-2">← Home</a>
      </header>

      {/* Page dots */}
      <div className="flex justify-center items-center gap-2 py-2 shrink-0">
        {Array.from({ length: TOTAL_PAGES }, (_, i) => (
          <button
            key={i}
            onClick={() => setPage(i)}
            className={`rounded-full transition-all duration-200 ${
              i === page ? "w-5 h-2 bg-white" : "w-2 h-2 bg-zinc-600"
            }`}
          />
        ))}
        <span className="text-[10px] text-zinc-600 ml-2">{page + 1} / {TOTAL_PAGES}</span>
      </div>

      {/* Carousel */}
      <div
        ref={carouselRef}
        className="flex-1 overflow-hidden"
        style={{ touchAction: "pan-y" }}
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(-${page * (100 / TOTAL_PAGES)}%)`,
            width: `${TOTAL_PAGES * 100}%`,
          }}
        >
          {Array.from({ length: TOTAL_PAGES }, (_, p) => (
            <div
              key={p}
              className="h-full p-2"
              style={{
                width: `${100 / TOTAL_PAGES}%`,
                display: "grid",
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gridTemplateRows: `repeat(${ROWS}, 1fr)`,
                gap: "8px",
              }}
            >
              {Array.from({ length: PAGE_SIZE }, (_, i) => {
                const cellIdx = p * PAGE_SIZE + i;
                const block   = blocks.find(b => b.cellIndex === cellIdx);
                const isHover = hoveredCell === cellIdx;

                return (
                  <div
                    key={cellIdx}
                    data-cell={cellIdx}
                    onClick={() => handleCellClick(cellIdx)}
                    className={`rounded-2xl border-2 relative overflow-hidden transition-all duration-150 ${
                      isHover
                        ? "border-white/50 bg-white/10 scale-[1.04]"
                        : block
                        ? "border-transparent"
                        : "border-zinc-800 border-dashed bg-zinc-900/30 active:bg-zinc-800/50"
                    }`}
                  >
                    {/* Empty cell number */}
                    {!block && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-800">
                        {cellIdx}
                      </span>
                    )}

                    {/* Block */}
                    {block && (
                      <div
                        data-item-id={block.id}
                        className={`absolute inset-0 ${block.color} flex flex-col items-center justify-center gap-0.5 transition-all duration-150 ${
                          draggingId === block.id
                            ? "opacity-50 scale-95 ring-4 ring-white/50 ring-inset"
                            : ""
                        }`}
                      >
                        <span className="text-white font-semibold text-sm leading-tight text-center px-1">
                          {block.label}
                        </span>
                        <span className="text-white/50 text-[9px]">#{cellIdx}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Hint bar */}
      <div className="shrink-0 flex justify-around items-center px-2 py-2.5 border-t border-zinc-800 bg-zinc-900/60">
        <span className="text-[10px] text-zinc-500">
          <span className="text-emerald-500">👆</span> Chạm ô trống
        </span>
        <span className="text-zinc-800">│</span>
        <span className="text-[10px] text-zinc-500">
          <span className="text-violet-400">←→</span> Vuốt sang trang
        </span>
        <span className="text-zinc-800">│</span>
        <span className="text-[10px] text-zinc-500">
          <span className="text-amber-400">✋</span> Giữ để kéo
        </span>
      </div>
    </div>
  );
}
