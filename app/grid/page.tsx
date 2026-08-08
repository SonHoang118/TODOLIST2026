"use client";

import { useState, useRef, useEffect } from "react";

// ─── Grid config ──────────────────────────────────────────────────────────────

const COLS = 8;
const ROWS = 10;
const CELL = 88;       // px per cell
const GAP  = 8;        // px gap between cells
const STRIDE = CELL + GAP;
const GRID_W = COLS * CELL + (COLS - 1) * GAP;
const GRID_H = ROWS * CELL + (ROWS - 1) * GAP;
const INIT_PAD = 12;   // initial offset from container edge

const LONG_PRESS_MS = 350;
const DRAG_DELTA    = 8;   // movement that cancels long-press and starts pan

const PALETTE = [
  "bg-violet-600", "bg-emerald-600", "bg-amber-500",  "bg-sky-600",
  "bg-rose-600",   "bg-teal-600",    "bg-orange-500", "bg-indigo-600",
  "bg-pink-600",   "bg-cyan-600",    "bg-lime-600",   "bg-fuchsia-600",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Block { id: number; label: string; cellIndex: number; color: string; }

// ─── Component ────────────────────────────────────────────────────────────────

export default function GridPage() {
  const [blocks, setBlocks]               = useState<Block[]>([]);
  const [draggingId, setDraggingId]       = useState<number | null>(null);
  const [dragPos, setDragPos]             = useState({ x: 0, y: 0 });
  const [hoveredCell, setHoveredCell]     = useState<number | null>(null);
  const [badge, setBadge]                 = useState<string | null>(null);

  const blockIdRef  = useRef(0);
  const colorRef    = useRef(0);
  const blocksRef   = useRef<Block[]>([]);
  blocksRef.current = blocks;

  // Callback refs — imperative handlers read these at call time, never stale
  const fn = useRef({
    setBlocks, setDraggingId, setDragPos, setHoveredCell, setBadge,
    nextId:    (): number => ++blockIdRef.current,
    nextColor: (): string => { const c = PALETTE[colorRef.current % PALETTE.length]; colorRef.current++; return c; },
  });
  fn.current.setBlocks      = setBlocks;
  fn.current.setDraggingId  = setDraggingId;
  fn.current.setDragPos     = setDragPos;
  fn.current.setHoveredCell = setHoveredCell;
  fn.current.setBadge       = setBadge;

  // Pan stored in a ref and applied directly to DOM — no re-renders while panning
  const panRef = useRef({ x: INIT_PAD, y: INIT_PAD });

  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef      = useRef<HTMLDivElement>(null);

  const applyPan = (x: number, y: number) => {
    const container = containerRef.current;
    if (!container) return;
    const maxX = INIT_PAD;
    const maxY = INIT_PAD;
    const minX = container.clientWidth  - GRID_W - INIT_PAD;
    const minY = container.clientHeight - GRID_H - INIT_PAD;
    const cx = Math.min(maxX, Math.max(minX, x));
    const cy = Math.min(maxY, Math.max(minY, y));
    panRef.current = { x: cx, y: cy };
    if (gridRef.current) gridRef.current.style.transform = `translate(${cx}px, ${cy}px)`;
  };

  // Convert screen coords to cell index, returns null if outside grid or in gap
  const screenToCell = (screenX: number, screenY: number): number | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const gx = screenX - rect.left - panRef.current.x;
    const gy = screenY - rect.top  - panRef.current.y;
    const col = Math.floor(gx / STRIDE);
    const row = Math.floor(gy / STRIDE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    // Reject touches that land in a gap
    if (gx - col * STRIDE > CELL || gy - row * STRIDE > CELL) return null;
    return row * COLS + col;
  };

  // Mutable gesture state
  const gs = useRef({
    startX: 0, startY: 0,    // original touch start (for tap detection)
    panRefX: 0, panRefY: 0,  // last touch pos for incremental pan delta
    t0: 0,
    isPanning: false,
    isDragging: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    draggingItemId: null as number | null,
    touchedCellIndex: null as number | null,
    touchedItemId: null as number | null,
  });

  const clearTimer = () => {
    if (gs.current.timer) { clearTimeout(gs.current.timer); gs.current.timer = null; }
  };

  // ── Unified touch handler ──────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Apply initial pan once container is measured
    applyPan(INIT_PAD, INIT_PAD);

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      gs.current.startX  = gs.current.panRefX = t.clientX;
      gs.current.startY  = gs.current.panRefY = t.clientY;
      gs.current.t0       = Date.now();
      gs.current.isPanning  = false;
      gs.current.isDragging = false;

      const cellIdx = screenToCell(t.clientX, t.clientY);
      const el      = document.elementFromPoint(t.clientX, t.clientY);
      const item    = el?.closest<HTMLElement>("[data-item-id]");
      gs.current.touchedCellIndex = cellIdx;
      gs.current.touchedItemId    = item ? Number(item.dataset.itemId) : null;

      if (gs.current.touchedItemId !== null) {
        const id = gs.current.touchedItemId;
        gs.current.draggingItemId = id;
        gs.current.timer = setTimeout(() => {
          gs.current.isDragging = true;
          fn.current.setDraggingId(id);
          fn.current.setDragPos({ x: t.clientX, y: t.clientY });
          fn.current.setBadge("DRAG");
        }, LONG_PRESS_MS);
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const t  = e.touches[0];
      const dx = t.clientX - gs.current.panRefX;
      const dy = t.clientY - gs.current.panRefY;

      if (gs.current.isDragging) {
        fn.current.setDragPos({ x: t.clientX, y: t.clientY });
        fn.current.setHoveredCell(screenToCell(t.clientX, t.clientY));
        return;
      }

      const adx = Math.abs(t.clientX - gs.current.startX);
      const ady = Math.abs(t.clientY - gs.current.startY);
      if ((adx > DRAG_DELTA || ady > DRAG_DELTA) && !gs.current.isPanning) {
        clearTimer();
        gs.current.isPanning = true;
      }

      if (gs.current.isPanning) {
        applyPan(panRef.current.x + dx, panRef.current.y + dy);
        // Reset reference point for next incremental delta
        gs.current.panRefX = t.clientX;
        gs.current.panRefY = t.clientY;
      }
    };

    const onEnd = (e: TouchEvent) => {
      e.preventDefault();
      clearTimer();
      const t   = e.changedTouches[0];

      // ── Case 1: drop dragged block ────────────────────────────────────────
      if (gs.current.isDragging && gs.current.draggingItemId !== null) {
        const srcId    = gs.current.draggingItemId;
        const srcBlock = blocksRef.current.find(b => b.id === srcId);
        const destIdx  = screenToCell(t.clientX, t.clientY);

        if (destIdx !== null && srcBlock) {
          const occupant = blocksRef.current.find(b => b.cellIndex === destIdx && b.id !== srcId);
          if (occupant) {
            // Swap the two blocks
            const srcIdx = srcBlock.cellIndex;
            fn.current.setBlocks(prev => prev.map(b => {
              if (b.id === srcId)       return { ...b, cellIndex: destIdx };
              if (b.id === occupant.id) return { ...b, cellIndex: srcIdx };
              return b;
            }));
            fn.current.setBadge("DRAG swap");
          } else {
            fn.current.setBlocks(prev =>
              prev.map(b => b.id === srcId ? { ...b, cellIndex: destIdx } : b)
            );
            fn.current.setBadge(`DRAG → [${Math.floor(destIdx / COLS)},${destIdx % COLS}]`);
          }
        } else {
          fn.current.setBadge("DRAG cancelled");
        }
        fn.current.setDraggingId(null);
        fn.current.setHoveredCell(null);
        gs.current.isDragging     = false;
        gs.current.draggingItemId = null;

      // ── Case 2: tap on an empty cell → create block ───────────────────────
      } else if (!gs.current.isPanning) {
        const adx = Math.abs(t.clientX - gs.current.startX);
        const ady = Math.abs(t.clientY - gs.current.startY);
        if (adx < 10 && ady < 10 && Date.now() - gs.current.t0 < 500) {
          if (gs.current.touchedItemId === null && gs.current.touchedCellIndex !== null) {
            const cidx = gs.current.touchedCellIndex;
            if (!blocksRef.current.find(b => b.cellIndex === cidx)) {
              const id    = fn.current.nextId();
              const color = fn.current.nextColor();
              fn.current.setBlocks(prev => [
                ...prev,
                { id, label: `Task ${id}`, cellIndex: cidx, color },
              ]);
              fn.current.setBadge(`TOUCH [${Math.floor(cidx / COLS)},${cidx % COLS}]`);
            }
          }
        }
      }

      gs.current.isPanning        = false;
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

  // Auto-clear badge
  useEffect(() => {
    if (!badge) return;
    const t = setTimeout(() => setBadge(null), 1500);
    return () => clearTimeout(t);
  }, [badge]);

  // Desktop click support
  const handleCellClick = (cellIdx: number) => {
    if (!blocksRef.current.find(b => b.cellIndex === cellIdx)) {
      const id    = ++blockIdRef.current;
      const color = PALETTE[colorRef.current % PALETTE.length];
      colorRef.current++;
      setBlocks(prev => [...prev, { id, label: `Task ${id}`, cellIndex: cellIdx, color }]);
      setBadge(`TOUCH [${Math.floor(cellIdx / COLS)},${cellIdx % COLS}]`);
    }
  };

  const draggingBlock = blocks.find(b => b.id === draggingId);

  return (
    <div className="flex flex-col h-dvh bg-zinc-950 text-white select-none">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0 z-10">
        <h1 className="font-bold text-base shrink-0">Grid</h1>
        <div className="flex-1 flex justify-center min-w-0">
          {badge && (
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-zinc-700 text-white truncate">
              {badge}
            </span>
          )}
        </div>
        <button
          onClick={() => setBlocks([])}
          className="text-xs text-zinc-500 px-2 py-1 rounded-lg bg-zinc-800 shrink-0"
        >
          Clear
        </button>
        <a href="/" className="text-xs text-zinc-500 underline shrink-0">← Home</a>
      </header>

      {/* Pannable area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        style={{ touchAction: "none" }}
      >
        {/* Grid — positioned via transform (managed imperatively, not via React state) */}
        <div
          ref={gridRef}
          className="absolute top-0 left-0"
          style={{
            width: GRID_W,
            height: GRID_H,
            display: "grid",
            gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
            gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
            gap: GAP,
            willChange: "transform",
          }}
        >
          {Array.from({ length: COLS * ROWS }, (_, i) => {
            const block   = blocks.find(b => b.cellIndex === i);
            const isHover = hoveredCell === i;
            return (
              <div
                key={i}
                data-cell={i}
                onClick={() => handleCellClick(i)}
                className={`rounded-2xl border-2 relative overflow-hidden cursor-pointer transition-colors duration-100 ${
                  isHover
                    ? "border-white/60 bg-white/10"
                    : block
                    ? "border-transparent"
                    : "border-zinc-800 border-dashed bg-zinc-900/30"
                }`}
              >
                {/* Cell coordinate label */}
                {!block && (
                  <span className="absolute inset-0 flex items-end justify-end p-1.5 text-[9px] text-zinc-800 leading-none pointer-events-none">
                    {Math.floor(i / COLS)},{i % COLS}
                  </span>
                )}
                {/* Block */}
                {block && (
                  <div
                    data-item-id={block.id}
                    className={`absolute inset-0 rounded-2xl ${block.color} flex flex-col items-center justify-center gap-0.5 transition-opacity duration-150 ${
                      draggingId === block.id ? "opacity-30" : "opacity-100"
                    }`}
                  >
                    <span className="text-white font-semibold text-xs text-center px-2 leading-tight">
                      {block.label}
                    </span>
                    <span className="text-white/40 text-[9px]">
                      {Math.floor(block.cellIndex / COLS)},{block.cellIndex % COLS}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Drag ghost — follows finger, pointer-events:none so it doesn't block hit-testing */}
        {draggingBlock && (
          <div
            className={`fixed pointer-events-none rounded-2xl ${draggingBlock.color} flex flex-col items-center justify-center gap-0.5 shadow-2xl z-50`}
            style={{
              width:     CELL,
              height:    CELL,
              left:      dragPos.x - CELL / 2,
              top:       dragPos.y - CELL / 2,
              transform: "scale(1.12)",
              opacity:   0.92,
            }}
          >
            <span className="text-white font-semibold text-xs">{draggingBlock.label}</span>
          </div>
        )}
      </div>

      {/* Hint bar */}
      <div className="shrink-0 flex justify-around items-center px-2 py-2 border-t border-zinc-800 bg-zinc-900/60">
        <span className="text-[10px] text-zinc-500">
          <span className="text-emerald-400">👆</span> Chạm ô trống
        </span>
        <span className="text-zinc-800">│</span>
        <span className="text-[10px] text-zinc-500">
          <span className="text-violet-400">✋</span> Vuốt tự do
        </span>
        <span className="text-zinc-800">│</span>
        <span className="text-[10px] text-zinc-500">
          <span className="text-amber-400">🖐</span> Giữ để kéo
        </span>
      </div>
    </div>
  );
}
