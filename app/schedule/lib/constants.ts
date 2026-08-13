import type { TaskLabelValue, TaskStatus } from "./types";

export const SLOT_H = 32;
export const DAY_W = 100;
export const TIME_W = 44;
export const HEADER_H = 52;
// Temporary weekday-header preview. Reset this to 0 to restore the original height.
export const TEMP_WEEKDAY_HEADER_EXTRA_HEIGHT = 30;
export const WEEKDAY_HEADER_H = HEADER_H + TEMP_WEEKDAY_HEADER_EXTRA_HEIGHT;
export const SLOTS = 48;
export const DAYS = 7;
export const LONG_PRESS_MS = 350;
export const DRAG_DELTA = 8;
export const HANDLE_H = 14;
export const DAY_W_MIN = 60;
export const DAY_W_MAX = 140;
export const DAY_W_STEP = 20;
export const SLOT_MS = 30 * 60 * 1000;

export const COLORS = [
  "bg-violet-600", "bg-emerald-600", "bg-amber-500", "bg-sky-600",
  "bg-rose-600", "bg-teal-600", "bg-orange-500", "bg-indigo-600",
  "bg-pink-600", "bg-cyan-600", "bg-lime-600", "bg-fuchsia-600",
];

export const TAILWIND_COLOR_TO_HEX: Record<string, string> = {
  "bg-violet-600": "#7c3aed", "bg-emerald-600": "#059669", "bg-amber-500": "#f59e0b", "bg-sky-600": "#0284c7",
  "bg-rose-600": "#e11d48", "bg-teal-600": "#0d9488", "bg-orange-500": "#f97316", "bg-indigo-600": "#4f46e5",
  "bg-pink-600": "#db2777", "bg-cyan-600": "#0891b2", "bg-lime-600": "#65a30d", "bg-fuchsia-600": "#c026d3",
};

export const DEFAULT_TASK_BG = "__DEFAULT_TASK_BG__";
export const PERSONAL_TASK_BG = "__PERSONAL_TASK_BG__";
export const LEGACY_DEFAULT_TASK_BG = "bg-zinc-700";
export const DAY_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export const TASK_TITLE_POOL = ["Đi gặp khách hàng", "Đi khảo sát công trình", "Đi lấy vật tư", "Kiểm tra tiến độ đội thi công", "Làm việc với nhà cung cấp", "Nghiệm thu hạng mục", "Họp điều phối công việc", "Chuẩn bị hồ sơ thanh toán", "Kiểm tra an toàn công trường", "Cập nhật báo cáo cuối ngày"];
export const EPOCH_DATE = new Date(2026, 0, 1);
export const INF_BUFFER = 180;
export const INF_CENTER = 90;

export const DEFAULT_TASK_LABEL: TaskLabelValue = "DEFAULT";
export const PERSONAL_TASK_LABEL: TaskLabelValue = "PERSONAL";
export const TASK_LABEL_TEXT: Record<TaskLabelValue, string> = { DEFAULT: "Mặc định", PERSONAL: "Việc cá nhân" };
export const STATUS_LABEL: Record<TaskStatus, string> = { PENDING: "Đang chờ tiếp nhận", IN_PROGRESS: "Đang làm", DONE: "Đã hoàn thành" };
