// Streams an answer from an open model on Hugging Face Inference Providers.
// The response body is plain UTF-8 text, streamed as it is generated.

import { guard, jsonError } from "@/lib/server/guard";
import { voiceConfig } from "@/lib/voice/config";
import { systemPrompt } from "@/lib/voice/knowledge";
import { createSseParser } from "@/lib/voice/sse";

export const maxDuration = 30;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function parseMessages(body: unknown): ChatMessage[] | null {
  const { maxMessages, maxMessageChars } = voiceConfig.limits;
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > maxMessages) return null;
  const clean: ChatMessage[] = [];
  for (const m of messages) {
    const role = (m as ChatMessage)?.role;
    const content = (m as ChatMessage)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim().slice(0, maxMessageChars);
    if (!text) return null;
    clean.push({ role, content: text });
  }
  return clean[clean.length - 1].role === "user" ? clean : null;
}

export async function POST(req: Request) {
  const { token, url, model, maxTokens } = voiceConfig.llm;
  if (!token) return jsonError(503, "not_configured", "The assistant is not configured.");

  const blocked = await guard(req, { name: "chat", perMinute: 8, perDay: 60, globalPerDay: 600 });
  if (blocked) return blocked;

  const messages = parseMessages(await req.json().catch(() => null));
  if (!messages) return jsonError(400, "bad_request", "The conversation could not be read.");

  const upstream = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [{ role: "system", content: systemPrompt() }, ...messages],
    }),
    signal: req.signal,
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("[voice/chat] LLM request failed", upstream.status, detail.slice(0, 500));
    if (upstream.status === 402) return jsonError(503, "out_of_credits", "The assistant has used up its credits for now.");
    if (upstream.status === 429) return jsonError(429, "rate_limited", "The assistant is busy. Try again in a moment.");
    return jsonError(502, "upstream_error", "The assistant could not answer right now.");
  }

  // Convert the provider's SSE stream into a plain text stream of content deltas.
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const text = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const delta of parser.push(decoder.decode(chunk, { stream: true }))) {
          controller.enqueue(encoder.encode(delta));
        }
      },
    }),
  );

  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
