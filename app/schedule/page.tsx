"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const SLOT_H    = 32;   // px per 30-min slot
const DAY_W     = 100;  // px per day column
const TIME_W    = 44;   // px for the time-label column
const HEADER_H  = 52;   // px for the day-header row
const SLOTS     = 48;   // 00:00 → 23:30
const DAYS      = 7;

const LONG_PRESS_MS = 350;
const DRAG_DELTA    = 8;
const HANDLE_H      = 14;
const DAY_W_MIN     = 60;
const DAY_W_MAX     = 140;
const DAY_W_STEP    = 20;

const COLORS = [
  "bg-violet-600", "bg-emerald-600", "bg-amber-500",  "bg-sky-600",
  "bg-rose-600",   "bg-teal-600",    "bg-orange-500", "bg-indigo-600",
  "bg-pink-600",   "bg-cyan-600",    "bg-lime-600",   "bg-fuchsia-600",
];

const TAILWIND_COLOR_TO_HEX: Record<string, string> = {
  "bg-violet-600": "#7c3aed",
  "bg-emerald-600": "#059669",
  "bg-amber-500": "#f59e0b",
  "bg-sky-600": "#0284c7",
  "bg-rose-600": "#e11d48",
  "bg-teal-600": "#0d9488",
  "bg-orange-500": "#f97316",
  "bg-indigo-600": "#4f46e5",
  "bg-pink-600": "#db2777",
  "bg-cyan-600": "#0891b2",
  "bg-lime-600": "#65a30d",
  "bg-fuchsia-600": "#c026d3",
};

const DEFAULT_TASK_BG = "__DEFAULT_TASK_BG__";
const PERSONAL_TASK_BG = "__PERSONAL_TASK_BG__";
const LEGACY_DEFAULT_TASK_BG = "bg-zinc-700";

const DAY_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const TASK_TITLE_POOL = [
  "Đi gặp khách hàng",
  "Đi khảo sát công trình",
  "Đi lấy vật tư",
  "Kiểm tra tiến độ đội thi công",
  "Làm việc với nhà cung cấp",
  "Nghiệm thu hạng mục",
  "Họp điều phối công việc",
  "Chuẩn bị hồ sơ thanh toán",
  "Kiểm tra an toàn công trường",
  "Cập nhật báo cáo cuối ngày",
];

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

function currentTimeScrollTop(slotH: number) {
  const now = new Date();
  return Math.max(0, (now.getHours() * 2 - 3) * slotH);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  id: number;
  title: string;
  description: string;
  absDay: number;
  slotIndex: number;  // 0=00:00 … 47=23:30
  span: number;       // 1=30min, 2=1hr, …
  color: string;
  label: string;
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  assignedFromName: string | null;
}

interface SessionUser {
  id: number;
  name: string;
  role: "ADMIN" | "STAFF";
  avatar: string;
}

interface ApiTask {
  id: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  color: string;
  label: string;
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  assignedFromName: string | null;
}

type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE";
type TaskLabelValue = "DEFAULT" | "PERSONAL";

const DEFAULT_TASK_LABEL: TaskLabelValue = "DEFAULT";
const PERSONAL_TASK_LABEL: TaskLabelValue = "PERSONAL";

const TASK_LABEL_TEXT: Record<TaskLabelValue, string> = {
  DEFAULT: "Mặc định",
  PERSONAL: "Việc cá nhân",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "Đang chờ tiếp nhận",
  IN_PROGRESS: "Đang làm",
  DONE: "Đã hoàn thành",
};

const AUTH_STORAGE_KEY = "todo2026.currentUser";
const TASK_DRAFT_STORAGE_PREFIX = "todo2026.tasksDraft";

const SLOT_MS = 30 * 60 * 1000;

interface LocalTaskDraft {
  updatedAt: number;
  synced: boolean;
  tasks: Task[];
}

function taskDraftStorageKey(ownerUserId: number): string {
  return `${TASK_DRAFT_STORAGE_PREFIX}.${ownerUserId}`;
}

function taskSignature(tasks: Task[]): string {
  return JSON.stringify(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      absDay: task.absDay,
      slotIndex: task.slotIndex,
      span: task.span,
      color: task.color,
      label: task.label,
      status: task.status,
      assignedFromName: task.assignedFromName,
    })),
  );
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "PENDING" || value === "IN_PROGRESS" || value === "DONE";
}

function normalizeTaskLabel(value: unknown): TaskLabelValue {
  if (typeof value !== "string") return DEFAULT_TASK_LABEL;

  const normalized = value.trim().toLowerCase();
  if (normalized === "personal" || normalized === "việc cá nhân" || normalized === "viec ca nhan") {
    return PERSONAL_TASK_LABEL;
  }

  return DEFAULT_TASK_LABEL;
}

function taskLabelText(value: unknown): string {
  return TASK_LABEL_TEXT[normalizeTaskLabel(value)];
}

function randomTaskTitle(): string {
  const i = Math.floor(Math.random() * TASK_TITLE_POOL.length);
  return TASK_TITLE_POOL[i] ?? "Công việc mới";
}

function maxTaskId(tasks: Task[]): number {
  return tasks.reduce((max, task) => Math.max(max, task.id), 0);
}

function ensureUniqueTaskIds(tasks: Task[]): Task[] {
  const seen = new Set<number>();
  let nextId = maxTaskId(tasks);
  let changed = false;

  const normalized = tasks.map((task) => {
    if (!seen.has(task.id)) {
      seen.add(task.id);
      return task;
    }

    changed = true;
    nextId += 1;
    seen.add(nextId);
    return { ...task, id: nextId };
  });

  return changed ? normalized : tasks;
}

function sanitizeDraftTask(value: unknown): Task | null {
  const task = (value ?? {}) as Partial<Task>;
  if (
    typeof task.id !== "number" ||
    typeof task.title !== "string" ||
    typeof task.description !== "string" ||
    typeof task.absDay !== "number" ||
    typeof task.slotIndex !== "number" ||
    typeof task.span !== "number" ||
    typeof task.color !== "string" ||
    typeof task.label !== "string" ||
    !isTaskStatus(task.status)
  ) {
    return null;
  }

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    absDay: task.absDay,
    slotIndex: task.slotIndex,
    span: Math.max(1, task.span),
    color: task.color,
    label: normalizeTaskLabel(task.label),
    status: task.status,
    assignedFromName: typeof task.assignedFromName === "string" ? task.assignedFromName : null,
  };
}

