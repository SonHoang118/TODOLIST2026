"use client";

import { useEffect, useRef, useState } from "react";
import { ApiScheduleTaskRepository } from "../repositories/api-schedule-task-repository";
import type { Task } from "../types";

const repository = new ApiScheduleTaskRepository();

export function useScheduleTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const skipNextSave = useRef(false);

  useEffect(() => {
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
  }, []);

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
