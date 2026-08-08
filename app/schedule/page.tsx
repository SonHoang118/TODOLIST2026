"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const SLOT_H    = 32;   // px per 30-min slot
const DAY_W     = 88;   // px per day column
const TIME_W    = 44;   // px for the time-label column
const HEADER_H  = 52;   // px for the day-header row
const SLOTS     = 48;   // 00:00 → 23:30
const DAYS      = 7;

const LONG_PRESS_MS = 350;
const DRAG_DELTA    = 8;
const HANDLE_H      = 14;

const COLORS = [
  "bg-violet-600", "bg-emerald-600", "bg-amber-500",  "bg-sky-600",
  "bg-rose-600",   "bg-teal-600",    "bg-orange-500", "bg-indigo-600",
  "bg-pink-600",   "bg-cyan-600",    "bg-lime-600",   "bg-fuchsia-600",
];

const DAY_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slotLabel(slot: number) {
  const h = Math.floor(slot / 2);
  const m = slot % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
}

function getWeekDates(offset = 0): Date[] {
  const today = new Date();
  const dow   = today.getDay() === 0 ? 7 : today.getDay(); // 1=Mon
  const mon   = new Date(today);
  mon.setDate(today.getDate() - dow + 1 + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date) {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  id: number;
  title: string;
  dayIndex: number;   // 0=Mon … 6=Sun
  slotIndex: number;  // 0=00:00 … 47=23:30
  span: number;       // 1=30min, 2=1hr, …
  color: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [tasks, setTasks]                 = useState<Task[]>([]);
  const [weekOffset, setWeekOffset]       = useState(0);
  const [draggingId, setDraggingId]       = useState<number | null>(null);
  const [longPressedId, setLongPressedId] = useState<number | null>(null);
  const [dragPos, setDragPos]             = useState({ x: 0, y: 0 });
  const [resizingId, setResizingId]       = useState<number | null>(null);
  const [editingId, setEditingId]         = useState<number | null>(null);
  const [editTitle, setEditTitle]         = useState("");
  const [badge, setBadge]                 = useState<string | null>(null);
  const [zoomLevel, setZoomLevel]          = useState(1); // 0.5– 3.0

  // Effective slot height — derived from zoom, mirrored in a ref for imperative handlers
  const effSlotH    = Math.round(SLOT_H * zoomLevel);
  const effSlotHRef = useRef(SLOT_H);
  const zoomRef     = useRef(1);
  effSlotHRef.current = effSlotH;
  zoomRef.current     = zoomLevel;

  // Saved state for scroll-position preservation during zoom
  const pinchZoomBeforeRef   = useRef(1);
  const pinchScrollTopRef    = useRef(0);
  const pinchCenterYRef      = useRef(0);

  const taskIdRef    = useRef(0);
  const colorRef     = useRef(0);
  const tasksRef     = useRef<Task[]>([]);
  tasksRef.current   = tasks;
  const resizingIdRef = useRef<number | null>(null);
  resizingIdRef.current = resizingId;

  const scrollRef    = useRef<HTMLDivElement>(null);
  const taskEls      = useRef<Map<number, HTMLDivElement>>(new Map());
  const resizeSpanRef = useRef(1);

  // Callback refs
  const fn = useRef({
    setTasks, setDraggingId, setLongPressedId,
    setDragPos, setResizingId, setEditingId, setEditTitle, setBadge, setZoomLevel,
    nextId:    (): number => ++taskIdRef.current,
    nextColor: (): string => { const c = COLORS[colorRef.current % COLORS.length]; colorRef.current++; return c; },
  });
  fn.current.setTasks         = setTasks;
  fn.current.setDraggingId    = setDraggingId;
  fn.current.setLongPressedId = setLongPressedId;
  fn.current.setDragPos       = setDragPos;
  fn.current.setResizingId    = setResizingId;
  fn.current.setEditingId     = setEditingId;
  fn.current.setEditTitle     = setEditTitle;
  fn.current.setBadge         = setBadge;
  fn.current.setZoomLevel     = setZoomLevel;

  // Mutable gesture state
  const gs = useRef({
    startX: 0, startY: 0, t0: 0,
    isDragging: false,
    longPressFired: false,
    isResizeDragging: false,
    isPinching: false,
    pinchDist0: 0,
    pinchZoom0: 1,  // zoom at pinch-gesture start, fixed until next pinch
    timer: null as ReturnType<typeof setTimeout> | null,
    draggingTaskId:   null as number | null,
    resizeTaskId:     null as number | null,
    resizeTopClientY: 0,
    resizeMaxSpan:    SLOTS as number,
    touchedTaskId:    null as number | null,
    touchedDay:       null as number | null,
    touchedSlot:      null as number | null,
    pendingAction:    null as "edit" | "remove" | null,
    pendingTaskId:    null as number | null,
  });

  const clearTimer = () => {
    if (gs.current.timer) { clearTimeout(gs.current.timer); gs.current.timer = null; }
  };

  // Convert screen coords to { dayIndex, slotIndex } within the current scroll position
  const screenToSlot = (cx: number, cy: number) => {
    const el = scrollRef.current;
    if (!el) return null;
    const r    = el.getBoundingClientRect();
    const relX = cx - r.left + el.scrollLeft - TIME_W;
    const relY = cy - r.top  + el.scrollTop  - HEADER_H;
    const day  = Math.floor(relX / DAY_W);
    const slot = Math.floor(relY / effSlotHRef.current);
    if (day < 0 || day >= DAYS || slot < 0 || slot >= SLOTS) return null;
    return { dayIndex: day, slotIndex: slot };
  };

  // Adjust scrollTop after zoom to keep the pinch center fixed in the viewport
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const rect         = container.getBoundingClientRect();
    const oldEffSlotH  = SLOT_H * pinchZoomBeforeRef.current;
    const newEffSlotH  = SLOT_H * zoomLevel;
    if (oldEffSlotH === newEffSlotH) return;
    const pinchScreenY  = pinchCenterYRef.current;
    const slotsAtPinch  = (pinchScrollTopRef.current + pinchScreenY - rect.top - HEADER_H) / oldEffSlotH;
    const newScrollTop  = HEADER_H + slotsAtPinch * newEffSlotH - (pinchScreenY - rect.top);
    container.scrollTop = Math.max(0, newScrollTop);
    // Note: pinchZoomBeforeRef is updated in onMove before each setZoomLevel call, not here
  }, [zoomLevel]);

  // ── Touch handler ─────────────────────────────────────────────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // Scroll to current time on mount
    const now = new Date();
    container.scrollTop = Math.max(0, (now.getHours() * 2 - 3) * effSlotHRef.current);

    const onStart = (e: TouchEvent) => {
      const t  = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);

      // ── Pinch to zoom (2 fingers) ──────────────────────────────────────────
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        clearTimer();
        gs.current.isDragging      = false;
        gs.current.longPressFired  = false;
        gs.current.isPinching      = true;
        gs.current.pinchDist0      = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        gs.current.pinchZoom0      = zoomRef.current;  // fixed for the whole gesture
        // Save baseline for first useLayoutEffect step
        pinchZoomBeforeRef.current = zoomRef.current;
        pinchScrollTopRef.current  = container.scrollTop;
        pinchCenterYRef.current    = (t1.clientY + t2.clientY) / 2;
        return;
      }

      // ── Action buttons (edit/remove) — no preventDefault so tap fires ─────
      const actionEl = el?.closest<HTMLElement>("[data-action]");
      if (actionEl) {
        gs.current.pendingAction  = actionEl.dataset.action as "edit" | "remove";
        gs.current.pendingTaskId  = Number(actionEl.dataset.taskId);
        return;
      }

      // ── Resize handle touch ───────────────────────────────────────────────
      const handleEl = el?.closest<HTMLElement>("[data-resize-handle]");
      if (handleEl && resizingIdRef.current !== null) {
        const taskId = Number(handleEl.dataset.resizeHandle);
        if (taskId === resizingIdRef.current) {
          e.preventDefault();
          const task = tasksRef.current.find(t => t.id === taskId)!;
          const rect = container.getBoundingClientRect();
          gs.current.isResizeDragging = true;
          gs.current.resizeTaskId     = taskId;
          gs.current.resizeTopClientY = rect.top - container.scrollTop + HEADER_H + task.slotIndex * effSlotHRef.current;
          gs.current.resizeMaxSpan    = SLOTS - task.slotIndex;
          resizeSpanRef.current       = task.span;
          return;
        }
      }

      // Dismiss resize mode when touching elsewhere
      if (resizingIdRef.current !== null) fn.current.setResizingId(null);

      gs.current.startX = t.clientX;
      gs.current.startY = t.clientY;
      gs.current.t0     = Date.now();
      gs.current.isDragging     = false;
      gs.current.longPressFired = false;

      const taskEl = el?.closest<HTMLElement>("[data-task-id]");
      const slot   = screenToSlot(t.clientX, t.clientY);
      gs.current.touchedTaskId = taskEl ? Number(taskEl.dataset.taskId) : null;
      gs.current.touchedDay    = slot?.dayIndex  ?? null;
      gs.current.touchedSlot   = slot?.slotIndex ?? null;

      if (gs.current.touchedTaskId !== null) {
        const id = gs.current.touchedTaskId;
        gs.current.draggingTaskId = id;
        gs.current.timer = setTimeout(() => {
          gs.current.longPressFired = true;
          fn.current.setLongPressedId(id);
        }, LONG_PRESS_MS);
      }
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];

      // ── Pinch zoom update ───────────────────────────────────────────────────
      if (gs.current.isPinching && e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const newZoom = Math.min(3, Math.max(0.5,
          gs.current.pinchZoom0 * newDist / gs.current.pinchDist0  // ratio from gesture start
        ));
        // Save current state BEFORE setZoomLevel so useLayoutEffect gets correct baseline
        pinchZoomBeforeRef.current = zoomRef.current;
        pinchScrollTopRef.current  = container.scrollTop;
        pinchCenterYRef.current    = (t1.clientY + t2.clientY) / 2;
        fn.current.setZoomLevel(newZoom);
        return;
      }

      // ── Resize drag ─────────────────────────────────────────────────
      if (gs.current.isResizeDragging && gs.current.resizeTaskId !== null) {
        e.preventDefault();
        const eSH     = effSlotHRef.current;
        const rawH    = Math.max(eSH, t.clientY - gs.current.resizeTopClientY);
        const snapped = Math.min(Math.max(1, Math.round(rawH / eSH)), gs.current.resizeMaxSpan);
        if (snapped !== resizeSpanRef.current) {
          resizeSpanRef.current = snapped;
          const taskEl = taskEls.current.get(gs.current.resizeTaskId);
          if (taskEl) {
            taskEl.style.transition = "height 0.08s cubic-bezier(0.34,1.56,0.64,1)";
            taskEl.style.height = `${snapped * eSH}px`;
          }
        }
        return;
      }

      const adx = Math.abs(t.clientX - gs.current.startX);
      const ady = Math.abs(t.clientY - gs.current.startY);

      // Long press + finger moves → start drag
      if (gs.current.longPressFired && !gs.current.isDragging && (adx > DRAG_DELTA || ady > DRAG_DELTA)) {
        gs.current.isDragging = true;
        fn.current.setDraggingId(gs.current.draggingTaskId!);
        fn.current.setLongPressedId(null);
      }

      if (gs.current.isDragging) {
        e.preventDefault(); // stop native scroll during task drag
        fn.current.setDragPos({ x: t.clientX, y: t.clientY });
        return;
      }

      // Short movement before long press → cancel timer, allow native scroll
      if (!gs.current.longPressFired && (adx > DRAG_DELTA || ady > DRAG_DELTA)) {
        clearTimer();
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (gs.current.isPinching) {
        if (e.touches.length < 2) gs.current.isPinching = false;
        return;
      }
      clearTimer();
      const t = e.changedTouches[0];

      // ── Action button ─────────────────────────────────────────────────────
      if (gs.current.pendingAction !== null) {
        const action = gs.current.pendingAction;
        const taskId = gs.current.pendingTaskId!;
        if (action === "remove") {
          fn.current.setTasks(prev => prev.filter(t => t.id !== taskId));
          fn.current.setResizingId(null);
          fn.current.setBadge("Đã xoá");
        } else {
          const task = tasksRef.current.find(t => t.id === taskId);
          fn.current.setEditTitle(task?.title ?? "");
          fn.current.setEditingId(taskId);
        }
        gs.current.pendingAction = null;
        gs.current.pendingTaskId = null;
        return;
      }

      // ── End resize ────────────────────────────────────────────────────────
      if (gs.current.isResizeDragging && gs.current.resizeTaskId !== null) {
        const taskId    = gs.current.resizeTaskId;
        const finalSpan = resizeSpanRef.current;
        fn.current.setTasks(prev => prev.map(t => t.id === taskId ? { ...t, span: finalSpan } : t));
        fn.current.setBadge(`${finalSpan * 30} phút`);
        gs.current.isResizeDragging = false;
        gs.current.resizeTaskId     = null;
        return;
      }

      // ── End drag ──────────────────────────────────────────────────────────
      if (gs.current.isDragging && gs.current.draggingTaskId !== null) {
        const taskId = gs.current.draggingTaskId;
        const dest   = screenToSlot(t.clientX, t.clientY);
        if (dest) {
          fn.current.setTasks(prev => prev.map(task =>
            task.id === taskId ? { ...task, dayIndex: dest.dayIndex, slotIndex: dest.slotIndex } : task
          ));
          fn.current.setBadge(`${DAY_SHORT[dest.dayIndex]} ${slotLabel(dest.slotIndex)}`);
        }
        fn.current.setDraggingId(null);
        gs.current.isDragging     = false;
        gs.current.draggingTaskId = null;

      // ── Long press + release → resize mode ───────────────────────────────
      } else if (gs.current.longPressFired && gs.current.draggingTaskId !== null) {
        const adx = Math.abs(t.clientX - gs.current.startX);
        const ady = Math.abs(t.clientY - gs.current.startY);
        if (adx < DRAG_DELTA && ady < DRAG_DELTA) {
          fn.current.setResizingId(gs.current.draggingTaskId);
          fn.current.setBadge("Kéo thanh để điều chỉnh thời lượng");
        }
        fn.current.setLongPressedId(null);

      // ── Quick tap → create task ───────────────────────────────────────────
      } else if (gs.current.touchedTaskId === null) {
        const adx = Math.abs(t.clientX - gs.current.startX);
        const ady = Math.abs(t.clientY - gs.current.startY);
        if (adx < 10 && ady < 10 && Date.now() - gs.current.t0 < 500) {
          if (gs.current.touchedDay !== null && gs.current.touchedSlot !== null) {
            const day   = gs.current.touchedDay;
            const slot  = gs.current.touchedSlot;
            const id    = fn.current.nextId();
            const color = fn.current.nextColor();
            fn.current.setTasks(prev => [...prev, { id, title: `Task ${id}`, dayIndex: day, slotIndex: slot, span: 2, color }]);
            fn.current.setBadge(`${DAY_SHORT[day]} ${slotLabel(slot)}`);
          }
        }
      }

      gs.current.longPressFired = false;
      gs.current.draggingTaskId = null;
      gs.current.touchedTaskId  = null;
      gs.current.touchedDay     = null;
      gs.current.touchedSlot    = null;
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
    const t = setTimeout(() => setBadge(null), 2500);
    return () => clearTimeout(t);
  }, [badge]);

  // Week data
  const weekDates = getWeekDates(weekOffset);
  const today     = new Date();
  const todayIdx  = weekDates.findIndex(d => isSameDay(d, today));

  // Current time position
  const nowSlot   = today.getHours() * 2 + (today.getMinutes() >= 30 ? 1 : 0);
  const nowFrac   = (today.getMinutes() % 30) / 30;
  const nowTop    = nowSlot * effSlotH + nowFrac * effSlotH;

  const draggingTask = tasks.find(t => t.id === draggingId);

  return (
    <div className="flex flex-col h-dvh bg-zinc-950 text-white select-none overflow-hidden">

      {/* ── App header ───────────────────────────────────────────────────── */}
      <header className="flex items-center gap-1 px-3 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 text-lg"
        >‹</button>

        <div className="flex-1 text-center min-w-0">
          <p className="text-xs font-semibold text-zinc-300 truncate">
            {weekDates[0]?.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" })}
            {" – "}
            {weekDates[6]?.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric", year: "numeric" })}
          </p>
          {badge && (
            <p className="text-[10px] text-violet-400 truncate">{badge}</p>
          )}
        </div>

        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 text-lg"
        >›</button>

        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="text-[10px] text-violet-400 px-2 py-1 rounded-lg bg-violet-900/40 shrink-0"
          >
            Hôm nay
          </button>
        )}

        <a href="/" className="text-xs text-zinc-600 underline ml-1 shrink-0">←</a>
      </header>

      {/* ── Main scrollable area ─────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div style={{ width: TIME_W + DAYS * DAY_W }}>

          {/* ── Header row: sticky top, corner also sticky left ──────────── */}
          <div
            className="flex z-20 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800"
            style={{ position: "sticky", top: 0, height: HEADER_H }}
          >
            {/* Top-left corner: sticky in both axes */}
            <div
              className="bg-zinc-900/95 shrink-0 z-30"
              style={{ position: "sticky", left: 0, width: TIME_W }}
            />
            {/* Day headers */}
            {weekDates.map((date, i) => {
              const isToday = i === todayIdx;
              return (
                <div
                  key={i}
                  style={{ width: DAY_W }}
                  className={`flex flex-col items-center justify-center border-l border-zinc-800 shrink-0 ${isToday ? "bg-violet-900/20" : ""}`}
                >
                  <span className={`text-[10px] font-medium uppercase ${isToday ? "text-violet-400" : "text-zinc-500"}`}>
                    {DAY_SHORT[i]}
                  </span>
                  <span className={`text-base font-bold leading-tight ${isToday ? "text-violet-300 bg-violet-600 rounded-full w-7 h-7 flex items-center justify-center" : "text-zinc-200"}`}>
                    {date.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── Body row: time column sticky left + grid ─────────────────── */}
          <div className="flex">

            {/* Time labels: sticky left so it stays visible on horizontal scroll */}
            <div
              className="bg-zinc-950 z-10 shrink-0"
              style={{ position: "sticky", left: 0, width: TIME_W }}
            >
              {Array.from({ length: SLOTS }, (_, slot) => (
                <div
                  key={slot}
                  style={{ height: effSlotH }}
                  className="flex items-start justify-end pr-1.5 border-t border-zinc-900"
                >
                  {slot % 2 === 0 && (
                    <span className="text-[9px] text-zinc-600 -mt-1 leading-none tabular-nums">
                      {slotLabel(slot)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* ── Grid area ────────────────────────────────────────────── */}
            <div style={{ position: "relative", width: DAYS * DAY_W, height: SLOTS * effSlotH }}>
              {/* Background slot rows */}
              {Array.from({ length: SLOTS }, (_, slot) => (
                <div
                  key={slot}
                  style={{ height: effSlotH, display: "flex" }}
                  className={slot % 2 === 0 ? "border-t border-zinc-800" : "border-t border-zinc-900"}
                >
                  {Array.from({ length: DAYS }, (_, day) => (
                    <div
                      key={day}
                      data-day={day}
                      data-slot={slot}
                      style={{ width: DAY_W }}
                      className={`shrink-0 border-l border-zinc-800/60 ${day === todayIdx ? "bg-violet-950/15" : ""}`}
                    />
                  ))}
                </div>
              ))}

              {/* Current time red line */}
              {todayIdx >= 0 && (
                <div
                  className="absolute pointer-events-none z-20 flex items-center"
                  style={{ top: nowTop - 1, left: todayIdx * DAY_W, width: DAY_W }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 -ml-0.5 shrink-0" />
                  <div className="flex-1 h-px bg-red-500" style={{ boxShadow: "0 0 4px rgba(239,68,68,0.7)" }} />
                </div>
              )}

              {/* Task blocks */}
              {tasks.map(task => {
                const isDraggingThis = draggingId    === task.id;
                const isResizing     = resizingId    === task.id;
                const isLongPressed  = longPressedId === task.id;
                const h = task.span * effSlotH;

                return (
                  <div
                    key={task.id}
                    ref={el => { if (el) taskEls.current.set(task.id, el); else taskEls.current.delete(task.id); }}
                    data-task-id={task.id}
                    className="absolute overflow-hidden"
                    style={{
                      left:       task.dayIndex * DAY_W + 2,
                      top:        task.slotIndex * effSlotH,
                      width:      DAY_W - 4,
                      height:     h,
                      borderRadius: 8,
                      zIndex:     isDraggingThis ? 20 : isResizing ? 15 : 5,
                      transition: gs.current.isResizeDragging ? "none" : "height 0.15s ease",
                    touchAction: "none", // let our handlers capture this, not native scroll
                  }}
                >
                  {/* Task body */}
                  <div
                    className={`absolute inset-0 ${task.color} flex flex-col p-1.5 transition-all duration-100
                      ${isDraggingThis ? "opacity-30 scale-[0.93]" : ""}
                      ${isLongPressed  ? "ring-2 ring-white/70 ring-inset scale-[0.96]" : ""}
                      ${isResizing     ? "ring-2 ring-white ring-inset brightness-110" : ""}`}
                    style={{ borderRadius: 8 }}
                  >
                    <p className="text-white text-[10px] font-semibold leading-tight truncate">{task.title}</p>
                    <p className="text-white/50 text-[9px] tabular-nums">{slotLabel(task.slotIndex)}</p>
                    {task.span > 1 && (
                      <p className="text-white/40 text-[9px] tabular-nums">→ {slotLabel(task.slotIndex + task.span)}</p>
                    )}

                    {/* Edit / Remove buttons in resize mode */}
                    {isResizing && (
                      <div className="absolute top-1 right-1 flex gap-1">
                        <button
                          data-action="edit" data-task-id={task.id}
                          className="w-5 h-5 rounded-full bg-white/25 text-white text-[9px] flex items-center justify-center"
                        >✏</button>
                        <button
                          data-action="remove" data-task-id={task.id}
                          className="w-5 h-5 rounded-full bg-red-500/70 text-white text-[9px] flex items-center justify-center"
                        >✕</button>
                      </div>
                    )}
                  </div>

                  {/* Resize handle (bottom bar) */}
                  {isResizing && (
                    <div
                      data-resize-handle={task.id}
                      className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/50"
                      style={{ height: HANDLE_H, borderRadius: "0 0 8px 8px", touchAction: "none" }}
                    >
                      <div className="w-8 h-0.5 rounded-full bg-white/60" />
                    </div>
                  )}
                </div>
              );
            })}
            </div>{/* end grid */}
          </div>{/* end body row */}
        </div>{/* end content wrapper */}
      </div>{/* end scrollRef */}

      {/* ── Drag ghost ───────────────────────────────────────────────────── */}
      {draggingTask && (
        <div
          className={`fixed pointer-events-none rounded-lg ${draggingTask.color} flex flex-col p-1.5 shadow-2xl z-50`}
          style={{
            left:      dragPos.x - (DAY_W - 4) / 2,
            top:       dragPos.y - draggingTask.span * effSlotH / 2,
            width:     DAY_W - 4,
            height:    draggingTask.span * effSlotH,
            opacity:   0.9,
            transform: "scale(1.06)",
          }}
        >
          <p className="text-white text-[10px] font-semibold leading-tight truncate">{draggingTask.title}</p>
          <p className="text-white/50 text-[9px]">{slotLabel(draggingTask.slotIndex)}</p>
        </div>
      )}

      {/* ── Edit modal ───────────────────────────────────────────────────── */}
      {editingId !== null && (() => {
        const task = tasks.find(t => t.id === editingId);
        if (!task) return null;
        return (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setEditingId(null)}
          >
            <div
              className="bg-zinc-800 rounded-2xl p-5 shadow-2xl mx-4 w-full max-w-xs"
              onClick={e => e.stopPropagation()}
            >
              <p className="text-xs text-zinc-400 mb-2">Tên công việc</p>
              <input
                autoFocus
                className="w-full bg-zinc-700 text-white rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500/60"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    setTasks(prev => prev.map(t => t.id === editingId ? { ...t, title: editTitle.trim() || t.title } : t));
                    setEditingId(null);
                  }
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setEditingId(null)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-700 text-zinc-300 text-xs"
                >Huỷ</button>
                <button
                  onClick={() => {
                    setTasks(prev => prev.map(t => t.id === editingId ? { ...t, title: editTitle.trim() || t.title } : t));
                    setEditingId(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-semibold"
                >Lưu</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
