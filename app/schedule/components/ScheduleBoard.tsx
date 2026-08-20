"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  COLORS, DAY_W, DAY_W_MAX, DAY_W_MIN, DAY_W_STEP, DAYS, DEFAULT_TASK_BG,
  DEFAULT_TASK_LABEL, DRAG_DELTA, HANDLE_H, HEADER_H, INF_BUFFER, INF_CENTER,
  LONG_PRESS_MS, PERSONAL_TASK_BG, PERSONAL_TASK_LABEL, SLOT_H, SLOT_MS, SLOTS,
  STATUS_LABEL, TASK_LABEL_TEXT, TIME_W,
} from "../lib/constants";
import { absDayToDate, absDayToDateInput, currentTimeScrollTop, dateInputToAbsDay, dateToAbsDay, dayShortOf, getWeekDates, isSameDay, slotLabel, slotToTimeInput, timeInputToSlot } from "../lib/date";
import { getMultiDayEndSlot, getMultiDayTaskLanes, isMultiDayTask, layoutMultiDayBars } from "../lib/multi-day";
import { uploadAvatarToCloudinary } from "../lib/avatar";
import {
  buildDateFromAbsDayAndSlot,
  colorToPickerHex,
  doneTaskBgClass,
  ensureUniqueTaskIds,
  isHexColor,
  isTaskStatus,
  maxTaskId,
  normalizeTaskLabel,
  randomTaskTitle,
  resolveTaskBgClass,
  taskLabelText,
  withTaskAudit,
  withTaskConfirmOnly,
} from "../lib/domain/task";
import { useScheduleTasks } from "../lib/hooks/use-schedule-tasks";
import { useScheduleUsers } from "../lib/hooks/use-schedule-users";
import { useNotifications } from "../lib/hooks/use-notifications";
import { usePushNotifications } from "../lib/hooks/use-push-notifications";
import { readActiveUserId } from "../lib/session";
import { TaskAvatar } from "./TaskAvatar";
import { TaskEditModal } from "./TaskEditModal";
import { TodayTaskList } from "./TodayTaskList";
import type { AppNotification, ScheduleScope, SessionUser, Task, TaskLabelValue, TaskStatus } from "../lib/types";

type RgbColor = { r: number; g: number; b: number };

const TIME_GRADIENT_ANCHORS: Array<{ minute: number; color: string }> = [
  { minute: 0, color: "#020617" },
  { minute: 120, color: "#1E293B" },
  { minute: 240, color: "#0F172A" },
  { minute: 270, color: "#334155" },
  { minute: 300, color: "#748CAB" },
  { minute: 360, color: "#E4C1F9" },
  { minute: 390, color: "#FBC4AB" },
  { minute: 420, color: "#FFDDBB" },
  { minute: 480, color: "#A0C4FF" },
  { minute: 570, color: "#4EA8DE" },
  { minute: 660, color: "#0077B6" },
  { minute: 720, color: "#FFFFFF" },
  { minute: 990, color: "#FFB703" },
  { minute: 1020, color: "#FB8500" },
  { minute: 1050, color: "#D00000" },
  { minute: 1080, color: "#6A0DAD" },
  { minute: 1110, color: "#1D3557" },
  { minute: 1140, color: "#0F172A" },
  { minute: 1320, color: "#020617" },
  { minute: 1410, color: "#1E293B" },
];

