"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiScheduleTaskRepository } from "../repositories/api-schedule-task-repository";
import type { ScheduleScope, Task } from "../types";

export function useScheduleTasks(scope: ScheduleScope, ownerId: number | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const skipNextSave = useRef(false);
  const repository = useMemo(() => new ApiScheduleTaskRepository(scope, ownerId), [scope, ownerId]);

  useEffect(() => {
    if (scope === "USER" && ownerId === null) {
      setTasks([]);
      setIsLoading(true);
      return;
    }
    let active = true;
    const unsubscribe = repository.subscribe((nextTasks) => {
      skipNextSave.current = true;
      setTasks(nextTasks);
    });
    void repository.load().then((savedTasks) => {
      if (!active) return;
      setTasks(savedTasks);
      setIsLoading(false);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [ownerId, repository, scope]);

  useEffect(() => {
    if (isLoading) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void repository.save(tasks).catch(() => {
        // A realtime event or the next successful change will reconcile the optimistic UI.
      });
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [isLoading, tasks]);

  return { tasks, setTasks, isLoading };
}
