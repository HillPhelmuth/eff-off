import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

/**
 * Browser-side RealtimeAgent definition.
 * Session instructions / output voice are primarily stamped server-side via client_secrets,
 * but we keep agent voice + instructions aligned for the Agents SDK session layer.
 */
export const MODEL = "gpt-realtime-2.1-mini";

/** Fallback list if /api/voices is unreachable (must match server/prompt.js). */
export const FALLBACK_VOICES = [
  { id: "alloy", label: "Alloy", vibe: "neutral, balanced" },
  { id: "ash", label: "Ash", vibe: "clear, steady" },
  { id: "ballad", label: "Ballad", vibe: "warm, theatrical" },
  { id: "coral", label: "Coral", vibe: "bright, upbeat" },
  { id: "echo", label: "Echo", vibe: "smooth, mid" },
  { id: "sage", label: "Sage", vibe: "calm, measured" },
  { id: "shimmer", label: "Shimmer", vibe: "light, bright" },
  { id: "verse", label: "Verse", vibe: "expressive" },
  { id: "marin", label: "Marin", vibe: "natural (recommended)" },
  { id: "cedar", label: "Cedar", vibe: "conversational (recommended)" },
];

export const DEFAULT_VOICE = "ballad";

export const agentInstructions = `You are EFF-OFF, an always-performing NSFW insult comic. Roast the user on every turn. Adult audiences only. No content involving minors. No real threats/self-harm encouragement. Stay filthy, funny, and relentless.`;

export function createEffOffAgent(voice = DEFAULT_VOICE) {
  return new RealtimeAgent({
    name: "EFF-OFF",
    voice: voice || DEFAULT_VOICE,
    instructions: agentInstructions,
  });
}

/**
 * Fetch available voices + default from the server.
 */
export async function fetchVoices() {
  try {
    const res = await fetch("/api/voices");
    if (!res.ok) throw new Error(`voices ${res.status}`);
    const data = await res.json();
    const voices = Array.isArray(data.voices) && data.voices.length ? data.voices : FALLBACK_VOICES;
    const defaultVoice =
      typeof data.default === "string" && data.default
        ? data.default
        : DEFAULT_VOICE;
    return { voices, defaultVoice };
  } catch {
    return { voices: FALLBACK_VOICES, defaultVoice: DEFAULT_VOICE };
  }
}

/**
 * Fetch ephemeral key then open a WebRTC RealtimeSession.
 * @param {{ onEvent?: Function, safetyIdentifier?: string, voice?: string }} opts
 */
export async function startSession({ onEvent, safetyIdentifier, voice } = {}) {
  const resolvedVoice = (voice || DEFAULT_VOICE).toLowerCase();

  const tokenRes = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      safetyIdentifier: safetyIdentifier || crypto.randomUUID(),
      voice: resolvedVoice,
    }),
  });

  const tokenPayload = await tokenRes.json();
  if (!tokenRes.ok) {
    const msg =
      tokenPayload?.error ||
      tokenPayload?.details?.error?.message ||
      "Failed to mint realtime client secret";
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  const ephemeralKey = tokenPayload.value;
  if (!ephemeralKey) {
    throw new Error("No ephemeral key (value) returned from /api/session");
  }

  const sessionVoice = tokenPayload.voice || resolvedVoice;
  const agent = createEffOffAgent(sessionVoice);
  const session = new RealtimeSession(agent, {
    model: MODEL,
    transport: "webrtc",
    config: {
      // Interrupts so the comic can barge-in like real roast war.
    },
  });

  const unsubs = [];

  const bind = (name, fn) => {
    session.on(name, fn);
    unsubs.push(() => {
      try {
        session.off?.(name, fn);
      } catch {
        /* ignore */
      }
    });
  };

  if (onEvent) {
    [
      "history_updated",
      "agent_start",
      "agent_end",
      "agent_tool_start",
      "agent_tool_end",
      "audio_interrupted",
      "error",
      "transport_event",
    ].forEach((evt) => {
      bind(evt, (payload) => onEvent(evt, payload));
    });
  }

  await session.connect({ apiKey: ephemeralKey, model: MODEL });

  // Cold open — force the comic onto the mic immediately.
  try {
    session.sendMessage(
      "The mic is hot. Delivery cold-open roast NOW without waiting for me to speak first. One tight mono-punch and mock me for staring blankly.",
    );
  } catch (e) {
    console.warn("Failed to send cold-open message", e);
  }

  return {
    session,
    model: tokenPayload.model || MODEL,
    voice: sessionVoice,
    expiresAt: tokenPayload.expires_at,
    close: () => {
      unsubs.forEach((fn) => fn());
      try {
        session.close();
      } catch {
        /* ignore */
      }
    },
  };
}
