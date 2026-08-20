"use client";

import * as Ably from "ably";
import { ensureUniqueTaskIds } from "../domain/task";
import type { ScheduleScope, Task } from "../types";
import type { ScheduleTaskRepository } from "./schedule-task-repository";

type TaskEvent = { tasks: Task[]; deletedIds: number[] };
type MutationResponse = { tasks: Task[]; deletedIds: number[] };

function taskSignature(task: Task): string {
  const content = { ...task };
  delete content.version;
  delete content.updatedAt;
  return JSON.stringify(content);
}

/** Cloud-backed task repository. Neon is the only source of task data. */
export class ApiScheduleTaskRepository implements ScheduleTaskRepository {
  private knownTasks = new Map<number, Task>();
  private client: Ably.Realtime | null = null;
  private channel: Ably.RealtimeChannel | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly scope: ScheduleScope, private readonly ownerId: number | null) {}

  async load(): Promise<Task[]> {
    const cloudTasks = await this.fetchCloudTasks();
    this.remember(cloudTasks);
    return cloudTasks;
  }

  save(tasks: Task[]): Promise<void> {
    const snapshot = ensureUniqueTaskIds(tasks);
    this.writeChain = this.writeChain.then(() => this.write(snapshot));
    return this.writeChain;
  }

  subscribe(listener: (tasks: Task[]) => void): () => void {
    const client = new Ably.Realtime({ authUrl: "/api/realtime/token" });
    const channel = client.channels.get(this.channelName());
    const onMessage = (message: Ably.Message) => {
      const event = message.data as TaskEvent;
      if (!event || !Array.isArray(event.tasks) || !Array.isArray(event.deletedIds)) return;
      const next = new Map(this.knownTasks);
      event.deletedIds.forEach((id) => next.delete(id));
      event.tasks.forEach((task) => next.set(task.id, task));
      const snapshot = ensureUniqueTaskIds([...next.values()]);
      this.remember(snapshot);
      listener(snapshot);
    };

    channel.subscribe("tasks.changed", onMessage);
    this.client = client;
    this.channel = channel;
    // Keeps shared data usable if realtime credentials are temporarily unavailable.
    const pollId = window.setInterval(() => {
      void this.fetchCloudTasks()
        .then((tasks) => {
          this.remember(tasks);
          listener(tasks);
        })
        .catch(() => undefined);
    }, 2_000);
    return () => {
      window.clearInterval(pollId);
      void channel.unsubscribe("tasks.changed", onMessage);
      client.close();
      if (this.client === client) {
        this.client = null;
        this.channel = null;
      }
    };
  }

  private async write(nextTasks: Task[]): Promise<void> {
    const changes = nextTasks.filter((task) => {
      const previous = this.knownTasks.get(task.id);
      return !previous || taskSignature(previous) !== taskSignature(task);
    });
    const nextIds = new Set(nextTasks.map((task) => task.id));
    const deletedIds = [...this.knownTasks.keys()].filter((id) => !nextIds.has(id));
    if (changes.length === 0 && deletedIds.length === 0) return;

    const response = await fetch("/api/schedule/tasks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes, deletedIds, scope: this.scope, ownerId: this.ownerId }),
    });
    if (!response.ok) {
      const message = response.status === 409 ? "Lịch vừa được người khác thay đổi. Đang tải lại dữ liệu mới nhất." : "Không thể lưu lịch chung.";
      throw new Error(message);
    }
    const result = (await response.json()) as MutationResponse;
    const next = new Map(this.knownTasks);
    result.deletedIds.forEach((id) => next.delete(id));
    result.tasks.forEach((task) => next.set(task.id, task));
    this.remember([...next.values()]);
  }

  private remember(tasks: Task[]): void {
    this.knownTasks = new Map(tasks.map((task) => [task.id, task]));
  }

  private async fetchCloudTasks(): Promise<Task[]> {
    const response = await fetch(`/api/schedule/tasks?${new URLSearchParams({ scope: this.scope, ...(this.scope === "USER" && this.ownerId !== null ? { ownerId: String(this.ownerId) } : {}) })}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Không thể tải lịch chung.");
    return ensureUniqueTaskIds((await response.json()) as Task[]);
  }

  private channelName(): string {
    return this.scope === "COMPANY" ? "schedule:company" : `schedule:user:${this.ownerId}`;
  }
}
