"use client";

import * as Ably from "ably";
import { ensureUniqueTaskIds } from "../domain/task";
import type { ScheduleScope, Task } from "../types";
import type { ScheduleTaskRepository } from "./schedule-task-repository";

type TaskEvent = { tasks: Task[]; deletedIds: number[] };

function signature(task: Task): string {
  const value = { ...task };
  delete value.version; delete value.updatedAt; delete value.commentCount;
  return JSON.stringify(value);
}

/** Cloud repository with a pending layer that prevents remote events overwriting local UI. */
export class ApiScheduleTaskRepository implements ScheduleTaskRepository {
  private known = new Map<number, Task>();
  private desired: Task[] | null = null;
  private listener: ((tasks: Task[]) => void) | null = null;
  private drainPromise: Promise<void> | null = null;
  private revision = 0;

  constructor(private readonly scope: ScheduleScope, private readonly ownerId: number | null) {}

  async load(): Promise<Task[]> {
    const tasks = await this.fetchCloud();
    this.remember(tasks);
    return tasks;
  }

  loadCached(): Task[] | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.cacheKey()) ?? "null") as { tasks?: Task[] } | null;
      return Array.isArray(parsed?.tasks) ? ensureUniqueTaskIds(parsed.tasks) : null;
    } catch { return null; }
  }

  save(tasks: Task[]): Promise<void> {
    this.desired = ensureUniqueTaskIds(tasks);
    this.revision += 1;
    if (!this.drainPromise) this.drainPromise = this.drain().finally(() => { this.drainPromise = null; });
    return this.drainPromise;
  }

  subscribe(listener: (tasks: Task[]) => void): () => void {
    this.listener = listener;
    const client = new Ably.Realtime({ authUrl: "/api/realtime/token" });
    const channel = client.channels.get(this.channelName());
    let pollId: number | null = null;
    const stopPolling = () => { if (pollId !== null) clearInterval(pollId); pollId = null; };
    const reconcile = () => void this.fetchCloud().then((tasks) => { this.remember(tasks); this.emit(); }).catch(() => undefined);
    const startPolling = () => { if (pollId === null) pollId = window.setInterval(reconcile, 10_000); };
    const onMessage = (message: Ably.Message) => {
      const event = message.data as TaskEvent;
      if (!event || !Array.isArray(event.tasks) || !Array.isArray(event.deletedIds)) return;
      event.deletedIds.forEach((id) => this.known.delete(id));
      event.tasks.forEach((task) => this.known.set(task.id, task));
      this.cache([...this.known.values()]);
      this.emit();
    };
    const onConnected = () => { stopPolling(); reconcile(); };
    const onDisconnected = () => startPolling();
    channel.subscribe("tasks.changed", onMessage);
    client.connection.on("connected", onConnected);
    client.connection.on("disconnected", onDisconnected);
    client.connection.on("suspended", onDisconnected);
    client.connection.on("failed", onDisconnected);
    return () => {
      stopPolling(); this.listener = null;
      void channel.unsubscribe("tasks.changed", onMessage);
      client.close();
    };
  }

  private async drain(): Promise<void> {
    let didRetryConflict = false;
    while (this.desired) {
      const revision = this.revision;
      try {
        await this.write(this.desired);
        didRetryConflict = false;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "CONFLICT" || didRetryConflict) throw error;
        didRetryConflict = true;
        this.remember(await this.fetchCloud());
        continue;
      }
      if (revision === this.revision) {
        this.desired = null;
        this.emit();
        return;
      }
    }
  }

  private async write(nextTasks: Task[]): Promise<void> {
    const changes = nextTasks.filter((task) => !this.known.has(task.id) || signature(this.known.get(task.id)!) !== signature(task))
      .map((task) => {
        const server = this.known.get(task.id);
        return server ? { ...task, version: server.version, updatedAt: server.updatedAt } : task;
      });
    const nextIds = new Set(nextTasks.map((task) => task.id));
    const deletedIds = [...this.known.keys()].filter((id) => !nextIds.has(id));
    if (!changes.length && !deletedIds.length) return;
    const response = await fetch("/api/schedule/tasks", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes, deletedIds, scope: this.scope, ownerId: this.ownerId }),
    });
    if (!response.ok) throw new Error(response.status === 409 ? "CONFLICT" : "SAVE_FAILED");
    const result = await response.json() as TaskEvent;
    result.deletedIds.forEach((id) => this.known.delete(id));
    result.tasks.forEach((task) => this.known.set(task.id, task));
    this.cache([...this.known.values()]);
  }

  private emit(): void {
    if (!this.listener) return;
    if (!this.desired) return this.listener(ensureUniqueTaskIds([...this.known.values()]));
    this.listener(ensureUniqueTaskIds(this.desired.map((task) => {
      const server = this.known.get(task.id);
      return server ? { ...task, version: server.version, updatedAt: server.updatedAt, commentCount: server.commentCount ?? task.commentCount } : task;
    })));
  }

  private remember(tasks: Task[]): void { this.known = new Map(tasks.map((task) => [task.id, task])); this.cache(tasks); }
  private cache(tasks: Task[]): void { try { localStorage.setItem(this.cacheKey(), JSON.stringify({ tasks, savedAt: Date.now() })); } catch {} }
  private cacheKey(): string { return `dhs-todo:schedule-cache:${this.scope}:${this.ownerId ?? "company"}`; }
  private channelName(): string { return this.scope === "COMPANY" ? "schedule:company" : `schedule:user:${this.ownerId}`; }
  private async fetchCloud(): Promise<Task[]> {
    const query = new URLSearchParams({ scope: this.scope, ...(this.scope === "USER" && this.ownerId !== null ? { ownerId: String(this.ownerId) } : {}) });
    const response = await fetch(`/api/schedule/tasks?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    return ensureUniqueTaskIds(await response.json() as Task[]);
  }
}
