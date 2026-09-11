// Streams microphone audio to Deepgram and reports live transcripts.
// Audio is captured as 16-bit PCM with an AudioWorklet, which works the same in every
// modern browser (MediaRecorder containers differ between Chrome, Firefox and Safari).

export interface TranscriberEvents {
  /** Current best guess for the whole utterance so far (finalized + interim words). */
  onTranscript: (text: string) => void;
  /** The speaker paused long enough for the turn to be over. */
  onUtteranceEnd: (text: string) => void;
  /** Microphone level between 0 and 1, for a visual meter. */
  onLevel: (level: number) => void;
  onError: (message: string) => void;
}

const WORKLET = `
class PcmProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(2048);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-processor", PcmProcessor);
`;

export class TranscriberError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "rate_limited" | "mic_denied" | "mic_missing" | "connection",
  ) {
    super(message);
  }
}

async function fetchToken(): Promise<{ token: string; url: string }> {
  const res = await fetch("/api/voice/token", { method: "POST" });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  if (res.status === 503) throw new TranscriberError(body.message ?? "Voice input is not configured.", "not_configured");
  if (res.status === 429) throw new TranscriberError(body.message ?? "Too many requests.", "rate_limited");
  throw new TranscriberError(body.message ?? "Voice input is unavailable right now.", "connection");
}

function openSocket(url: string, token: string): Promise<WebSocket> {
  // Browsers can't set an Authorization header on WebSockets, so the token travels as a
  // subprotocol. If that handshake is refused, retry once with the query parameter form.
  const attempt = (ws: WebSocket) =>
    new Promise<WebSocket>((resolve, reject) => {
      ws.binaryType = "arraybuffer";
      ws.onopen = () => resolve(ws);
      ws.onclose = () => reject(new Error("closed before open"));
      ws.onerror = () => undefined; // onclose follows
    });
  return attempt(new WebSocket(url, ["bearer", token])).catch(() => {
    const sep = url.includes("?") ? "&" : "?";
    return attempt(new WebSocket(`${url}${sep}access_token=${encodeURIComponent(token)}`));
  });
}

export class LiveTranscriber {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private finalized = "";
  private interim = "";
  private stopped = false;
  private ended = false;

  constructor(private events: TranscriberEvents) {}

  async start(): Promise<void> {
    // Ask for the microphone first so a denied permission doesn't spend a token.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotFoundError") throw new TranscriberError("No microphone was found on this device.", "mic_missing");
      throw new TranscriberError("Microphone access is blocked. Allow it in your browser's site settings.", "mic_denied");
    }
    if (this.stopped) return this.cleanup();

    const ctx = new AudioContext();
    this.ctx = ctx;
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }

    let ws: WebSocket;
    try {
      const { token, url } = await fetchToken();
      if (this.stopped) return this.cleanup();
      const params = new URLSearchParams({
        model: "nova-3",
        language: "multi", // English/Spanish code-switching
        smart_format: "true",
        interim_results: "true",
        endpointing: "100",
        utterance_end_ms: "1000",
        encoding: "linear16",
        sample_rate: String(ctx.sampleRate),
        channels: "1",
      });
      ws = await openSocket(`${url}?${params}`, token);
    } catch (err) {
      this.cleanup();
      if (err instanceof TranscriberError) throw err;
      throw new TranscriberError("Could not connect to the speech service.", "connection");
    }
    if (this.stopped) {
      ws.close();
      return this.cleanup();
    }
    this.ws = ws;

    ws.onmessage = (e) => this.handleMessage(e.data);
    ws.onclose = () => {
      if (!this.stopped) this.finish();
    };

    const source = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, "pcm-processor");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const pcm = new Int16Array(e.data);
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
      this.events.onLevel(Math.min(1, Math.sqrt(sum / pcm.length) * 4));
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    source.connect(node);
    // The worklet must be connected to the graph to run; it outputs silence.
    node.connect(ctx.destination);
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    let msg: {
      type?: string;
      is_final?: boolean;
      speech_final?: boolean;
      channel?: { alternatives?: { transcript?: string }[] };
    };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === "Results") {
      const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
      if (msg.is_final) {
        if (text) this.finalized = `${this.finalized} ${text}`.trim();
        this.interim = "";
      } else {
        this.interim = text;
      }
      this.events.onTranscript(`${this.finalized} ${this.interim}`.trim());
    } else if (msg.type === "UtteranceEnd" && this.finalized) {
      this.finish();
    }
  }

  /** Ends the turn now and reports whatever was heard. */
  finish() {
    if (this.ended) return;
    this.ended = true;
    const text = `${this.finalized} ${this.interim}`.trim();
    this.stop();
    this.events.onUtteranceEnd(text);
  }

  stop() {
    this.stopped = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Ask Deepgram to flush and close cleanly.
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
    }
    this.ws?.close();
    this.ws = null;
    this.cleanup();
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.events.onLevel(0);
  }
}
