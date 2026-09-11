"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSentenceSplitter } from "@/lib/voice/sentences";
import { Speaker } from "@/lib/voice/speaker";
import { LiveTranscriber, TranscriberError } from "@/lib/voice/transcriber";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const MAX_USER_TURNS = 10;
const HISTORY_SENT = 10; // messages of context sent with each question
const NO_SPEECH_TIMEOUT_MS = 10_000;
const MAX_LISTEN_MS = 30_000;

const SUGGESTIONS = [
  "What is Marco working on?",
  "What did Marco study?",
  "¿Qué es VQE, explicado fácil?",
  "How does the object detection demo work?",
];

export default function VoiceChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [micAvailable, setMicAvailable] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const voiceRepliesRef = useRef(voiceReplies);
  const logRef = useRef<HTMLDivElement>(null);

  const userTurns = messages.filter((m) => m.role === "user").length;
  const limitReached = userTurns >= MAX_USER_TURNS;

  useEffect(() => {
    messagesRef.current = messages;
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, transcript]);

  useEffect(() => {
    voiceRepliesRef.current = voiceReplies;
    if (!voiceReplies) speakerRef.current?.stop();
  }, [voiceReplies]);

  // Create the speaker once, and tear everything down when leaving the page.
  useEffect(() => {
    const speaker = new Speaker();
    speaker.onStatus = (s) => setSpeaking(s === "speaking");
    speaker.onUnavailable = (message) => {
      setVoiceReplies(false);
      setNotice(`${message} Replies will be shown as text only.`);
    };
    speakerRef.current = speaker;
    const secure = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    const id = setTimeout(() => setMicAvailable(secure), 0);
    return () => {
      clearTimeout(id);
      speaker.stop();
      transcriberRef.current?.stop();
      chatAbort.current?.abort();
    };
  }, []);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text) return;
    const history = [...messagesRef.current, { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setNotice(null);
    setThinking(true);

    const controller = new AbortController();
    chatAbort.current = controller;
    const splitter = createSentenceSplitter();
    const speak = (sentence: string) => {
      if (voiceRepliesRef.current) speakerRef.current?.speak(sentence);
    };
    let answer = "";

    try {
      const res = await fetch("/api/voice/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-HISTORY_SENT) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "The assistant could not answer right now.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const delta = decoder.decode(value, { stream: true });
        answer += delta;
        setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: answer }]);
        splitter.push(delta).forEach(speak);
      }
      const rest = splitter.flush();
      if (rest) speak(rest);
      if (!answer.trim()) throw new Error("The assistant returned an empty answer. Try asking again.");
    } catch (err) {
      if (controller.signal.aborted) return;
      setNotice(err instanceof Error ? err.message : "Something went wrong.");
      // Drop the empty assistant placeholder, keep the question so it can be retried.
      if (!answer.trim()) setMessages((prev) => prev.slice(0, -1));
    } finally {
      if (chatAbort.current === controller) {
        chatAbort.current = null;
        setThinking(false);
      }
    }
  }, []);

  const startListening = useCallback(async () => {
    const speaker = speakerRef.current;
    speaker?.unlock(); // inside the click, so later playback is allowed
    speaker?.stop();
    chatAbort.current?.abort();
    setThinking(false);
    setNotice(null);
    setTranscript("");
    setListening(true);

    let heard = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = () => timers.forEach(clearTimeout);

    const transcriber = new LiveTranscriber({
      onTranscript: (text) => {
        heard = heard || text.length > 0;
        setTranscript(text);
      },
      onUtteranceEnd: (text) => {
        clearTimers();
        transcriberRef.current = null;
        setListening(false);
        setTranscript(null);
        if (text) void ask(text);
        else setNotice("I didn't catch anything. Try again, a little closer to the microphone.");
      },
      onLevel: setLevel,
      onError: (message) => setNotice(message),
    });
    transcriberRef.current = transcriber;

    timers.push(setTimeout(() => !heard && transcriber.finish(), NO_SPEECH_TIMEOUT_MS));
    timers.push(setTimeout(() => transcriber.finish(), MAX_LISTEN_MS));

    try {
      await transcriber.start();
    } catch (err) {
      clearTimers();
      transcriber.stop();
      transcriberRef.current = null;
      setListening(false);
      setTranscript(null);
      if (err instanceof TranscriberError) {
        if (err.code === "not_configured") setMicAvailable(false);
        setNotice(err.message);
      } else {
        setNotice("Voice input could not start. You can still type your question.");
      }
    }
  }, [ask]);

  const onMicClick = () => {
    if (listening) transcriberRef.current?.finish();
    else void startListening();
  };

  const stopSpeaking = () => speakerRef.current?.stop();

  const newConversation = () => {
    transcriberRef.current?.stop();
    speakerRef.current?.stop();
    chatAbort.current?.abort();
    setMessages([]);
    setTranscript(null);
    setListening(false);
    setThinking(false);
    setNotice(null);
  };

  const submitText = (text: string) => {
    if (limitReached || thinking || listening) return;
    speakerRef.current?.unlock();
    speakerRef.current?.stop();
    setDraft("");
    void ask(text);
  };

  const status = listening
    ? "Listening. Pause for a moment when you're done."
    : thinking
      ? "Thinking…"
      : speaking
        ? "Speaking"
        : limitReached
          ? "This conversation has reached its limit."
          : micAvailable
            ? "Press the microphone and ask a question."
            : "Type a question to start.";

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <div className="flex h-[min(560px,70vh)] flex-col rounded-[3px] border border-rule bg-paper-raised">
          <div ref={logRef} className="flex-1 space-y-6 overflow-y-auto px-5 py-6 sm:px-7" aria-live="polite">
            {messages.length === 0 && transcript === null && (
              <div className="flex h-full flex-col justify-center">
                <p className="font-serif text-[20px] text-ink">Ask about Marco&apos;s work, in English or Spanish.</p>
                <p className="mt-2 text-[15px] text-ink-muted">Try one of these:</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => submitText(s)}
                        className="rounded-[3px] border border-ink/25 px-3 py-1.5 text-left text-[15px] text-ink hover:border-ink/60"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i}>
                <p className="text-[13px] text-ink-muted">{m.role === "user" ? "You" : "Assistant"}</p>
                {m.role === "user" ? (
                  <p className="mt-1 text-[16px] leading-[1.55] text-ink">{m.content}</p>
                ) : (
                  <p className="mt-1 max-w-[62ch] font-serif text-[18px] leading-[1.6] text-ink">
                    {m.content || <span className="text-ink-muted">…</span>}
                  </p>
                )}
              </div>
            ))}

            {transcript !== null && (
              <div>
                <p className="text-[13px] text-ink-muted">You</p>
                <p className="mt-1 text-[16px] leading-[1.55] text-ink-muted italic">{transcript || "Listening…"}</p>
              </div>
            )}
          </div>

          <form
            className="flex gap-2 border-t border-rule p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitText(draft);
            }}
          >
            <label htmlFor="voice-chat-input" className="sr-only">
              Type a question
            </label>
            <input
              id="voice-chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={600}
              disabled={limitReached}
              placeholder={limitReached ? "Start a new conversation to keep going" : "Or type a question"}
              className="min-w-0 flex-1 rounded-[3px] border border-ink/20 bg-paper px-3 py-2 text-[16px] text-ink placeholder:text-ink-muted/70 focus-visible:border-accent disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!draft.trim() || thinking || listening || limitReached}
              className="rounded-[3px] bg-ink px-4 py-2 text-[15px] text-paper hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      </div>

      <div className="space-y-8 lg:col-span-5">
        {micAvailable && (
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={onMicClick}
              disabled={limitReached}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening and send" : "Start talking"}
              className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full bg-ink text-paper transition-[box-shadow] duration-75 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-accent"
              style={{ boxShadow: listening ? `0 0 0 ${4 + level * 16}px rgba(44, 102, 144, 0.2)` : undefined }}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
                {listening ? (
                  <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
                ) : (
                  <>
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" strokeLinecap="round" />
                  </>
                )}
              </svg>
            </button>
            <p className="text-[16px] leading-[1.45] text-ink">{status}</p>
          </div>
        )}
        {!micAvailable && <p className="text-[16px] text-ink">{status}</p>}

        {notice && (
          <p role="alert" className="text-[15px] leading-[1.5] text-[#9a3412]">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {speaking && (
            <button
              type="button"
              onClick={stopSpeaking}
              className="rounded-[3px] border border-ink/25 px-3.5 py-1.5 text-[15px] text-ink hover:border-ink/60"
            >
              Stop speaking
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={newConversation}
              className="rounded-[3px] border border-ink/25 px-3.5 py-1.5 text-[15px] text-ink hover:border-ink/60"
            >
              New conversation
            </button>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-3 text-[16px] text-ink">
          <input
            type="checkbox"
            checked={voiceReplies}
            onChange={(e) => setVoiceReplies(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Read replies aloud
        </label>

        <p className="border-t border-rule pt-6 text-[14px] leading-[1.55] text-ink-muted">
          Your voice is streamed to Deepgram for transcription, the text is answered by an open model through
          Hugging Face, and replies are spoken by ElevenLabs. This site does not store your conversation. Usage is
          rate limited.
        </p>
      </div>
    </div>
  );
}
