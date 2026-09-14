import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startSession, fetchVoices } from "./agent.js";
import { createCaptions } from "./captions.js";

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
  const [model, setModel] = useState("gpt-live-1");
  const [micLevel, setMicLevel] = useState(0);
  const [consented, setConsented] = useState(false);
  const [twenties, setTwenties] = useState(false);
  const [voices, setVoices] = useState([{ id: "marin", label: "Marin" }]);
  const [voice, setVoice] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(true);
  const handle = useRef(null);
  const logRef = useRef(null);
  const attempt = useRef(null);
  const followCaptions = useRef(true);

  const live = status === "live";
  const busy = status === "connecting" || live || status === "closing";

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
    })().catch(() => {
      if (!cancelled) {
        setVoice("marin");
        setError("Could not load voice options. Using Marin.");
      }
    }).finally(() => {
      if (!cancelled) setVoicesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (logRef.current && followCaptions.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  // Meter the microphone stream already used by WebRTC.
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
        stream = handle.current?.microphone;
        if (!stream) return;
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
      ctx?.close?.();
    };
  }, [live]);

  const canConnect = consented && twenties && !voicesLoading && !busy;

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
    setLines([]);
    followCaptions.current = true;
    const controller = new AbortController();
    attempt.current = controller;
    const captions = createCaptions();
    setStatus("connecting");
    try {
      const established = await startSession({
        voice,
        signal: controller.signal,
        safetyIdentifier: localStorage.getItem("effoff.sid") || (() => {
          const id = crypto.randomUUID();
          localStorage.setItem("effoff.sid", id);
          return id;
        })(),
        onEvent: (name, payload) => {
          if (attempt.current !== controller || controller.signal.aborted) return;
          if (name === "session.input_transcript.delta" || name === "session.output_transcript.delta") {
            setLines(captions(payload));
          }
          if (name === "session.closed" || name === "connection_error") {
            handle.current = null;
            setStatus(name === "session.closed" ? "idle" : "error");
          }
          if (name === "error" || name === "connection_error") {
            console.error(payload);
            const err = payload?.error ?? payload;
            setError(
              (err && (err.message || err.error?.message)) ||
                "Live session error",
            );
          }
        },
      });
      if (controller.signal.aborted || attempt.current !== controller) {
        await established.close();
        return;
      }
      handle.current = established;
      setModel(established.model || "gpt-live-1");
      setStatus("live");
    } catch (e) {
      if (controller.signal.aborted || attempt.current !== controller) return;
      console.error(e);
      setError(e?.message || String(e));
      setStatus("error");
    }
  }, [voice]);

  const onHangup = useCallback(async () => {
    const current = handle.current;
    setStatus("closing");
    if (current) await current.close();
    else attempt.current?.abort();
    handle.current = null;
    attempt.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => () => {
    attempt.current?.abort();
    void handle.current?.close();
  }, []);

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
      case "closing":
        return "LEAVING STAGE…";
      default:
        return status;
    }
  }, [status]);

  const voiceMeta = voices.find((v) => v.id === voice);

  return (
    <div className="page">
      <div className="noise" aria-hidden />
      <header className="hero">
        <div className="badge">OPENAI LIVE · {model}</div>
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
            Transcripts stream over OpenAI Live (<code>{model}</code>). Mic audio
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
            disabled={busy || voicesLoading}
            aria-label="Live voice"
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {v.vibe ? ` — ${v.vibe}` : ""}
              </option>
            ))}
          </select>
          {voiceMeta ? (
            <p className="voice-hint muted">
              Selected: <strong>{voiceMeta.label}</strong>{voiceMeta.vibe ? ` · ${voiceMeta.vibe}` : ""}
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
          {status !== "live" && status !== "connecting" && status !== "closing" ? (
            <button className="primary" disabled={!canConnect} onClick={onConnect}>
              {status === "connecting" ? "Connecting…" : "Step on stage"}
            </button>
          ) : (
            <button className="danger" disabled={status === "closing"} onClick={onHangup}>
              Hang up / walk away
            </button>
          )}
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card transcript">
        <h2>Set list (live transcripts)</h2>
        <div className="log" ref={logRef} onScroll={(event) => {
          const el = event.currentTarget;
          followCaptions.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}>
          {lines.length === 0 ? (
            <p className="muted">Roasts will land here once the mic goes live.</p>
          ) : (
            lines.map((line) => (
              <div key={line.id} className={`line ${line.role}`}>
                <span className="who">{line.role === "you" ? "YOU" : "EFF-OFF"}</span>
                <p style={{ whiteSpace: "pre-wrap" }}>{line.text}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <footer>
        <p>
          Built with <a href="https://developers.openai.com/api/docs/guides/live">OpenAI GPT-Live</a>{" "}
          · model <code>{model}</code>
        </p>
      </footer>
    </div>
  );
}
