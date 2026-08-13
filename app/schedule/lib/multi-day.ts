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

export function getMultiDayTaskLanes(tasks: Task[]): Map<number, number> {
  const bars = tasks
    .filter(isMultiDayTask)
    .map((task) => ({
      task,
      start: task.absDay * SLOTS + task.slotIndex,
      end: (task.endAbsDay ?? task.absDay) * SLOTS + getMultiDayEndSlot(task),
    }))
    .sort((first, second) => first.start - second.start || second.end - first.end);

  const laneEnds: number[] = [];
  const lanes = new Map<number, number>();
  for (const { task, start, end } of bars) {
    const lane = laneEnds.findIndex((laneEnd) => start >= laneEnd);
    const resolvedLane = lane === -1 ? laneEnds.length : lane;
    laneEnds[resolvedLane] = end;
    lanes.set(task.id, resolvedLane);
  }

  return lanes;
}

export function layoutMultiDayBars(tasks: Task[], viewStartAbsDay: number, dayCount: number, dayWidth: number): MultiDayBar[] {
  const viewStart = viewStartAbsDay * SLOTS;
  const viewEnd = (viewStartAbsDay + dayCount) * SLOTS;
  const laneByTask = getMultiDayTaskLanes(tasks);
  const bars = tasks
    .filter(isMultiDayTask)
    .map((task) => ({
      task,
      start: task.absDay * SLOTS + task.slotIndex,
      end: (task.endAbsDay ?? task.absDay) * SLOTS + getMultiDayEndSlot(task),
    }))
    .filter(({ start, end }) => end > viewStart && start < viewEnd)
    .sort((first, second) => first.start - second.start || second.end - first.end);

  return bars.map(({ task, start, end }) => {
    const clippedStart = Math.max(start, viewStart);
    const clippedEnd = Math.min(end, viewEnd);
    return {
      task,
      lane: laneByTask.get(task.id) ?? 0,
      left: ((clippedStart - viewStart) / SLOTS) * dayWidth,
      width: Math.max(8, ((clippedEnd - clippedStart) / SLOTS) * dayWidth),
    };
  });
}
