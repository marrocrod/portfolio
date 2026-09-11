// Plays the assistant's reply sentence by sentence. Each sentence is synthesized as soon
// as it is ready, so audio for sentence n+1 downloads while sentence n is playing.

export type SpeakerStatus = "idle" | "speaking";

// A tiny silent WAV, played during a click to unlock audio on browsers with strict
// autoplay rules (Safari), so later async playback is allowed.
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private queue: Promise<string | null>[] = [];
  private playing = false;
  private generation = 0;
  private controllers = new Set<AbortController>();
  /** Called when voice replies fail, e.g. because the service is not configured. */
  onUnavailable: (message: string) => void = () => undefined;
  onStatus: (status: SpeakerStatus) => void = () => undefined;

  /** Must be called from a user gesture (click or key press). */
  unlock() {
    this.audio ??= new Audio();
    this.audio.src = SILENCE;
    this.audio.play().catch(() => undefined);
  }

  speak(text: string) {
    const gen = this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);

    const url = fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (gen === this.generation) this.onUnavailable(body.message ?? "Voice replies are unavailable right now.");
          return null;
        }
        return URL.createObjectURL(await res.blob());
      })
      .catch(() => null)
      .finally(() => this.controllers.delete(controller));

    this.queue.push(url);
    if (!this.playing) void this.drain(gen);
  }

  private async drain(gen: number) {
    this.playing = true;
    this.onStatus("speaking");
    while (this.queue.length && gen === this.generation) {
      const url = await this.queue.shift()!;
      if (!url || gen !== this.generation) {
        if (url) URL.revokeObjectURL(url);
        continue;
      }
      await this.play(url);
      URL.revokeObjectURL(url);
    }
    if (gen === this.generation) {
      this.playing = false;
      this.onStatus("idle");
    }
  }

  private play(url: string): Promise<void> {
    this.audio ??= new Audio();
    const audio = this.audio;
    return new Promise((resolve) => {
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.src = url;
      audio.play().catch(done);
    });
  }

  /** Stops playback and drops everything queued. */
  stop() {
    this.generation++;
    this.controllers.forEach((c) => c.abort());
    this.controllers.clear();
    this.queue = [];
    if (this.audio) {
      this.audio.pause();
      // Resolve the pending play() promise, if any.
      this.audio.dispatchEvent(new Event("ended"));
    }
    if (this.playing) {
      this.playing = false;
      this.onStatus("idle");
    }
  }

  get busy() {
    return this.playing;
  }
}
