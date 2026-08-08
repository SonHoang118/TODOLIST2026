"use client";

import { useState, useRef, useEffect } from "react";

// ─── Grid config ──────────────────────────────────────────────────────────────

const COLS        = 8;
const ROWS        = 10;
const CELL        = 88;
const GAP         = 8;
const STRIDE      = CELL + GAP;
const GRID_W      = COLS * CELL + (COLS - 1) * GAP;
const GRID_H      = ROWS * CELL + (ROWS - 1) * GAP;
const INIT_PAD    = 12;
const LONG_PRESS_MS  = 350;
const DRAG_DELTA     = 8;
const HANDLE_H       = 24;  // resize handle bar height px

// All valid snap heights in ¼-cell increments (0.25 → ROWS)
const SNAP_SPANS = Array.from({ length: ROWS * 4 }, (_, i) => (i + 1) * 0.25);
const PALETTE    = [
  "bg-violet-600", "bg-emerald-600", "bg-amber-500",  "bg-sky-600",
  "bg-rose-600",   "bg-teal-600",    "bg-orange-500", "bg-indigo-600",
  "bg-pink-600",   "bg-cyan-600",    "bg-lime-600",   "bg-fuchsia-600",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Pixel height that exactly covers `span` cell-heights (including inter-cell gaps)
function spanToPx(span: number): number {
  const i = Math.floor(span);
  const f = span - i;
  if (i === 0) return f * CELL;
  if (f === 0) return i * CELL + (i - 1) * GAP;
  return span * CELL + i * GAP; // integer cells + trailing fraction
}

// Nearest valid snap span for a raw pixel height, capped at maxSpan
function snapSpan(px: number, maxSpan: number): number {
  const valid = SNAP_SPANS.filter(s => s <= maxSpan);
  return (valid.length ? valid : [0.25]).reduce(
    (best, s) => Math.abs(spanToPx(s) - px) < Math.abs(spanToPx(best) - px) ? s : best,
  );
}

const cellTopPx  = (ci: number) => Math.floor(ci / COLS) * STRIDE;
const cellLeftPx = (ci: number) => (ci % COLS) * STRIDE;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Block { id: number; label: string; cellIndex: number; color: string; span: number; }

// ─── Component ────────────────────────────────────────────────────────────────

export default function GridPage() {
  const [blocks, setBlocks]               = useState<Block[]>([]);
  const [draggingId, setDraggingId]       = useState<number | null>(null);
  const [longPressedId, setLongPressedId] = useState<number | null>(null);  // long press visual cue
  const [dragPos, setDragPos]             = useState({ x: 0, y: 0 });
  const [hoveredCell, setHoveredCell]     = useState<number | null>(null);
  const [resizingId, setResizingId]       = useState<number | null>(null);  // block showing resize handle
  const [badge, setBadge]                 = useState<string | null>(null);

  const blockIdRef      = useRef(0);
  const colorRef        = useRef(0);
  const blocksRef       = useRef<Block[]>([]);
  blocksRef.current     = blocks;
  const resizingIdRef   = useRef<number | null>(null);
  resizingIdRef.current = resizingId;

  // Callback refs — always current, safe to call from imperative handlers
  const fn = useRef({
    setBlocks, setDraggingId, setLongPressedId,
    setDragPos, setHoveredCell, setResizingId, setBadge,
    nextId:    (): number => ++blockIdRef.current,
    nextColor: (): string => { const c = PALETTE[colorRef.current % PALETTE.length]; colorRef.current++; return c; },
  });
  fn.current.setBlocks        = setBlocks;
  fn.current.setDraggingId    = setDraggingId;
  fn.current.setLongPressedId = setLongPressedId;
  fn.current.setDragPos       = setDragPos;
  fn.current.setHoveredCell   = setHoveredCell;
  fn.current.setResizingId    = setResizingId;
  fn.current.setBadge         = setBadge;

  // Pan: stored in ref, applied via direct DOM to avoid re-renders while panning
  const panRef       = useRef({ x: INIT_PAD, y: INIT_PAD });
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef      = useRef<HTMLDivElement>(null);
  // Per-block DOM refs for direct height manipulation during resize
  const blockEls     = useRef<Map<number, HTMLDivElement>>(new Map());
  const resizeSpanRef = useRef(1); // live span tracked during resize drag

  const applyPan = (x: number, y: number) => {
    const c = containerRef.current;
    if (!c) return;
    const cx = Math.min(INIT_PAD, Math.max(c.clientWidth  - GRID_W - INIT_PAD, x));
    const cy = Math.min(INIT_PAD, Math.max(c.clientHeight - GRID_H - INIT_PAD, y));
    panRef.current = { x: cx, y: cy };
    if (gridRef.current) gridRef.current.style.transform = `translate(${cx}px, ${cy}px)`;
  };

  const screenToCell = (sx: number, sy: number): number | null => {
    const c = containerRef.current;
    if (!c) return null;
    const r  = c.getBoundingClientRect();
    const gx = sx - r.left - panRef.current.x;
    const gy = sy - r.top  - panRef.current.y;
    const col = Math.floor(gx / STRIDE);
    const row = Math.floor(gy / STRIDE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    if (gx - col * STRIDE > CELL || gy - row * STRIDE > CELL) return null;
    return row * COLS + col;
  };

  // Mutable gesture state — no re-renders needed
  const gs = useRef({
    startX: 0, startY: 0,      // original touch start, never reset (for tap/threshold detection)
    panRefX: 0, panRefY: 0,    // reset each move for incremental pan delta
    t0: 0,
    isPanning: false,
    isDragging: false,
    longPressFired: false,
    isResizeDragging: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    draggingItemId:        null as number | null,
    resizeBlockId:         null as number | null,
    resizeBlockTopScreenY: 0,
    resizeMaxSpan:         ROWS as number,
    touchedCellIndex: null as number | null,
    touchedItemId:    null as number | null,
  });

  const clearTimer = () => {
    if (gs.current.timer) { clearTimeout(gs.current.timer); gs.current.timer = null; }
  };

  // ── Unified touch handler (single useEffect, registered once) ────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    applyPan(INIT_PAD, INIT_PAD);

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      const t  = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);

      // ── A: touch on resize handle of active resize block ─────────────────
      const handleEl = el?.closest<HTMLElement>("[data-resize-handle]");
      if (handleEl && resizingIdRef.current !== null) {
        const blockId = Number(handleEl.dataset.resizeHandle);
        if (blockId === resizingIdRef.current) {
          const block = blocksRef.current.find(b => b.id === blockId)!;
          const rect  = container.getBoundingClientRect();
          gs.current.isResizeDragging       = true;
          gs.current.resizeBlockId          = blockId;
          gs.current.resizeBlockTopScreenY  = rect.top + panRef.current.y + cellTopPx(block.cellIndex);
          gs.current.resizeMaxSpan          = ROWS - Math.floor(block.cellIndex / COLS);
          resizeSpanRef.current             = block.span;
          return;
        }
      }

      // ── Dismiss resize mode if touching elsewhere ─────────────────────────
      if (resizingIdRef.current !== null) fn.current.setResizingId(null);

      // ── Normal gesture init ───────────────────────────────────────────────
      gs.current.startX          = gs.current.panRefX = t.clientX;
      gs.current.startY          = gs.current.panRefY = t.clientY;
      gs.current.t0              = Date.now();
      gs.current.isPanning       = false;
      gs.current.isDragging      = false;
      gs.current.longPressFired  = false;

      const itemEl = el?.closest<HTMLElement>("[data-item-id]");
      gs.current.touchedCellIndex = screenToCell(t.clientX, t.clientY);
      gs.current.touchedItemId    = itemEl ? Number(itemEl.dataset.itemId) : null;

      if (gs.current.touchedItemId !== null) {
        const id = gs.current.touchedItemId;
        gs.current.draggingItemId = id;
        // Long press fires visual cue but does NOT commit drag/resize yet
        gs.current.timer = setTimeout(() => {
          gs.current.longPressFired = true;
          fn.current.setLongPressedId(id);
        }, LONG_PRESS_MS);
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];

      // ── Resize drag: update block height live via direct DOM ──────────────
      if (gs.current.isResizeDragging && gs.current.resizeBlockId !== null) {
        const rawH    = Math.max(spanToPx(0.25), t.clientY - gs.current.resizeBlockTopScreenY);
        const snapped = snapSpan(rawH, gs.current.resizeMaxSpan);
        if (resizeSpanRef.current !== snapped) {
          resizeSpanRef.current = snapped;
          const blockEl = blockEls.current.get(gs.current.resizeBlockId);
          if (blockEl) {
            // Short transition only when snapping to a new increment
            blockEl.style.transition = "height 0.1s cubic-bezier(0.34,1.56,0.64,1)";
            blockEl.style.height = `${spanToPx(snapped)}px`;
          }
        }
        return;
      }

      const adx = Math.abs(t.clientX - gs.current.startX);
      const ady = Math.abs(t.clientY - gs.current.startY);

      // ── Promote long-press to drag once finger moves ──────────────────────
      if (gs.current.longPressFired && !gs.current.isDragging && (adx > DRAG_DELTA || ady > DRAG_DELTA)) {
        gs.current.isDragging = true;
        fn.current.setDraggingId(gs.current.draggingItemId!);
        fn.current.setLongPressedId(null);
      }

      if (gs.current.isDragging) {
        fn.current.setDragPos({ x: t.clientX, y: t.clientY });
        fn.current.setHoveredCell(screenToCell(t.clientX, t.clientY));
        return;
      }

      // ── Cancel long-press and start panning if moved before timer ─────────
      if (!gs.current.longPressFired && (adx > DRAG_DELTA || ady > DRAG_DELTA) && !gs.current.isPanning) {
        clearTimer();
        gs.current.isPanning = true;
      }

      if (gs.current.isPanning) {
        const dx = t.clientX - gs.current.panRefX;
        const dy = t.clientY - gs.current.panRefY;
        applyPan(panRef.current.x + dx, panRef.current.y + dy);
        gs.current.panRefX = t.clientX;
        gs.current.panRefY = t.clientY;
      }
    };

    const onEnd = (e: TouchEvent) => {
      e.preventDefault();
      clearTimer();
      const t = e.changedTouches[0];

      // ── A: commit resize drag ─────────────────────────────────────────────
      if (gs.current.isResizeDragging && gs.current.resizeBlockId !== null) {
        const blockId   = gs.current.resizeBlockId;
        const finalSpan = resizeSpanRef.current;
        fn.current.setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, span: finalSpan } : b));
        fn.current.setBadge(`RESIZE ×${finalSpan}`);
        gs.current.isResizeDragging = false;
        gs.current.resizeBlockId    = null;
        return;
      }

      // ── B: drop dragged block ─────────────────────────────────────────────
      if (gs.current.isDragging && gs.current.draggingItemId !== null) {
        const srcId    = gs.current.draggingItemId;
        const srcBlock = blocksRef.current.find(b => b.id === srcId);
        const destIdx  = screenToCell(t.clientX, t.clientY);

        if (destIdx !== null && srcBlock) {
          const occupant = blocksRef.current.find(b => b.cellIndex === destIdx && b.id !== srcId);
          if (occupant) {
            const srcIdx = srcBlock.cellIndex;
            fn.current.setBlocks(prev => prev.map(b => {
              if (b.id === srcId)       return { ...b, cellIndex: destIdx };
              if (b.id === occupant.id) return { ...b, cellIndex: srcIdx };
              return b;
            }));
            fn.current.setBadge("DRAG swap");
          } else {
            fn.current.setBlocks(prev => prev.map(b => b.id === srcId ? { ...b, cellIndex: destIdx } : b));
            fn.current.setBadge(`DRAG → [${Math.floor(destIdx / COLS)},${destIdx % COLS}]`);
          }
        } else {
          fn.current.setBadge("DRAG cancelled");
        }
        fn.current.setDraggingId(null);
        fn.current.setHoveredCell(null);

      // ── C: long-press + release → enter resize mode ───────────────────────
      } else if (gs.current.longPressFired && gs.current.draggingItemId !== null) {
        const adx = Math.abs(t.clientX - gs.current.startX);
        const ady = Math.abs(t.clientY - gs.current.startY);
        if (adx < DRAG_DELTA && ady < DRAG_DELTA) {
          fn.current.setResizingId(gs.current.draggingItemId);
          fn.current.setBadge("RESIZE mode — kéo thanh dưới");
        }
        fn.current.setLongPressedId(null);

      // ── D: quick tap → create block on empty cell ─────────────────────────
      } else if (!gs.current.isPanning) {
        const adx = Math.abs(t.clientX - gs.current.startX);
        const ady = Math.abs(t.clientY - gs.current.startY);
        if (adx < 10 && ady < 10 && Date.now() - gs.current.t0 < 500) {
          if (gs.current.touchedItemId === null && gs.current.touchedCellIndex !== null) {
            const cidx = gs.current.touchedCellIndex;
            if (!blocksRef.current.find(b => b.cellIndex === cidx)) {
              const id    = fn.current.nextId();
              const color = fn.current.nextColor();
              fn.current.setBlocks(prev => [...prev, { id, label: `Task ${id}`, cellIndex: cidx, color, span: 1 }]);
              fn.current.setBadge(`TOUCH [${Math.floor(cidx / COLS)},${cidx % COLS}]`);
            }
          }
        }
      }

      // Reset shared gesture state
      gs.current.isPanning        = false;
      gs.current.isDragging       = false;
      gs.current.longPressFired   = false;
      gs.current.draggingItemId   = null;
      gs.current.touchedCellIndex = null;
      gs.current.touchedItemId    = null;
    };

    container.addEventListener("touchstart", onStart, { passive: false });
    container.addEventListener("touchmove",  onMove,  { passive: false });
    container.addEventListener("touchend",   onEnd,   { passive: false });
    return () => {
      container.removeEventListener("touchstart", onStart);
      container.removeEventListener("touchmove",  onMove);
      container.removeEventListener("touchend",   onEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!badge) return;
    const t = setTimeout(() => setBadge(null), 2000);
    return () => clearTimeout(t);
  }, [badge]);

  // Desktop click: create block in empty cell
  const handleCellClick = (cellIdx: number) => {
    if (!blocksRef.current.find(b => b.cellIndex === cellIdx)) {
      const id = ++blockIdRef.current;
      const color = PALETTE[colorRef.current % PALETTE.length];
      colorRef.current++;
      setBlocks(prev => [...prev, { id, label: `Task ${id}`, cellIndex: cellIdx, color, span: 1 }]);
      setBadge(`TOUCH [${Math.floor(cellIdx / COLS)},${cellIdx % COLS}]`);
    }
  };

  const draggingBlock = blocks.find(b => b.id === draggingId);

  return (
    <div className="flex flex-col h-dvh bg-zinc-950 text-white select-none">

      <header className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0 z-10">
        <h1 className="font-bold text-base shrink-0">Grid</h1>
        <div className="flex-1 flex justify-center min-w-0">
          {badge && (
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-zinc-700 text-white truncate">{badge}</span>
          )}
        </div>
        <button
          onClick={() => { setBlocks([]); setResizingId(null); }}
          className="text-xs text-zinc-500 px-2 py-1 rounded-lg bg-zinc-800 shrink-0"
        >
          Clear
        </button>
        <a href="/" className="text-xs text-zinc-500 underline shrink-0">← Home</a>
      </header>

      <div ref={containerRef} className="flex-1 overflow-hidden relative" style={{ touchAction: "none" }}>

        {/* Grid — transform driven imperatively for pan */}
        <div
          ref={gridRef}
          className="absolute top-0 left-0"
          style={{ width: GRID_W, height: GRID_H, willChange: "transform" }}
        >
          {/* Cell layer */}
          <div
            className="absolute inset-0"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
              gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
              gap: GAP,
            }}
          >
            {Array.from({ length: COLS * ROWS }, (_, i) => (
              <div
                key={i}
                data-cell={i}
                onClick={() => handleCellClick(i)}
                className={`rounded-2xl border-2 relative cursor-pointer transition-colors duration-100 ${
                  hoveredCell === i
                    ? "border-white/50 bg-white/10"
                    : "border-zinc-800 border-dashed bg-zinc-900/30"
                }`}
              >
                <span className="absolute bottom-1 right-1.5 text-[9px] text-zinc-800 pointer-events-none leading-none">
                  {Math.floor(i / COLS)},{i % COLS}
                </span>
              </div>
            ))}
          </div>

          {/* Block layer — absolutely positioned, can span multiple cells */}
          {blocks.map(block => {
            const h          = spanToPx(block.span);
            const isResizing = resizingId === block.id;
            const isDraggingThis = draggingId === block.id;
            const isLongPressed  = longPressedId === block.id;

            return (
              <div
                key={block.id}
                ref={el => { if (el) blockEls.current.set(block.id, el); else blockEls.current.delete(block.id); }}
                data-item-id={block.id}
                className="absolute overflow-hidden"
                style={{
                  left:         cellLeftPx(block.cellIndex),
                  top:          cellTopPx(block.cellIndex),
                  width:        CELL,
                  height:       h,
                  borderRadius: 16,
                  zIndex:       isDraggingThis ? 10 : isResizing ? 8 : 1,
                  transition:   "height 0.15s ease",
                }}
              >
                {/* Block body */}
                <div
                  className={`absolute inset-0 ${block.color} flex flex-col items-center justify-center gap-0.5 transition-all duration-150
                    ${isDraggingThis ? "opacity-30 scale-[0.94]" : "opacity-100"}
                    ${isLongPressed  ? "ring-2 ring-white/80 ring-inset scale-[0.97]" : ""}
                    ${isResizing     ? "ring-2 ring-white ring-inset brightness-110" : ""}`}
                >
                  <span className="text-white font-semibold text-xs text-center px-2 leading-tight">{block.label}</span>
                  <span className="text-white/40 text-[9px]">{Math.floor(block.cellIndex / COLS)},{block.cellIndex % COLS}</span>
                  {block.span !== 1 && (
                    <span className="text-white/50 text-[10px] font-medium">×{block.span}</span>
                  )}
                </div>

                {/* Resize handle — visible only while in resize mode */}
                {isResizing && (
                  <div
                    data-resize-handle={block.id}
                    className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/50 active:bg-black/70"
                    style={{ height: HANDLE_H, borderRadius: "0 0 16px 16px", cursor: "ns-resize" }}
                  >
                    {/* Grip dots */}
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex gap-1">
                        {[0,1,2,3,4].map(i => <div key={i} className="w-1 h-1 rounded-full bg-white/50" />)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Drag ghost */}
        {draggingBlock && (
          <div
            className={`fixed pointer-events-none rounded-2xl ${draggingBlock.color} flex flex-col items-center justify-center shadow-2xl z-50`}
            style={{
              width:     CELL,
              height:    spanToPx(draggingBlock.span),
              left:      dragPos.x - CELL / 2,
              top:       dragPos.y - spanToPx(draggingBlock.span) / 2,
              transform: "scale(1.1)",
              opacity:   0.9,
            }}
          >
            <span className="text-white font-semibold text-xs">{draggingBlock.label}</span>
          </div>
        )}
      </div>

      {/* Hint bar */}
      <div className="shrink-0 flex justify-around items-center px-2 py-2 border-t border-zinc-800 bg-zinc-900/60">
        <span className="text-[10px] text-zinc-500"><span className="text-emerald-400">👆</span> Chạm tạo</span>
        <span className="text-zinc-800">│</span>
        <span className="text-[10px] text-zinc-500"><span className="text-violet-400">✋</span> Vuốt pan</span>
        <span className="text-zinc-800">│</span>
        <span className="text-[10px] text-zinc-500"><span className="text-amber-400">🖐+move</span> Kéo</span>
        <span className="text-zinc-800">│</span>
        <span className="text-[10px] text-zinc-500"><span className="text-sky-400">🖐+stay</span> Resize</span>
      </div>
    </div>
  );
}
