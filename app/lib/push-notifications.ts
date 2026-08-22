import webpush from "web-push";
import { sql } from "./database";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  kind?: string;
  actorName?: string | null;
  taskId?: number | null;
  taskScope?: "USER" | "COMPANY" | null;
  taskOwnerUserId?: number | null;
};

type SubscriptionRow = {
  id: string | number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type JobRow = {
  id: string | number;
  recipient_user_id: string | number;
  title: string;
  body: string;
  target_url: string;
  kind: string | null;
  actor_name: string | null;
  task_id: string | number | null;
  task_scope: "USER" | "COMPANY" | null;
  task_owner_user_id: string | number | null;
  in_app_delivered_at: string | null;
};

type UserRow = { id: string | number };
type TodayTaskRow = { title: string };

export type DailyReminderResult = {
  checked: number;
  queued: number;
  empty: number;
  alreadyQueued: number;
  beforeScheduledTime: boolean;
  scheduledTime: string;
  localDate: string;
};

function targetUrlForJob(job: JobRow): string {
  if (job.task_id === null || job.task_scope === null) return job.target_url;
  const params = new URLSearchParams({
    notificationTaskId: String(job.task_id),
    notificationScope: job.task_scope,
  });
  if (job.task_scope === "USER" && job.task_owner_user_id !== null) {
    params.set("notificationOwnerId", String(job.task_owner_user_id));
  }
  return `/schedule?${params}`;
}

export async function ensurePushTables(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schedule_notifications (
    id BIGSERIAL PRIMARY KEY, recipient_user_id BIGINT NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, actor_name TEXT, task_id BIGINT,
    task_scope TEXT, task_owner_user_id BIGINT,
    push_job_id BIGINT UNIQUE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE schedule_notifications ADD COLUMN IF NOT EXISTS push_job_id BIGINT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS schedule_notifications_push_job_id_key ON schedule_notifications (push_job_id)`;
  await sql`CREATE TABLE IF NOT EXISTS schedule_push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS schedule_push_jobs (
    id BIGSERIAL PRIMARY KEY,
    recipient_user_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    target_url TEXT NOT NULL DEFAULT '/schedule',
    kind TEXT,
    actor_name TEXT,
    task_id BIGINT,
    task_scope TEXT,
    task_owner_user_id BIGINT,
    in_app_delivered_at TIMESTAMPTZ,
    available_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE schedule_push_jobs ADD COLUMN IF NOT EXISTS kind TEXT`;
  await sql`ALTER TABLE schedule_push_jobs ADD COLUMN IF NOT EXISTS actor_name TEXT`;
  await sql`ALTER TABLE schedule_push_jobs ADD COLUMN IF NOT EXISTS task_id BIGINT`;
  await sql`ALTER TABLE schedule_push_jobs ADD COLUMN IF NOT EXISTS task_scope TEXT`;
  await sql`ALTER TABLE schedule_push_jobs ADD COLUMN IF NOT EXISTS task_owner_user_id BIGINT`;
  await sql`ALTER TABLE schedule_push_jobs ADD COLUMN IF NOT EXISTS in_app_delivered_at TIMESTAMPTZ`;
  await sql`CREATE TABLE IF NOT EXISTS schedule_daily_push_deliveries (
    user_id BIGINT NOT NULL,
    local_date DATE NOT NULL,
    PRIMARY KEY (user_id, local_date)
  )`;
}

export async function queuePushNotification(recipientUserId: number, payload: PushPayload, delayMinutes = 5): Promise<void> {
  await ensurePushTables();
  await sql`INSERT INTO schedule_push_jobs (recipient_user_id, title, body, target_url, kind, actor_name, task_id, task_scope, task_owner_user_id, available_at)
    VALUES (${recipientUserId}, ${payload.title}, ${payload.body}, ${payload.url ?? "/schedule"}, ${payload.kind ?? null}, ${payload.actorName ?? null}, ${payload.taskId ?? null}, ${payload.taskScope ?? null}, ${payload.taskOwnerUserId ?? null}, NOW() + (${delayMinutes} * INTERVAL '1 minute'))`;
}

function configureWebPush(): boolean {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function vietnamNow(): { date: string; hour: number; minute: number; absDay: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const localMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const epoch = Date.UTC(2026, 0, 1);
  return { date, hour: Number(parts.hour), minute: Number(parts.minute), absDay: Math.round((localMidnight - epoch) / 86_400_000) };
}

function dailyReminderTime(): { hour: number; minute: number; label: string } {
  const parsedHour = Number(process.env.DAILY_PUSH_HOUR ?? "6");
  const parsedMinute = Number(process.env.DAILY_PUSH_MINUTE ?? "0");
  const hour = Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 6;
  const minute = Number.isInteger(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59 ? parsedMinute : 0;
  return { hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

async function queueDailyTodayTasks(): Promise<DailyReminderResult> {
  const now = vietnamNow();
  const scheduled = dailyReminderTime();
  const beforeScheduledTime = now.hour < scheduled.hour || (now.hour === scheduled.hour && now.minute < scheduled.minute);
  const result: DailyReminderResult = {
    checked: 0,
    queued: 0,
    empty: 0,
    alreadyQueued: 0,
    beforeScheduledTime,
    scheduledTime: scheduled.label,
    localDate: now.date,
  };
  // The scheduler normally runs at DAILY_PUSH_HOUR:DAILY_PUSH_MINUTE. If GitHub delays a run, send once
  // later that same day instead of silently missing the reminder.
  if (result.beforeScheduledTime) return result;
  const users = await sql`SELECT id FROM schedule_users` as UserRow[];
  for (const user of users) {
    const userId = Number(user.id);
    result.checked++;
    const rows = await sql`SELECT data->>'title' AS title FROM schedule_task_entries
      WHERE scope_key = ${`USER:${userId}`}
        AND (data->>'absDay')::integer <= ${now.absDay}
        AND COALESCE((data->>'endAbsDay')::integer, (data->>'absDay')::integer) >= ${now.absDay}
        AND COALESCE(data->>'status', 'PENDING') <> 'DONE'
      ORDER BY (data->>'slotIndex')::integer` as TodayTaskRow[];
    // Do not claim today's delivery when there is nothing to send. This keeps
    // later cron runs eligible if a task is added after 06:00.
    if (rows.length === 0) {
      result.empty++;
      continue;
    }
    const inserted = await sql`INSERT INTO schedule_daily_push_deliveries (user_id, local_date)
      VALUES (${userId}, ${now.date}) ON CONFLICT DO NOTHING RETURNING user_id` as UserRow[];
    if (inserted.length === 0) {
      result.alreadyQueued++;
      continue;
    }
    const names = rows.slice(0, 3).map((task) => task.title).join(" • ");
    const rest = rows.length > 3 ? ` và ${rows.length - 3} việc khác` : "";
    try {
      await queuePushNotification(userId, { title: `Hôm nay có ${rows.length} việc cần làm`, body: `${names}${rest}`, url: "/schedule" }, 0);
    } catch (error) {
      // Let the next cron run retry if creating the push job failed.
      await sql`DELETE FROM schedule_daily_push_deliveries WHERE user_id = ${userId} AND local_date = ${now.date}`;
      throw error;
    }
    result.queued++;
  }
  return result;
}

export async function dispatchDuePushNotifications(): Promise<{ sent: number; removed: number; daily: DailyReminderResult }> {
  if (!configureWebPush()) throw new Error("VAPID is not configured.");
  await ensurePushTables();
  const daily = await queueDailyTodayTasks();
  const jobs = await sql`SELECT id, recipient_user_id, title, body, target_url, kind, actor_name, task_id, task_scope, task_owner_user_id, in_app_delivered_at
    FROM schedule_push_jobs
    WHERE sent_at IS NULL AND available_at <= NOW()
    ORDER BY id
    LIMIT 100` as JobRow[];
  let sent = 0;
  let removed = 0;
  for (const job of jobs) {
    if (!job.in_app_delivered_at && job.kind) {
      await sql`INSERT INTO schedule_notifications (recipient_user_id, kind, title, body, actor_name, task_id, task_scope, task_owner_user_id, push_job_id)
        VALUES (${job.recipient_user_id}, ${job.kind}, ${job.title}, ${job.body}, ${job.actor_name}, ${job.task_id}, ${job.task_scope}, ${job.task_owner_user_id}, ${job.id})
        ON CONFLICT (push_job_id) DO NOTHING`;
      await sql`UPDATE schedule_push_jobs SET in_app_delivered_at = NOW() WHERE id = ${job.id}`;
    }
    const subscriptions = await sql`SELECT id, endpoint, p256dh, auth
      FROM schedule_push_subscriptions WHERE user_id = ${job.recipient_user_id}` as SubscriptionRow[];
    const payload = JSON.stringify({ title: job.title, body: job.body, url: targetUrlForJob(job), icon: "/logoApp.png" });
    let retry = false;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 60 * 12 });
        sent++;
      } catch (error) {
        const statusCode = error instanceof webpush.WebPushError ? error.statusCode : undefined;
        if (statusCode === 404 || statusCode === 410) {
          await sql`DELETE FROM schedule_push_subscriptions WHERE id = ${subscription.id}`;
          removed++;
        } else {
          retry = true;
        }
      }
    }
    if (retry) await sql`UPDATE schedule_push_jobs SET attempts = attempts + 1 WHERE id = ${job.id}`;
    else await sql`UPDATE schedule_push_jobs SET sent_at = NOW(), attempts = attempts + 1 WHERE id = ${job.id}`;
  }
  return { sent, removed, daily };
}
