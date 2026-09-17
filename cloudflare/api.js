import {
  EFF_OFF_INSTRUCTIONS,
  getLiveConfig,
  getLiveVoices,
} from "../server/shared/live.js";

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function liveHealth(env) {
  const { model, voice } = getLiveConfig(env);
  return json({
    ok: true,
    name: "eff-off",
    model,
    voice,
    hasApiKey: Boolean(env.OPENAI_API_KEY),
  });
}

export function liveVoices(env) {
  const { voice: defaultVoice } = getLiveConfig(env);
  return json({ voices: getLiveVoices(env), defaultVoice });
}

function sanitizedSafetyIdentifier(value) {
  if (typeof value !== "string") return "eff-off-anonymous";
  return value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 128) || "eff-off-anonymous";
}

export async function createLiveSession(request, env, fetchImpl = fetch) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid session request body." }, 400);
  }

  const { model, voice: defaultVoice } = getLiveConfig(env);
  const { sdp, safetyIdentifier, voice = defaultVoice } = body || {};
  if (typeof sdp !== "string" || !sdp.startsWith("v=0") || !/^m=audio /m.test(sdp)) {
    return json({ error: "A WebRTC SDP offer with audio is required." }, 400);
  }
  if (!getLiveVoices(env).some((option) => option.id === voice)) {
    return json({ error: "Select a supported Live voice." }, 400);
  }
  if (!env.OPENAI_API_KEY) {
    return json({ error: "Server missing OPENAI_API_KEY." }, 503);
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": sanitizedSafetyIdentifier(safetyIdentifier),
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        session: {
          model,
          instructions: EFF_OFF_INSTRUCTIONS,
          audio: { output: { voice } },
          delegation: { type: "client" },
          store: false,
        },
        transport: { type: "webrtc", sdp },
      }),
    });

    if (!response.ok) {
      return json({ error: `OpenAI rejected Live session creation (${response.status}).` }, response.status);
    }

    const data = await response.json();
    if (typeof data.session?.id !== "string" || !data.session.id ||
        data.transport?.type !== "webrtc" || typeof data.transport.sdp !== "string" ||
        !data.transport.sdp.startsWith("v=0")) {
      return json({ error: "OpenAI returned an invalid Live session answer." }, 502);
    }

    return json({
      sessionId: data.session.id,
      sdp: data.transport.sdp,
      model,
      voice,
    }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return json({ error: "Failed to create Live session." }, error?.name === "TimeoutError" ? 504 : 502);
  }
}
