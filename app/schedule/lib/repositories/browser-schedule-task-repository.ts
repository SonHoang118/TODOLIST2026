import { ensureUniqueTaskIds } from "../domain/task";
import type { Task } from "../types";
import type { ScheduleTaskRepository } from "./schedule-task-repository";

const STORAGE_KEY = "todolist:schedule-tasks:v1";
const CHANNEL_NAME = "todolist:schedule-tasks";
const senderId = typeof crypto === "undefined" ? "server" : crypto.randomUUID();

type StoredTasks = { version: 1; tasks: Task[] };

function readTasks(raw: string | null): Task[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTasks>;
    return Array.isArray(parsed.tasks) ? ensureUniqueTaskIds(parsed.tasks as Task[]) : [];
  } catch {
    return [];
  }
}

/** Local-first adapter. Replace this class with an API adapter when cloud sync is introduced. */
export class BrowserScheduleTaskRepository implements ScheduleTaskRepository {
  async load(): Promise<Task[]> {
    if (typeof window === "undefined") return [];
    return readTasks(window.localStorage.getItem(STORAGE_KEY));
  }

  async save(tasks: Task[]): Promise<void> {
    if (typeof window === "undefined") return;
    const snapshot: StoredTasks = { version: 1, tasks };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  subscribe(listener: (tasks: Task[]) => void): () => void {
    if (typeof window === "undefined") return () => undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) listener(readTasks(event.newValue));
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
    const onMessage = (event: MessageEvent<{ senderId: string; tasks: Task[] }>) => {
      if (event.data.senderId !== senderId) listener(ensureUniqueTaskIds(event.data.tasks));
    };
    window.addEventListener("storage", onStorage);
    channel?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }

  announce(tasks: Task[]): void {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ senderId, tasks });
    channel.close();
  }
}
