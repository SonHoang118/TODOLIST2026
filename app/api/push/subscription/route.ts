import { ensurePushTables } from "../../../lib/push-notifications";
import { sql } from "../../../lib/database";

export const runtime = "nodejs";

type SubscriptionBody = { userId?: number; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };

function valid(body: SubscriptionBody): body is Required<SubscriptionBody> & { subscription: { endpoint: string; keys: { p256dh: string; auth: string } } } {
  return Number.isSafeInteger(body.userId) && (body.userId ?? 0) > 0 && typeof body.subscription?.endpoint === "string" && typeof body.subscription.keys?.p256dh === "string" && typeof body.subscription.keys?.auth === "string";
}

export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return Response.json({ error: "Push notifications are not configured." }, { status: 503 });
  return Response.json({ publicKey });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as SubscriptionBody | null;
  if (!body || !valid(body)) return Response.json({ error: "Invalid subscription." }, { status: 400 });
  await ensurePushTables();
  await sql`INSERT INTO schedule_push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${body.userId}, ${body.subscription.endpoint}, ${body.subscription.keys.p256dh}, ${body.subscription.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = NOW()`;
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as { endpoint?: string } | null;
  if (!body?.endpoint) return Response.json({ error: "Invalid subscription." }, { status: 400 });
  await ensurePushTables();
  await sql`DELETE FROM schedule_push_subscriptions WHERE endpoint = ${body.endpoint}`;
  return Response.json({ ok: true });
}
