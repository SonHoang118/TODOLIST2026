import * as Ably from "ably";

export const runtime = "nodejs";

export async function GET() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return Response.json({ error: "Realtime is not configured." }, { status: 503 });

  const client = new Ably.Rest(key);
  const tokenRequest = await client.auth.createTokenRequest({
    clientId: crypto.randomUUID(),
    capability: { "schedule:*": ["subscribe"], users: ["subscribe"] },
  });
  return Response.json(tokenRequest, { headers: { "Cache-Control": "no-store" } });
}
