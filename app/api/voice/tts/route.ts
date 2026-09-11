// Synthesizes one sentence with ElevenLabs and streams the MP3 back.

import { consumeDailyBudget } from "@/lib/server/rate-limit";
import { guard, jsonError } from "@/lib/server/guard";
import { voiceConfig } from "@/lib/voice/config";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { apiKey, apiUrl, voiceId, model, dailyCharacters } = voiceConfig.tts;
  if (!apiKey) return jsonError(503, "not_configured", "Voice replies are not configured.");

  // Replies are split into sentences, so this route sees several calls per answer.
  const blocked = await guard(req, { name: "tts", perMinute: 40, perDay: 400, globalPerDay: 4000 });
  if (blocked) return blocked;

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, voiceConfig.limits.maxTtsChars) : "";
  if (!text) return jsonError(400, "bad_request", "There is no text to read.");

  if (!(await consumeDailyBudget("tts:characters", text.length, dailyCharacters))) {
    return jsonError(429, "daily_limit", "Voice replies have reached their daily limit.");
  }

  const upstream = await fetch(
    `${apiUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
      signal: req.signal,
      cache: "no-store",
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("[voice/tts] ElevenLabs request failed", upstream.status, detail.slice(0, 500));
    if (upstream.status === 401 || upstream.status === 402) {
      return jsonError(503, "out_of_credits", "Voice replies are unavailable right now.");
    }
    return jsonError(502, "upstream_error", "Voice replies are unavailable right now.");
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
