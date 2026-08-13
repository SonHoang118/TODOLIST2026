import type { Task } from "../types";

/** Port for task persistence. A server/API adapter will implement this same contract. */
export interface ScheduleTaskRepository {
  load(): Promise<Task[]>;
  save(tasks: Task[]): Promise<void>;
  subscribe(listener: (tasks: Task[]) => void): () => void;
}
