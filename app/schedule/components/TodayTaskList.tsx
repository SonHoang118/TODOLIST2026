"use client";

import { absDayToDate, dayShortOf, slotLabel } from "../lib/date";
import { getMultiDayEndSlot, isMultiDayTask } from "../lib/multi-day";
import type { ScheduleTheme, Task } from "../lib/types";

interface TodayTaskListProps {
  tasks: Task[];
  todayAbsDay: number;
  isCompanySchedule: boolean;
  theme: ScheduleTheme;
  onComplete: (taskId: number) => void;
  onEdit: (taskId: number) => void;
  onRemove: (taskId: number) => void;
}

export function TodayTaskList({ tasks, todayAbsDay, isCompanySchedule, theme, onComplete, onEdit, onRemove }: TodayTaskListProps) {
  const todayTasks = tasks
    .filter((task) => task.absDay <= todayAbsDay && (task.endAbsDay ?? task.absDay) >= todayAbsDay)
    .sort((first, second) => first.slotIndex - second.slotIndex);
  const completedCount = todayTasks.filter((task) => task.status === "DONE").length;
  const today = new Date();

  return (
    <section className={`schedule-view-enter flex-1 overflow-y-auto px-4 py-5 sm:px-6 ${theme.root}`}>
      <div className="mx-auto max-w-3xl">
        <div className={`rounded-3xl border ${theme.border} bg-gradient-to-br from-violet-600 to-indigo-700 p-5 text-white shadow-xl shadow-violet-950/20`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-100">Việc hôm nay</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{dayShortOf(today)}, {today.toLocaleDateString("vi-VN")}</h1>
              <p className="mt-1 text-sm text-violet-100">Timeline công việc trong ngày của bạn.</p>
            </div>
            <div className="rounded-2xl bg-white/15 px-3 py-2 text-right backdrop-blur-sm">
              <p className="text-xl font-bold tabular-nums">{completedCount}/{todayTasks.length}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-violet-100">Hoàn thành</p>
            </div>
          </div>
        </div>

        {todayTasks.length === 0 ? (
          <div className={`schedule-view-enter mt-5 rounded-3xl border border-dashed ${theme.border} px-6 py-16 text-center`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-2xl">✓</div>
            <h2 className="mt-4 font-semibold">Hôm nay chưa có task</h2>
            <p className={`mt-1 text-sm ${theme.subtext}`}>Chạm vào lịch để tạo một công việc mới.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {todayTasks.map((task, index) => {
              const isDone = task.status === "DONE";
              const isMultiDay = isMultiDayTask(task);
              const time = isMultiDay
                ? `${absDayToDate(task.absDay).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${slotLabel(task.slotIndex)} → ${absDayToDate(task.endAbsDay ?? task.absDay).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${slotLabel(getMultiDayEndSlot(task))}`
                : `${slotLabel(task.slotIndex)} – ${slotLabel(task.slotIndex + task.span)}`;
              return (
                <article key={task.id} className={`schedule-list-card group rounded-2xl border ${theme.border} ${theme.hdrBg} p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`} style={{ animationDelay: `${index * 45}ms` }}>
                  <div className="flex items-start gap-3">
                    <button type="button" disabled={isCompanySchedule} onClick={() => onComplete(task.id)} aria-label={isDone ? "Đánh dấu đang làm" : "Đánh dấu hoàn thành"} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${isDone ? "border-emerald-400 bg-emerald-500 text-white" : "border-zinc-500 hover:border-violet-400"} ${isCompanySchedule ? "cursor-not-allowed opacity-50" : ""}`}>{isDone && "✓"}</button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`font-semibold ${isDone ? "text-zinc-500 line-through" : ""}`}>{task.title}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDone ? "bg-emerald-500/15 text-emerald-500" : task.status === "PENDING" ? "bg-amber-500/15 text-amber-500" : "bg-sky-500/15 text-sky-500"}`}>{isDone ? "DONE" : task.status === "PENDING" ? "CHỜ" : "ĐANG LÀM"}</span>
                      </div>
                      {task.description && <p className={`mt-1 line-clamp-2 text-sm ${theme.subtext}`}>{task.description}</p>}
                      <div className={`mt-3 flex items-center gap-2 text-xs font-medium ${theme.subtext}`}>
                        <span className="rounded-lg bg-black/5 px-2 py-1 tabular-nums dark:bg-white/5">◷ {time}</span>
                        <span>{isMultiDay ? "Nhiều ngày" : `${task.span * 30} phút`}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                      <button type="button" onClick={() => onEdit(task.id)} className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${theme.btnSecondary}`}>Sửa</button>
                      <button type="button" onClick={() => onRemove(task.id)} className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-500/20">Xóa</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
