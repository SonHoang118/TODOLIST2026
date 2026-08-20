import {
  DEFAULT_TASK_BG,
  DEFAULT_TASK_LABEL,
  LEGACY_DEFAULT_TASK_BG,
  PERSONAL_TASK_BG,
  PERSONAL_TASK_LABEL,
  TAILWIND_COLOR_TO_HEX,
  TASK_LABEL_TEXT,
  TASK_TITLE_POOL,
} from "../constants";
import { absDayToDate } from "../date";
import type { SessionUser, Task, TaskLabelValue, TaskStatus } from "../types";

export function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "PENDING" || value === "IN_PROGRESS" || value === "DONE";
}

export function normalizeTaskLabel(value: unknown): TaskLabelValue {
  if (typeof value !== "string") return DEFAULT_TASK_LABEL;
  const valueNormalized = value.trim().toLowerCase();
  return valueNormalized === "personal" || valueNormalized === "việc cá nhân" || valueNormalized === "viec ca nhan"
    ? PERSONAL_TASK_LABEL
    : DEFAULT_TASK_LABEL;
}

export function taskLabelText(value: unknown): string {
  return TASK_LABEL_TEXT[normalizeTaskLabel(value)];
}

export function randomTaskTitle(): string {
  return TASK_TITLE_POOL[Math.floor(Math.random() * TASK_TITLE_POOL.length)] ?? "Công việc mới";
}

export function maxTaskId(tasks: Task[]): number {
  return tasks.reduce((max, task) => Math.max(max, task.id), 0);
}

export function ensureUniqueTaskIds(tasks: Task[]): Task[] {
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

export function buildDateFromAbsDayAndSlot(absDay: number, slotIndex: number): Date {
  const date = absDayToDate(absDay);
  date.setHours(Math.floor(slotIndex / 2), slotIndex % 2 === 0 ? 0 : 30, 0, 0);
  return date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function taskEndTime(task: Task): number {
  const endDay = task.endAbsDay ?? task.absDay;
  const endSlot = task.endAbsDay !== undefined
    ? (task.endSlotIndex ?? task.slotIndex + task.span)
    : task.slotIndex + task.span;
  return buildDateFromAbsDayAndSlot(endDay, endSlot).getTime();
}

export function isTaskOverdue(task: Task, now = Date.now()): boolean {
  if (!task.updatedAt) return false;
  const updatedAt = Date.parse(task.updatedAt);
  return Number.isFinite(updatedAt)
    && now - taskEndTime(task) >= DAY_MS
    && now - updatedAt >= DAY_MS;
}

export function shouldAutoDeleteTask(task: Task, now = Date.now()): boolean {
  if (!task.updatedAt) return false;
  const updatedAt = Date.parse(task.updatedAt);
  return Number.isFinite(updatedAt)
    && now - updatedAt >= 15 * DAY_MS
    && (task.status === "DONE" || isTaskOverdue(task, now));
}

export function withTaskAudit(task: Task, actor: SessionUser | null): Task {
  if (!actor) return task;
  return {
    ...task,
    updatedByUserId: actor.id,
    updatedByName: actor.name,
    updatedByAvatar: actor.avatar,
    confirmedByUserIds: Array.from(new Set([...task.confirmedByUserIds, actor.id])),
  };
}

export function withTaskConfirmOnly(task: Task, actor: SessionUser | null): Task {
  if (!actor || task.confirmedByUserIds.includes(actor.id)) return task;
  return { ...task, confirmedByUserIds: [...task.confirmedByUserIds, actor.id] };
}

export function resolveTaskBgClass(taskColor: string, isDark: boolean): string {
  if (taskColor === DEFAULT_TASK_BG || taskColor === LEGACY_DEFAULT_TASK_BG) return isDark ? "bg-sky-700/80" : "bg-sky-500/85";
  if (taskColor === PERSONAL_TASK_BG) return isDark ? "bg-emerald-700/75" : "bg-emerald-500/70";
  return taskColor;
}

export function colorToPickerHex(taskColor: string): string {
  if (isHexColor(taskColor)) return taskColor;
  if (taskColor === DEFAULT_TASK_BG || taskColor === LEGACY_DEFAULT_TASK_BG) return "#3f3f46";
  if (taskColor === PERSONAL_TASK_BG) return "#16a34a";
  return TAILWIND_COLOR_TO_HEX[taskColor] ?? "#7c3aed";
}

export function colorToDisplayHex(taskColor: string, isDark: boolean): string {
  if (taskColor === DEFAULT_TASK_BG || taskColor === LEGACY_DEFAULT_TASK_BG) return isDark ? "#0369a1" : "#0ea5e9";
  if (taskColor === PERSONAL_TASK_BG) return isDark ? "#047857" : "#10b981";
  return colorToPickerHex(taskColor);
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function doneTaskBgClass(isDark: boolean): string {
  return isDark
    ? "bg-zinc-500/30 border border-zinc-300/60 brightness-90"
    : "bg-zinc-400/35 border border-zinc-500/50 brightness-95";
}
