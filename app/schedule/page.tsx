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

// Infinite-scroll constants
const EPOCH_DATE = new Date(2026, 0, 1);  // absolute day 0
const INF_BUFFER = 180;                   // total columns in infinite mode
const INF_CENTER = 90;                    // today is at this column index

function dateToAbsDay(d: Date): number {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((local.getTime() - EPOCH_DATE.getTime()) / 86400000);
}
function absDayToDate(n: number): Date {
  const d = new Date(EPOCH_DATE);
  d.setDate(EPOCH_DATE.getDate() + n);
  return d;
}
function dayShortOf(d: Date): string {
  return DAY_SHORT[d.getDay() === 0 ? 6 : d.getDay() - 1];
}

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
  const [zoomLevel, setZoomLevel]          = useState(1);
  const [isDark, setIsDark]               = useState(true);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [infiniteScroll, setInfiniteScroll] = useState(false);

  // Effective slot height — derived from zoom, mirrored in a ref for imperative handlers
  const effSlotH    = Math.round(SLOT_H * zoomLevel);
  const effSlotHRef = useRef(SLOT_H);
  const zoomRef     = useRef(1);
  effSlotHRef.current = effSlotH;
  zoomRef.current     = zoomLevel;

  // Saved state for scroll-position preservation during zoom
  // (approach: compute desiredScrollTop directly from pinch-start anchor each step)
  const desiredScrollTopRef = useRef<number | null>(null);

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

  // Theme token shortcuts
  const th = {
    root:        isDark ? "bg-zinc-950 text-white"    : "bg-gray-50 text-zinc-900",
    hdrBg:       isDark ? "bg-zinc-900"               : "bg-white",
    border:      isDark ? "border-zinc-800"           : "border-gray-200",
    stickyHdr:   isDark ? "bg-zinc-900/95"            : "bg-white/95",
    stickyBg:    isDark ? "bg-zinc-950"               : "bg-gray-50",
    halfBorder:  isDark ? "border-zinc-900"           : "border-gray-100",
    dayBorder:   isDark ? "border-zinc-800/60"        : "border-gray-200/80",
    todayCol:    isDark ? "bg-violet-950/15"          : "bg-violet-50/30",
    todayHdr:    isDark ? "bg-violet-900/20"          : "bg-violet-100/40",
    timeText:    isDark ? "text-zinc-600"             : "text-gray-400",
    subtext:     isDark ? "text-zinc-500"             : "text-gray-500",
    inputBg:     isDark ? "bg-zinc-700"               : "bg-gray-100",
    modalBg:     isDark ? "bg-zinc-800"               : "bg-white",
    btnSecondary:isDark ? "bg-zinc-700 text-zinc-300" : "bg-gray-100 text-gray-600",
  };

  // View geometry (depends on mode)
  const weekDates       = getWeekDates(weekOffset);
  const today           = new Date();
  const todayAbsDay     = dateToAbsDay(today);
  const colCount        = infiniteScroll ? INF_BUFFER : DAYS;
  const viewStartAbsDay = infiniteScroll
    ? todayAbsDay - INF_CENTER
    : dateToAbsDay(weekDates[0]);
  const colDates  = Array.from({ length: colCount }, (_, i) => absDayToDate(viewStartAbsDay + i));
  const todayIdx  = colDates.findIndex(d => isSameDay(d, today));

  // Refs so gesture handlers always read current view values
  const colCountRef        = useRef(DAYS);
  const viewStartAbsDayRef = useRef(0);
  const infiniteScrollRef  = useRef(false);
  colCountRef.current        = colCount;
  viewStartAbsDayRef.current = viewStartAbsDay;
  infiniteScrollRef.current  = infiniteScroll;

  // Mutable gesture state
  const gs = useRef({
    startX: 0, startY: 0, t0: 0,
    isDragging: false,
    longPressFired: false,
    isResizeDragging: false,
    isPinching: false,
    pinchDist0: 0,
    pinchZoom0: 1,  // zoom at pinch-gesture start, fixed until next pinch
    pinchScrollTop0: 0,  // scrollTop when pinch started
    pinchScreenY0: 0,    // initial midpoint screen-Y, the content anchor
    pinchRectTop: 0,     // container rect.top at pinch start
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
    if (day < 0 || day >= colCountRef.current || slot < 0 || slot >= SLOTS) return null;
    return { dayIndex: day, slotIndex: slot };
  };

  // Apply pre-computed scroll position after zoom re-render
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || desiredScrollTopRef.current === null) return;
    container.scrollTop = desiredScrollTopRef.current;
    desiredScrollTopRef.current = null;
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
        gs.current.isPinching       = true;
        gs.current.pinchDist0       = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        gs.current.pinchZoom0       = zoomRef.current;
        gs.current.pinchScrollTop0  = container.scrollTop;
        gs.current.pinchScreenY0    = (t1.clientY + t2.clientY) / 2;
        gs.current.pinchRectTop     = container.getBoundingClientRect().top;
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
          gs.current.pinchZoom0 * newDist / gs.current.pinchDist0
        ));
        // Slot that was under the pinch center when the gesture started
        const anchorSlot = (gs.current.pinchScrollTop0 + gs.current.pinchScreenY0
          - gs.current.pinchRectTop - HEADER_H) / (SLOT_H * gs.current.pinchZoom0);
        // Current midpoint (allows simultaneous pan while pinching)
        const midY = (t1.clientY + t2.clientY) / 2;
        // Desired scrollTop that keeps anchorSlot at the current midpoint
        desiredScrollTopRef.current = Math.max(0,
          gs.current.pinchRectTop + HEADER_H + anchorSlot * SLOT_H * newZoom - midY
        );
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
          const destDate = absDayToDate(viewStartAbsDayRef.current + dest.dayIndex);
          fn.current.setBadge(`${dayShortOf(destDate)} ${slotLabel(dest.slotIndex)}`);
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
            const colDate = absDayToDate(viewStartAbsDayRef.current + day);
            fn.current.setBadge(`${dayShortOf(colDate)} ${slotLabel(slot)}`);
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

  // Scroll to today when switching to infinite mode
  useEffect(() => {
    if (!infiniteScroll) return;
    const c = scrollRef.current;
    if (!c) return;
    c.scrollLeft = Math.max(0, INF_CENTER * DAY_W - c.clientWidth / 2);
  }, [infiniteScroll]);

  // Week data — kept for week-mode header
  // (colDates / todayIdx are computed above, before the gesture refs)
  const nowSlot   = today.getHours() * 2 + (today.getMinutes() >= 30 ? 1 : 0);
  const nowFrac   = (today.getMinutes() % 30) / 30;
  const nowTop    = nowSlot * effSlotH + nowFrac * effSlotH;

  const draggingTask = tasks.find(t => t.id === draggingId);

  // Reset tasks when toggling scroll mode to avoid column-index confusion
  const handleToggleInfiniteScroll = () => {
    setInfiniteScroll(v => !v);
    setTasks([]);
    setResizingId(null);
  };

  return (
    <div className={`flex flex-col h-dvh ${th.root} select-none overflow-hidden`}>

      {/* ── App header ───────────────────────────────────────────────────── */}
      <header className={`flex items-center gap-1 px-3 py-2 ${th.hdrBg} border-b ${th.border} shrink-0`}>
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          className={`w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 text-lg ${infiniteScroll ? "opacity-30 pointer-events-none" : ""}`}
        >‹</button>

        <div className="flex-1 text-center min-w-0">
          <p className="text-xs font-semibold text-zinc-300 truncate">
            {infiniteScroll ? "Lịch liên tục" : (
              <>
                {weekDates[0]?.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" })}
                {" – "}
                {weekDates[6]?.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric", year: "numeric" })}
              </>
            )}
          </p>
          {badge && (
            <p className="text-[10px] text-violet-400 truncate">{badge}</p>
          )}
        </div>

        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className={`w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 text-lg ${infiniteScroll ? "opacity-30 pointer-events-none" : ""}`}
        >›</button>

        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="text-[10px] text-violet-400 px-2 py-1 rounded-lg bg-violet-900/40 shrink-0"
          >
            Hôm nay
          </button>
        )}

        <button
          onClick={() => setSettingsOpen(true)}
          className={`w-8 h-8 flex items-center justify-center rounded-lg ${th.subtext} shrink-0`}
          aria-label="Cài đặt"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </header>

      {/* ── Main scrollable area ─────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div style={{ width: TIME_W + colCount * DAY_W }}>

          {/* ── Header row: sticky top, corner also sticky left ──────────── */}
          <div
            className={`flex z-20 ${th.stickyHdr} backdrop-blur-sm border-b ${th.border}`}
            style={{ position: "sticky", top: 0, height: HEADER_H }}
          >
            {/* Top-left corner: sticky in both axes */}
            <div
              className={`${th.stickyHdr} shrink-0 z-30`}
              style={{ position: "sticky", left: 0, width: TIME_W }}
            />
            {/* Day headers: rendered from colDates (7 in week mode, INF_BUFFER in infinite mode) */}
            {colDates.map((date, i) => {
              const isToday = i === todayIdx;
              return (
                <div
                  key={i}
                  style={{ width: DAY_W }}
                  className={`flex flex-col items-center justify-center border-l ${th.border} shrink-0 ${isToday ? th.todayHdr : ""}`}
                >
                  <span className={`text-[10px] font-medium uppercase ${isToday ? "text-violet-400" : "text-zinc-500"}`}>
                    {dayShortOf(date)}
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
              className={`${th.stickyBg} z-10 shrink-0`}
              style={{ position: "sticky", left: 0, width: TIME_W }}
            >
              {Array.from({ length: SLOTS }, (_, slot) => (
                <div
                  key={slot}
                  style={{ height: effSlotH }}
                  className={`flex items-start justify-end pr-1.5 border-t ${th.halfBorder}`}
                >
                  {slot % 2 === 0 && (
                    <span className={`text-[9px] ${th.timeText} -mt-1 leading-none tabular-nums`}>
                      {slotLabel(slot)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* ── Grid area ────────────────────────────────────────────── */}
            <div style={{ position: "relative", width: colCount * DAY_W, height: SLOTS * effSlotH }}>
              {/* Background slot rows */}
              {Array.from({ length: SLOTS }, (_, slot) => (
                <div
                  key={slot}
                  style={{ height: effSlotH, display: "flex" }}
                  className={slot % 2 === 0 ? `border-t ${th.border}` : `border-t ${th.halfBorder}`}
                >
                  {Array.from({ length: colCount }, (_, day) => (
                    <div
                      key={day}
                      data-day={day}
                      data-slot={slot}
                      style={{ width: DAY_W }}
                      className={`shrink-0 border-l ${th.dayBorder} ${day === todayIdx ? th.todayCol : ""}`}
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
                const colIdx = task.dayIndex;
                if (colIdx < 0 || colIdx >= colCount) return null; // outside current view
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
                      left:       colIdx * DAY_W + 2,
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

      {/* ── Settings sidebar ─────────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSettingsOpen(false)} />
          <div className={`relative w-72 h-full ${th.root} flex flex-col border-l ${th.border} shadow-2xl`}>
            <div className={`flex items-center justify-between px-4 py-4 border-b ${th.border} shrink-0`}>
              <h2 className="font-semibold text-base">Cài đặt</h2>
              <button onClick={() => setSettingsOpen(false)} className={`w-8 h-8 flex items-center justify-center rounded-lg ${th.subtext}`}>✕</button>
            </div>
            <div className="flex-1 px-4 py-5 overflow-y-auto">
              {/* Dark / Light toggle */}
              <div className={`flex items-center justify-between py-4 border-b ${th.border}`}>
                <div>
                  <p className="text-sm font-medium">Giao diện</p>
                  <p className={`text-xs ${th.subtext} mt-0.5`}>{isDark ? "Tối" : "Sáng"}</p>
                </div>
                <button
                  onClick={() => setIsDark(d => !d)}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${isDark ? "bg-violet-600" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${isDark ? "translate-x-6" : "translate-x-0.5"}`} />
                </button>
              </div>

              {/* Infinite horizontal scroll toggle */}
              <div className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium">Cuộn ngang vô tận</p>
                  <p className={`text-xs ${th.subtext} mt-0.5`}>
                    {infiniteScroll ? `${INF_BUFFER} ngày (ñặt lại task khi bật/tắt)` : "Chỉ hiện 1 tuần"}
                  </p>
                </div>
                <button
                  onClick={handleToggleInfiniteScroll}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${infiniteScroll ? "bg-violet-600" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${infiniteScroll ? "translate-x-6" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>
          </div>
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
              className={`${th.modalBg} rounded-2xl p-5 shadow-2xl mx-4 w-full max-w-xs`}
              onClick={e => e.stopPropagation()}
            >
              <p className="text-xs text-zinc-400 mb-2">Tên công việc</p>
              <input
                autoFocus
                className={`w-full ${th.inputBg} text-inherit rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500/60`}
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
                  className={`flex-1 py-2.5 rounded-xl ${th.btnSecondary} text-xs`}
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