function readTaskDraft(ownerUserId: number): LocalTaskDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(taskDraftStorageKey(ownerUserId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown; synced?: unknown; tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return null;
    const tasks = parsed.tasks
      .map((item) => sanitizeDraftTask(item))
      .filter((item): item is Task => item !== null);

    return {
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      synced: parsed.synced === true,
      tasks,
    };
  } catch {
    return null;
  }
}

function writeTaskDraft(ownerUserId: number, tasks: Task[], synced: boolean): void {
  if (typeof window === "undefined") return;
  const payload: LocalTaskDraft = {
    updatedAt: Date.now(),
    synced,
    tasks,
  };
  window.localStorage.setItem(taskDraftStorageKey(ownerUserId), JSON.stringify(payload));
}

function buildDateFromAbsDayAndSlot(absDay: number, slotIndex: number): Date {
  const date = absDayToDate(absDay);
  const hours = Math.floor(slotIndex / 2);
  const minutes = slotIndex % 2 === 0 ? 0 : 30;
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function taskToApiInput(task: Task): {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  color: string;
  label: string;
  status: TaskStatus;
} {
  const start = buildDateFromAbsDayAndSlot(task.absDay, task.slotIndex);
  const end = new Date(start.getTime() + Math.max(1, task.span) * SLOT_MS);
  return {
    title: task.title,
    description: task.description,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    color: task.color,
    label: normalizeTaskLabel(task.label),
    status: task.status,
  };
}

function apiTaskToLocalTask(apiTask: ApiTask): Task {
  const start = new Date(apiTask.startAt);
  const end = new Date(apiTask.endAt);
  const absDay = dateToAbsDay(start);
  const slotIndex = start.getHours() * 2 + (start.getMinutes() >= 30 ? 1 : 0);
  const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / SLOT_MS));

  return {
    id: apiTask.id,
    title: apiTask.title,
    description: apiTask.description,
    absDay,
    slotIndex,
    span,
    color: apiTask.color,
    label: normalizeTaskLabel(apiTask.label),
    status: apiTask.status,
    assignedFromName: apiTask.assignedFromName,
  };
}

