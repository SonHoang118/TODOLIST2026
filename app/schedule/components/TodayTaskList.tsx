"use client";

import { absDayToDate, dayShortOf, slotLabel } from "../lib/date";
import { getMultiDayEndSlot, isMultiDayTask } from "../lib/multi-day";
import { isTaskOverdue, isTaskReadOnly } from "../lib/domain/task";
import type { ScheduleTheme, SessionUser, Task } from "../lib/types";

interface TodayTaskListProps {
  tasks: Task[];
  todayAbsDay: number;
  isCompanySchedule: boolean;
  isViewingOwnSchedule: boolean;
  sessionUser: SessionUser | null;
  viewingUser: SessionUser | null;
  users: SessionUser[];
  theme: ScheduleTheme;
  onComplete: (taskId: number) => void;
  onAccept: (taskId: number) => void;
  onConfirm: (taskId: number) => void;
  onEdit: (taskId: number) => void;
  onRemove: (taskId: number) => void;
}

const COMPANY_AVATAR_URL = "https://res.cloudinary.com/dbwtitpvi/image/upload/v1787320357/logo2_a2niqo.jpg";

export function TodayTaskList({ tasks, todayAbsDay, isCompanySchedule, isViewingOwnSchedule, sessionUser, viewingUser, users, theme, onComplete, onAccept, onConfirm, onEdit, onRemove }: TodayTaskListProps) {
  const todayTasks = tasks
    .filter((task) => task.absDay <= todayAbsDay && (task.endAbsDay ?? task.absDay) >= todayAbsDay)
    .sort((first, second) => first.slotIndex - second.slotIndex);
  const completedCount = todayTasks.filter((task) => task.status === "DONE").length;
  const isAllComplete = !isCompanySchedule && todayTasks.length > 0 && completedCount === todayTasks.length;
  const today = new Date();

  return (
    <section className={`schedule-view-enter flex-1 overflow-y-auto px-4 py-5 sm:px-6 ${theme.root}`}>
      <div className="mx-auto max-w-3xl pb-28">
        <div className={`rounded-3xl border ${theme.border} bg-gradient-to-br from-violet-600 to-indigo-700 p-5 text-white shadow-xl shadow-violet-950/20`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-100">Việc hôm nay</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{dayShortOf(today)}, {today.toLocaleDateString("vi-VN")}</h1>
              {isCompanySchedule ? (
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-violet-100">
                  <img src={COMPANY_AVATAR_URL} alt="DHStudio" className="h-6 w-6 rounded-full border border-white/40 object-cover" />
                  <span>DHStudio</span>
                </div>
              ) : viewingUser ? (
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-violet-100">
                  {viewingUser.avatar ? (
                    <img src={viewingUser.avatar} alt={viewingUser.name} className="h-6 w-6 rounded-full border border-white/40 object-cover" />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">{viewingUser.name.trim().charAt(0).toUpperCase()}</span>
                  )}
                  <span>{viewingUser.name}</span>
                </div>
              ) : null}
            </div>
            <div className={`today-progress relative isolate overflow-visible rounded-2xl px-3 py-2 text-right backdrop-blur-sm ${isAllComplete ? "today-progress-complete bg-emerald-400/25" : "bg-white/15"}`}>
              {isAllComplete && <div className="today-progress-burst pointer-events-none absolute inset-0" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => <span key={index} style={{ "--burst-index": index } as React.CSSProperties} />)}
              </div>}
              <div className="relative flex h-7 items-center justify-end text-xl font-bold tabular-nums">
                {isCompanySchedule ? <span>{todayTasks.length} task</span> : <>
                  <span className="sr-only" aria-live="polite">{completedCount}/{todayTasks.length} hoàn thành</span>
                  <span className="today-progress-number" aria-hidden="true">
                    <span className="today-progress-number-track" style={{ transform: `translateY(-${completedCount * 1.75}rem)` }}>
                      {Array.from({ length: todayTasks.length + 1 }, (_, value) => <span key={value}>{value}</span>)}
                    </span>
                  </span>
                  <span aria-hidden="true">/{todayTasks.length}</span>
                  {isAllComplete && <span className="today-progress-check ml-1" aria-hidden="true">✓</span>}
                </>}
              </div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-violet-100">{isCompanySchedule ? "Hôm nay" : "Hoàn thành"}</p>
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
              const isOverdue = isTaskOverdue(task);
              const isReadOnly = isTaskReadOnly(task);
              const isMultiDay = isMultiDayTask(task);
              const time = isMultiDay
                ? `${absDayToDate(task.absDay).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${slotLabel(task.slotIndex)} → ${absDayToDate(task.endAbsDay ?? task.absDay).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${slotLabel(getMultiDayEndSlot(task))}`
                : `${slotLabel(task.slotIndex)} – ${slotLabel(task.slotIndex + task.span)}`;
              const isAwaitingAcceptance = task.status === "PENDING" && Boolean(task.assignedFromName);
              const canAccept = isViewingOwnSchedule && isAwaitingAcceptance && !isOverdue && !isReadOnly;
              const canComplete = isViewingOwnSchedule && !isAwaitingAcceptance && !isOverdue && !isReadOnly;
              const hasConfirmed = sessionUser !== null && task.confirmedByUserIds.includes(sessionUser.id);
              const canConfirm = isCompanySchedule && sessionUser !== null && !hasConfirmed && !isOverdue && !isReadOnly;
              const confirmedUsers = task.confirmedByUserIds
                .map((userId) => users.find((user) => user.id === userId))
                .filter((user): user is SessionUser => user !== undefined);
              const visibleConfirmedUsers = confirmedUsers.length > 5 ? confirmedUsers.slice(0, 4) : confirmedUsers.slice(0, 5);
              const hiddenConfirmedCount = confirmedUsers.length - visibleConfirmedUsers.length;
              return (
                <article key={task.id} onClick={() => { if (canComplete) onComplete(task.id); }} className={`schedule-list-card group relative rounded-2xl border ${isOverdue ? (isCompanySchedule ? "border-[3px] border-zinc-500" : "border-[3px] border-red-600") : theme.border} ${theme.hdrBg} p-4 ${isOverdue ? "pb-7" : ""} ${canComplete ? "cursor-pointer" : ""} shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`} style={{ animationDelay: `${index * 45}ms` }}>
                  <div className="flex items-start gap-3">
                    {!isAwaitingAcceptance && !isOverdue && isViewingOwnSchedule && <button type="button" disabled={!canComplete} onClick={(event) => { event.stopPropagation(); if (canComplete) onComplete(task.id); }} aria-label={isDone ? (isReadOnly ? "Đã hoàn thành" : "Bỏ hoàn thành") : "Đánh dấu hoàn thành"} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${isDone ? `${isReadOnly ? "cursor-not-allowed " : ""}border-emerald-400 bg-emerald-500 text-white` : "border-zinc-500 hover:border-violet-400"}`}>{isDone && "✓"}</button>}
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold ${isDone && !isCompanySchedule ? "text-zinc-500 line-through" : ""}`}>{task.title}</p>
                      {!isCompanySchedule && <div className="mt-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDone ? "bg-emerald-500/15 text-emerald-500" : task.status === "PENDING" ? "bg-amber-500/15 text-amber-500" : "bg-sky-500/15 text-sky-500"}`}>{isDone ? "DONE" : task.status === "PENDING" ? "CHỜ" : "ĐANG LÀM"}</span>
                      </div>}
                      {task.description && <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${theme.subtext}`}>{task.description}</p>}
                      <div className={`mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap text-xs font-medium ${theme.subtext}`}>
                        <span className="shrink-0 rounded-lg bg-black/5 px-2 py-1 tabular-nums dark:bg-white/5">◷ {time}</span>
                        <span className="shrink-0">{isMultiDay ? "Nhiều ngày" : `${task.span * 30} phút`}</span>
                      </div>
                      {isCompanySchedule && <details className="mt-3" onClick={(event) => event.stopPropagation()}>
                        <summary className={`flex cursor-pointer list-none items-center gap-2 text-xs font-medium ${theme.subtext}`}>
                          <span className="shrink-0">Đã xác nhận:</span>
                          {confirmedUsers.length === 0 ? <span>Chưa có</span> : <span className="flex -space-x-1.5">
                            {visibleConfirmedUsers.map((user) => <img key={user.id} src={user.avatar} alt={user.name} title={user.name} className="h-6 w-6 rounded-full border-2 border-white object-cover dark:border-zinc-800" />)}
                            {hiddenConfirmedCount > 0 && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-violet-600 text-[9px] font-bold text-white dark:border-zinc-800">+{hiddenConfirmedCount}</span>}
                          </span>}
                          {confirmedUsers.length > 0 && <span aria-hidden="true" className="ml-1 text-[10px]">▼</span>}
                        </summary>
                        {confirmedUsers.length > 0 && <ul className={`mt-2 grid gap-1 rounded-xl bg-black/5 p-2 text-xs dark:bg-white/5 ${theme.subtext}`}>
                          {confirmedUsers.map((user) => <li key={user.id} className="flex items-center gap-2"><img src={user.avatar} alt="" className="h-5 w-5 rounded-full object-cover" /><span>{user.name}</span></li>)}
                        </ul>}
                      </details>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                      {!isReadOnly && <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(task.id); }} className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${theme.btnSecondary}`}>Sửa</button>}
                      <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(task.id); }} className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-500/20">Xóa</button>
                    </div>
                  </div>
                  {(canAccept || canConfirm) && <div className={`mt-3 flex justify-end border-t ${theme.border} pt-3`}>
                    {canAccept && <button type="button" onClick={(event) => { event.stopPropagation(); onAccept(task.id); }} className="rounded-xl border border-amber-300/70 bg-amber-400 px-4 py-2 text-xs font-bold text-zinc-900 shadow-sm transition hover:bg-amber-300">Nhận</button>}
                    {canConfirm && <button type="button" onClick={(event) => { event.stopPropagation(); onConfirm(task.id); }} className="rounded-xl border border-emerald-300/70 bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-400">Xác nhận</button>}
                  </div>}
                  {isOverdue && <div className={`absolute bottom-0 left-0 right-0 rounded-b-xl py-1 text-center text-[10px] font-bold text-white ${isCompanySchedule ? "bg-zinc-600" : "bg-red-600"}`}>{isCompanySchedule ? "ĐÃ HẾT HẠN" : "QUÁ HẠN"}</div>}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