function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function lerpColor(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function slotGradientTextColor(slot: number, isDark: boolean): string {
  const minute = slot * 30;
  const anchors = TIME_GRADIENT_ANCHORS;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];

  if (!first || !last) return isDark ? "rgb(161, 161, 170)" : "rgb(75, 85, 99)";

  let base = hexToRgb(first.color);
  for (let i = 0; i < anchors.length - 1; i++) {
    const start = anchors[i];
    const end = anchors[i + 1];
    if (minute >= start.minute && minute <= end.minute) {
      const range = end.minute - start.minute || 1;
      const t = (minute - start.minute) / range;
      base = lerpColor(hexToRgb(start.color), hexToRgb(end.color), t);
      break;
    }
  }

  const mixTarget = isDark ? { r: 255, g: 255, b: 255 } : { r: 15, g: 23, b: 42 };
  const mixRatio = isDark ? 0.58 : 0.52;
  const mixed = lerpColor(base, mixTarget, mixRatio);
  return `rgb(${mixed.r}, ${mixed.g}, ${mixed.b})`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [viewMode, setViewMode] = useState<"SCHEDULE" | "TASK_LIST">("SCHEDULE");
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
  const [displayBadge, setDisplayBadge]   = useState<string | null>(null);
  const [isBadgeVisible, setIsBadgeVisible] = useState(false);
  const [zoomLevel, setZoomLevel]          = useState(1);
  const [dayWidth, setDayWidth]           = useState(DAY_W);
  const [isDark, setIsDark]               = useState(true);
  const [isGradientTimeText, setIsGradientTimeText] = useState(true);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationTaskToFocus, setNotificationTaskToFocus] = useState<{ taskId: number; scope: ScheduleScope; ownerId: number | null; requiresLoad: boolean } | null>(null);
  const [hasObservedNotificationLoad, setHasObservedNotificationLoad] = useState(false);
  const [highlightedNotificationTaskId, setHighlightedNotificationTaskId] = useState<number | null>(null);
  const [isNotificationNavigating, setIsNotificationNavigating] = useState(false);
  const [infiniteScroll, setInfiniteScroll] = useState(true);
  const [isMultiDayLaneExpanded, setIsMultiDayLaneExpanded] = useState(true);
  const [horizontalViewport, setHorizontalViewport] = useState({ left: 0, width: 0 });
  const [scheduleScope, setScheduleScope] = useState<ScheduleScope>("USER");
  const [isInteractionLocked, setIsInteractionLocked] = useState(false);
  const [enteringTaskId, setEnteringTaskId] = useState<number | null>(null);
  const [isTaskExitActive, setIsTaskExitActive] = useState(false);
  const [sessionUser, setSessionUser]     = useState<SessionUser | null>(null);
  const usersForAuth = useScheduleUsers();
  const [authUserId, setAuthUserId]       = useState<number | null>(null);
  const [authError, setAuthError]         = useState<string | null>(null);
  const [authBusy, setAuthBusy]           = useState(false);
  const { tasks, setTasks, isLoading: isScheduleLoading, isSaving: isScheduleSaving } = useScheduleTasks(scheduleScope, authUserId);
  const { notifications, unreadCount, isMarkingAllRead, markAllRead, markRead } = useNotifications(sessionUser?.id ?? null);
  const pushNotifications = usePushNotifications(sessionUser?.id ?? null);
  const avatarInputRef                    = useRef<HTMLInputElement>(null);
  const sessionUserRef                     = useRef<SessionUser | null>(null);
  const usersForAuthRef                    = useRef<SessionUser[]>([]);
  const authUserIdRef                      = useRef<number | null>(null);
  const scheduleScopeRef                   = useRef<ScheduleScope>("USER");
  const isViewingOwnScheduleRef            = useRef(false);
  const interactionLockedRef               = useRef(true);
  const interactionUnlockTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskEntranceTimerRef               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskExitTimerRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeHideTimerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeShowTimerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationHighlightTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  sessionUserRef.current = sessionUser;
  usersForAuthRef.current = usersForAuth;
  authUserIdRef.current = authUserId;
  scheduleScopeRef.current = scheduleScope;
  interactionLockedRef.current = isInteractionLocked;
  isViewingOwnScheduleRef.current = scheduleScope !== "COMPANY" && sessionUser !== null && authUserId === sessionUser.id;

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
  const scheduleScrollPositionRef = useRef<{ left: number; top: number } | null>(null);
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
  const multiDayTaskLanes = getMultiDayTaskLanes(tasks);
  const multiDayBars = layoutMultiDayBars(tasks, viewStartAbsDay, colCount, dayWidth);
  const viewStartSlot = viewStartAbsDay * SLOTS;
  const viewportStartPx = horizontalViewport.width > 0 ? horizontalViewport.left : 0;
  const viewportEndPx = horizontalViewport.width > 0
    ? Math.min(colCount * dayWidth, horizontalViewport.left + horizontalViewport.width - TIME_W)
    : colCount * dayWidth;
  const visibleStartSlot = viewStartSlot + (viewportStartPx / dayWidth) * SLOTS;
  const visibleEndSlot = viewStartSlot + (viewportEndPx / dayWidth) * SLOTS;
  const multiDayTasksBeforeView = tasks
    .filter((task) => isMultiDayTask(task) && (task.endAbsDay ?? task.absDay) * SLOTS + getMultiDayEndSlot(task) <= visibleStartSlot)
    .sort((first, second) => {
      const firstEnd = (first.endAbsDay ?? first.absDay) * SLOTS + getMultiDayEndSlot(first);
      const secondEnd = (second.endAbsDay ?? second.absDay) * SLOTS + getMultiDayEndSlot(second);
      return secondEnd - firstEnd;
    });
  const multiDayTasksAfterView = tasks
    .filter((task) => isMultiDayTask(task) && task.absDay * SLOTS + task.slotIndex >= visibleEndSlot)
    .sort((first, second) => first.absDay * SLOTS + first.slotIndex - (second.absDay * SLOTS + second.slotIndex));
  const nearestMultiDayTaskBeforeView = multiDayTasksBeforeView[0];
  const nearestMultiDayTaskAfterView = multiDayTasksAfterView[0];
  const taskStartSlot = (task: Task) => task.absDay * SLOTS + task.slotIndex;
  const taskEndSlot = (task: Task) => (task.endAbsDay ?? task.absDay) * SLOTS + getMultiDayEndSlot(task);
  const multiDayTasksBeforeIndicator = nearestMultiDayTaskBeforeView
    ? multiDayTasksBeforeView
      .filter((task) => taskStartSlot(task) < taskEndSlot(nearestMultiDayTaskBeforeView) && taskEndSlot(task) > taskStartSlot(nearestMultiDayTaskBeforeView))
      .filter((task, index, matchingTasks) => matchingTasks.findIndex((candidate) => multiDayTaskLanes.get(candidate.id) === multiDayTaskLanes.get(task.id)) === index)
    : [];
  const multiDayTasksAfterIndicator = nearestMultiDayTaskAfterView
    ? multiDayTasksAfterView
      .filter((task) => taskStartSlot(task) < taskEndSlot(nearestMultiDayTaskAfterView) && taskEndSlot(task) > taskStartSlot(nearestMultiDayTaskAfterView))
      .filter((task, index, matchingTasks) => matchingTasks.findIndex((candidate) => multiDayTaskLanes.get(candidate.id) === multiDayTaskLanes.get(task.id)) === index)
    : [];
  const hasMultiDayEdgeIndicators = multiDayTasksBeforeIndicator.length > 0 || multiDayTasksAfterIndicator.length > 0;
  const multiDayLaneCount = Math.max(
    multiDayBars.reduce((count, bar) => Math.max(count, bar.lane + 1), 0),
    ...multiDayTasksBeforeIndicator.map((task) => (multiDayTaskLanes.get(task.id) ?? 0) + 1),
    ...multiDayTasksAfterIndicator.map((task) => (multiDayTaskLanes.get(task.id) ?? 0) + 1),
  );
  const hasOverlappingMultiDayTasks = multiDayLaneCount > 1;
  const multiDayLaneHeight = multiDayLaneCount > 0 || hasMultiDayEdgeIndicators
    ? (hasOverlappingMultiDayTasks && !isMultiDayLaneExpanded ? 36 : Math.max(1, multiDayLaneCount) * 36 + 8)
    : 0;

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
    pendingAction:    null as "edit" | "remove" | "accept" | "complete" | "confirm" | null,
    pendingTaskId:    null as number | null,
    startScrollLeft:  0,
    startScrollTop:   0,
    didScroll:        false,
    lastMoveX:        0,
    lastMoveTime:     0,
    lastVx:           0,
    lastTilt:         0,
  });

  const clearTimer = () => {
    if (gs.current.timer) { clearTimeout(gs.current.timer); gs.current.timer = null; }
  };

  const triggerTaskEntranceAnimation = (taskId: number) => {
    if (taskEntranceTimerRef.current) {
      clearTimeout(taskEntranceTimerRef.current);
      taskEntranceTimerRef.current = null;
    }

    setEnteringTaskId(taskId);
    taskEntranceTimerRef.current = setTimeout(() => {
      setEnteringTaskId(null);
      taskEntranceTimerRef.current = null;
    }, 700);
  };

  const triggerTaskExitAnimation = (onComplete: () => void) => {
    if (taskExitTimerRef.current) {
      clearTimeout(taskExitTimerRef.current);
      taskExitTimerRef.current = null;
    }
    if (taskEntranceTimerRef.current) {
      clearTimeout(taskEntranceTimerRef.current);
      taskEntranceTimerRef.current = null;
    }

    lockInteractions();
    setEnteringTaskId(null);
    setIsTaskExitActive(true);

    taskExitTimerRef.current = setTimeout(() => {
      setIsTaskExitActive(false);
      taskExitTimerRef.current = null;
      onComplete();
    }, 180);
  };

  const lockInteractions = () => {
    if (interactionUnlockTimerRef.current) {
      clearTimeout(interactionUnlockTimerRef.current);
      interactionUnlockTimerRef.current = null;
    }
    // Loading locks are intentionally disabled while schedule data is local.
    setIsInteractionLocked(false);
  };

  const unlockInteractionsAfter = (delayMs: number) => {
    if (interactionUnlockTimerRef.current) {
      clearTimeout(interactionUnlockTimerRef.current);
    }
    interactionUnlockTimerRef.current = setTimeout(() => {
      setIsInteractionLocked(false);
      interactionUnlockTimerRef.current = null;
    }, Math.max(0, delayMs));
  };

  const patchTask = (taskId: number, patch: Partial<Task>) => {
    fn.current.setTasks((prev) => prev.map((t) => (t.id === taskId ? withTaskAudit({ ...t, ...patch }, sessionUserRef.current) : t)));
  };

  const applyTaskAction = (action: "edit" | "remove" | "accept" | "complete" | "confirm", taskId: number) => {
    if (action === "remove") {
      const task = tasksRef.current.find((t) => t.id === taskId);
      const taskName = task?.title?.trim() || `#${taskId}`;
      const shouldDelete = window.confirm(`Bạn có chắc muốn xóa task \"${taskName}\" không?`);
      if (!shouldDelete) return false;

      fn.current.setTasks(prev => prev.filter(t => t.id !== taskId));
      fn.current.setResizingId(null);
      fn.current.setBadge("Đã xoá");
      return true;
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
      if (scheduleScopeRef.current === "COMPANY") return;
      fn.current.setTasks(prev => prev.map(t => t.id === taskId ? withTaskAudit({ ...t, status: "IN_PROGRESS" }, sessionUserRef.current) : t));
      fn.current.setBadge("Đã nhận task");
      return;
    }

    if (action === "confirm") {
      if (scheduleScopeRef.current !== "COMPANY") return;
      fn.current.setTasks(prev => prev.map((t) => (t.id === taskId ? withTaskConfirmOnly(t, sessionUserRef.current) : t)));
      fn.current.setBadge("Đã xác nhận task");
      return;
    }

    if (scheduleScopeRef.current === "COMPANY") return;

    let nextStatus: TaskStatus = "DONE";
    fn.current.setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      nextStatus = t.status === "DONE" ? "IN_PROGRESS" : "DONE";
      return withTaskAudit({ ...t, status: nextStatus }, sessionUserRef.current);
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
    if (viewMode !== "SCHEDULE") return;
    const container = scrollRef.current;
    if (!container) return;

    // Only set an initial position. Returning from Task List restores the saved view.
    if (scheduleScrollPositionRef.current === null) {
      container.scrollTop = currentTimeScrollTop(effSlotHRef.current);
    }

    const onStart = (e: TouchEvent) => {
      if (interactionLockedRef.current) {
        e.preventDefault();
        clearTimer();
        return;
      }

      const t  = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);

      if (el?.closest("[data-multi-day-toggle]")) {
        e.preventDefault();
        setIsMultiDayLaneExpanded((expanded) => !expanded);
        clearTimer();
        return;
      }

      // The multi-day lane overlays the calendar grid. Empty lane space is not a
      // time slot, so it must not fall through to the quick-create gesture.
      if (el?.closest("[data-multi-day-lane]") && !el?.closest("[data-task-id]")) {
        e.preventDefault();
        clearTimer();
        return;
      }

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

      // ── Action buttons ────────────────────────────────────────────────────
      const actionEl = el?.closest<HTMLElement>("[data-action]");
      if (actionEl) {
        // Do not prevent the initial touch: a touch that starts on an action
        // button must still be allowed to initiate a native scroll.
        gs.current.startX = t.clientX;
        gs.current.startY = t.clientY;
        gs.current.startScrollLeft = container.scrollLeft;
        gs.current.startScrollTop = container.scrollTop;
        gs.current.didScroll = false;
        gs.current.pendingAction  = actionEl.dataset.action as "edit" | "remove" | "accept" | "complete" | "confirm";
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
        const task = tasksRef.current.find((item) => item.id === id);
        // Multi-day tasks are edited from their detail modal, not repositioned or resized by gesture.
        if (task && isMultiDayTask(task)) return;

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
        gs.current.lastTilt = 0;
        setDragTiltDeg(0);
        fn.current.setLongPressedId(null);
      }

      if (gs.current.isDragging) {
        e.preventDefault(); // stop native scroll during task drag
        const now = performance.now();
        const dt = Math.max(1, now - gs.current.lastMoveTime);
        const vx = (t.clientX - gs.current.lastMoveX) / dt;
        // Use horizontal velocity + smoothing to avoid jittery tilt on tiny finger tremors.
        const velocityDeadzone = 0.02;
        const targetTilt = Math.abs(vx) < velocityDeadzone
          ? 0
          : Math.max(-20, Math.min(20, vx * 45));
        const tilt = gs.current.lastTilt * 0.82 + targetTilt * 0.18;
        const finalTilt = Math.abs(tilt) < 0.6 ? 0 : tilt;
        gs.current.lastTilt = finalTilt;
        setDragTiltDeg(finalTilt);
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

      // An action button only fires for a short tap. This lets a swipe that begins
      // on (for example) the complete checkbox scroll the schedule instead.
      if (gs.current.pendingAction !== null) {
        const action = gs.current.pendingAction;
        const taskId = gs.current.pendingTaskId!;
        const t = e.changedTouches[0];
        const didMove = Math.abs(t.clientX - gs.current.startX) > DRAG_DELTA
          || Math.abs(t.clientY - gs.current.startY) > DRAG_DELTA
          || gs.current.didScroll;

        if (!didMove) {
          // Suppress the browser's follow-up click because the action is applied
          // here, avoiding a double toggle on touch devices.
          e.preventDefault();
          applyTaskAction(action, taskId);
        }
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
        fn.current.setTasks(prev => prev.map(t => t.id === taskId ? withTaskAudit({ ...t, span: finalSpan }, sessionUserRef.current) : t));
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
              ? withTaskAudit({
                  ...task,
                  absDay: viewStartAbsDayRef.current + dest.dayIndex,
                  endAbsDay: isMultiDayTask(task)
                    ? viewStartAbsDayRef.current + dest.dayIndex + ((task.endAbsDay ?? task.absDay) - task.absDay)
                    : undefined,
                  slotIndex: dest.slotIndex,
                }, sessionUserRef.current)
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
            const isCompany = scheduleScopeRef.current === "COMPANY";
            const assignedFromName = actorUser && ownerName && actorUser.name !== ownerName
              ? actorUser.name
              : null;
            const initialLabel: TaskLabelValue = isCompany
              ? DEFAULT_TASK_LABEL
              : actorUser && authUserIdRef.current === actorUser.id
              ? PERSONAL_TASK_LABEL
              : DEFAULT_TASK_LABEL;
            const color = initialLabel === PERSONAL_TASK_LABEL ? PERSONAL_TASK_BG : DEFAULT_TASK_BG;
            const initialStatus: TaskStatus = isCompany
              ? "IN_PROGRESS"
              : actorUser && authUserIdRef.current === actorUser.id
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
              assignedFromName: isCompany ? null : assignedFromName,
              createdByUserId: actorUser?.id ?? null,
              createdByName: actorUser?.name ?? null,
              createdByAvatar: actorUser?.avatar ?? null,
              updatedByUserId: actorUser?.id ?? null,
              updatedByName: actorUser?.name ?? null,
              updatedByAvatar: actorUser?.avatar ?? null,
              confirmedByUserIds: actorUser ? [actorUser.id] : [],
            }]);
            triggerTaskEntranceAnimation(id);
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
  // Event listeners must be reattached whenever the schedule container remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  useEffect(() => {
    if (!badge) return;
    const t = setTimeout(() => setBadge(null), 2500);
    return () => clearTimeout(t);
  }, [badge]);

  useEffect(() => {
    if (badgeHideTimerRef.current) {
      clearTimeout(badgeHideTimerRef.current);
      badgeHideTimerRef.current = null;
    }
    if (badgeShowTimerRef.current) {
      clearTimeout(badgeShowTimerRef.current);
      badgeShowTimerRef.current = null;
    }

    if (!badge) {
      if (displayBadge !== null) {
        setIsBadgeVisible(false);
        badgeHideTimerRef.current = setTimeout(() => {
          setDisplayBadge(null);
          badgeHideTimerRef.current = null;
        }, 260);
      }
      return;
    }

    setDisplayBadge(badge);
    if (!isBadgeVisible) {
      badgeShowTimerRef.current = setTimeout(() => {
        setIsBadgeVisible(true);
        badgeShowTimerRef.current = null;
      }, 16);
    }
  }, [badge, displayBadge, isBadgeVisible]);

  useEffect(() => {
    return () => {
      if (interactionUnlockTimerRef.current) {
        clearTimeout(interactionUnlockTimerRef.current);
      }
      if (taskEntranceTimerRef.current) {
        clearTimeout(taskEntranceTimerRef.current);
      }
      if (taskExitTimerRef.current) {
        clearTimeout(taskExitTimerRef.current);
      }
      if (badgeHideTimerRef.current) {
        clearTimeout(badgeHideTimerRef.current);
      }
      if (badgeShowTimerRef.current) {
        clearTimeout(badgeShowTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setIsInteractionLocked(false);
    const firstUser = usersForAuth[0];
    if (!firstUser) return;
    const savedUserId = readActiveUserId();
    const activeUser = usersForAuth.find((user) => user.id === savedUserId) ?? firstUser;
    setSessionUser(activeUser);
    setAuthUserId((current) => usersForAuth.some((user) => user.id === current) ? current : activeUser.id);
  }, [usersForAuth]);

  const handleViewUserChange = (nextUserId: number) => {
    if (nextUserId === authUserIdRef.current) return;

    triggerTaskExitAnimation(() => {
      setAuthUserId(nextUserId);
      setResizingId(null);
      setReviewTaskId(null);
      setEditingId(null);
    });

    const selected = usersForAuth.find((u) => u.id === nextUserId);
    if (selected) {
      setBadge(`Đang xem lịch của ${selected.name}`);
    }
  };

  const handleScheduleScopeChange = (nextScope: ScheduleScope) => {
    if (nextScope === scheduleScopeRef.current) return;

    triggerTaskExitAnimation(() => {
      setScheduleScope(nextScope);
      setResizingId(null);
      setReviewTaskId(null);
      setEditingId(null);
    });

    setBadge(nextScope === "COMPANY" ? "Đang xem lịch công ty" : "Đang xem lịch cá nhân");
  };

  useEffect(() => {
    taskIdRef.current = Math.max(taskIdRef.current, maxTaskId(tasks));
  }, [tasks]);

  const handleAvatarPick = () => {
    if (!sessionUser) return;
    avatarInputRef.current?.click();
  };

  const handleAvatarFileChange = async (file: File | null) => {
    if (!sessionUser || !file) return;
    setAuthBusy(true);
    setAuthError(null);

    try {
      const avatar = await uploadAvatarToCloudinary(file);
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionUser.id, avatar }),
      });
      if (!response.ok) throw new Error("Không thể lưu avatar.");
      setBadge("Đã cập nhật avatar cho cả nhóm");
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

  useLayoutEffect(() => {
    if (viewMode !== "SCHEDULE") return;

    const frame = requestAnimationFrame(() => {
      if (scheduleScrollPositionRef.current) {
        scrollRef.current?.scrollTo(scheduleScrollPositionRef.current);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [viewMode]);

  const toggleViewMode = () => {
    if (viewMode === "SCHEDULE" && scrollRef.current) {
      scheduleScrollPositionRef.current = {
        left: scrollRef.current.scrollLeft,
        top: scrollRef.current.scrollTop,
      };
    }
    if (viewMode === "TASK_LIST") {
      setResizingId(null);
      gs.current.dismissResizeTap = false;
    }
    setViewMode((mode) => mode === "SCHEDULE" ? "TASK_LIST" : "SCHEDULE");
  };

  useLayoutEffect(() => {
    if (viewMode !== "SCHEDULE") return;
    const container = scrollRef.current;
    if (!container) return;

    const updateViewport = () => {
      const next = { left: container.scrollLeft, width: container.clientWidth };
      setHorizontalViewport((current) => (
        current.left === next.left && current.width === next.width ? current : next
      ));
    };

    updateViewport();
    container.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);
    return () => {
      container.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [viewMode]);

  // Week data — kept for week-mode header
  // (colDates / todayIdx are computed above, before the gesture refs)
  const nowSlot   = today.getHours() * 2 + (today.getMinutes() >= 30 ? 1 : 0);
  const nowFrac   = (today.getMinutes() % 30) / 30;
  const nowTop    = nowSlot * effSlotH + nowFrac * effSlotH;

  const draggingTask = tasks.find(t => t.id === draggingId);
  const isCompanySchedule = scheduleScope === "COMPANY";
  const draggingTaskIsDone = !isCompanySchedule && draggingTask?.status === "DONE";
  const draggingTaskBgClass = draggingTaskIsDone
    ? doneTaskBgClass(isDark)
    : draggingTask && !isHexColor(draggingTask.color)
    ? resolveTaskBgClass(draggingTask.color, isDark)
    : "";
  const draggingTaskBgStyle = draggingTask && !draggingTaskIsDone && isHexColor(draggingTask.color)
    ? { backgroundColor: draggingTask.color }
    : undefined;
  const isViewingOwnSchedule = !isCompanySchedule && sessionUser !== null && authUserId === sessionUser.id;
  // Saving is deliberately non-blocking: the overlay remains informative, but must not
  // swallow clicks such as a follow-up delete after a drag or resize.
  const isUiLocked = isScheduleLoading || authBusy || isInteractionLocked;
  const isSyncIndicatorVisible = isUiLocked || isScheduleSaving;
  const gridStrongBorderClass = isCompanySchedule ? "border-rose-500/30" : th.border;
  const gridHalfBorderClass = isCompanySchedule ? "border-rose-500/15" : th.halfBorder;
  const gridDayBorderClass = isCompanySchedule ? "border-rose-500/25" : th.dayBorder;

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

  const handleNotificationTaskClick = (notification: AppNotification) => {
    void markRead(notification.id);
    if (notification.taskId === null) return;
    const legacyOwner = notification.kind === "ASSIGNED"
      ? notification.recipientUserId
      : usersForAuth.find((user) => user.name === notification.actorName)?.id ?? null;
    const targetScope = notification.taskScope ?? (notification.kind === "COMPANY_CREATED" || notification.kind === "COMPANY_CONFIRMED" ? "COMPANY" : "USER");
    const targetOwnerId = notification.taskOwnerUserId ?? legacyOwner;
    if (targetScope === "USER" && targetOwnerId === null) return;

    // Start navigating immediately. A server check is only needed if the loaded
    // schedule cannot find the task.
    setIsNotificationNavigating(true);
    setNotificationsOpen(false);

    const requiresLoad = targetScope !== scheduleScope || (targetScope === "USER" && targetOwnerId !== authUserId);
    setHasObservedNotificationLoad(false);
    setViewMode("SCHEDULE");
    setNotificationTaskToFocus({ taskId: notification.taskId, scope: targetScope, ownerId: targetScope === "USER" ? targetOwnerId : null, requiresLoad });
    if (targetScope !== scheduleScope) setScheduleScope(targetScope);
    if (targetScope === "USER" && targetOwnerId !== authUserId) setAuthUserId(targetOwnerId);
    if (!infiniteScroll) setInfiniteScroll(true);
  };

  useEffect(() => {
    if (notificationTaskToFocus?.requiresLoad && isScheduleLoading) setHasObservedNotificationLoad(true);
  }, [isScheduleLoading, notificationTaskToFocus?.requiresLoad]);

  useLayoutEffect(() => {
    if (notificationTaskToFocus === null || viewMode !== "SCHEDULE" || !infiniteScroll || isScheduleLoading) return;
    if (scheduleScope !== notificationTaskToFocus.scope || (scheduleScope === "USER" && authUserId !== notificationTaskToFocus.ownerId)) return;
    if (notificationTaskToFocus.requiresLoad && !hasObservedNotificationLoad) return;
    const task = tasks.find((item) => item.id === notificationTaskToFocus.taskId);
    const container = scrollRef.current;
    if (!task || !container) {
      if (!task) {
        const missingTask = notificationTaskToFocus;
        setNotificationTaskToFocus(null);
        void (async () => {
          try {
            const params = new URLSearchParams({
              scope: missingTask.scope,
              ...(missingTask.scope === "USER" ? { ownerId: String(missingTask.ownerId) } : {}),
            });
            const response = await fetch(`/api/schedule/tasks?${params}`, { cache: "no-store" });
            if (!response.ok) return;
            const latestTasks = await response.json() as Task[];
            if (!latestTasks.some((item) => item.id === missingTask.taskId)) setBadge("Task không còn tồn tại");
          } catch {
            // The next realtime update can still restore the task list if the check fails.
          } finally {
            setIsNotificationNavigating(false);
          }
        })();
      }
      return;
    }
    if (isMultiDayTask(task) && !isMultiDayLaneExpanded) {
      setIsMultiDayLaneExpanded(true);
      return;
    }
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targetDay = task.absDay - viewStartAbsDay;
    const targetLeft = TIME_W + targetDay * dayWidth + dayWidth / 2 - container.clientWidth / 2;
    const taskCenterY = isMultiDayTask(task)
      ? HEADER_H + ((multiDayTaskLanes.get(task.id) ?? 0) * 36) + 18
      : HEADER_H + task.slotIndex * effSlotH + task.span * effSlotH / 2;
    const targetTop = taskCenterY - container.clientHeight / 2;
    let hasHighlighted = false;
    const highlightTask = () => {
      if (hasHighlighted) return;
      hasHighlighted = true;
      if (notificationHighlightTimerRef.current) clearTimeout(notificationHighlightTimerRef.current);
      setHighlightedNotificationTaskId(task.id);
      notificationHighlightTimerRef.current = setTimeout(() => {
        setHighlightedNotificationTaskId(null);
        setIsNotificationNavigating(false);
        notificationHighlightTimerRef.current = null;
      }, 560);
    };
    const startTimer = window.setTimeout(() => {
      const frame = requestAnimationFrame(() => {
      container.scrollTo({
        left: Math.max(0, targetLeft),
        top: Math.max(0, targetTop),
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
      container.addEventListener("scrollend", highlightTask, { once: true });
      // The fallback is only used by browsers without scrollend. Scale it with the
      // travel distance so it is unlikely to run while a long smooth scroll is active.
      const scrollDistance = Math.hypot(targetLeft - container.scrollLeft, targetTop - container.scrollTop);
      window.setTimeout(highlightTask, prefersReducedMotion ? 30 : Math.min(2_500, Math.max(900, scrollDistance * 0.12)));
      setBadge(`Đang xem: ${task.title}`);
      setNotificationTaskToFocus(null);
      });
      void frame;
    }, 420);
    return () => {
      clearTimeout(startTimer);
    };
  }, [authUserId, dayWidth, effSlotH, hasObservedNotificationLoad, infiniteScroll, isMultiDayLaneExpanded, isScheduleLoading, multiDayTaskLanes, notificationTaskToFocus, scheduleScope, tasks, viewMode, viewStartAbsDay]);

  return (
    <div className={`flex flex-col h-dvh ${th.root} select-none overflow-hidden`} aria-busy={isNotificationNavigating}>
      {isNotificationNavigating && <div className="fixed inset-0 z-[60] cursor-wait" aria-label="Đang điều hướng đến công việc" />}

      {/* ── App header ───────────────────────────────────────────────────── */}
      <header className={`relative flex items-center gap-1 px-3 py-2 pr-20 ${th.hdrBg} border-b ${th.border} shrink-0`}>
        <button
          type="button"
          onClick={toggleViewMode}
          className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${viewMode === "TASK_LIST" ? "bg-violet-600 text-white" : th.btnSecondary}`}
          aria-label={viewMode === "SCHEDULE" ? "Chuyển sang danh sách công việc" : "Chuyển sang lịch"}
          title={viewMode === "SCHEDULE" ? "Danh sách công việc" : "Xem lịch"}
        >
          {viewMode === "SCHEDULE" ? "☷" : "▦"}
        </button>
        {viewMode === "SCHEDULE" && (infiniteScroll ? (
          <div className="hidden w-8 h-8 shrink-0 sm:block" />
        ) : (
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 text-lg"
          >‹</button>
        ))}

        <div className="flex-1 text-center min-w-0">
          <p className={`text-xs font-semibold text-zinc-300 truncate transition-transform duration-300 ${isBadgeVisible ? "-translate-y-0.5" : "translate-y-0"}`}>
            {infiniteScroll ? today.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" }) : (
              <>
                {weekDates[0]?.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" })}
                {" – "}
                {weekDates[6]?.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric", year: "numeric" })}
              </>
            )}
          </p>
          <div
            className={`overflow-hidden transition-all duration-300 ease-out ${isBadgeVisible ? "max-h-6 opacity-100 translate-y-0 mt-0.5" : "max-h-0 opacity-0 -translate-y-1 mt-0"}`}
          >
            <p className="text-[10px] text-violet-400 truncate">{displayBadge ?? ""}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {viewMode === "SCHEDULE" && (infiniteScroll ? (
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
          ))}

        </div>

        <button
          type="button"
          onClick={() => {
            setNotificationsOpen(true);
            setSettingsOpen(false);
          }}
          className={`absolute right-11 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg ${th.subtext} shrink-0`}
          aria-label="Thông báo"
          title="Thông báo"
        >
          <span className="relative">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            {unreadCount > 0 && <span className="absolute -right-2 -top-2 min-w-3.5 h-3.5 rounded-full bg-rose-500 px-0.5 text-center text-[9px] font-bold leading-3.5 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </span>
        </button>
        <button
          onClick={() => {
            setSettingsOpen(true);
            setNotificationsOpen(false);
          }}
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg ${th.subtext} shrink-0`}
          aria-label="Cài đặt"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </header>

      {viewMode === "TASK_LIST" ? (
        <TodayTaskList
          tasks={tasks}
          todayAbsDay={todayAbsDay}
          isCompanySchedule={isCompanySchedule}
          theme={th}
          onComplete={(taskId) => applyTaskAction("complete", taskId)}
          onEdit={(taskId) => applyTaskAction("edit", taskId)}
          onRemove={(taskId) => applyTaskAction("remove", taskId)}
        />
      ) : (
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className={`h-full overflow-auto ${isUiLocked ? "pointer-events-none" : ""}`}
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

          {multiDayLaneHeight > 0 && (
            <div data-multi-day-lane className={`sticky top-[52px] z-20 flex border-b ${th.border} ${th.stickyBg}`} style={{ height: multiDayLaneHeight, marginBottom: -multiDayLaneHeight }}>
              <div className={`${th.stickyBg} sticky left-0 z-30 flex shrink-0 items-start justify-center pt-1`} style={{ width: TIME_W }}>
                {hasOverlappingMultiDayTasks && (
                  <button
                    type="button"
                    data-multi-day-toggle
                    onClick={() => setIsMultiDayLaneExpanded((expanded) => !expanded)}
                    className={`flex h-8 w-10 items-center justify-center text-zinc-400 transition-colors hover:text-violet-400`}
                    aria-label={isMultiDayLaneExpanded ? "Thu gọn task nhiều ngày" : "Hiển thị toàn bộ task nhiều ngày"}
                    title={isMultiDayLaneExpanded ? "Thu gọn task nhiều ngày" : `Hiển thị ${multiDayBars.length} task nhiều ngày`}
                  >
                    <svg className={`h-5 w-5 transition-transform duration-300 ${isMultiDayLaneExpanded ? "rotate-180" : "rotate-0"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="relative" style={{ width: colCount * dayWidth }}>
                {Array.from({ length: colCount }, (_, day) => (
                  <div key={day} className={`absolute inset-y-0 border-l ${gridDayBorderClass} ${day === todayIdx ? th.todayCol : ""}`} style={{ left: day * dayWidth, width: dayWidth }} />
                ))}
                {isMultiDayLaneExpanded && hasMultiDayEdgeIndicators && horizontalViewport.width > TIME_W && (
                  <div
                    className="pointer-events-none sticky z-20 h-0"
                    style={{ left: TIME_W, width: horizontalViewport.width - TIME_W }}
                  >
                    {multiDayTasksBeforeIndicator.map((task) => (
                      <div
                        key={task.id}
                        className={`absolute left-0 h-[27px] w-1 rounded-r ${isHexColor(task.color) ? "" : resolveTaskBgClass(task.color, isDark)}`}
                        style={{ top: (multiDayTaskLanes.get(task.id) ?? 0) * 36 + 5, backgroundColor: isHexColor(task.color) ? task.color : undefined }}
                        title={`Task phía trước: ${task.title}`}
                      />
                    ))}
                    {multiDayTasksAfterIndicator.map((task) => (
                      <div
                        key={task.id}
                        className={`absolute right-1 h-[27px] w-1 rounded-l ${isHexColor(task.color) ? "" : resolveTaskBgClass(task.color, isDark)}`}
                        style={{ top: (multiDayTaskLanes.get(task.id) ?? 0) * 36 + 5, backgroundColor: isHexColor(task.color) ? task.color : undefined }}
                        title={`Task phía sau: ${task.title}`}
                      />
                    ))}
                  </div>
                )}
                {hasOverlappingMultiDayTasks && !isMultiDayLaneExpanded ? (
                  <div className="sticky left-0 z-30 flex h-full w-[calc(100vw-44px)] items-center justify-center pointer-events-none">
                    <button
                      type="button"
                      data-multi-day-toggle
                      onClick={() => setIsMultiDayLaneExpanded(true)}
                      className="pointer-events-auto text-center text-[11px] font-semibold text-zinc-400 transition-colors hover:text-violet-400"
                    >
                      {multiDayBars.length} task diễn ra nhiều ngày
                    </button>
                  </div>
                ) : multiDayBars.map(({ task, lane, left, width }) => {
                  const isDone = !isCompanySchedule && task.status === "DONE";
                  const backgroundColor = isHexColor(task.color) ? task.color : undefined;
                  const backgroundClass = isDone ? doneTaskBgClass(isDark) : resolveTaskBgClass(task.color, isDark);
                  const canToggleDone = !isCompanySchedule
                    && isViewingOwnSchedule
                    && (task.status === "IN_PROGRESS" || task.status === "DONE");
                  return (
                    <div
                      key={task.id}
                      data-task-id={task.id}
                    className={`absolute z-10 rounded-lg text-left text-[10px] font-semibold text-white shadow-sm transition hover:brightness-110 ${highlightedNotificationTaskId === task.id ? "schedule-task-highlight" : ""} ${backgroundClass}`}
                      style={{ left, top: lane * 36 + 5, width, height: 27, backgroundColor }}
                    >
                      <div
                        className="sticky z-10 inline-flex h-full w-max max-w-full min-w-0 items-center px-1"
                        style={{ left: TIME_W }}
                      >
                        {canToggleDone && (
                          <button
                            type="button"
                            data-action="complete"
                            data-task-id={task.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              applyTaskAction("complete", task.id);
                            }}
                            className={`mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isDone ? "border-emerald-300 bg-emerald-400/30" : "border-white/85 bg-black/25"}`}
                            title={isDone ? "Bỏ hoàn thành" : "Đánh dấu hoàn thành"}
                            aria-label={isDone ? "Bỏ hoàn thành" : "Đánh dấu hoàn thành"}
                          >
                            {isDone && <span className="text-[10px] leading-none text-emerald-200">✓</span>}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setReviewTaskId(task.id)}
                          className="min-w-0 flex-1 text-left"
                          title={`${task.title}: ${slotLabel(task.slotIndex)} → ${slotLabel(getMultiDayEndSlot(task))}`}
                        >
                          <span className={`block truncate ${isDone ? "line-through" : ""}`}>{task.title}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                    <span
                      className={`text-[9px] -mt-1 leading-none tabular-nums ${isGradientTimeText ? "" : th.timeText}`}
                      style={isGradientTimeText ? { color: slotGradientTextColor(slot, isDark) } : undefined}
                    >
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
                  className={slot % 2 === 0 ? `border-t ${gridStrongBorderClass}` : `border-t ${gridHalfBorderClass}`}
                >
                  {Array.from({ length: colCount }, (_, day) => (
                    <div
                      key={day}
                      data-day={day}
                      data-slot={slot}
                      style={{ width: dayWidth }}
                      className={`shrink-0 border-l ${gridDayBorderClass} ${day === todayIdx ? th.todayCol : ""}`}
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
              {tasks.map((task) => {
                if (isMultiDayTask(task)) return null;
                const colIdx = task.absDay - viewStartAbsDay;
                if (colIdx < 0 || colIdx >= colCount) return null; // outside current view
                const isDraggingThis = draggingId    === task.id;
                const isResizing     = resizingId    === task.id;
                const isLongPressed  = longPressedId === task.id;
                const isPending = !isCompanySchedule && task.status === "PENDING";
                const isInProgress = !isCompanySchedule && task.status === "IN_PROGRESS";
                const isDone = !isCompanySchedule && task.status === "DONE";
                const creatorName = task.createdByName ?? task.assignedFromName;
                const creatorAvatar = task.createdByAvatar ?? null;
                const creatorId = task.createdByUserId;
                const editorName = task.updatedByName;
                const editorAvatar = task.updatedByAvatar;
                const actorId = sessionUser?.id ?? null;
                const hasConfirmedByActor = actorId !== null && task.confirmedByUserIds.includes(actorId);
                const canConfirmCompanyTask =
                  isCompanySchedule &&
                  actorId !== null &&
                  actorId !== task.createdByUserId &&
                  actorId !== task.updatedByUserId &&
                  !hasConfirmedByActor;
                const confirmerUsers = task.confirmedByUserIds
                  .map((id) => usersForAuth.find((user) => user.id === id))
                  .filter((user): user is SessionUser => Boolean(user));
                const displayedConfirmerUsers = confirmerUsers.length > 3
                  ? confirmerUsers.slice(0, 2)
                  : confirmerUsers.slice(0, 3);
                const hiddenConfirmerCount = confirmerUsers.length > 3
                  ? confirmerUsers.length - 2
                  : 0;
                const taskBgClass = isDone
                  ? ""
                  : isHexColor(task.color)
                    ? ""
                    : resolveTaskBgClass(task.color, isDark);
                const taskBgStyle = !isDone && isHexColor(task.color)
                  ? { backgroundColor: task.color }
                  : undefined;
                const subtitleLabel = normalizeTaskLabel(task.label) === PERSONAL_TASK_LABEL
                  ? TASK_LABEL_TEXT.PERSONAL
                  : "";
                const subtitleText = subtitleLabel ? `#${subtitleLabel}` : "";
                const h = task.span * effSlotH;
                const cardW = dayWidth - 4;
                const isUltraCompactCard = cardW < 84 || h < 54;
                const isCompactCard = !isUltraCompactCard && (cardW < 104 || h < 84);
                const avatarSize: "xs" | "sm" | "md" = isUltraCompactCard ? "xs" : isCompactCard ? "sm" : "md";
                const bodyPaddingClass = isUltraCompactCard ? "p-1" : isCompactCard ? "p-1.5" : "p-2";
                const metaTextClass = isUltraCompactCard ? "text-[8px]" : "text-[9px]";
                const titleTextClass = isUltraCompactCard ? "text-[10px] leading-[1.1]" : isCompactCard ? "text-[11px] leading-tight" : "text-[12px] leading-tight";
                const checkboxSizeClass = isUltraCompactCard ? "h-5 w-5" : "h-6 w-6";
                const checkboxOffsetClass = isUltraCompactCard ? "pl-5" : "pl-6";
                const showDescription = Boolean(task.description.trim())
                  && h >= (isUltraCompactCard ? 76 : 58)
                  && (!isCompanySchedule || h >= 100);
                const showSubtitle = Boolean(subtitleText)
                  && h >= (isUltraCompactCard ? 90 : 66)
                  && (!isCompanySchedule || h >= 100);
                const showCompanyMeta = h >= 100;
                const actionButtonClass = isUltraCompactCard
                  ? "self-end rounded-md border px-1.5 py-0.5 text-[8px] font-semibold shadow-md"
                  : "self-end rounded-md border px-2 py-0.5 text-[9px] font-semibold shadow-md";
                const pendingBottomReserveClass = isPending
                  ? (isUltraCompactCard ? "pb-5" : "pb-6")
                  : "";
                const pendingActionClass = isUltraCompactCard
                  ? "absolute bottom-1 right-1 z-10 rounded-md border px-1.5 py-0.5 text-[8px] font-semibold shadow-md"
                  : "absolute bottom-1.5 right-1.5 z-10 rounded-md border px-2 py-0.5 text-[9px] font-semibold shadow-md";

                const taskAnimationClass = isTaskExitActive
                  ? "schedule-task-exit"
                  : enteringTaskId === task.id
                  ? "schedule-task-enter"
                  : "";

                return (
                  <div
                    key={task.id}
                    ref={el => { if (el) taskEls.current.set(task.id, el); else taskEls.current.delete(task.id); }}
                    data-task-id={task.id}
                    className={`absolute overflow-hidden ${taskAnimationClass} ${highlightedNotificationTaskId === task.id ? "schedule-task-highlight" : ""}`}
                    style={{
                      left:       colIdx * dayWidth + 2,
                      top:        task.slotIndex * effSlotH,
                      width:      dayWidth - 4,
                      height:     h,
                      borderRadius: 8,
                      zIndex:     isDraggingThis ? 20 : isResizing ? 15 : 5,
                      transition: gs.current.isResizeDragging ? "none" : "height 0.15s ease",
                      animationDelay: taskAnimationClass === "schedule-task-exit" ? "0ms" : undefined,
                      animationFillMode: taskAnimationClass ? "both" : undefined,
                      touchAction: "pan-x pan-y", // allow scrolling even when touch starts on a task
                  }}
                >
                  {/* Task body */}
                  <div
                    className={`absolute inset-0 ${taskBgClass} flex flex-col ${bodyPaddingClass} ${pendingBottomReserveClass} transition-all duration-100
                      ${isDraggingThis ? "opacity-0" : ""}
                      ${isLongPressed  ? "ring-2 ring-white/70 ring-inset scale-[0.96]" : ""}
                      ${isResizing     ? "ring-2 ring-white ring-inset brightness-110" : ""}
                      ${isDone ? doneTaskBgClass(isDark) : ""}
                      ${isPending ? "border border-dashed border-white/60 bg-black/20" : ""}`}
                    style={{ borderRadius: 8, ...taskBgStyle }}
                  >
                    {!isCompanySchedule && isViewingOwnSchedule && (isInProgress || isDone) && (
                      <button
                        type="button"
                        data-action="complete"
                        data-task-id={task.id}
                        onClick={() => applyTaskAction("complete", task.id)}
                        className={`absolute top-1 left-1 ${checkboxSizeClass} shrink-0 rounded-md border flex items-center justify-center z-10 ${isDone ? "border-emerald-300 bg-emerald-400/30" : "border-white/85 bg-black/25"}`}
                        title={isDone ? "Bỏ hoàn thành" : "Đánh dấu hoàn thành"}
                        aria-label={isDone ? "Bỏ hoàn thành" : "Đánh dấu hoàn thành"}
                      >
                        {isDone && <span className="text-xs leading-none text-emerald-200">✓</span>}
                      </button>
                    )}

                    {isCompanySchedule && creatorName && showCompanyMeta && (
                      <div className={`flex items-center gap-1.5 text-white/70 ${metaTextClass} truncate mb-0.5`}>
                        <span>from:</span>
                        <TaskAvatar name={creatorName} avatar={creatorAvatar} fallbackSeed={creatorId} size={avatarSize} />
                      </div>
                    )}
                    {isCompanySchedule && editorName && showCompanyMeta && (
                      <div className={`flex items-center gap-1.5 text-white/70 ${metaTextClass} truncate mb-0.5`}>
                        <span>sửa lần cuối:</span>
                        <TaskAvatar name={editorName} avatar={editorAvatar} fallbackSeed={task.updatedByUserId} size={avatarSize} />
                      </div>
                    )}

                    <div className={`flex items-start gap-1 ${!isCompanySchedule && isViewingOwnSchedule && (isInProgress || isDone) ? checkboxOffsetClass : "pl-0"}`}>
                      <p
                        className={`${titleTextClass} font-semibold flex-1 text-white ${isDone ? "line-through" : ""}`}
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

                    {showDescription && (
                      <p
                        className={`text-white/80 ${metaTextClass}`}
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
                    {showSubtitle && (
                      <p
                        className={`text-white/75 ${metaTextClass} italic`}
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

                    {!isCompanySchedule && task.assignedFromName && (
                      <div className={`flex items-center gap-1.5 text-white/65 ${metaTextClass} truncate`}>
                        <span>from:</span>
                        <TaskAvatar name={task.assignedFromName} avatar={usersForAuth.find((user) => user.name === task.assignedFromName)?.avatar ?? null} size={avatarSize} />
                      </div>
                    )}

                    {isCompanySchedule && showCompanyMeta && (confirmerUsers.length > 0 || canConfirmCompanyTask) && (
                      <div className="mt-auto flex flex-col items-end gap-1">
                        {confirmerUsers.length > 0 && (
                          <div className={`self-start flex items-center gap-1.5 text-white/70 ${metaTextClass} truncate`}>
                            <span>xác nhận:</span>
                            <div className="flex items-center">
                              {displayedConfirmerUsers.map((user, idx) => (
                                <div
                                  key={user.id}
                                  className={idx === 0 ? "" : "-ml-1.5"}
                                  style={{ zIndex: 20 - idx }}
                                >
                                  <TaskAvatar name={user.name} avatar={user.avatar} fallbackSeed={user.id} size={avatarSize} />
                                </div>
                              ))}
                              {hiddenConfirmerCount > 0 && (
                                <div
                                  className={`${isUltraCompactCard ? "h-3.5 min-w-3.5 text-[7px]" : "h-4 min-w-4 text-[8px]"} -ml-1.5 rounded-full bg-zinc-700 px-1 font-semibold text-white border border-white/40 flex items-center justify-center`}
                                  style={{ zIndex: 10 }}
                                >
                                  +{hiddenConfirmerCount}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {canConfirmCompanyTask && (
                          <button
                            type="button"
                            data-action="confirm"
                            data-task-id={task.id}
                            onClick={() => applyTaskAction("confirm", task.id)}
                            className={`${actionButtonClass} border-emerald-100/70 bg-emerald-400/85 text-zinc-900`}
                          >
                            Xác nhận
                          </button>
                        )}
                      </div>
                    )}

                    {isPending && (
                      isViewingOwnSchedule ? (
                        <button
                          type="button"
                          data-action="accept"
                          data-task-id={task.id}
                          onClick={() => applyTaskAction("accept", task.id)}
                          className={`${pendingActionClass} border-amber-100/70 bg-amber-400/85 text-zinc-900`}
                        >
                          Nhận
                        </button>
                      ) : (
                        <p className={`${pendingActionClass} border-white/40 bg-black/45 text-white/90`}>Đang chờ</p>
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

        <div
          className={`absolute inset-0 z-40 transition-opacity duration-300 ${isSyncIndicatorVisible ? "opacity-100" : "opacity-0 pointer-events-none"} ${isUiLocked ? "pointer-events-auto" : "pointer-events-none"}`}
          aria-hidden={!isSyncIndicatorVisible}
        >
          <div className={`absolute inset-0 ${isScheduleLoading || isScheduleSaving || authBusy ? "bg-zinc-950/60" : "bg-zinc-950/40"} backdrop-blur-[2px]`} />
          <div className="absolute -left-10 top-[22%] h-36 w-36 rounded-full bg-violet-500/25 blur-3xl animate-pulse" />
          <div className="absolute -right-8 top-[38%] h-40 w-40 rounded-full bg-cyan-500/20 blur-3xl animate-pulse" />

          <div className="absolute inset-0 flex items-center justify-center px-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-zinc-900/75 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="relative h-9 w-9 shrink-0">
                  <div className="absolute inset-0 rounded-full border border-white/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-violet-300 border-r-sky-300 animate-spin" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {isScheduleLoading
                      ? (scheduleScope === "COMPANY" ? "Đang tải lịch công ty" : "Đang tải lịch cá nhân")
                      : isScheduleSaving || authBusy ? "Đang đồng bộ thay đổi" : "Đang sẵn sàng để thao tác"}
                  </p>
                  <p className="text-[11px] text-zinc-300">
                    {isScheduleLoading
                      ? "Đồng bộ dữ liệu và dựng timeline..."
                      : isScheduleSaving || authBusy ? "Đang lưu vào hệ thống chung..." : "Hoàn tất dựng giao diện, khóa chạm nhanh trong giây lát..."}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-violet-300/80 via-cyan-300/80 to-emerald-300/80 animate-pulse" />
                </div>
                <div className="h-2 w-4/5 rounded-full bg-white/10 animate-pulse" />
                <div className="h-2 w-2/3 rounded-full bg-white/10 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

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
      <div className={`fixed inset-0 z-50 flex justify-end transition-opacity duration-200 ${notificationsOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <div className={`absolute inset-0 transition-opacity duration-200 ${notificationsOpen ? "bg-black/40" : "bg-black/0"}`} onClick={() => setNotificationsOpen(false)} />
        <aside className={`relative h-full w-80 max-w-[88vw] ${th.root} flex flex-col border-l ${th.border} shadow-2xl transform transition-transform duration-300 ease-out ${notificationsOpen ? "translate-x-0" : "translate-x-full"}`} aria-label="Danh sách thông báo">
          <div className={`flex items-center justify-between px-4 py-4 border-b ${th.border} shrink-0`}>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-base">Thông báo</h2>
              {unreadCount > 0 && <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadCount}</span>}
            </div>
            <button type="button" onClick={() => setNotificationsOpen(false)} className={`w-8 h-8 flex items-center justify-center rounded-lg ${th.subtext}`} aria-label="Đóng thông báo">✕</button>
          </div>
          {notifications.length > 0 && <div className={`flex h-10 items-center px-4 border-b ${th.border}`}>
            {unreadCount > 0 ? (
              <button type="button" onClick={() => void markAllRead()} className="text-xs font-medium text-violet-400 hover:text-violet-300">Đánh dấu tất cả là đã đọc</button>
            ) : (
              <p className={`flex items-center gap-2 text-xs ${th.subtext}`}>
                {isMarkingAllRead && <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" aria-label="Đang cập nhật" />}
                Có {notifications.length} thông báo đã được đọc
              </p>
            )}
          </div>}
          <div className="flex-1 overflow-y-auto py-2">
            {notifications.length === 0 ? (
              <div className={`mx-4 mt-8 rounded-2xl border border-dashed ${th.border} px-5 py-10 text-center`}>
                <p className="text-2xl">🔔</p>
                <p className="mt-3 text-sm font-medium">Chưa có thông báo</p>
                <p className={`mt-1 text-xs ${th.subtext}`}>Các cập nhật về công việc và lịch công ty sẽ xuất hiện ở đây.</p>
              </div>
            ) : notifications.map((notification: AppNotification) => {
              const icon = notification.kind === "ASSIGNED" ? "↳" : notification.kind === "ACCEPTED" ? "✓" : notification.kind === "COMPLETED" ? "✓" : notification.kind === "COMPANY_CREATED" ? "+" : "✓";
              const iconColor = notification.kind === "COMPLETED" ? "bg-emerald-500/20 text-emerald-400" : notification.kind === "COMPANY_CREATED" ? "bg-sky-500/20 text-sky-400" : "bg-violet-500/20 text-violet-400";
              const borderColor = notification.kind === "ASSIGNED" ? "border-violet-500/50" : notification.kind === "ACCEPTED" ? "border-amber-500/50" : notification.kind === "COMPLETED" ? "border-emerald-500/50" : notification.kind === "COMPANY_CREATED" ? "border-sky-500/50" : "border-rose-500/50";
              const actor = usersForAuth.find((user) => user.name === notification.actorName);
              const actorInitial = (notification.actorName ?? "H").trim().charAt(0).toUpperCase() || "H";
              const canOpenTask = notification.taskId !== null;
              return <article key={notification.id} onClick={() => handleNotificationTaskClick(notification)} className={`mx-3 mb-2 flex gap-2.5 rounded-xl border border-l-4 px-3 py-3 ${borderColor} ${canOpenTask ? "cursor-pointer transition hover:-translate-y-0.5 hover:brightness-110" : "cursor-default"} ${notification.isRead ? "opacity-70" : isDark ? "bg-violet-950/30" : "bg-violet-50"}`}>
                {actor?.avatar ? (
                  <img src={actor.avatar} alt={notification.actorName ?? "Người thực hiện"} className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${iconColor}`}>{actorInitial}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex gap-2"><p className="min-w-0 flex-1 text-sm font-semibold leading-5">{notification.title}</p><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${iconColor}`}>{icon}</span>{!notification.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />}</div>
                  <p className={`mt-0.5 text-xs leading-5 ${th.subtext}`}>{notification.body}</p>
                  <p className={`mt-1 text-[10px] ${th.subtext}`}>{new Date(notification.createdAt).toLocaleString("vi-VN", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </article>;
            })}
          </div>
        </aside>
      </div>

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

              <div className={`mb-4 rounded-xl border ${th.border} px-3 py-3`}>
                <p className="text-sm font-medium">Thông báo trên điện thoại</p>
                <p className={`mt-1 text-xs ${th.subtext}`}>
                  {pushNotifications.permission === "unsupported"
                    ? "Trình duyệt hoặc thiết bị này chưa hỗ trợ thông báo đẩy."
                    : pushNotifications.permission === "checking"
                      ? "Đang kiểm tra quyền thông báo của thiết bị..."
                    : pushNotifications.permission === "denied"
                      ? "Bạn đã chặn thông báo. Hãy bật lại quyền trong cài đặt trình duyệt."
                    : pushNotifications.isSubscribed
                        ? "Đã bật và đăng ký thiết bị nhận thông báo."
                        : "Bật để nhận thông báo ngay cả khi DHS To do đang đóng."}
                </p>
                {sessionUser && pushNotifications.permission !== "unsupported" && pushNotifications.permission !== "denied" && pushNotifications.permission !== "checking" && (
                  <button
                    type="button"
                    disabled={pushNotifications.isBusy}
                    onClick={() => void (pushNotifications.isSubscribed ? pushNotifications.disable() : pushNotifications.enable())}
                    className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${pushNotifications.isSubscribed ? "bg-zinc-700 text-zinc-200 hover:bg-zinc-600" : "bg-violet-600 text-white hover:bg-violet-500"}`}
                  >
                    {pushNotifications.isBusy ? "Đang xử lý..." : pushNotifications.isSubscribed ? "Tắt thông báo" : "Bật thông báo"}
                  </button>
                )}
                {pushNotifications.permission === "granted" && (
                  <button type="button" onClick={() => void pushNotifications.test()} className="mt-3 ml-2 rounded-lg bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-400 transition hover:bg-sky-500/25">
                    Gửi thông báo thử
                  </button>
                )}
                {pushNotifications.error && <p className="mt-2 text-[11px] text-rose-400">{pushNotifications.error}</p>}
              </div>

              <div className={`mb-4 rounded-xl border ${th.border} px-3 py-3 grid gap-2`}>
                <p className="text-sm font-medium">Chế độ lịch</p>
                <div className={`grid grid-cols-2 rounded-lg p-1 ${th.inputBg}`}>
                  <button
                    type="button"
                    onClick={() => handleScheduleScopeChange("USER")}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${scheduleScope === "USER" ? "bg-violet-600 text-white" : "text-zinc-300"}`}
                  >
                    Lịch cá nhân
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScheduleScopeChange("COMPANY")}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${scheduleScope === "COMPANY" ? "bg-violet-600 text-white" : "text-zinc-300"}`}
                  >
                    Lịch công ty
                  </button>
                </div>
                <p className={`text-[11px] ${th.subtext}`}>
                  {scheduleScope === "COMPANY"
                    ? "Lịch chung: ai cũng có thể xem và sửa"
                    : "Lịch theo từng tài khoản"}
                </p>
              </div>

              {scheduleScope === "USER" && (
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
              )}

              {scheduleScope === "COMPANY" && authError && (
                <p className="text-[11px] text-rose-400">{authError}</p>
              )}

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

              <div className={`flex items-center justify-between py-4 border-b ${th.border}`}>
                <div>
                  <p className="text-sm font-medium">Màu giờ gradient</p>
                  <p className={`text-xs ${th.subtext} mt-0.5`}>
                    {isGradientTimeText ? "Đang bật" : "Dùng màu mặc định"}
                  </p>
                </div>
                <button
                  onClick={() => setIsGradientTimeText((v) => !v)}
                  className={`relative w-9 h-4 rounded-full transition-colors duration-200 ${isGradientTimeText ? "bg-violet-600" : "bg-gray-300"}`}
                >
                  <span className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${isGradientTimeText ? "translate-x-5" : "translate-x-0"}`} />
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

      {/* ── Task edit modal ──────────────────────────────────────────────── */}
      {reviewTaskId !== null && (() => {
        const task = tasks.find((item) => item.id === reviewTaskId);
        if (!task) return null;
        return (
          <TaskEditModal
            task={task}
            isCompanySchedule={isCompanySchedule}
            isDark={isDark}
            users={usersForAuth}
            currentUser={sessionUser}
            onClose={() => setReviewTaskId(null)}
            onDelete={() => {
              if (applyTaskAction("remove", task.id)) setReviewTaskId(null);
            }}
            onAccept={() => applyTaskAction("accept", task.id)}
            onPatch={(patch) => patchTask(task.id, patch)}
          />
        );
      })()}

      {/* Legacy review card retained temporarily while the new UI settles. */}
      {reviewTaskId !== null && (() => {
        const task = tasks.find(t => t.id === reviewTaskId);
        if (!task) return null;
        const taskDate = absDayToDate(task.absDay);
        const isMultiDay = isMultiDayTask(task);
        const taskEndAbsDay = task.endAbsDay ?? task.absDay;
        const taskEndDate = absDayToDate(taskEndAbsDay);
        const durationMinutes = task.span * 30;
        const creatorName = task.createdByName ?? task.assignedFromName ?? "Không rõ";
        const updatedByName = task.updatedByName ?? "Chưa có";
        const confirmerNames = task.confirmedByUserIds
          .map((id) => usersForAuth.find((user) => user.id === id)?.name ?? `ID ${id}`)
          .filter((name, idx, arr) => arr.indexOf(name) === idx);
        return (
          <div
            className="hidden"
            onClick={() => setReviewTaskId(null)}
          >
            <div
              className={`${th.modalBg} rounded-2xl p-5 shadow-2xl mx-4 w-full max-w-xs border ${th.border}`}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">Chi tiết công việc</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (applyTaskAction("remove", task.id)) setReviewTaskId(null);
                  }}
                  className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600"
                >
                  Xóa
                </button>
              </div>
              <div className={`mt-3 rounded-xl ${th.inputBg} px-3 py-2`}>
                <p className={`text-[11px] ${th.subtext}`}>Tên công việc</p>
                <input
                  className="mt-1 w-full bg-transparent text-[16px] font-medium outline-none"
                  defaultValue={task.title}
                  onBlur={(e) => patchTask(task.id, { title: e.target.value })}
                  placeholder="Nhập tên công việc"
                />
              </div>

              <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                <p className={`text-[11px] ${th.subtext}`}>Mô tả</p>
                <textarea
                  className="mt-1 min-h-20 w-full resize-none bg-transparent text-[16px] outline-none"
                  defaultValue={task.description}
                  onBlur={(e) => patchTask(task.id, { description: e.target.value })}
                  placeholder="Nhập mô tả"
                />
              </div>

              {isCompanySchedule && (
                <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                  <p className={`text-[11px] ${th.subtext}`}>Người xác nhận</p>
                  {confirmerNames.length > 0 ? (
                    <div className="mt-0.5 text-sm">
                      {confirmerNames.map((name) => (
                        <p key={name} className="break-words">{name}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-sm">Chưa có</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mt-2">
                {!isCompanySchedule && (
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
                )}
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
                {!isCompanySchedule && (
                  <div className={`rounded-xl ${th.inputBg} px-3 py-2`}>
                    <p className={`text-[11px] ${th.subtext}`}>Trạng thái</p>
                    <p className="mt-0.5 text-sm">{STATUS_LABEL[task.status]}</p>
                  </div>
                )}
              </div>

              <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span>
                    <span className={`block text-[11px] ${th.subtext}`}>Thời lượng</span>
                    <span className="block text-sm">Task nhiều ngày</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={isMultiDay}
                    onChange={(event) => patchTask(task.id, event.target.checked
                      ? { endAbsDay: task.absDay + 1, endSlotIndex: Math.min(SLOTS - 1, task.slotIndex + task.span) }
                      : { endAbsDay: undefined, endSlotIndex: undefined })}
                    className="h-4 w-4 accent-violet-500"
                  />
                </label>
                {isMultiDay ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label>
                      <span className={`block text-[11px] ${th.subtext}`}>Bắt đầu</span>
                      <input
                        type="date"
                        value={absDayToDateInput(task.absDay)}
                        onChange={(event) => {
                          const nextStart = dateInputToAbsDay(event.target.value);
                          if (nextStart !== null) {
                            patchTask(task.id, {
                              absDay: nextStart,
                              endAbsDay: Math.max(nextStart + 1, taskEndAbsDay),
                            });
                          }
                        }}
                        className="mt-0.5 w-full rounded bg-transparent text-sm outline-none"
                      />
                      <input
                        type="time"
                        step="1800"
                        value={slotToTimeInput(task.slotIndex)}
                        onChange={(event) => {
                          const nextSlot = timeInputToSlot(event.target.value);
                          if (nextSlot !== null) patchTask(task.id, { slotIndex: nextSlot });
                        }}
                        className="mt-1 w-full rounded bg-transparent text-sm outline-none"
                      />
                    </label>
                    <label>
                      <span className={`block text-[11px] ${th.subtext}`}>Kết thúc</span>
                      <input
                        type="date"
                        min={absDayToDateInput(task.absDay)}
                        value={absDayToDateInput(taskEndAbsDay)}
                        onChange={(event) => {
                          const nextEnd = dateInputToAbsDay(event.target.value);
                          if (nextEnd !== null) patchTask(task.id, { endAbsDay: Math.max(task.absDay + 1, nextEnd) });
                        }}
                        className="mt-0.5 w-full rounded bg-transparent text-sm outline-none"
                      />
                      <input
                        type="time"
                        step="1800"
                        value={slotToTimeInput(getMultiDayEndSlot(task))}
                        onChange={(event) => {
                          const nextSlot = timeInputToSlot(event.target.value);
                          if (nextSlot !== null) patchTask(task.id, { endSlotIndex: nextSlot });
                        }}
                        className="mt-1 w-full rounded bg-transparent text-sm outline-none"
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <p className={`mt-3 text-[11px] ${th.subtext}`}>Ngày</p>
                    <p className="mt-0.5 text-sm">{dayShortOf(taskDate)}, {taskDate.toLocaleDateString("vi-VN")}</p>
                  </>
                )}
                {isMultiDay && <p className={`mt-2 text-xs ${th.subtext}`}>Kết thúc {dayShortOf(taskEndDate)}, {taskEndDate.toLocaleDateString("vi-VN")} lúc {slotLabel(getMultiDayEndSlot(task))}.</p>}
              </div>

              {!isMultiDay && (
                <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                  <p className={`text-[11px] ${th.subtext}`}>Thời gian</p>
                  <p className="mt-0.5 text-sm tabular-nums">
                    {slotLabel(task.slotIndex)} - {slotLabel(task.slotIndex + task.span)}
                  </p>
                  <p className={`mt-0.5 text-xs ${th.subtext}`}>{durationMinutes} phút</p>
                </div>
              )}

              {isCompanySchedule && (
                <>
                  <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                    <p className={`text-[11px] ${th.subtext}`}>Người tạo</p>
                    <p className="mt-0.5 text-sm break-words">{creatorName}</p>
                  </div>
                  <div className={`mt-2 rounded-xl ${th.inputBg} px-3 py-2`}>
                    <p className={`text-[11px] ${th.subtext}`}>Người sửa lần cuối</p>
                    <p className="mt-0.5 text-sm break-words">{updatedByName}</p>
                  </div>
                </>
              )}

              {!isCompanySchedule && task.assignedFromName && (
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
                    } : t).map((t) => (t.id === editingId ? withTaskAudit(t, sessionUserRef.current) : t)));
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
              <div className="mt-2">
                {!isCompanySchedule && (
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
                )}
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
                    } : t).map((t) => (t.id === editingId ? withTaskAudit(t, sessionUserRef.current) : t)));
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

