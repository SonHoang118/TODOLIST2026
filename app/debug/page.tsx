"use client";

import { useState, useRef, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type GestureKind = "SWIPE_LEFT" | "SWIPE_RIGHT" | "TOUCH" | "DRAG_START" | "DRAG_END";
interface GestureLog { id: number; kind: GestureKind; detail: string; ts: number; }
interface TodoItem { id: number; text: string; cellIndex: number; }

const PANEL_LABELS = ["SWIPE", "TOUCH", "DRAG"] as const;
const SWIPE_THRESHOLD = 50;
const LONG_PRESS_MS = 350;
const DRAG_MOVE_THRESHOLD = 8;
const GRID_SIZE = 9;

const BADGE: Record<GestureKind, string> = {
  SWIPE_LEFT: "bg-violet-500",
  SWIPE_RIGHT: "bg-violet-500",
  TOUCH: "bg-emerald-500",
  DRAG_START: "bg-amber-500",
  DRAG_END: "bg-orange-500",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DebugPage() {
  const [currentPanel, setCurrentPanel] = useState(0);
  const [logs, setLogs]     = useState<GestureLog[]>([]);
  const [todos, setTodos]   = useState<TodoItem[]>([]);
  const [draggingId, setDraggingId]   = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);

  const logIdRef  = useRef(0);
  const todoIdRef = useRef(0);

  // Callback refs — imperative listeners read these at call time, never stale
  const fn = useRef({
    addLog: (_kind: GestureKind, _detail: string) => {},
    nextTodoId: (): number => 0,
    setPanel: setCurrentPanel,
    setTodos,
    setDraggingId,
    setHoveredCell,
  });
  fn.current.addLog = (kind, detail) =>
    setLogs(prev => [{ id: logIdRef.current++, kind, detail, ts: Date.now() }, ...prev.slice(0, 9)]);
  fn.current.nextTodoId  = () => ++todoIdRef.current;
  fn.current.setPanel    = setCurrentPanel;
  fn.current.setTodos    = setTodos;
  fn.current.setDraggingId  = setDraggingId;
  fn.current.setHoveredCell = setHoveredCell;

  // Mutable gesture tracking (no re-renders needed)
  const gs = useRef({
    startX: 0, startY: 0,
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    isDragging: false,
    draggingItemId: null as number | null,
  });

  const clearTimer = () => {
    if (gs.current.longPressTimer) {
      clearTimeout(gs.current.longPressTimer);
      gs.current.longPressTimer = null;
    }
  };

  // ── SWIPE: non-passive touchmove lets us call preventDefault on iOS ──────────
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    let sx = 0, sy = 0;

    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
    const onMove  = (e: TouchEvent) => {
      const dx = Math.abs(e.touches[0].clientX - sx);
      const dy = Math.abs(e.touches[0].clientY - sy);
      if (dx > dy) e.preventDefault(); // block iOS horizontal scroll
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
          fn.current.addLog("SWIPE_LEFT",  `${Math.round(Math.abs(dx))}px`);
          fn.current.setPanel(p => Math.min(PANEL_LABELS.length - 1, p + 1));
        } else {
          fn.current.addLog("SWIPE_RIGHT", `${Math.round(Math.abs(dx))}px`);
          fn.current.setPanel(p => Math.max(0, p - 1));
        }
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove",  onMove,  { passive: false }); // non-passive required
    el.addEventListener("touchend",   onEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, []);

  // ── TOUCH: non-passive so stopPropagation fires before carousel listener ─────
  const tapZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = tapZoneRef.current;
    if (!el) return;
    let sx = 0, sy = 0, t0 = 0;

    const onStart = (e: TouchEvent) => {
      e.stopPropagation();
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
    };
    const onEnd = (e: TouchEvent) => {
      e.stopPropagation();
      const dx = Math.abs(e.changedTouches[0].clientX - sx);
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (dx < 10 && dy < 10 && Date.now() - t0 < 600) {
        const id = fn.current.nextTodoId();
        fn.current.setTodos(prev => [...prev, { id, text: `Task #${id}`, cellIndex: -1 }]);
        fn.current.addLog("TOUCH", `Created Task #${id}`);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchend",   onEnd,   { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend",   onEnd);
    };
  }, []);

  // ── DRAG: event delegation on panel, non-passive to call preventDefault ──────
  const dragPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const area = dragPanelRef.current;
    if (!area) return;

    const onStart = (e: TouchEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
      if (!item) return; // empty area → let swipe handler work
      e.stopPropagation();
      e.preventDefault();

      const itemId = Number(item.dataset.itemId);
      gs.current.startX = e.touches[0].clientX;
      gs.current.startY = e.touches[0].clientY;
      gs.current.isDragging = false;
      gs.current.draggingItemId = itemId;

      gs.current.longPressTimer = setTimeout(() => {
        gs.current.isDragging = true;
        fn.current.setDraggingId(itemId);
        fn.current.addLog("DRAG_START", `Task #${itemId}`);
      }, LONG_PRESS_MS);
    };

    const onMove = (e: TouchEvent) => {
      if (!gs.current.draggingItemId) return;
      e.preventDefault();
      const t  = e.touches[0];
      const dx = Math.abs(t.clientX - gs.current.startX);
      const dy = Math.abs(t.clientY - gs.current.startY);

      if (!gs.current.isDragging && (dx > DRAG_MOVE_THRESHOLD || dy > DRAG_MOVE_THRESHOLD)) {
        clearTimer(); // finger moved before long-press fired → not a drag
      }
      if (gs.current.isDragging) {
        const under = document.elementFromPoint(t.clientX, t.clientY);
        const cell  = under?.closest<HTMLElement>("[data-cell]");
        fn.current.setHoveredCell(cell ? Number(cell.dataset.cell) : null);
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!gs.current.draggingItemId) return;
      e.preventDefault();
      clearTimer();

      if (gs.current.isDragging) {
        const itemId = gs.current.draggingItemId!;
        const t      = e.changedTouches[0];
        const under  = document.elementFromPoint(t.clientX, t.clientY);
        const cell   = under?.closest<HTMLElement>("[data-cell]");
        if (cell) {
          const cellIdx = Number(cell.dataset.cell);
          fn.current.setTodos(prev =>
            prev.map(todo => todo.id === itemId ? { ...todo, cellIndex: cellIdx } : todo)
          );
          fn.current.addLog("DRAG_END", `Task #${itemId} → cell ${cellIdx}`);
        } else {
          fn.current.addLog("DRAG_END", `Task #${itemId} (outside)`);
        }
        fn.current.setDraggingId(null);
        fn.current.setHoveredCell(null);
      }
      gs.current.isDragging     = false;
      gs.current.draggingItemId = null;
    };

    area.addEventListener("touchstart", onStart, { passive: false });
    area.addEventListener("touchmove",  onMove,  { passive: false });
    area.addEventListener("touchend",   onEnd,   { passive: false });
    return () => {
      area.removeEventListener("touchstart", onStart);
      area.removeEventListener("touchmove",  onMove);
      area.removeEventListener("touchend",   onEnd);
    };
  }, []);

  const placed   = todos.filter(t => t.cellIndex >= 0);
  const unplaced = todos.filter(t => t.cellIndex < 0);

  return (
    // h-[100dvh] accounts for iOS Safari collapsible URL bar (100vh does not)
    <div className="flex flex-col h-dvh bg-zinc-950 text-white select-none overflow-hidden">

      <header className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <h1 className="font-bold text-lg tracking-tight">
          Debug <span className="text-zinc-400 font-normal text-sm">/ mobile gestures</span>
        </h1>
        <a href="/" className="text-xs text-zinc-500 underline underline-offset-2">← Home</a>
      </header>

      <div className="flex justify-center gap-2 py-3 shrink-0">
        {PANEL_LABELS.map((label, i) => (
          <button
            key={label}
            onClick={() => setCurrentPanel(i)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              i === currentPanel ? "bg-white text-zinc-900" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* pan-y: iOS can still scroll lists vertically; we handle horizontal */}
      <div ref={carouselRef} className="flex-1 overflow-hidden" style={{ touchAction: "pan-y" }}>
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${currentPanel * 100}%)`, width: `${PANEL_LABELS.length * 100}%` }}
        >

          {/* Panel 0: SWIPE */}
          <div className="w-full h-full flex flex-col items-center justify-center gap-6 px-8">
            <div className="w-16 h-16 rounded-full bg-violet-600 flex items-center justify-center text-2xl">←→</div>
            <h2 className="text-2xl font-bold text-violet-400">SWIPE</h2>
            <p className="text-zinc-400 text-center text-sm leading-relaxed">
              Vuốt <strong className="text-white">trái</strong> hoặc{" "}
              <strong className="text-white">phải</strong> để di chuyển giữa các panel.
            </p>
            <div className="flex gap-3">
              <span className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm">← (đầu)</span>
              <span className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm">TOUCH →</span>
            </div>
            <p className="text-zinc-600 text-xs">Hoặc bấm nút tab bên trên</p>
          </div>

          {/* Panel 1: TOUCH */}
          <div className="w-full h-full flex flex-col">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
              <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-lg">👆</div>
              <div>
                <h2 className="font-bold text-emerald-400">TOUCH</h2>
                <p className="text-xs text-zinc-500">Chạm vào vùng bên dưới để tạo task</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {todos.length === 0 && (
                <p className="text-center text-zinc-600 mt-8 text-sm">Chưa có task nào. Hãy chạm!</p>
              )}
              {todos.map(todo => (
                <div key={todo.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-sm">{todo.text}</span>
                  {todo.cellIndex >= 0 && (
                    <span className="ml-auto text-xs text-zinc-500">cell {todo.cellIndex}</span>
                  )}
                </div>
              ))}
            </div>
            {/* touch-action:none — prevents iOS from treating tap as scroll-start */}
            <div
              ref={tapZoneRef}
              style={{ touchAction: "none" }}
              className="h-24 mx-4 mb-4 rounded-2xl border-2 border-dashed border-emerald-800 bg-emerald-950/30 flex items-center justify-center shrink-0"
              onClick={() => {
                const id = ++todoIdRef.current;
                setTodos(prev => [...prev, { id, text: `Task #${id}`, cellIndex: -1 }]);
                setLogs(prev => [
                  { id: logIdRef.current++, kind: "TOUCH", detail: `Created Task #${id} (click)`, ts: Date.now() },
                  ...prev.slice(0, 9),
                ]);
              }}
            >
              <span className="text-emerald-600 text-sm font-medium pointer-events-none">
                + Chạm / Click để thêm task
              </span>
            </div>
          </div>

          {/* Panel 2: DRAG */}
          <div ref={dragPanelRef} className="w-full h-full flex flex-col" style={{ touchAction: "none" }}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
              <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-lg">✋</div>
              <div>
                <h2 className="font-bold text-amber-400">DRAG</h2>
                <p className="text-xs text-zinc-500">Giữ task ({LONG_PRESS_MS}ms) → kéo vào ô lưới</p>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
              <p className="text-xs text-zinc-500 mb-2">Tasks chưa xếp:</p>
              <div className="flex flex-wrap gap-2 min-h-9">
                {unplaced.length === 0 && (
                  <p className="text-xs text-zinc-700">Tạo task ở panel TOUCH rồi quay lại</p>
                )}
                {unplaced.map(todo => (
                  <div
                    key={todo.id}
                    data-item-id={todo.id}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      draggingId === todo.id
                        ? "bg-amber-500 text-black scale-110 shadow-lg shadow-amber-500/30"
                        : "bg-zinc-700 text-white"
                    }`}
                  >
                    {todo.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 px-4 py-3 overflow-hidden">
              <p className="text-xs text-zinc-500 mb-2">Lưới 3×3 — kéo task vào đây:</p>
              <div className="grid grid-cols-3 gap-2 h-[calc(100%-20px)]">
                {Array.from({ length: GRID_SIZE }, (_, i) => {
                  const occupant = placed.find(t => t.cellIndex === i);
                  return (
                    <div
                      key={i}
                      data-cell={i}
                      className={`rounded-xl border-2 flex flex-col items-center justify-center p-2 transition-colors ${
                        hoveredCell === i
                          ? "border-amber-400 bg-amber-950/40"
                          : occupant
                          ? "border-zinc-600 bg-zinc-800/60"
                          : "border-zinc-800 bg-zinc-900/50"
                      }`}
                    >
                      <span className="text-xs text-zinc-700 mb-1">{i}</span>
                      {occupant && (
                        <div
                          data-item-id={occupant.id}
                          className={`w-full px-1 py-1 rounded-lg text-center text-xs font-medium transition-all ${
                            draggingId === occupant.id
                              ? "bg-amber-500 text-black scale-105"
                              : "bg-zinc-600 text-white"
                          }`}
                        >
                          {occupant.text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-800 bg-zinc-900 px-4 py-3 max-h-32 overflow-y-auto">
        <p className="text-[10px] font-semibold text-zinc-500 mb-2 uppercase tracking-widest">Gesture Log</p>
        {logs.length === 0 && <p className="text-xs text-zinc-700">Chưa có gesture nào...</p>}
        {logs.map(log => (
          <div key={log.id} className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0 ${BADGE[log.kind]}`}>
              {log.kind}
            </span>
            <span className="text-xs text-zinc-400 truncate">{log.detail}</span>
            <span className="ml-auto text-[10px] text-zinc-700 tabular-nums shrink-0">
              {new Date(log.ts).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
