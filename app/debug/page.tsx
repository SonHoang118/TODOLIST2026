"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type GestureKind = "SWIPE_LEFT" | "SWIPE_RIGHT" | "TOUCH" | "DRAG_START" | "DRAG_END";

interface GestureLog {
  id: number;
  kind: GestureKind;
  detail: string;
  ts: number;
}

interface TodoItem {
  id: number;
  text: string;
  cellIndex: number;
}

const PANEL_LABELS = ["SWIPE", "TOUCH", "DRAG"] as const;
type PanelId = (typeof PANEL_LABELS)[number];

// ─── Constants ───────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 50;   // px horizontal to trigger a swipe
const DRAG_MOVE_THRESHOLD = 8; // px movement during long-press window
const LONG_PRESS_MS = 350;    // ms to detect long-press for drag
const GRID_SIZE = 9;          // 3×3 grid for DRAG panel

// ─── Gesture badge colors ─────────────────────────────────────────────────────

const BADGE: Record<GestureKind, string> = {
  SWIPE_LEFT:  "bg-violet-500",
  SWIPE_RIGHT: "bg-violet-500",
  TOUCH:       "bg-emerald-500",
  DRAG_START:  "bg-amber-500",
  DRAG_END:    "bg-orange-500",
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function DebugPage() {
  const [currentPanel, setCurrentPanel] = useState(0);
  const [logs, setLogs] = useState<GestureLog[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);

  const logIdRef = useRef(0);
  const todoIdRef = useRef(0);

  // ── Logging helper ──────────────────────────────────────────────────────────

  const addLog = useCallback((kind: GestureKind, detail: string) => {
    setLogs((prev) => [
      { id: logIdRef.current++, kind, detail, ts: Date.now() },
      ...prev.slice(0, 9),
    ]);
  }, []);

  // ── Shared touch state for gesture detection ────────────────────────────────

  const touchState = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    isDragging: false,
    draggingItemId: null as number | null,
  });

  const clearLongPress = () => {
    if (touchState.current.longPressTimer !== null) {
      clearTimeout(touchState.current.longPressTimer);
      touchState.current.longPressTimer = null;
    }
  };

  // ── Panel container: detects SWIPE ──────────────────────────────────────────

  const panelTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchState.current.startX = t.clientX;
    touchState.current.startY = t.clientY;
    touchState.current.startTime = Date.now();
    touchState.current.isDragging = false;
  }, []);

  const panelTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - touchState.current.startX;
      const dy = t.clientY - touchState.current.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx > SWIPE_THRESHOLD && absDx > absDy) {
        if (dx < 0) {
          addLog("SWIPE_LEFT", `${Math.round(absDx)}px →`);
          setCurrentPanel((p) => Math.min(PANEL_LABELS.length - 1, p + 1));
        } else {
          addLog("SWIPE_RIGHT", `${Math.round(absDx)}px ←`);
          setCurrentPanel((p) => Math.max(0, p - 1));
        }
      }
    },
    [addLog]
  );

  // ── TOUCH panel: tap anywhere to add a todo ─────────────────────────────────

  const touchAreaRef = useRef<HTMLDivElement>(null);

  const touchPanelStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchState.current.startX = t.clientX;
    touchState.current.startY = t.clientY;
    touchState.current.startTime = Date.now();
  }, []);

  const touchPanelEnd = useCallback(
    (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      const dx = Math.abs(t.clientX - touchState.current.startX);
      const dy = Math.abs(t.clientY - touchState.current.startY);
      const duration = Date.now() - touchState.current.startTime;

      if (dx < 10 && dy < 10 && duration < 600) {
        const newId = ++todoIdRef.current;
        setTodos((prev) => [
          ...prev,
          { id: newId, text: `Task #${newId}`, cellIndex: -1 },
        ]);
        addLog("TOUCH", `Created Task #${newId}`);
      }
    },
    [addLog]
  );

  // ── DRAG panel: long-press + drag between grid cells ───────────────────────

  // We track touch events per grid item
  const itemTouchStart = useCallback(
    (itemId: number) => (e: React.TouchEvent) => {
      e.stopPropagation();
      const t = e.touches[0];
      touchState.current.startX = t.clientX;
      touchState.current.startY = t.clientY;
      touchState.current.isDragging = false;
      touchState.current.draggingItemId = itemId;

      touchState.current.longPressTimer = setTimeout(() => {
        touchState.current.isDragging = true;
        setDraggingId(itemId);
        addLog("DRAG_START", `Item #${itemId}`);
      }, LONG_PRESS_MS);
    },
    [addLog]
  );

  const itemTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - touchState.current.startX);
    const dy = Math.abs(t.clientY - touchState.current.startY);

    // Cancel long press if the finger moved before threshold
    if (!touchState.current.isDragging && (dx > DRAG_MOVE_THRESHOLD || dy > DRAG_MOVE_THRESHOLD)) {
      clearLongPress();
    }

    // If dragging, find which cell is under finger
    if (touchState.current.isDragging) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const cell = el?.closest<HTMLElement>("[data-cell]");
      const cellIndex = cell ? Number(cell.dataset.cell) : null;
      setHoveredCell(cellIndex);
    }
  }, []);

  const itemTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      clearLongPress();

      if (touchState.current.isDragging && touchState.current.draggingItemId !== null) {
        const itemId = touchState.current.draggingItemId;
        const t = e.changedTouches[0];
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const cell = el?.closest<HTMLElement>("[data-cell]");

        if (cell) {
          const targetCell = Number(cell.dataset.cell);
          setTodos((prev) =>
            prev.map((todo) =>
              todo.id === itemId ? { ...todo, cellIndex: targetCell } : todo
            )
          );
          addLog("DRAG_END", `Item #${itemId} → cell ${targetCell}`);
        } else {
          addLog("DRAG_END", `Item #${itemId} (dropped outside)`);
        }

        setDraggingId(null);
        setHoveredCell(null);
        touchState.current.isDragging = false;
        touchState.current.draggingItemId = null;
      }
    },
    [addLog]
  );

  // ── Drag panel todos (only those placed in a cell) ──────────────────────────

  const dragPanelTodos = todos.filter((t) => t.cellIndex >= 0);
  const unplacedTodos = todos.filter((t) => t.cellIndex < 0);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white select-none overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pt-safe pb-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <h1 className="font-bold text-lg tracking-tight">
          Debug <span className="text-zinc-400 font-normal text-sm">/ mobile gestures</span>
        </h1>
        <a href="/" className="text-xs text-zinc-500 underline underline-offset-2">
          ← Home
        </a>
      </header>

      {/* Panel indicators */}
      <div className="flex justify-center gap-2 py-3 shrink-0">
        {PANEL_LABELS.map((label, i) => (
          <button
            key={label}
            onClick={() => setCurrentPanel(i)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              i === currentPanel
                ? "bg-white text-zinc-900"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Panels (swipeable) */}
      <div
        className="flex-1 overflow-hidden"
        onTouchStart={panelTouchStart}
        onTouchEnd={panelTouchEnd}
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${currentPanel * 100}%)`, width: `${PANEL_LABELS.length * 100}%` }}
        >
          {/* ── Panel 0: SWIPE ─────────────────────────────────────────────── */}
          <div className="w-full h-full flex flex-col items-center justify-center gap-6 px-8">
            <div className="w-16 h-16 rounded-full bg-violet-600 flex items-center justify-center text-3xl">
              ←→
            </div>
            <h2 className="text-2xl font-bold text-violet-400">SWIPE</h2>
            <p className="text-zinc-400 text-center text-sm leading-relaxed">
              Vuốt <strong className="text-white">trái</strong> hoặc{" "}
              <strong className="text-white">phải</strong> trên màn hình để di chuyển
              giữa các panel. Sử dụng để điều hướng giữa các chức năng trong ứng
              dụng.
            </p>
            <div className="flex gap-4 mt-2">
              <span className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm">← TOUCH</span>
              <span className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm">→</span>
            </div>
            <p className="text-zinc-600 text-xs mt-4">
              Swipe hoặc bấm nút bên trên để chuyển panel
            </p>
          </div>

          {/* ── Panel 1: TOUCH ─────────────────────────────────────────────── */}
          <div className="w-full h-full flex flex-col">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
              <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-lg">
                👆
              </div>
              <div>
                <h2 className="font-bold text-emerald-400">TOUCH</h2>
                <p className="text-xs text-zinc-500">Chạm vào vùng trống để tạo task</p>
              </div>
            </div>

            {/* Todo list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {todos.length === 0 && (
                <p className="text-center text-zinc-600 mt-8 text-sm">Chưa có task nào. Hãy chạm!</p>
              )}
              {todos.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-sm">{todo.text}</span>
                  {todo.cellIndex >= 0 && (
                    <span className="ml-auto text-xs text-zinc-500">cell {todo.cellIndex}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Tap zone */}
            <div
              ref={touchAreaRef}
              className="h-24 mx-4 mb-4 rounded-2xl border-2 border-dashed border-emerald-800 bg-emerald-950/30 flex items-center justify-center cursor-pointer shrink-0"
              onTouchStart={touchPanelStart}
              onTouchEnd={touchPanelEnd}
              onClick={() => {
                // desktop fallback
                const newId = ++todoIdRef.current;
                setTodos((prev) => [...prev, { id: newId, text: `Task #${newId}`, cellIndex: -1 }]);
                addLog("TOUCH", `Created Task #${newId} (click)`);
              }}
            >
              <span className="text-emerald-600 text-sm font-medium">
                + Chạm / Click để thêm task
              </span>
            </div>
          </div>

          {/* ── Panel 2: DRAG ──────────────────────────────────────────────── */}
          <div className="w-full h-full flex flex-col">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
              <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-lg">
                ✋
              </div>
              <div>
                <h2 className="font-bold text-amber-400">DRAG</h2>
                <p className="text-xs text-zinc-500">Giữ task → kéo vào ô lưới bên dưới</p>
              </div>
            </div>

            {/* Unplaced items (source) */}
            <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
              <p className="text-xs text-zinc-500 mb-2">Tasks chưa được xếp:</p>
              <div className="flex flex-wrap gap-2 min-h-9">
                {unplacedTodos.length === 0 && (
                  <p className="text-xs text-zinc-700">
                    Tạo task ở panel TOUCH rồi quay lại đây
                  </p>
                )}
                {unplacedTodos.map((todo) => (
                  <div
                    key={todo.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      draggingId === todo.id
                        ? "bg-amber-500 text-black scale-110 shadow-lg shadow-amber-500/30"
                        : "bg-zinc-700 text-white"
                    }`}
                    onTouchStart={itemTouchStart(todo.id)}
                    onTouchMove={itemTouchMove}
                    onTouchEnd={itemTouchEnd}
                  >
                    {todo.text}
                  </div>
                ))}
              </div>
            </div>

            {/* 3×3 Grid */}
            <div className="flex-1 px-4 py-3">
              <p className="text-xs text-zinc-500 mb-2">Lưới 3×3 — kéo task vào đây:</p>
              <div className="grid grid-cols-3 gap-2 h-[calc(100%-24px)]">
                {Array.from({ length: GRID_SIZE }, (_, i) => {
                  const occupant = dragPanelTodos.find((t) => t.cellIndex === i);
                  const isHovered = hoveredCell === i;
                  return (
                    <div
                      key={i}
                      data-cell={i}
                      className={`rounded-xl border-2 flex flex-col items-center justify-center p-2 transition-colors ${
                        isHovered
                          ? "border-amber-400 bg-amber-950/40"
                          : occupant
                          ? "border-zinc-600 bg-zinc-800/60"
                          : "border-zinc-800 bg-zinc-900/50"
                      }`}
                    >
                      <span className="text-xs text-zinc-700 mb-1">{i}</span>
                      {occupant && (
                        <div
                          className={`w-full px-1 py-1 rounded-lg text-center text-xs font-medium transition-all ${
                            draggingId === occupant.id
                              ? "bg-amber-500 text-black"
                              : "bg-zinc-600 text-white"
                          }`}
                          onTouchStart={itemTouchStart(occupant.id)}
                          onTouchMove={itemTouchMove}
                          onTouchEnd={itemTouchEnd}
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

      {/* Gesture log */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-900 px-4 py-3 max-h-36 overflow-y-auto">
        <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-widest">
          Gesture Log
        </p>
        {logs.length === 0 && (
          <p className="text-xs text-zinc-700">Chưa có gesture nào được ghi lại...</p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${BADGE[log.kind]}`}>
              {log.kind}
            </span>
            <span className="text-xs text-zinc-400">{log.detail}</span>
            <span className="ml-auto text-[10px] text-zinc-700 tabular-nums">
              {new Date(log.ts).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
