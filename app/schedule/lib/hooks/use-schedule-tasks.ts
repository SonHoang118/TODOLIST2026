"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiScheduleTaskRepository } from "../repositories/api-schedule-task-repository";
import type { ScheduleScope, Task } from "../types";

export function useScheduleTasks(scope: ScheduleScope, ownerId: number | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const skipNextSave = useRef(false);
  const repository = useMemo(() => new ApiScheduleTaskRepository(scope, ownerId), [scope, ownerId]);

  useEffect(() => {
    setIsLoading(true);
    setTasks([]);
    if (scope === "USER" && ownerId === null) {
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
      // Do not show a saving overlay while the user is still dragging/resizing.
      // The debounce callback can be cancelled repeatedly before a request starts.
      setIsSaving(true);
      void repository.save(tasks).catch(() => {
        // A realtime event or the next successful change will reconcile the optimistic UI.
      }).finally(() => {
        setIsSaving(false);
      });
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [isLoading, tasks]);

  return { tasks, setTasks, isLoading, isSaving };
}
