import { dispatchDuePushNotifications } from "../../../lib/push-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.PUSH_CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await dispatchDuePushNotifications()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to dispatch push notifications." }, { status: 500 });
  }
}
