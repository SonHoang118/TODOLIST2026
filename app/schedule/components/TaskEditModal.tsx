"use client";

import { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { SLOTS, STATUS_LABEL } from "../lib/constants";
import { absDayToDate, absDayToDateInput, dateInputToAbsDay, dayShortOf, slotLabel, slotToTimeInput, timeInputToSlot } from "../lib/date";
import { colorToPickerHex } from "../lib/domain/task";
import { getMultiDayEndSlot, isMultiDayTask } from "../lib/multi-day";
import type { SessionUser, Task } from "../lib/types";

interface TaskEditModalProps {
  task: Task;
  isCompanySchedule: boolean;
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

export function TaskEditModal({ task, isCompanySchedule, users, currentUser, onClose, onDelete, onAccept, onPatch }: TaskEditModalProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const pickerRef = useRef<HTMLDivElement>(null);
  const isMultiDay = isMultiDayTask(task);
  const startDate = absDayToDate(task.absDay);
  const endAbsDay = task.endAbsDay ?? task.absDay;
  const endDate = absDayToDate(endAbsDay);
  const taskColor = colorToPickerHex(task.color);
  const ownerName = task.createdByName ?? task.assignedFromName ?? currentUser?.name ?? "Người tạo task";
  const ownerAvatar = task.createdByAvatar ?? currentUser?.avatar ?? null;
  const commenters = [
    { name: ownerName, avatar: ownerAvatar, time: "5 phút trước", text: "À! chiều nhớ cầm thêm bản sau khi chỉnh sửa đi nhé mọi người." },
    { name: "Tôi", avatar: currentUser?.avatar ?? null, time: "20 phút trước", text: "Có cần cầm thêm gì không ạ ?" },
    { name: "Nguyễn Minh Anh", avatar: null, time: "32 phút trước", text: "Mình đã kiểm tra lại hồ sơ, phần thông tin khách hàng đã đầy đủ rồi nhé." },
    { name: "Trần Hoàng", avatar: null, time: "45 phút trước", text: "Mọi người nhớ mang theo bản gốc để đối chiếu." },
    { name: ownerName, avatar: ownerAvatar, time: "1 giờ trước", text: "Mình sẽ đến sớm khoảng 10 phút để chuẩn bị." },
    { name: "Tôi", avatar: currentUser?.avatar ?? null, time: "2 giờ trước", text: "Vâng ạ, em đã ghi chú lại rồi." },
  ];
  const confirmedUsers = task.confirmedByUserIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is SessionUser => Boolean(user));

  useEffect(() => {
    if (!pickerOpen) return;
    const closePicker = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [pickerOpen]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <section className="relative max-h-[94vh] w-full max-w-[455px] overflow-y-auto rounded-xl bg-[#242424] text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div ref={pickerRef} className="relative">
          <button
            type="button"
            className="block h-[68px] w-full rounded-t-xl transition-[filter] hover:brightness-110"
            style={{ backgroundColor: taskColor }}
            onClick={() => setPickerOpen((open) => !open)}
            aria-label="Đổi màu công việc"
          />
          {pickerOpen && (
            <div className="absolute left-5 top-14 z-20 rounded-xl bg-zinc-900 p-3 shadow-2xl ring-1 ring-white/15">
              <HexColorPicker color={taskColor} onChange={(color) => onPatch({ color })} />
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-300">
                <span>Màu công việc</span><span className="font-mono uppercase">{taskColor}</span>
              </div>
            </div>
          )}
          <button type="button" onClick={onClose} aria-label="Đóng" className="absolute right-4 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-4xl font-light leading-none hover:bg-black/45">×</button>
        </div>

        <div className="flex h-16 items-center justify-between border-b border-white/15 px-[18px]">
          {isCompanySchedule ? (
            <div className="flex min-w-0 items-center gap-2 text-sm font-bold">
              <span className="text-xl">⌄</span><span>Đã xác nhận</span>
              <div className="flex -space-x-2">
                {(confirmedUsers.length > 0 ? confirmedUsers : users.slice(0, 3)).map((user) => (
                  <img key={user.id} src={user.avatar} alt={user.name} title={user.name} className="h-6 w-6 rounded-full border-2 border-[#242424] object-cover" />
                ))}
              </div>
            </div>
          ) : (
            task.assignedFromName && task.status === "PENDING" ? (
              <button type="button" onClick={onAccept} className="rounded-md bg-violet-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-violet-500">Nhận</button>
            ) : (
              <span className="rounded-md bg-[#5b4932] px-5 py-2 text-sm font-semibold text-amber-500">
                {task.status === "PENDING" ? "Đang chờ" : STATUS_LABEL[task.status]}
              </span>
            )
          )}
          <button type="button" onClick={onDelete} className="rounded-md bg-red-500 px-5 py-2 text-sm font-bold transition hover:bg-red-600">Xóa</button>
        </div>

        <div className="border-b border-white/15 px-[18px] py-5">
          <div className="flex items-center gap-4">
            <LargeAvatar name={ownerName} avatar={ownerAvatar} />
            <textarea rows={1} defaultValue={task.title} onBlur={(event) => onPatch({ title: event.target.value })} className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-base font-bold leading-snug outline-none [field-sizing:content]" placeholder="Tên công việc" />
            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-sm text-zinc-300">×</span>
          </div>
          <textarea defaultValue={task.description} onBlur={(event) => onPatch({ description: event.target.value })} className="mt-3 h-[60px] w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 outline-none" placeholder="Nhập mô tả" />
        </div>

        <div className="border-b border-white/15 px-[18px] py-4">
          <label className="flex cursor-pointer items-center gap-4 text-xl font-bold">
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(event) => onPatch(event.target.checked
                ? { endAbsDay: task.absDay + 1, endSlotIndex: Math.min(SLOTS - 1, task.slotIndex + task.span) }
                : { endAbsDay: undefined, endSlotIndex: undefined })}
              className="h-5 w-5 accent-purple-600"
            />
            Task nhiều ngày
          </label>

          {!isMultiDay ? (
            <div className="mt-6 flex items-center justify-between gap-3 text-lg font-bold">
              <DatePickerField date={startDate} value={absDayToDateInput(task.absDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) onPatch({ absDay: day }); }} />
              <div className="grid grid-cols-[72px_12px_auto_auto] items-center gap-2 whitespace-nowrap">
                <input type="time" step="1800" value={slotToTimeInput(task.slotIndex)} onChange={(event) => { const slot = timeInputToSlot(event.target.value); if (slot !== null) onPatch({ slotIndex: slot }); }} className="w-[72px] bg-transparent outline-none [color-scheme:dark]" />
                <span className="text-center">-</span><span>{slotLabel(task.slotIndex + task.span)}</span><span className="text-sm text-zinc-500">{task.span * 30} phút</span>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4 text-lg font-bold">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <DatePickerField date={startDate} value={absDayToDateInput(task.absDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) onPatch({ absDay: day, endAbsDay: Math.max(day + 1, endAbsDay) }); }} />
                <span className="text-sm text-zinc-500">Bắt đầu</span>
                <input type="time" step="1800" value={slotToTimeInput(task.slotIndex)} onChange={(event) => { const slot = timeInputToSlot(event.target.value); if (slot !== null) onPatch({ slotIndex: slot }); }} className="w-[72px] bg-transparent outline-none [color-scheme:dark]" />
              </div>
              <div className="pl-16 text-4xl font-light leading-none">↓</div>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                <DatePickerField date={endDate} min={absDayToDateInput(task.absDay)} value={absDayToDateInput(endAbsDay)} onChange={(value) => { const day = dateInputToAbsDay(value); if (day !== null) onPatch({ endAbsDay: Math.max(task.absDay + 1, day) }); }} />
                <span className="text-sm text-zinc-500">Kết thúc</span>
                <input type="time" step="1800" value={slotToTimeInput(getMultiDayEndSlot(task))} onChange={(event) => { const slot = timeInputToSlot(event.target.value); if (slot !== null) onPatch({ endSlotIndex: slot }); }} className="w-[72px] bg-transparent outline-none [color-scheme:dark]" />
              </div>
              <p className="sr-only">{dayShortOf(startDate)} đến {dayShortOf(endDate)}</p>
            </div>
          )}
        </div>

        <div className="px-[18px] py-5">
          <div className="flex items-center gap-3 border-b border-white/15 pb-3">
            <SmallAvatar name={currentUser?.name ?? "Tôi"} avatar={currentUser?.avatar ?? null} />
            <input className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-500" placeholder="Nhập gì đó ..." />
            <button type="button" aria-label="Gửi bình luận" className="text-3xl text-sky-400">➤</button>
          </div>
          <button type="button" onClick={() => setCommentsOpen((open) => !open)} aria-expanded={commentsOpen} className="mt-4 flex items-center gap-2 text-base font-bold">
            {commenters.length} comment
            <svg viewBox="0 0 20 20" fill="none" className={`h-5 w-5 transition-transform ${commentsOpen ? "rotate-180" : ""}`} aria-hidden><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {commentsOpen && <div className="mt-4 max-h-[220px] space-y-7 overflow-y-auto pr-2">
            {commenters.map((comment) => (
              <div key={`${comment.name}-${comment.time}`} className="flex gap-3">
                <SmallAvatar name={comment.name} avatar={comment.avatar} />
                <div className="min-w-0 text-sm leading-snug">
                  <p><span className="font-bold">{comment.name}</span> <span className="ml-1 text-zinc-500">{comment.time}</span></p>
                  <p className="mt-1 text-zinc-100">{comment.text}</p>
                </div>
              </div>
            ))}
          </div>}
        </div>
      </section>
    </div>
  );
}
