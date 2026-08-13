export interface Task {
  id: number;
  title: string;
  description: string;
  absDay: number;
  /** Inclusive final day; absent means the task is contained in one day. */
  endAbsDay?: number;
  /** End time of a multi-day task, stored as a 30-minute slot. */
  endSlotIndex?: number;
  slotIndex: number;
  span: number;
  color: string;
  label: string;
  status: TaskStatus;
  assignedFromName: string | null;
  createdByUserId: number | null;
  createdByName: string | null;
  createdByAvatar: string | null;
  updatedByUserId: number | null;
  updatedByName: string | null;
  updatedByAvatar: string | null;
  confirmedByUserIds: number[];
}

export interface SessionUser {
  id: number;
  name: string;
  role: "ADMIN" | "STAFF";
  avatar: string;
}

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE";
export type TaskLabelValue = "DEFAULT" | "PERSONAL";
export type ScheduleScope = "USER" | "COMPANY";

export interface ScheduleTheme {
  root: string;
  hdrBg: string;
  border: string;
  stickyHdr: string;
  stickyBg: string;
  halfBorder: string;
  dayBorder: string;
  todayCol: string;
  todayHdr: string;
  timeText: string;
  subtext: string;
  inputBg: string;
  modalBg: string;
  btnSecondary: string;
}
