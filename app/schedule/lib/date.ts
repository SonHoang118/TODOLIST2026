import { DAY_SHORT, EPOCH_DATE } from "./constants";

export function dateToAbsDay(date: Date): number {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local.getTime() - EPOCH_DATE.getTime()) / 86_400_000);
}

export function absDayToDate(day: number): Date {
  const date = new Date(EPOCH_DATE);
  date.setDate(EPOCH_DATE.getDate() + day);
  return date;
}

export function dayShortOf(date: Date): string {
  return DAY_SHORT[date.getDay() === 0 ? 6 : date.getDay() - 1];
}

export function slotLabel(slot: number): string {
  const hours = Math.floor(slot / 2);
  const minutes = slot % 2 === 0 ? "00" : "30";
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

export function getWeekDates(offset = 0): Date[] {
  const today = new Date();
  const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek + 1 + offset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

export function isSameDay(first: Date, second: Date): boolean {
  return first.getDate() === second.getDate() && first.getMonth() === second.getMonth() && first.getFullYear() === second.getFullYear();
}

export function currentTimeScrollTop(slotHeight: number): number {
  return Math.max(0, (new Date().getHours() * 2 - 3) * slotHeight);
}

export function absDayToDateInput(day: number): string {
  const date = absDayToDate(day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateInputToAbsDay(value: string): number | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : dateToAbsDay(date);
}

export function slotToTimeInput(slot: number): string {
  return slotLabel(Math.max(0, Math.min(47, slot)));
}

export function timeInputToSlot(value: string): number | null {
  const match = /^(\d{2}):(00|30)$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  return hours >= 0 && hours <= 23 ? hours * 2 + (match[2] === "30" ? 1 : 0) : null;
}