function resolveTaskBgClass(taskColor: string, isDark: boolean): string {
  if (taskColor === DEFAULT_TASK_BG || taskColor === LEGACY_DEFAULT_TASK_BG) {
    return isDark ? "bg-sky-700/80" : "bg-sky-500/85";
  }
  if (taskColor === PERSONAL_TASK_BG) {
    return isDark ? "bg-emerald-700/75" : "bg-emerald-500/70";
  }
  return taskColor;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function colorToPickerHex(taskColor: string): string {
  if (isHexColor(taskColor)) return taskColor;
  if (taskColor === DEFAULT_TASK_BG || taskColor === LEGACY_DEFAULT_TASK_BG) return "#3f3f46";
  if (taskColor === PERSONAL_TASK_BG) return "#16a34a";
  return TAILWIND_COLOR_TO_HEX[taskColor] ?? "#7c3aed";
}

function doneTaskBgClass(isDark: boolean): string {
  return isDark
    ? "border border-zinc-300/60 brightness-90"
    : "border border-zinc-500/50 brightness-95";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [tasks, setTasks]                 = useState<Task[]>([]);
  const [weekOffset, setWeekOffset]       = useState(0);
  const [draggingId, setDraggingId]       = useState<number | null>(null);
  const [longPressedId, setLongPressedId] = useState<number | null>(null);
  const [dragPos, setDragPos]             = useState({ x: 0, y: 0 });
  const [dragTiltDeg, setDragTiltDeg]     = useState(0);
  const [dragPreview, setDragPreview]     = useState<{ dayIndex: number; slotIndex: number } | null>(null);
  const [resizingId, setResizingId]       = useState<number | null>(null);
  const [reviewTaskId, setReviewTaskId]   = useState<number | null>(null);
  const [editingId, setEditingId]         = useState<number | null>(null);
  const [editTitle, setEditTitle]         = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLabel, setEditLabel]         = useState<TaskLabelValue>(DEFAULT_TASK_LABEL);
  const [editStatus, setEditStatus]       = useState<TaskStatus>("PENDING");
  const [badge, setBadge]                 = useState<string | null>(null);
  const [zoomLevel, setZoomLevel]          = useState(1);
  const [dayWidth, setDayWidth]           = useState(DAY_W);
  const [isDark, setIsDark]               = useState(true);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [infiniteScroll, setInfiniteScroll] = useState(false);
  const [sessionUser, setSessionUser]     = useState<SessionUser | null>(null);
  const [usersForAuth, setUsersForAuth]   = useState<SessionUser[]>([]);
  const [authUserId, setAuthUserId]       = useState<number | null>(null);
  const [authError, setAuthError]         = useState<string | null>(null);
  const [authBusy, setAuthBusy]           = useState(false);
  const avatarInputRef                    = useRef<HTMLInputElement>(null);
  const isHydratingTasksRef               = useRef(false);
  const sessionUserRef                     = useRef<SessionUser | null>(null);
  const usersForAuthRef                    = useRef<SessionUser[]>([]);
  const authUserIdRef                      = useRef<number | null>(null);
  const isViewingOwnScheduleRef            = useRef(false);
  const lastSyncedSignatureRef             = useRef("");
  const hasPendingChangesRef               = useRef(false);

  sessionUserRef.current = sessionUser;
  usersForAuthRef.current = usersForAuth;
  authUserIdRef.current = authUserId;
  isViewingOwnScheduleRef.current = sessionUser !== null && authUserId === sessionUser.id;

  // Effective slot height — derived from zoom, mirrored in a ref for imperative handlers
  const effSlotH    = Math.round(SLOT_H * zoomLevel);
  const effSlotHRef = useRef(SLOT_H);
  const dayWidthRef = useRef(DAY_W);
  const zoomRef     = useRef(1);
  effSlotHRef.current = effSlotH;
  dayWidthRef.current = dayWidth;
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
    setDragPos, setDragPreview, setResizingId, setEditingId, setEditTitle, setBadge, setZoomLevel,
    nextId:    (): number => ++taskIdRef.current,
    nextColor: (): string => { const c = COLORS[colorRef.current % COLORS.length]; colorRef.current++; return c; },
  });
  fn.current.setTasks         = setTasks;
  fn.current.setDraggingId    = setDraggingId;
  fn.current.setLongPressedId = setLongPressedId;
  fn.current.setDragPos       = setDragPos;
  fn.current.setDragPreview   = setDragPreview;
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
    dismissResizeTap: false,
    pendingAction:    null as "edit" | "remove" | "accept" | "complete" | null,
    pendingTaskId:    null as number | null,
    startScrollLeft:  0,
    startScrollTop:   0,
    didScroll:        false,
    lastMoveX:        0,
    lastMoveTime:     0,
    lastVx:           0,
  });

  const clearTimer = () => {
    if (gs.current.timer) { clearTimeout(gs.current.timer); gs.current.timer = null; }
  };

  const patchTask = (taskId: number, patch: Partial<Task>) => {
    fn.current.setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
  };

  const applyTaskAction = (action: "edit" | "remove" | "accept" | "complete", taskId: number) => {
    if (action === "remove") {
      const task = tasksRef.current.find((t) => t.id === taskId);
      const taskName = task?.title?.trim() || `#${taskId}`;
      const shouldDelete = window.confirm(`Bạn có chắc muốn xóa task \"${taskName}\" không?`);
      if (!shouldDelete) return;

      fn.current.setTasks(prev => prev.filter(t => t.id !== taskId));
      fn.current.setResizingId(null);
      fn.current.setBadge("Đã xoá");
      return;
    }

    if (action === "edit") {
      const task = tasksRef.current.find(t => t.id === taskId);
      fn.current.setEditTitle(task?.title ?? "");
      setEditDescription(task?.description ?? "");
      setEditLabel(normalizeTaskLabel(task?.label));
      setEditStatus(task?.status ?? "PENDING");
      fn.current.setEditingId(null);
      setReviewTaskId(taskId);
      return;
    }

    if (action === "accept") {
      fn.current.setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: "IN_PROGRESS" } : t));
      fn.current.setBadge("Đã nhận task");
      return;
    }

    let nextStatus: TaskStatus = "DONE";
    fn.current.setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      nextStatus = t.status === "DONE" ? "IN_PROGRESS" : "DONE";
      return { ...t, status: nextStatus };
    }));
    fn.current.setBadge(nextStatus === "DONE" ? "Đã hoàn thành" : "Đang làm lại");
    return;
  };

  // Convert screen coords to { dayIndex, slotIndex } within the current scroll position
  const screenToSlot = (cx: number, cy: number) => {
    const el = scrollRef.current;
    if (!el) return null;
    const r    = el.getBoundingClientRect();
    const relX = cx - r.left + el.scrollLeft - TIME_W;
    const relY = cy - r.top  + el.scrollTop  - HEADER_H;
    const day  = Math.floor(relX / dayWidthRef.current);
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
        // Prevent synthetic click after touch to avoid double-toggle on mobile.
        e.preventDefault();
        gs.current.pendingAction  = actionEl.dataset.action as "edit" | "remove" | "accept" | "complete";
        gs.current.pendingTaskId  = Number(actionEl.dataset.taskId);
        return;
      }

      // Make complete checkbox easier to tap by using hit-slop on the top-left area.
      const taskElForHitSlop = el?.closest<HTMLElement>("[data-task-id]");
      if (taskElForHitSlop) {
        const taskId = Number(taskElForHitSlop.dataset.taskId);
        const task = tasksRef.current.find((item) => item.id === taskId);
        const canToggleDone =
          isViewingOwnScheduleRef.current &&
          (task?.status === "IN_PROGRESS" || task?.status === "DONE");

        if (canToggleDone) {
          const rect = taskElForHitSlop.getBoundingClientRect();
          const hitSlop = 10;
          const hitSize = 28;
          const withinX = t.clientX >= rect.left - hitSlop && t.clientX <= rect.left + hitSize + hitSlop;
          const withinY = t.clientY >= rect.top - hitSlop && t.clientY <= rect.top + hitSize + hitSlop;

          if (withinX && withinY) {
            e.preventDefault();
            gs.current.pendingAction = "complete";
            gs.current.pendingTaskId = taskId;
            return;
          }
        }
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

      // If resize mode is active, the first tap outside should only dismiss it.
      if (resizingIdRef.current !== null) {
        fn.current.setResizingId(null);
        gs.current.dismissResizeTap = true;
        gs.current.touchedTaskId = null;
        gs.current.touchedDay = null;
        gs.current.touchedSlot = null;
        return;
      }

      gs.current.startX = t.clientX;
      gs.current.startY = t.clientY;
      gs.current.t0     = Date.now();
      gs.current.isDragging     = false;
      gs.current.longPressFired = false;
      gs.current.startScrollLeft = container.scrollLeft;
      gs.current.startScrollTop = container.scrollTop;
      gs.current.didScroll = false;

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

      // Once long-press is active on a task, stop native panning so drag gesture is exclusive.
      if (gs.current.longPressFired && !gs.current.isResizeDragging && !gs.current.isPinching) {
        e.preventDefault();
      }

      if (!gs.current.isDragging && !gs.current.isResizeDragging && !gs.current.isPinching) {
        const dxScroll = Math.abs(container.scrollLeft - gs.current.startScrollLeft);
        const dyScroll = Math.abs(container.scrollTop - gs.current.startScrollTop);
        if (dxScroll > 2 || dyScroll > 2) {
          gs.current.didScroll = true;
          clearTimer();
        }
      }

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
        fn.current.setDragPreview(screenToSlot(t.clientX, t.clientY));
        gs.current.lastMoveX = t.clientX;
        gs.current.lastMoveTime = performance.now();
        gs.current.lastVx = 0;
        setDragTiltDeg(0);
        fn.current.setLongPressedId(null);
      }

      if (gs.current.isDragging) {
        e.preventDefault(); // stop native scroll during task drag
        const now = performance.now();
        const dt = Math.max(1, now - gs.current.lastMoveTime);
        const vx = (t.clientX - gs.current.lastMoveX) / dt;
        const ax = (vx - gs.current.lastVx) / dt;
        // Convert horizontal acceleration to visual tilt and clamp to +/-20deg.
        const tilt = Math.max(-20, Math.min(20, ax * 2200));
        setDragTiltDeg(tilt);
        gs.current.lastMoveX = t.clientX;
        gs.current.lastMoveTime = now;
        gs.current.lastVx = vx;
        fn.current.setDragPreview(screenToSlot(t.clientX, t.clientY));
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

      if (gs.current.dismissResizeTap) {
        gs.current.dismissResizeTap = false;
        return;
      }

      // Always execute pending action first to avoid dropping taps after tiny scroll jitter.
      if (gs.current.pendingAction !== null) {
        const action = gs.current.pendingAction;
        const taskId = gs.current.pendingTaskId!;
        applyTaskAction(action, taskId);
        gs.current.pendingAction = null;
        gs.current.pendingTaskId = null;
        gs.current.longPressFired = false;
        gs.current.draggingTaskId = null;
        gs.current.touchedTaskId  = null;
        gs.current.touchedDay     = null;
        gs.current.touchedSlot    = null;
        gs.current.didScroll      = false;
        return;
      }

      if (gs.current.didScroll && !gs.current.isDragging && !gs.current.isResizeDragging) {
        gs.current.longPressFired = false;
        gs.current.draggingTaskId = null;
        gs.current.touchedTaskId  = null;
        gs.current.touchedDay     = null;
        gs.current.touchedSlot    = null;
        return;
      }

      clearTimer();
      const t = e.changedTouches[0];

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
            task.id === taskId
              ? { ...task, absDay: viewStartAbsDayRef.current + dest.dayIndex, slotIndex: dest.slotIndex }
              : task
          ));
          const destDate = absDayToDate(viewStartAbsDayRef.current + dest.dayIndex);
          fn.current.setBadge(`${dayShortOf(destDate)} ${slotLabel(dest.slotIndex)}`);
        }
        fn.current.setDragPreview(null);
        fn.current.setDraggingId(null);
        setDragTiltDeg(0);
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

      // ── Quick tap on task → open detail modal ───────────────────────────
      } else if (gs.current.touchedTaskId !== null) {
        const adx = Math.abs(t.clientX - gs.current.startX);
        const ady = Math.abs(t.clientY - gs.current.startY);
        if (adx < 10 && ady < 10 && Date.now() - gs.current.t0 < LONG_PRESS_MS) {
          setEditingId(null);
          setReviewTaskId(gs.current.touchedTaskId);
        }

      // ── Quick tap → create task ───────────────────────────────────────────
      } else if (gs.current.touchedTaskId === null) {
        const adx = Math.abs(t.clientX - gs.current.startX);
        const ady = Math.abs(t.clientY - gs.current.startY);
        if (adx < 10 && ady < 10 && Date.now() - gs.current.t0 < 500) {
          if (gs.current.touchedDay !== null && gs.current.touchedSlot !== null) {
            const day   = gs.current.touchedDay;
            const slot  = gs.current.touchedSlot;
            const id    = fn.current.nextId();
            const ownerName = usersForAuthRef.current.find((u) => u.id === authUserIdRef.current)?.name ?? null;
            const actorUser = sessionUserRef.current;
            const assignedFromName = actorUser && ownerName && actorUser.name !== ownerName
              ? actorUser.name
              : null;
            const initialLabel: TaskLabelValue = actorUser && authUserIdRef.current === actorUser.id
              ? PERSONAL_TASK_LABEL
              : DEFAULT_TASK_LABEL;
            const color = initialLabel === PERSONAL_TASK_LABEL ? PERSONAL_TASK_BG : DEFAULT_TASK_BG;
            const initialStatus: TaskStatus = actorUser && authUserIdRef.current === actorUser.id
              ? "IN_PROGRESS"
              : "PENDING";

            fn.current.setTasks(prev => [...prev, {
              id,
              title: randomTaskTitle(),
              description: "",
              absDay: viewStartAbsDayRef.current + day,
              slotIndex: slot,
              span: 2,
              color,
              label: initialLabel,
              status: initialStatus,
              assignedFromName,
            }]);
            fn.current.setResizingId(id);
            fn.current.setBadge("Kéo thanh để điều chỉnh thời lượng");
          }
        }
      }

      gs.current.longPressFired = false;
      gs.current.draggingTaskId = null;
      gs.current.touchedTaskId  = null;
      gs.current.touchedDay     = null;
      gs.current.touchedSlot    = null;
      gs.current.didScroll      = false;
      fn.current.setDragPreview(null);
      setDragTiltDeg(0);
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

  useEffect(() => {
    void loadAuthUsers();
  }, []);

  const loadAuthUsers = async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const data = (await res.json()) as { users?: SessionUser[] };
      if (!res.ok || !Array.isArray(data.users)) return;

      const fetchedUsers = data.users;
      setUsersForAuth(fetchedUsers);

      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as { id?: number }) : null;
      const activeId = typeof parsed?.id === "number" ? parsed.id : null;
      const activeUser = fetchedUsers.find((u) => u.id === activeId) ?? null;

      setSessionUser(activeUser);
      setAuthUserId((prev) => prev ?? activeUser?.id ?? fetchedUsers[0]?.id ?? null);
    } catch {
      setSessionUser(null);
    }
  };

  const persistTasksToServer = async (
    tasksToSave: Task[],
    options?: { showBadge?: boolean; keepalive?: boolean },
  ) => {
    if (!authUserId || !sessionUser || isHydratingTasksRef.current) return;

    try {
      const response = await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerUserId: authUserId,
          actorUserId: sessionUser.id,
          tasks: tasksToSave.map(taskToApiInput),
        }),
        keepalive: options?.keepalive,
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Không thể lưu task.");
      }

      setAuthError(null);
      if (options?.showBadge) {
        setBadge("Đã tự lưu");
      }
      lastSyncedSignatureRef.current = taskSignature(tasksToSave);
      hasPendingChangesRef.current = false;
      writeTaskDraft(authUserId, tasksToSave, true);
    } catch (error) {
      hasPendingChangesRef.current = true;
      writeTaskDraft(authUserId, tasksToSave, false);
      if (!options?.keepalive) {
        setAuthError(error instanceof Error ? error.message : "Không thể lưu task.");
      }
    }
  };

  const loadTasksForViewedUser = async (ownerUserId: number) => {
    try {
      isHydratingTasksRef.current = true;
      const actorUserId = sessionUserRef.current?.id;
      const query = actorUserId
        ? `/api/tasks?ownerUserId=${ownerUserId}&actorUserId=${actorUserId}`
        : `/api/tasks?ownerUserId=${ownerUserId}`;
      const response = await fetch(query, { cache: "no-store" });
      const data = (await response.json()) as { tasks?: ApiTask[]; error?: string };
      if (!response.ok || !Array.isArray(data.tasks)) {
        throw new Error(data.error ?? "Không thể tải task.");
      }
      const canViewPersonal = sessionUserRef.current?.id === ownerUserId;
      const remoteTasks = ensureUniqueTaskIds(data.tasks
        .map(apiTaskToLocalTask)
        .filter((task) => canViewPersonal || normalizeTaskLabel(task.label) !== PERSONAL_TASK_LABEL));
      const draft = readTaskDraft(ownerUserId);
      const draftTasks = ensureUniqueTaskIds((draft?.tasks ?? []).filter(
        (task) => canViewPersonal || normalizeTaskLabel(task.label) !== PERSONAL_TASK_LABEL,
      ));

      if (draft && !draft.synced) {
        const draftSignature = taskSignature(draftTasks);
        const remoteSignature = taskSignature(remoteTasks);
        if (draftSignature !== remoteSignature) {
          setTasks(draftTasks);
          taskIdRef.current = Math.max(taskIdRef.current, maxTaskId(draftTasks));
          lastSyncedSignatureRef.current = remoteSignature;
          hasPendingChangesRef.current = true;
          setBadge("Đã khôi phục thay đổi chưa đồng bộ");

          if (sessionUserRef.current) {
            window.setTimeout(() => {
              void persistTasksToServer(draftTasks, { showBadge: true });
            }, 0);
          }
          return;
        }
      }

      setTasks(remoteTasks);
  taskIdRef.current = Math.max(taskIdRef.current, maxTaskId(remoteTasks));
      lastSyncedSignatureRef.current = taskSignature(remoteTasks);
      hasPendingChangesRef.current = false;
      writeTaskDraft(ownerUserId, remoteTasks, true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Không thể tải task.");
      setTasks([]);
      lastSyncedSignatureRef.current = "";
      hasPendingChangesRef.current = false;
    } finally {
      window.setTimeout(() => {
        isHydratingTasksRef.current = false;
      }, 0);
    }
  };

  const handleViewUserChange = (nextUserId: number) => {
    setAuthUserId(nextUserId);
    const selected = usersForAuth.find((u) => u.id === nextUserId);
    if (selected) {
      setBadge(`Đang xem lịch của ${selected.name}`);
    }
  };

  useEffect(() => {
    if (!authUserId) return;
    void loadTasksForViewedUser(authUserId);
  }, [authUserId]);

  useEffect(() => {
    if (!authUserId || isHydratingTasksRef.current) return;
    const signature = taskSignature(tasks);
    const isSynced = signature === lastSyncedSignatureRef.current;
    hasPendingChangesRef.current = !isSynced;
    writeTaskDraft(authUserId, tasks, isSynced);
  }, [tasks, authUserId]);

  useEffect(() => {
    taskIdRef.current = Math.max(taskIdRef.current, maxTaskId(tasks));
  }, [tasks]);

  useEffect(() => {
    if (!authUserId || !sessionUser || isHydratingTasksRef.current || !hasPendingChangesRef.current) return;

    const snapshot = tasks;
    const t = setTimeout(async () => {
      await persistTasksToServer(snapshot, { showBadge: true });
    }, 15000);

    return () => clearTimeout(t);
  }, [tasks, authUserId, sessionUser]);

  useEffect(() => {
    const flushPendingTasks = () => {
      if (isHydratingTasksRef.current || !hasPendingChangesRef.current) return;

      const ownerUserId = authUserIdRef.current;
      const actorUser = sessionUserRef.current;
      if (!ownerUserId || !actorUser) return;

      const snapshot = tasksRef.current;
      writeTaskDraft(ownerUserId, snapshot, false);

      void fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerUserId,
          actorUserId: actorUser.id,
          tasks: snapshot.map(taskToApiInput),
        }),
        keepalive: true,
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingTasks();
      }
    };

    window.addEventListener("beforeunload", flushPendingTasks);
    window.addEventListener("pagehide", flushPendingTasks);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushPendingTasks);
      window.removeEventListener("pagehide", flushPendingTasks);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const handleAvatarPick = () => {
    if (!sessionUser) return;
    avatarInputRef.current?.click();
  };

  const handleAvatarFileChange = async (file: File | null) => {
    if (!sessionUser || !file) return;
    setAuthBusy(true);
    setAuthError(null);

    try {
      const avatarUrl = await uploadAvatarToCloudinary(file);
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-actor-user-id": String(sessionUser.id),
        },
        body: JSON.stringify({ avatar: avatarUrl }),
      });
      const data = (await response.json()) as { user?: SessionUser; error?: string };
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "Không thể cập nhật avatar.");
      }

      setSessionUser(data.user);
      setBadge("Đã cập nhật avatar");
      await loadAuthUsers();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Không thể cập nhật avatar.");
    } finally {
      setAuthBusy(false);
    }
  };

  // Scroll to today when switching to infinite mode
  useEffect(() => {
    if (!infiniteScroll) return;
    const c = scrollRef.current;
    if (!c) return;
    c.scrollTo({
      left: INF_CENTER * dayWidth,
      top: currentTimeScrollTop(effSlotHRef.current),
    });
  }, [infiniteScroll, dayWidth]);

  // Week data — kept for week-mode header
  // (colDates / todayIdx are computed above, before the gesture refs)
  const nowSlot   = today.getHours() * 2 + (today.getMinutes() >= 30 ? 1 : 0);
  const nowFrac   = (today.getMinutes() % 30) / 30;
  const nowTop    = nowSlot * effSlotH + nowFrac * effSlotH;

  const draggingTask = tasks.find(t => t.id === draggingId);
  const draggingTaskBgClass = draggingTask && !isHexColor(draggingTask.color)
    ? resolveTaskBgClass(draggingTask.color, isDark)
    : "";
  const draggingTaskBgStyle = draggingTask && isHexColor(draggingTask.color)
    ? { backgroundColor: draggingTask.color }
    : undefined;
  const isViewingOwnSchedule = sessionUser !== null && authUserId === sessionUser.id;

  const handleResetInfiniteView = () => {
    const c = scrollRef.current;
    if (!c) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    c.scrollTo({
      left: INF_CENTER * dayWidth,
      top: currentTimeScrollTop(effSlotHRef.current),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    setBadge("Đã reset về hôm nay");
  };

  // Keep tasks when toggling scroll mode; positions are already anchored by absDay.
  const handleToggleInfiniteScroll = () => {
    setInfiniteScroll(v => !v);
    setResizingId(null);
  };

  return (
    <div className={`flex flex-col h-dvh ${th.root} select-none overflow-hidden`}>

      {/* ── App header ───────────────────────────────────────────────────── */}
      <header className={`relative flex items-center gap-1 px-3 py-2 pr-12 ${th.hdrBg} border-b ${th.border} shrink-0`}>
        {infiniteScroll ? (
          <div className="w-8 h-8 shrink-0" />
        ) : (
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 text-lg"
          >‹</button>
        )}

        <div className="flex-1 text-center min-w-0">
          <p className="text-xs font-semibold text-zinc-300 truncate">
            {infiniteScroll ? today.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" }) : (
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

        <div className="flex items-center gap-1 shrink-0">
          {infiniteScroll ? (
            <button
              onClick={handleResetInfiniteView}
              className="text-[10px] text-violet-400 px-2 py-1 rounded-lg bg-violet-900/40 shrink-0"
            >
              Reset view
            </button>
          ) : (
            <>
              <button
                onClick={() => setWeekOffset(w => w + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 text-lg"
              >›</button>

              {weekOffset !== 0 && (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="hidden min-[360px]:inline-flex text-[10px] text-violet-400 px-2 py-1 rounded-lg bg-violet-900/40 shrink-0"
                >
                  Hôm nay
                </button>
              )}
            </>
          )}

        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg ${th.subtext} shrink-0`}
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
        style={{ touchAction: "pan-x pan-y", overscrollBehavior: "contain" }}
      >
        <div style={{ width: TIME_W + colCount * dayWidth }}>

          {/* ── Header row: sticky top, corner also sticky left ──────────── */}
          <div
            className={`flex z-20 ${th.stickyHdr} border-b ${th.border}`}
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
                  style={{ width: dayWidth }}
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
            <div style={{ position: "relative", width: colCount * dayWidth, height: SLOTS * effSlotH }}>
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
                      style={{ width: dayWidth }}
                      className={`shrink-0 border-l ${th.dayBorder} ${day === todayIdx ? th.todayCol : ""}`}
                    />
                  ))}
                </div>
              ))}

              {/* Current time red line */}
              {todayIdx >= 0 && (
                <div
                  className="absolute pointer-events-none z-20 flex items-center"
                  style={{ top: nowTop - 1, left: todayIdx * dayWidth, width: dayWidth }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 -ml-0.5 shrink-0" />
                  <div className="flex-1 h-px bg-red-500" style={{ boxShadow: "0 0 4px rgba(239,68,68,0.7)" }} />
                </div>
              )}

              {/* Task blocks */}
              {tasks.map(task => {
                const colIdx = task.absDay - viewStartAbsDay;
                if (colIdx < 0 || colIdx >= colCount) return null; // outside current view
                const isDraggingThis = draggingId    === task.id;
                const isResizing     = resizingId    === task.id;
                const isLongPressed  = longPressedId === task.id;
                const isPending = task.status === "PENDING";
                const isInProgress = task.status === "IN_PROGRESS";
                const isDone = task.status === "DONE";
                const taskBgClass = isHexColor(task.color) ? "" : resolveTaskBgClass(task.color, isDark);
                const taskBgStyle = isHexColor(task.color) ? { backgroundColor: task.color } : undefined;
                const subtitleLabel = normalizeTaskLabel(task.label) === PERSONAL_TASK_LABEL
                  ? TASK_LABEL_TEXT.PERSONAL
                  : "";
                const subtitleText = subtitleLabel ? `#${subtitleLabel}` : "";
                const h = task.span * effSlotH;

                return (
                  <div
                    key={task.id}
                    ref={el => { if (el) taskEls.current.set(task.id, el); else taskEls.current.delete(task.id); }}
                    data-task-id={task.id}
                    className="absolute overflow-hidden"
                    style={{
                      left:       colIdx * dayWidth + 2,
                      top:        task.slotIndex * effSlotH,
                      width:      dayWidth - 4,
                      height:     h,
                      borderRadius: 8,
                      zIndex:     isDraggingThis ? 20 : isResizing ? 15 : 5,
                      transition: gs.current.isResizeDragging ? "none" : "height 0.15s ease",
                      touchAction: "pan-x pan-y", // allow scrolling even when touch starts on a task
                  }}
                >
                  {/* Task body */}
                  <div
                    className={`absolute inset-0 ${taskBgClass} flex flex-col p-1.5 transition-all duration-100
                      ${isDraggingThis ? "opacity-0" : ""}
                      ${isLongPressed  ? "ring-2 ring-white/70 ring-inset scale-[0.96]" : ""}
                      ${isResizing     ? "ring-2 ring-white ring-inset brightness-110" : ""}
                      ${isDone ? doneTaskBgClass(isDark) : ""}
                      ${isPending ? "border border-dashed border-white/60 bg-black/20" : ""}`}
                    style={{ borderRadius: 8, ...taskBgStyle }}
                  >
                    {isViewingOwnSchedule && (isInProgress || isDone) && (
                      <button
                        type="button"
                        data-action="complete"
                        data-task-id={task.id}
                        onClick={() => applyTaskAction("complete", task.id)}
                        className={`absolute top-1 left-1 h-6 w-6 shrink-0 rounded-md border flex items-center justify-center z-10 ${isDone ? "border-emerald-300 bg-emerald-400/30" : "border-white/85 bg-black/25"}`}
                        title={isDone ? "Bỏ hoàn thành" : "Đánh dấu hoàn thành"}
                        aria-label={isDone ? "Bỏ hoàn thành" : "Đánh dấu hoàn thành"}
                      >
                        {isDone && <span className="text-xs leading-none text-emerald-200">✓</span>}
                      </button>
                    )}

                    <div className="flex items-start gap-1 pl-6">
                      <p
                        className={`text-[11px] font-semibold leading-tight flex-1 text-white ${isDone ? "line-through" : ""}`}
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {task.title}
                      </p>
                    </div>

                    {task.description.trim() && (
                      <p
                        className="text-white/80 text-[9px]"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {task.description}
                      </p>
                    )}
                    {subtitleText && (
                      <p
                        className="text-white/75 text-[9px] italic"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {subtitleText}
                      </p>
                    )}
                    {task.assignedFromName && (
                      <p className="text-white/55 text-[9px] truncate">Được giao từ: {task.assignedFromName}</p>
                    )}

                    {isPending && (
                      isViewingOwnSchedule ? (
                        <button
                          type="button"
                          data-action="accept"
                          data-task-id={task.id}
                          onClick={() => applyTaskAction("accept", task.id)}
                          className="absolute bottom-1 right-1 rounded-md border border-amber-100/70 bg-amber-400/85 px-2 py-0.5 text-[9px] font-semibold text-zinc-900 shadow-md"
                        >
                          Nhận
                        </button>
                      ) : (
                        <p className="absolute bottom-1 right-1 rounded-md border border-white/40 bg-black/45 px-2 py-0.5 text-[9px] font-semibold text-white/90 shadow-sm">Đang chờ</p>
                      )
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

              {/* Drag destination preview */}
              {draggingTask && dragPreview && (
                <div
                  className={`absolute pointer-events-none rounded-lg ${draggingTaskBgClass} border-2 border-dashed border-white/80`}
                  style={{
                    left: dragPreview.dayIndex * dayWidth + 2,
                    top: dragPreview.slotIndex * effSlotH,
                    width: dayWidth - 4,
                    height: draggingTask.span * effSlotH,
                    opacity: 0.35,
                    zIndex: 18,
                    ...draggingTaskBgStyle,
                  }}
                />
              )}
            </div>{/* end grid */}
          </div>{/* end body row */}
        </div>{/* end content wrapper */}
      </div>{/* end scrollRef */}

      {/* ── Drag ghost ───────────────────────────────────────────────────── */}
      {draggingTask && (
        <div
          className={`fixed pointer-events-none rounded-lg ${draggingTaskBgClass} flex flex-col p-1.5 shadow-2xl z-50`}
          style={{
            left:      dragPos.x - (dayWidth - 4) / 2,
            top:       dragPos.y - 40,
            width:     dayWidth - 4,
            height:    draggingTask.span * effSlotH,
            opacity:   0.9,
            transform: `scale(1.06) rotate(${dragTiltDeg}deg)`,
            transformOrigin: "top center",
            ...draggingTaskBgStyle,
          }}
        >
          <p className="text-white text-[10px] font-semibold leading-tight truncate">{draggingTask.title}</p>
          <p className="text-white/50 text-[9px]">{slotLabel(draggingTask.slotIndex)}</p>
        </div>
      )}

      {/* ── Settings sidebar ─────────────────────────────────────────────── */}
      <div className={`fixed inset-0 z-50 flex justify-end transition-opacity duration-200 ${settingsOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <div
          className={`absolute inset-0 transition-opacity duration-200 ${settingsOpen ? "bg-black/40" : "bg-black/0"}`}
          onClick={() => setSettingsOpen(false)}
        />
        <div className={`relative w-72 max-w-[88vw] h-full ${th.root} flex flex-col border-l ${th.border} shadow-2xl transform transition-transform duration-300 ease-out ${settingsOpen ? "translate-x-0" : "translate-x-full"}`}>
            <div className={`flex items-center justify-between px-4 py-4 border-b ${th.border} shrink-0`}>
              <h2 className="font-semibold text-base">Cài đặt</h2>
              <button onClick={() => setSettingsOpen(false)} className={`w-8 h-8 flex items-center justify-center rounded-lg ${th.subtext}`}>✕</button>
            </div>
            <div className="flex-1 px-4 py-5 overflow-y-auto">
              <div className={`mb-4 rounded-xl border ${th.border} px-3 py-3`}>
                <p className={`text-[11px] uppercase tracking-wide ${th.subtext}`}>Tài khoản đang dùng</p>
                {sessionUser ? (
                  <div className="mt-2 flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleAvatarPick}
                      className="h-10 w-10 rounded-lg overflow-hidden border border-zinc-700 relative"
                      title="Bấm để đổi avatar"
                    >
                      {sessionUser.avatar ? (
                        <img src={sessionUser.avatar} alt={sessionUser.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-zinc-700 flex items-center justify-center text-sm font-semibold">
                          {sessionUser.name.trim().charAt(0).toUpperCase() || "U"}
                        </div>
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{sessionUser.name}</p>
                      <p className={`text-xs ${th.subtext}`}>{sessionUser.role} · ID {sessionUser.id}</p>
                    </div>
                  </div>
                ) : (
                  <p className={`mt-2 text-xs ${th.subtext}`}>Chưa có phiên đăng nhập.</p>
                )}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    void handleAvatarFileChange(file);
                    e.currentTarget.value = "";
                  }}
                />
              </div>

              <div className={`mb-4 rounded-xl border ${th.border} px-3 py-3 grid gap-2`}>
                <p className="text-sm font-medium">Xem lịch của</p>
                <select
                  value={authUserId ?? ""}
                  onChange={(e) => handleViewUserChange(Number(e.target.value))}
                  className={`h-9 rounded-lg ${th.inputBg} text-inherit px-2 text-sm outline-none`}
                  required
                >
                  <option value="" disabled>Chọn tài khoản</option>
                  {usersForAuth.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>

                {authUserId !== null && (() => {
                  const viewingUser = usersForAuth.find((u) => u.id === authUserId);
                  if (!viewingUser) return null;
                  return (
                    <div className="mt-1 flex items-center gap-2.5 rounded-lg border border-zinc-700 px-2.5 py-2">
                      {viewingUser.avatar ? (
                        <img src={viewingUser.avatar} alt={viewingUser.name} className="h-9 w-9 rounded-md object-cover" />
                      ) : (
                        <div className="h-9 w-9 rounded-md bg-zinc-700 flex items-center justify-center text-xs font-semibold">
                          {viewingUser.name.trim().charAt(0).toUpperCase() || "U"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{viewingUser.name}</p>
                        <p className={`text-xs ${th.subtext}`}>{viewingUser.role} · ID {viewingUser.id}</p>
                      </div>
                    </div>
                  );
                })()}

                {authError && <p className="text-[11px] text-rose-400">{authError}</p>}
              </div>

              {/* Dark / Light toggle */}
              <div className={`flex items-center justify-between py-4 border-b ${th.border}`}>
                <div>
                  <p className="text-sm font-medium">Giao diện</p>
                  <p className={`text-xs ${th.subtext} mt-0.5`}>{isDark ? "Tối" : "Sáng"}</p>
                </div>
                <button
                  onClick={() => setIsDark(d => !d)}
                  className={`relative w-9 h-4 rounded-full transition-colors duration-200 ${isDark ? "bg-violet-600" : "bg-gray-300"}`}
                >
                  <span className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${isDark ? "translate-x-5" : "translate-x-0"}`} />
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
                  className={`relative w-9 h-4 rounded-full transition-colors duration-200 ${infiniteScroll ? "bg-violet-600" : "bg-gray-300"}`}
                >
                  <span className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${infiniteScroll ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {/* Day column width */}
              <div className={`py-4 border-t ${th.border}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Độ rộng mỗi cột ngày</p>
                  <span className="text-xs text-zinc-400 tabular-nums">{dayWidth}px</span>
                </div>
                <input
                  type="range"
                  min={DAY_W_MIN}
                  max={DAY_W_MAX}
                  step={DAY_W_STEP}
                  value={dayWidth}
                  onChange={(e) => setDayWidth(Number(e.target.value))}
                  list="day-width-marks"
                  className="mt-2 w-full accent-violet-500"
                />
                <datalist id="day-width-marks">
                  <option value="60" label="60" />
                  <option value="80" label="80" />
                  <option value="100" label="100" />
                  <option value="120" label="120" />
                  <option value="140" label="140" />
                </datalist>
              </div>
            </div>
          </div>
      </div>

      {/* ── Review card (touch) ──────────────────────────────────────────── */}
      {reviewTaskId !== null && (() => {
        const task = tasks.find(t => t.id === reviewTaskId);
        if (!task) return null;
        const taskDate = absDayToDate(task.absDay);
        const durationMinutes = task.span * 30;
        return (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setReviewTaskId(null)}
          >
            <div
              className={`${th.modalBg} rounded-2xl p-5 shadow-2xl mx-4 w-full max-w-xs border ${th.border}`}
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold">Chi tiết công việc</h3>
              <div className={`mt-3 rounded-xl ${th.inputBg} px-3 py-2`}>
                <p className={`text-[11px] ${th.subtext}`}>Tên công việc</p>
                <input
                  className="mt-1 w-full bg-transparent text-[16px] font-medium outline-none"
                  value={task.title}
                  onChange={(e) => patchTask(task.id, { title: e.target.value })}
                  placeholder="Nhập tên công việc"
                />
              </div>

              <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                <p className={`text-[11px] ${th.subtext}`}>Mô tả</p>
                <textarea
                  className="mt-1 min-h-20 w-full resize-none bg-transparent text-[16px] outline-none"
                  value={task.description}
                  onChange={(e) => patchTask(task.id, { description: e.target.value })}
                  placeholder="Nhập mô tả"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className={`rounded-xl ${th.inputBg} px-3 py-2`}>
                  <p className={`text-[11px] ${th.subtext}`}>Nhãn</p>
                  <select
                    className="mt-1 w-full rounded-md bg-transparent text-[16px] italic outline-none"
                    value={normalizeTaskLabel(task.label)}
                    onChange={(e) => patchTask(task.id, { label: normalizeTaskLabel(e.target.value) })}
                  >
                    <option value={DEFAULT_TASK_LABEL}>{TASK_LABEL_TEXT.DEFAULT}</option>
                    <option value={PERSONAL_TASK_LABEL}>{TASK_LABEL_TEXT.PERSONAL}</option>
                  </select>
                </div>
                <div className={`rounded-xl ${th.inputBg} px-3 py-2`}>
                  <p className={`text-[11px] ${th.subtext}`}>Màu</p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      className="h-7 w-10 cursor-pointer rounded border border-zinc-500 bg-transparent p-0"
                      value={colorToPickerHex(task.color)}
                      onChange={(e) => patchTask(task.id, { color: e.target.value })}
                      aria-label="Chọn màu"
                    />
                    <span className="text-xs">{colorToPickerHex(task.color)}</span>
                  </div>
                </div>
                <div className={`rounded-xl ${th.inputBg} px-3 py-2`}>
                  <p className={`text-[11px] ${th.subtext}`}>Trạng thái</p>
                  <p className="mt-0.5 text-sm">{STATUS_LABEL[task.status]}</p>
                </div>
              </div>

              <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                <p className={`text-[11px] ${th.subtext}`}>Ngày</p>
                <p className="mt-0.5 text-sm">
                  {dayShortOf(taskDate)}, {taskDate.toLocaleDateString("vi-VN")}
                </p>
              </div>

              <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                <p className={`text-[11px] ${th.subtext}`}>Thời gian</p>
                <p className="mt-0.5 text-sm tabular-nums">
                  {slotLabel(task.slotIndex)} - {slotLabel(task.slotIndex + task.span)}
                </p>
                <p className={`mt-0.5 text-xs ${th.subtext}`}>{durationMinutes} phút</p>
              </div>

              {task.assignedFromName && (
                <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                  <p className={`text-[11px] ${th.subtext}`}>Được giao từ</p>
                  <p className="mt-0.5 text-sm wrap-break-word">{task.assignedFromName}</p>
                </div>
              )}

              <div className="flex mt-3">
                <button
                  onClick={() => setReviewTaskId(null)}
                  className={`w-full py-2.5 rounded-xl ${th.btnSecondary} text-xs font-semibold`}
                >Đóng</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Edit modal (form) ────────────────────────────────────────────── */}
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
                className={`w-full ${th.inputBg} text-inherit rounded-xl px-3 py-2.5 text-[16px] outline-none focus:ring-2 focus:ring-violet-500/60`}
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    setTasks(prev => prev.map(t => t.id === editingId ? {
                      ...t,
                      title: editTitle.trim() || t.title,
                      description: editDescription,
                      label: normalizeTaskLabel(editLabel),
                      status: editStatus,
                    } : t));
                    setEditingId(null);
                  }
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
              <p className="text-xs text-zinc-400 mt-2 mb-1">Mô tả</p>
              <textarea
                className={`w-full ${th.inputBg} text-inherit rounded-xl px-3 py-2 text-[16px] outline-none focus:ring-2 focus:ring-violet-500/60 min-h-20`}
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Nhãn</p>
                  <select
                    className={`w-full ${th.inputBg} text-inherit rounded-xl px-3 py-2 text-[16px] outline-none focus:ring-2 focus:ring-violet-500/60`}
                    value={editLabel}
                    onChange={e => setEditLabel(normalizeTaskLabel(e.target.value))}
                  >
                    <option value={DEFAULT_TASK_LABEL}>{TASK_LABEL_TEXT.DEFAULT}</option>
                    <option value={PERSONAL_TASK_LABEL}>{TASK_LABEL_TEXT.PERSONAL}</option>
                  </select>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Trạng thái</p>
                  <select
                    className={`w-full ${th.inputBg} text-inherit rounded-xl px-3 py-2 text-[16px] outline-none focus:ring-2 focus:ring-violet-500/60`}
                    value={editStatus}
                    onChange={e => setEditStatus(e.target.value as TaskStatus)}
                  >
                    <option value="PENDING">{STATUS_LABEL.PENDING}</option>
                    <option value="IN_PROGRESS">{STATUS_LABEL.IN_PROGRESS}</option>
                    <option value="DONE">{STATUS_LABEL.DONE}</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setEditingId(null)}
                  className={`flex-1 py-2.5 rounded-xl ${th.btnSecondary} text-xs`}
                >Huỷ</button>
                <button
                  onClick={() => {
                    setTasks(prev => prev.map(t => t.id === editingId ? {
                      ...t,
                      title: editTitle.trim() || t.title,
                      description: editDescription,
                      label: normalizeTaskLabel(editLabel),
                      status: editStatus,
                    } : t));
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

async function uploadAvatarToCloudinary(file: File): Promise<string> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error("Thiếu NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME hoặc NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  const data = (await response.json()) as { secure_url?: string; error?: { message?: string } };
  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message ?? "Upload avatar thất bại.");
  }

  return data.secure_url;
}
