"use client";

import { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { SLOTS, STATUS_LABEL } from "../lib/constants";
import { absDayToDate, absDayToDateInput, dateInputToAbsDay, dayShortOf } from "../lib/date";
import { colorToDisplayHex } from "../lib/domain/task";
import { getMultiDayEndSlot, isMultiDayTask } from "../lib/multi-day";
import type { ScheduleScope, SessionUser, Task, TaskComment } from "../lib/types";
import { HalfHourTimePicker } from "./HalfHourTimePicker";

interface TaskEditModalProps {
  task: Task;
  isCompanySchedule: boolean;
  scheduleScope: ScheduleScope;
  scheduleOwnerId: number | null;
  isOverdue: boolean;
  isReadOnly: boolean;
  isDark: boolean;
  users: SessionUser[];
  currentUser: SessionUser | null;
  onClose: () => void;
  onDelete: () => void;
  onAccept: () => void;
  onPatch: (patch: Partial<Task>) => void;
}

function displayDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${dayShortOf(date)}, ${day}/${month}/${date.getFullYear()}`;
}

function statusBadgeClass(status: Task["status"]): string {
  if (status === "DONE") return "border border-emerald-400/25 bg-emerald-500/15 text-emerald-400";
  if (status === "IN_PROGRESS") return "border border-sky-400/25 bg-sky-500/15 text-sky-400";
  return "border border-amber-400/25 bg-amber-500/15 text-amber-400";
}

function DatePickerField({ date, value, min, onChange }: { date: Date; value: string; min?: string; onChange: (value: string) => void }) {
  return (
    <label className="relative min-w-0 cursor-pointer whitespace-nowrap">
      <span>{displayDate(date)}</span>
      <input type="date" value={value} min={min} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Chọn ngày" />
    </label>
  );
}

function LargeAvatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  if (avatar) return <img src={avatar} alt={name ?? "avatar"} className="h-12 w-12 shrink-0 rounded-full object-cover" />;
  return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-lg font-bold text-white">{name?.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function SmallAvatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  if (avatar) return <img src={avatar} alt={name ?? "avatar"} className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-xs font-bold text-white">{name?.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function commentTimeLabel(createdAt: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (elapsedSeconds < 60) return "Vừa xong";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export function TaskEditModal({ task, isCompanySchedule, scheduleScope, scheduleOwnerId, isOverdue, isReadOnly, isDark, users, currentUser, onClose, onDelete, onAccept, onPatch }: TaskEditModalProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [confirmersOpen, setConfirmersOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const pickerRef = useRef<HTMLDivElement>(null);
  const confirmersRef = useRef<HTMLDivElement>(null);
  const isMultiDay = isMultiDayTask(task);
  const startDate = absDayToDate(task.absDay);
  const endAbsDay = task.endAbsDay ?? task.absDay;
  const endDate = absDayToDate(endAbsDay);
  const taskColor = colorToDisplayHex(task.color, isDark);
  const ownerName = task.createdByName ?? task.assignedFromName ?? currentUser?.name ?? "Người tạo task";
  const ownerAvatar = task.createdByAvatar ?? currentUser?.avatar ?? null;
  const titleAvatarName = isCompanySchedule ? (task.updatedByName ?? ownerName) : ownerName;
  const titleAvatar = isCompanySchedule ? (task.updatedByAvatar ?? ownerAvatar) : ownerAvatar;
  const [commenters, setCommenters] = useState<TaskComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentSending, setCommentSending] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);
  const [newCommentId, setNewCommentId] = useState<number | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const confirmedUsers = task.confirmedByUserIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is SessionUser => Boolean(user));
  const canAcceptTask = !isCompanySchedule
    && task.status === "PENDING"
    && Boolean(task.assignedFromName)
    && currentUser !== null
    && scheduleOwnerId === currentUser.id;
  const patchAndMarkChanged = (patch: Partial<Task>) => {
    if (isReadOnly) return;
    setHasChanges(true);
    onPatch(patch);
  };
  const submitComment = async () => {
    const text = commentDraft.trim();
    if (!text || !currentUser || commentSending) return;
    setCommentSending(true);
    setCommentError(null);
    try {
      const response = await fetch("/api/schedule/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scheduleScope, ownerId: scheduleOwnerId, taskId: task.id, authorUserId: currentUser.id, content: text }),
      });
      if (!response.ok) throw new Error("Không thể gửi bình luận.");
      const savedComment = await response.json() as TaskComment;
      setCommenters((current) => [savedComment, ...current]);
      setNewCommentId(savedComment.id);
      setCommentDraft("");
      setCommentsOpen(true);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Không thể gửi bình luận.");
    } finally {
      setCommentSending(false);
    }
  };
  const deleteComment = async (commentId: number) => {
    if (!currentUser || deletingCommentId !== null) return;
    if (!window.confirm("Bạn có chắc muốn xóa bình luận này không?")) return;
    setDeletingCommentId(commentId);
    setCommentError(null);
    try {
      const response = await fetch("/api/schedule/comments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scheduleScope, ownerId: scheduleOwnerId, taskId: task.id, commentId, authorUserId: currentUser.id }),
      });
      if (!response.ok) throw new Error("Không thể xóa bình luận.");
      setCommenters((current) => current.filter((comment) => comment.id !== commentId));
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Không thể xóa bình luận.");
    } finally {
      setDeletingCommentId(null);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ scope: scheduleScope, taskId: String(task.id) });
    if (scheduleScope === "USER" && scheduleOwnerId !== null) params.set("ownerId", String(scheduleOwnerId));
    void fetch(`/api/schedule/comments?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải bình luận.");
        setCommenters(await response.json() as TaskComment[]);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCommentError(error instanceof Error ? error.message : "Không thể tải bình luận.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommentsLoading(false);
      });
    return () => controller.abort();
  }, [scheduleOwnerId, scheduleScope, task.id]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closePicker = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [pickerOpen]);

  useEffect(() => {
    if (!confirmersOpen) return;
    const closeConfirmers = (event: PointerEvent) => {
      if (!confirmersRef.current?.contains(event.target as Node)) setConfirmersOpen(false);
    };
    document.addEventListener("pointerdown", closeConfirmers);
    return () => document.removeEventListener("pointerdown", closeConfirmers);
  }, [confirmersOpen]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <section className="relative max-h-[94vh] w-full max-w-[455px] overflow-y-auto rounded-xl bg-[#242424] text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div ref={pickerRef} className="relative">
          {isReadOnly ? (
            <div className="h-[68px] w-full rounded-t-xl" style={{ backgroundColor: taskColor }} />
          ) : (
            <button
              type="button"
              className="block h-[68px] w-full rounded-t-xl transition-[filter] hover:brightness-110"
              style={{ backgroundColor: taskColor }}
              onClick={() => setPickerOpen((open) => !open)}
              aria-label="Đổi màu công việc"
            />
          )}
          {pickerOpen && (
            <div className="absolute left-5 top-14 z-20 rounded-xl bg-zinc-900 p-3 shadow-2xl ring-1 ring-white/15">
              <HexColorPicker color={taskColor} onChange={(color) => patchAndMarkChanged({ color })} />
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-300">
                <span>Màu công việc</span><span className="font-mono uppercase">{taskColor}</span>
              </div>
            </div>
          )}
          <button type="button" onClick={onClose} aria-label={hasChanges ? "Hoàn tất chỉnh sửa" : "Đóng"} className={`absolute right-4 top-3 flex h-11 w-11 items-center justify-center rounded-full transition ${hasChanges ? "border border-emerald-300/60 bg-emerald-500/30 text-emerald-50 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] hover:bg-emerald-500/40" : "bg-black/30 text-4xl font-light leading-none hover:bg-black/45"}`}>
            {hasChanges ? <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden><path d="m5 12.5 4.25 4.25L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg> : "×"}
          </button>
        </div>

        <div className="flex h-16 items-center justify-between border-b border-white/15 px-[18px]">
          {isOverdue ? <span className={`rounded-md border px-4 py-2 text-sm font-bold ${isCompanySchedule ? "border-zinc-400/25 bg-zinc-400/15 text-zinc-300" : "border-red-400/25 bg-red-500/15 text-red-400"}`}>{isCompanySchedule ? "Đã hết hạn" : "Quá hạn"}</span> : isCompanySchedule ? (
            <div ref={confirmersRef} className="relative min-w-0">
              <button type="button" onClick={() => setConfirmersOpen((open) => !open)} aria-expanded={confirmersOpen} className="flex min-w-0 items-center gap-2 text-sm font-bold">
                <svg viewBox="0 0 20 20" fill="none" className={`h-5 w-5 shrink-0 transition-transform ${confirmersOpen ? "rotate-180" : ""}`} aria-hidden><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Đã xác nhận</span>
                <div className="flex -space-x-2">
                  {confirmedUsers.slice(0, 3).map((user) => (
                    <img key={user.id} src={user.avatar} alt={user.name} title={user.name} className="h-6 w-6 rounded-full border-2 border-[#242424] object-cover" />
                  ))}
                </div>
              </button>
              {confirmersOpen && (
                <div className="absolute left-0 top-9 z-10 min-w-56 rounded-lg border border-white/15 bg-zinc-800 p-2 shadow-xl">
                  {confirmedUsers.length > 0 ? confirmedUsers.map((user) => (
                    <div key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-white/5">
                      <SmallAvatar name={user.name} avatar={user.avatar} /><span className="break-words">{user.name}</span>
                    </div>
                  )) : <p className="px-2 py-1.5 text-sm text-zinc-400">Chưa có người xác nhận</p>}
                </div>
              )}
            </div>
          ) : (
            canAcceptTask ? (
              <button type="button" onClick={() => { setHasChanges(true); onAccept(); }} className="rounded-md bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:bg-amber-300">Nhận</button>
            ) : (
              <span className={`rounded-md px-5 py-2 text-sm font-semibold ${statusBadgeClass(task.status)}`}>
                {task.status === "PENDING" ? "Đang chờ" : STATUS_LABEL[task.status]}
              </span>
            )
          )}
          <button type="button" onClick={onDelete} className="rounded-md bg-red-500 px-5 py-2 text-sm font-bold transition hover:bg-red-600">Xóa</button>
        </div>

        <div className="border-b border-white/15 px-[18px] py-5">
          <div className="flex items-center gap-4">
            <LargeAvatar name={titleAvatarName} avatar={titleAvatar} />
            <textarea readOnly={isReadOnly} rows={1} value={title} onChange={(event) => { setTitle(event.target.value); setHasChanges(true); }} onBlur={() => { if (!isReadOnly) onPatch({ title }); }} className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-base font-bold leading-snug outline-none [field-sizing:content]" placeholder="Tên công việc" />
            {!isReadOnly && <button type="button" onClick={() => { setTitle(""); patchAndMarkChanged({ title: "" }); }} aria-label="Xóa tiêu đề" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-sm text-zinc-300">×</button>}
          </div>
          <textarea readOnly={isReadOnly} value={description} onChange={(event) => { setDescription(event.target.value); setHasChanges(true); }} onBlur={() => { if (!isReadOnly) onPatch({ description }); }} className="mt-3 h-[60px] w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 outline-none" placeholder="Nhập mô tả" />
        </div>

        <div className={`border-b border-white/15 px-[18px] py-4 ${isReadOnly ? "pointer-events-none opacity-75" : ""}`}>
          <div className="flex items-center gap-4 text-xl font-bold">
            <input
              id={`multi-day-task-${task.id}`}
              type="checkbox"
              checked={isMultiDay}
              onChange={(event) => patchAndMarkChanged(event.target.checked
                ? { endAbsDay: task.absDay + 1, endSlotIndex: Math.min(SLOTS - 1, task.slotIndex + task.span) }
                : { endAbsDay: undefined, endSlotIndex: undefined })}
              className="h-5 w-5 cursor-pointer accent-purple-600"
            />
            <label htmlFor={`multi-day-task-${task.id}`} className="cursor-pointer">Task nhiều ngày</label>
          </div>

          {!isMultiDay ? (
            <div className="mt-6 flex items-center justify-between gap-3 text-lg font-bold">
              <DatePickerField date={startDate} value={absDayToDateInput(task.absDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) patchAndMarkChanged({ absDay: day }); }} />
              <div className="flex items-center gap-3 whitespace-nowrap tabular-nums">
                <HalfHourTimePicker value={task.slotIndex} maxSlot={Math.min(47, task.slotIndex + task.span - 1)} onChange={(slot) => patchAndMarkChanged({ slotIndex: slot, span: task.slotIndex + task.span - slot })} ariaLabel="Chọn giờ bắt đầu" />
                <span className="flex w-4 items-center justify-center leading-none">−</span>
                <HalfHourTimePicker value={task.slotIndex + task.span} minSlot={task.slotIndex + 1} maxSlot={48} includeNextMidnight onChange={(endSlot) => patchAndMarkChanged({ span: endSlot - task.slotIndex })} ariaLabel="Chọn giờ kết thúc" />
                <span className="text-sm text-zinc-500">{task.span * 30} phút</span>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4 text-lg font-bold">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <DatePickerField date={startDate} value={absDayToDateInput(task.absDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) patchAndMarkChanged({ absDay: day, endAbsDay: Math.max(day + 1, endAbsDay) }); }} />
                <span className="text-sm text-zinc-500">Bắt đầu</span>
                <HalfHourTimePicker value={task.slotIndex} onChange={(slot) => patchAndMarkChanged({ slotIndex: slot })} ariaLabel="Chọn giờ bắt đầu" />
              </div>
              <div className="pl-16 text-4xl font-light leading-none">↓</div>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <DatePickerField date={endDate} min={absDayToDateInput(task.absDay)} value={absDayToDateInput(endAbsDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) patchAndMarkChanged({ endAbsDay: Math.max(task.absDay + 1, day) }); }} />
                <span className="text-sm text-zinc-500">Kết thúc</span>
                <HalfHourTimePicker value={getMultiDayEndSlot(task)} onChange={(slot) => patchAndMarkChanged({ endSlotIndex: slot })} ariaLabel="Chọn giờ kết thúc" />
              </div>
              <p className="sr-only">{dayShortOf(startDate)} đến {dayShortOf(endDate)}</p>
            </div>
          )}
        </div>

        <div className="px-[18px] py-5">
          {!isReadOnly && <div className="flex items-center gap-3 border-b border-white/15 pb-3">
            <SmallAvatar name={currentUser?.name ?? "Tôi"} avatar={currentUser?.avatar ?? null} />
            <input maxLength={2000} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitComment(); }} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-500" placeholder="Nhập bình luận..." />
            <button type="button" onClick={() => void submitComment()} disabled={!commentDraft.trim() || !currentUser || commentSending} aria-label="Gửi bình luận" className="flex h-8 w-8 items-center justify-center text-sky-400 transition disabled:cursor-not-allowed disabled:opacity-35">
              {commentSending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" aria-hidden /> : <span className="text-3xl">➤</span>}
            </button>
          </div>}
          {commentError && <p className="mt-2 text-xs text-red-400">{commentError}</p>}
          <button type="button" onClick={() => setCommentsOpen((open) => !open)} disabled={commentsLoading} aria-expanded={commentsOpen} className="mt-4 flex h-6 items-center gap-2 text-base font-bold disabled:cursor-default">
            {commentsLoading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent" aria-hidden /><span>Đang tải</span></> : <span>{commenters.length} comment</span>}
            {!commentsLoading && <svg viewBox="0 0 20 20" fill="none" className={`h-5 w-5 transition-transform ${commentsOpen ? "rotate-180" : ""}`} aria-hidden><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
          <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${commentsOpen ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}>
            <div className={`min-h-0 overflow-hidden ${commentsOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
              <div className="h-[220px] overflow-y-auto pr-2">
            {!commentsLoading && commenters.length === 0 ? (
              <div className="flex h-full items-center justify-center" aria-label="Chưa có bình luận">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/5 bg-white/[0.035] text-zinc-600 shadow-inner">
                  <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {commenters.map((comment) => (
                  <div key={comment.id} className={`flex gap-3 ${comment.id === newCommentId ? "schedule-comment-enter" : ""}`}>
                    <SmallAvatar name={comment.authorName} avatar={comment.authorAvatar} />
                    <div className="min-w-0 text-sm leading-snug">
                      <p>
                        <span className="font-bold">{comment.authorUserId === currentUser?.id ? "Tôi" : comment.authorName}</span>
                        <span className="ml-1 text-zinc-500">{commentTimeLabel(comment.createdAt)}</span>
                        {comment.authorUserId === currentUser?.id && <button type="button" onClick={() => void deleteComment(comment.id)} disabled={deletingCommentId === comment.id} className="ml-2 font-medium text-red-400 transition hover:text-red-300 disabled:opacity-50">{deletingCommentId === comment.id ? "Đang xóa" : "Xóa"}</button>}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-zinc-100">{comment.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
