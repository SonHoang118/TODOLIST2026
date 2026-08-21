"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiScheduleTaskRepository } from "../repositories/api-schedule-task-repository";
import type { ScheduleScope, Task } from "../types";

export function useScheduleTasks(scope: ScheduleScope, ownerId: number | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeDataKey, setActiveDataKey] = useState<string | null>(null);
  const skipNextSave = useRef(false);
  const repository = useMemo(() => new ApiScheduleTaskRepository(scope, ownerId), [scope, ownerId]);
  const requestedDataKey = `${scope}:${ownerId ?? "company"}`;

  useEffect(() => {
    if (scope === "USER" && ownerId === null) {
      setActiveDataKey(null);
      setIsLoading(true);
      return;
    }
    const cachedTasks = repository.loadCached();
    skipNextSave.current = true;
    if (cachedTasks) {
      setTasks(cachedTasks);
      setActiveDataKey(requestedDataKey);
      setIsLoading(false);
    } else {
      setTasks([]);
      setActiveDataKey(requestedDataKey);
      setIsLoading(true);
    }
    let active = true;
    const unsubscribe = repository.subscribe((nextTasks) => {
      skipNextSave.current = true;
      setTasks(nextTasks);
    });
    void repository.load().then((savedTasks) => {
      if (!active) return;
      skipNextSave.current = true;
      setTasks(savedTasks);
      setIsLoading(false);
    }).catch(() => { if (active && cachedTasks) setIsLoading(false); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [ownerId, repository, requestedDataKey, scope]);

  useEffect(() => {
    if (isLoading) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    // Stage state immediately; the repository coalesces rapid updates into the latest
    // snapshot, preventing an older acknowledgement from replacing newer local UI.
    void repository.save(tasks).catch(() => undefined);
  }, [isLoading, repository, tasks]);

  return { tasks, setTasks, isLoading, isReady: activeDataKey === requestedDataKey };
}
