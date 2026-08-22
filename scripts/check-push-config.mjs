import webpush from "web-push";
import { neon } from "@neondatabase/serverless";

const required = [
  "DATABASE_URL",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "PUSH_CRON_SECRET",
];

const missing = required.filter((name) => !process.env[name]);
console.log("Environment:", Object.fromEntries(required.map((name) => [name, process.env[name] ? "present" : "missing"])));
if (missing.length > 0) {
  console.error(`Missing variables: ${missing.join(", ")}`);
  process.exit(1);
}

try {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  console.log("VAPID format: valid");
} catch (error) {
  console.error("VAPID format: invalid -", error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).formatToParts(new Date()).reduce((result, part) => {
  result[part.type] = part.value;
  return result;
}, {});
const localDate = `${parts.year}-${parts.month}-${parts.day}`;
const absDay = Math.round((Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - Date.UTC(2026, 0, 1)) / 86_400_000);
const sql = neon(process.env.DATABASE_URL);
const configuredHour = Number(process.env.DAILY_PUSH_HOUR ?? "6");
const configuredMinute = Number(process.env.DAILY_PUSH_MINUTE ?? "0");
console.log("Daily reminder time:", `${String(configuredHour).padStart(2, "0")}:${String(configuredMinute).padStart(2, "0")} Asia/Ho_Chi_Minh`);

try {
  const [users, subscriptions, eligibleToday, dailyDeliveries, jobsToday] = await Promise.all([
    sql`SELECT COUNT(*)::integer AS count FROM schedule_users`,
    sql`SELECT COUNT(*)::integer AS count, COUNT(DISTINCT user_id)::integer AS users FROM schedule_push_subscriptions`,
    sql`SELECT COUNT(*)::integer AS count,
        COUNT(DISTINCT SPLIT_PART(scope_key, ':', 2))::integer AS users
      FROM schedule_task_entries
      WHERE scope_key LIKE 'USER:%'
        AND (data->>'absDay')::integer <= ${absDay}
        AND COALESCE((data->>'endAbsDay')::integer, (data->>'absDay')::integer) >= ${absDay}
        AND COALESCE(data->>'status', 'PENDING') <> 'DONE'`,
    sql`SELECT COUNT(*)::integer AS count FROM schedule_daily_push_deliveries WHERE local_date = ${localDate}`,
    sql`SELECT
        COUNT(*) FILTER (WHERE sent_at IS NULL)::integer AS pending,
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::integer AS sent
      FROM schedule_push_jobs
      WHERE created_at >= (${localDate}::date AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
  ]);
  console.log("Database:", {
    vietnamTime: `${localDate} ${parts.hour}:${parts.minute}`,
    users: users[0]?.count ?? 0,
    pushSubscriptions: subscriptions[0]?.count ?? 0,
    subscribedUsers: subscriptions[0]?.users ?? 0,
    eligibleTasksToday: eligibleToday[0]?.count ?? 0,
    usersWithEligibleTasks: eligibleToday[0]?.users ?? 0,
    dailyRemindersClaimed: dailyDeliveries[0]?.count ?? 0,
    pushJobsPendingToday: jobsToday[0]?.pending ?? 0,
    pushJobsSentToday: jobsToday[0]?.sent ?? 0,
  });
} catch (error) {
  console.error("Database check failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
