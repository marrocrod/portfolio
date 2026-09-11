// Server-side configuration for the voice assistant. Every value can be
// overridden with an environment variable; the defaults are sensible starting points.

import "server-only";

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const voiceConfig = {
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY,
    apiUrl: env("DEEPGRAM_API_URL", "https://api.deepgram.com"),
    wsUrl: env("DEEPGRAM_WS_URL", "wss://api.deepgram.com/v1/listen"),
  },
  llm: {
    token: process.env.HF_TOKEN,
    url: env("HF_ROUTER_URL", "https://router.huggingface.co/v1/chat/completions"),
    // Any chat model served by Hugging Face Inference Providers. The suffix picks the provider policy.
    model: env("HF_MODEL", "meta-llama/Llama-3.3-70B-Instruct:fastest"),
    maxTokens: num("LLM_MAX_TOKENS", 260),
  },
  tts: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    apiUrl: env("ELEVENLABS_API_URL", "https://api.elevenlabs.io"),
    voiceId: env("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
    model: env("ELEVENLABS_MODEL", "eleven_flash_v2_5"),
    /** Site-wide daily cap on synthesized characters, to keep costs bounded. */
    dailyCharacters: num("DAILY_TTS_CHARACTERS", 5000),
  },
  limits: {
    maxMessages: 20,
    maxMessageChars: 600,
    maxTtsChars: 400,
  },
};
