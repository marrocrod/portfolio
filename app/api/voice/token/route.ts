// Issues a short-lived Deepgram token so the browser can stream audio directly to
// Deepgram without ever seeing the API key.

import { guard, jsonError } from "@/lib/server/guard";
import { voiceConfig } from "@/lib/voice/config";

export async function POST(req: Request) {
  const { apiKey, apiUrl, wsUrl } = voiceConfig.deepgram;
  if (!apiKey) return jsonError(503, "not_configured", "Voice input is not configured.");

  const blocked = await guard(req, { name: "stt", perMinute: 10, perDay: 80, globalPerDay: 800 });
  if (blocked) return blocked;

  const res = await fetch(`${apiUrl}/v1/auth/grant`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    // The token only needs to be valid while the WebSocket connects.
    body: JSON.stringify({ ttl_seconds: 30 }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("[voice/token] Deepgram grant failed", res.status, await res.text().catch(() => ""));
    return jsonError(502, "upstream_error", "Voice input is unavailable right now.");
  }
  const { access_token } = (await res.json()) as { access_token: string };
  return Response.json({ token: access_token, url: wsUrl }, { headers: { "Cache-Control": "no-store" } });
}
