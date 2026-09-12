// TEMPORARY diagnostic endpoint.
// Reports whether each environment variable reaches the server, never its value.
// Delete this file once the configuration is confirmed.

const NAMES = [
  "DEEPGRAM_API_KEY",
  "HF_TOKEN",
  "HF_MODEL",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

export const dynamic = "force-dynamic";

export function GET() {
  const report = Object.fromEntries(
    NAMES.map((name) => {
      const raw = process.env[name];
      if (raw === undefined) return [name, "MISSING"];
      const value = raw.trim();
      if (!value) return [name, "EMPTY"];
      const whitespace = raw !== value ? " + SURROUNDING WHITESPACE" : "";
      const quotes = /^["'].*["']$/.test(value) ? " + WRAPPED IN QUOTES" : "";
      return [name, `ok: ${value.length} chars, starts "${value.slice(0, 3)}"${whitespace}${quotes}`];
    }),
  );

  return Response.json(
    {
      report,
      // Names only, to see what Vercel injected at all.
      otherVariableNames: Object.keys(process.env)
        .filter((k) => !/^(npm_|NEXT_|__|PATH$|HOME$|NODE|AWS|LAMBDA|_HANDLER|TZ$|LANG$|PWD$|SHLVL$)/.test(k))
        .sort(),
      deploymentEnvironment: process.env.VERCEL_ENV ?? "not running on Vercel",
      deploymentUrl: process.env.VERCEL_URL ?? "unknown",
      projectName: process.env.VERCEL_PROJECT_NAME ?? "unknown",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
