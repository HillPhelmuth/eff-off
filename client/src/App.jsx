import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_VOICE, FALLBACK_VOICES, fetchVoices, startSession } from "./agent.js";

function extractTranscripts(history = []) {
  const rows = [];
  for (const item of history) {
    if (!item || item.type !== "message") continue;
    const role = item.role === "user" ? "you" : "eff-off";
    let text = "";
    if (Array.isArray(item.content)) {
      text = item.content
        .map((c) => {
          if (!c) return "";
          if (c.type === "input_audio" || c.type === "output_audio") return c.transcript || "";
          if (c.type === "input_text" || c.type === "output_text") return c.text || "";
          return c.transcript || c.text || "";
        })
        .filter(Boolean)
        .join(" ")
        .trim();
    }
    if (text) {
      rows.push({
        id: item.itemId || `${role}-${rows.length}-${text.slice(0, 12)}`,
        role,
        text,
      });
    }
  }
  return rows;
}

function loadSavedVoice(voices, fallback) {
  try {
    const saved = localStorage.getItem("effoff.voice");
    if (saved && voices.some((v) => v.id === saved)) return saved;
  } catch {
    /* ignore */
  }
  return fallback;
}

export default function App() {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [error, setError] = useState("");
  const [lines, setLines] = useState([]);
  const [model, setModel] = useState("gpt-realtime-2.1-mini");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [voices, setVoices] = useState(FALLBACK_VOICES);
  const [micLevel, setMicLevel] = useState(0);
  const [consented, setConsented] = useState(false);
  const [twenties, setTwenties] = useState(false);
  const handle = useRef(null);
  const logRef = useRef(null);

  const live = status === "live";
  const busy = status === "connecting" || live;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { voices: list, defaultVoice } = await fetchVoices();
      if (cancelled) return;
      setVoices(list);
      setVoice((prev) => {
        // Prefer saved/current if still valid; else server default.
        if (list.some((v) => v.id === prev)) return prev;
        return loadSavedVoice(list, defaultVoice);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  // Soft mic meter while live (separately from WebRTC track used by the SDK)
  useEffect(() => {
    if (!live) {
      setMicLevel(0);
      return undefined;
    }
    let cancelled = false;
    let raf = 0;
    let stream;
    let ctx;
    let analyser;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          setMicLevel(Math.min(1, rms * 4));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        /* meter is optional */
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close?.();
    };
  }, [live]);

  const canConnect = consented && twenties && status !== "connecting" && status !== "live";

  const onVoiceChange = useCallback((e) => {
    const next = e.target.value;
    setVoice(next);
    try {
      localStorage.setItem("effoff.voice", next);
    } catch {
      /* ignore */
    }
  }, []);

  const onConnect = useCallback(async () => {
    setError("");
    setStatus("connecting");
    try {
      const established = await startSession({
        voice,
        safetyIdentifier: localStorage.getItem("effoff.sid") || (() => {
          const id = crypto.randomUUID();
          localStorage.setItem("effoff.sid", id);
          return id;
        })(),
        onEvent: (name, payload) => {
          if (name === "history_updated") {
            // RealtimeSession emits history_updated with the full history array.
            const next = extractTranscripts(Array.isArray(payload) ? payload : []);
            if (next.length) setLines(next);
          }
          if (name === "error") {
            console.error(payload);
            const err = payload?.error ?? payload;
            setError(
              (err && (err.message || err.error?.message)) ||
                "Realtime session error",
            );
          }
        },
      });
      handle.current = established;
      setModel(established.model || "gpt-realtime-2.1-mini");
      if (established.voice) setVoice(established.voice);
      setStatus("live");
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
      setStatus("error");
    }
  }, [voice]);

  const onHangup = useCallback(() => {
    handle.current?.close();
    handle.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => () => handle.current?.close(), []);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "idle":
        return "OFF AIR";
      case "connecting":
        return "WIRING MIC…";
      case "live":
        return "LIVE — SPEAK TO GET ROASTED";
      case "error":
        return "BROKEN";
      default:
        return status;
    }
  }, [status]);

  const voiceMeta = voices.find((v) => v.id === voice);

  return (
    <div className="page">
      <div className="noise" aria-hidden />
      <header className="hero">
        <div className="badge">
          OPENAI REALTIME · {model} · {voice}
        </div>
        <h1>
          EFF<span className="dash">-</span>OFF
        </h1>
        <p className="tag">
          Always-on NSFW insult comic. Every syllable you offer becomes ammunition.
        </p>
      </header>

      <section className="card consent">
        <h2>House rules</h2>
        <ul>
          <li>Adults only. No participants under 18. You confirm you are 18+.</li>
          <li>
            This is consensual roast comedy: crude, sexual, mean-spirited jokes aimed at willingness,
            not identity-based hate speech.
          </li>
          <li>
            Transcripts stream over OpenAI Realtime (<code>gpt-realtime-2.1-mini</code>). Mic audio
            leaves your browser for the duration of the call.
          </li>
          <li>
            Stop anytime. If you need genuinely helpful assistance, hang up — this clown will not help.
          </li>
        </ul>
        <label className="check">
          <input
            type="checkbox"
            checked={twenties}
            onChange={(e) => setTwenties(e.target.checked)}
          />
          <span>I am 18 years of age or older.</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
          />
          <span>I want NSFW insults and I consent to voice processing.</span>
        </label>
      </section>

      <section className="card stage">
        <div className="status-row">
          <span className={`dot ${status}`} />
          <span className="status-text">{statusLabel}</span>
        </div>

        <div className="voice-picker">
          <label htmlFor="voice-select">
            Voice <span className="muted-inline">(locks in when you go live)</span>
          </label>
          <select
            id="voice-select"
            value={voice}
            onChange={onVoiceChange}
            disabled={busy}
            aria-label="Realtime voice"
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {v.vibe ? ` — ${v.vibe}` : ""}
              </option>
            ))}
          </select>
          {voiceMeta?.vibe ? (
            <p className="voice-hint muted">
              Selected: <strong>{voiceMeta.label}</strong> · {voiceMeta.vibe}
              {busy ? " · reconnect to switch" : ""}
            </p>
          ) : null}
        </div>

        <div className="viz" aria-hidden>
          <div className="ring" style={{ transform: `scale(${1 + micLevel * 0.35})` }} />
          <div className="ring delayed" style={{ transform: `scale(${1 + micLevel * 0.55})` }} />
          <div className="mic">🎤</div>
        </div>

        <div className="actions">
          {!live ? (
            <button className="primary" disabled={!canConnect} onClick={onConnect}>
              {status === "connecting" ? "Connecting…" : "Step on stage"}
            </button>
          ) : (
            <button className="danger" onClick={onHangup}>
              Hang up / walk away
            </button>
          )}
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card transcript">
        <h2>Set list (live transcripts)</h2>
        <div className="log" ref={logRef}>
          {lines.length === 0 ? (
            <p className="muted">Roasts will land here once the mic goes live.</p>
          ) : (
            lines.map((line) => (
              <div key={line.id} className={`line ${line.role}`}>
                <span className="who">{line.role === "you" ? "YOU" : "EFF-OFF"}</span>
                <p>{line.text}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <footer>
        <p>
          Built with <a href="https://developers.openai.com/api/docs/guides/voice-agents">OpenAI Voice Agents</a>{" "}
          · model <code>gpt-realtime-2.1-mini</code>
        </p>
      </footer>
    </div>
  );
}
