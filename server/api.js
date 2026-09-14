import express from "express";
import { EFF_OFF_INSTRUCTIONS, LIVE_MODEL, LIVE_VOICE } from "./prompt.js";
import { LIVE_VOICES } from "./voices.js";

export function createApi({ apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch } = {}) {
  const app = express.Router();
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/voices", (_req, res) => res.json({ voices: LIVE_VOICES, defaultVoice: LIVE_VOICE }));
  app.get("/api/health", (_req, res) => res.json({
    ok: true, name: "eff-off", model: LIVE_MODEL, voice: LIVE_VOICE, hasApiKey: Boolean(apiKey),
  }));
  app.get("/token", (_req, res) => res.status(410).json({
    error: "Token endpoint retired. POST an SDP offer to /api/session.",
  }));
  app.post("/api/session", async (req, res) => {
    const { sdp, safetyIdentifier, voice = LIVE_VOICE } = req.body || {};
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || !/^m=audio /m.test(sdp)) {
      return res.status(400).json({ error: "A WebRTC SDP offer with audio is required." });
    }
    if (!LIVE_VOICES.some(option => option.id === voice)) {
      return res.status(400).json({ error: "Select a supported Live voice." });
    }
    if (!apiKey) return res.status(503).json({ error: "Server missing OPENAI_API_KEY." });
    try {
      const response = await fetchImpl("https://api.openai.com/v1/live/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": typeof safetyIdentifier === "string"
            ? safetyIdentifier.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 128) || "eff-off-anonymous"
            : "eff-off-anonymous",
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          session: {
            model: LIVE_MODEL, instructions: EFF_OFF_INSTRUCTIONS,
            audio: { output: { voice } },
            delegation: { type: "client" }, store: false,
          },
          transport: { type: "webrtc", sdp },
        }),
      });
      if (!response.ok) {
        console.error("[eff-off] Live session rejected", response.status);
        return res.status(response.status).json({ error: `OpenAI rejected Live session creation (${response.status}).` });
      }
      const data = await response.json();
      if (typeof data.session?.id !== "string" || !data.session.id ||
          data.transport?.type !== "webrtc" || typeof data.transport.sdp !== "string" ||
          !data.transport.sdp.startsWith("v=0")) {
        return res.status(502).json({ error: "OpenAI returned an invalid Live session answer." });
      }
      res.set("Cache-Control", "no-store").json({
        sessionId: data.session.id, sdp: data.transport.sdp, model: LIVE_MODEL, voice,
      });
    } catch (error) {
      res.status(error.name === "TimeoutError" ? 504 : 502).json({ error: "Failed to create Live session." });
    }
  });
  app.use((error, _req, res, next) => {
    if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
      return res.status(error.status).json({ error: "Invalid session request body." });
    }
    next(error);
  });
  return app;
}
