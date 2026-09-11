// Incremental parser for OpenAI-style server-sent events (chat completion streams).

export interface SseParser {
  /** Feeds raw text and returns the content deltas completed by it. */
  push: (chunk: string) => string[];
  /** True once the `[DONE]` sentinel has been seen. */
  done: () => boolean;
}

export function createSseParser(): SseParser {
  let buffer = "";
  let finished = false;

  return {
    push(chunk) {
      buffer += chunk;
      const deltas: string[] = [];
      // Events are separated by a blank line; keep the trailing partial event in the buffer.
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            finished = true;
            continue;
          }
          try {
            const json = JSON.parse(data);
            const content = json?.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content) deltas.push(content);
          } catch {
            // Ignore keep-alive comments or malformed lines.
          }
        }
      }
      return deltas;
    },
    done: () => finished,
  };
}
