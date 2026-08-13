import { SLOTS } from "./constants";
import type { Task } from "./types";

export interface MultiDayBar {
  task: Task;
  lane: number;
  left: number;
  width: number;
}

export function isMultiDayTask(task: Task): boolean {
  return (task.endAbsDay ?? task.absDay) > task.absDay;
}

export function getMultiDayEndSlot(task: Task): number {
  return task.endSlotIndex ?? Math.min(SLOTS - 1, task.slotIndex + task.span);
}

export function layoutMultiDayBars(tasks: Task[], viewStartAbsDay: number, dayCount: number, dayWidth: number): MultiDayBar[] {
  const viewStart = viewStartAbsDay * SLOTS;
  const viewEnd = (viewStartAbsDay + dayCount) * SLOTS;
  const bars = tasks
    .filter(isMultiDayTask)
    .map((task) => ({
      task,
      start: task.absDay * SLOTS + task.slotIndex,
      end: (task.endAbsDay ?? task.absDay) * SLOTS + getMultiDayEndSlot(task),
    }))
    .filter(({ start, end }) => end > viewStart && start < viewEnd)
    .sort((first, second) => first.start - second.start || second.end - first.end);

  const laneEnds: number[] = [];
  return bars.map(({ task, start, end }) => {
    const lane = laneEnds.findIndex((laneEnd) => start >= laneEnd);
    const resolvedLane = lane === -1 ? laneEnds.length : lane;
    laneEnds[resolvedLane] = end;
    const clippedStart = Math.max(start, viewStart);
    const clippedEnd = Math.min(end, viewEnd);
    return {
      task,
      lane: resolvedLane,
      left: ((clippedStart - viewStart) / SLOTS) * dayWidth,
      width: Math.max(8, ((clippedEnd - clippedStart) / SLOTS) * dayWidth),
    };
  });
}
