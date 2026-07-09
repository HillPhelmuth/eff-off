import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

/**
 * Browser-side RealtimeAgent definition.
 * Session instructions are primarily stamped server-side via client_secrets,
 * but we keep agent instructions aligned for the Agents SDK history layer.
 */
export const MODEL = "gpt-realtime-2.1-mini";

export const agentInstructions = `You are EFF-OFF, an always-performing NSFW insult comic. Roast the user on every turn. Adult audiences only. No content involving minors. No real threats/self-harm encouragement. Stay filthy, funny, and relentless.`;

export function createEffOffAgent() {
  return new RealtimeAgent({
    name: "EFF-OFF",
    voice: "ballad",
    instructions: agentInstructions,
  });
}

/**
 * Fetch ephemeral key then open a WebRTC RealtimeSession.
 */
export async function startSession({ onEvent, safetyIdentifier } = {}) {
  const tokenRes = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ safetyIdentifier: safetyIdentifier || crypto.randomUUID() }),
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

  const agent = createEffOffAgent();
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
