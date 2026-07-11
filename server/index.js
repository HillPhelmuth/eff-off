import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EFF_OFF_INSTRUCTIONS,
  REALTIME_MODEL,
  REALTIME_VOICE,
  REALTIME_VOICES,
  resolveRealtimeVoice,
} from "./prompt.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn(
    "[eff-off] OPENAI_API_KEY is not set. /api/session will fail until you configure it.",
  );
}

const app = express();
app.use(express.json({ limit: "32kb" }));

function buildSessionBody(voice) {
  const resolvedVoice = resolveRealtimeVoice(voice);
  return {
    expires_after: {
      anchor: "created_at",
      seconds: Number(process.env.CLIENT_SECRET_TTL_SECONDS || 600),
    },
    session: {
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: EFF_OFF_INSTRUCTIONS,
      audio: {
        input: {
          // Browser + headset friendly defaults
          noise_reduction: { type: "near_field" },
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice: resolvedVoice,
        },
      },
      // low latency insult comic — keep reasoning light
      // (supported by realtime-2 family; ignored safely if unsupported)
      reasoning: { effort: "low" },
    },
  };
}

app.get("/api/health", (_req, res) => {
  const defaultVoice = resolveRealtimeVoice(REALTIME_VOICE);
  res.json({
    ok: true,
    name: "eff-off",
    model: REALTIME_MODEL,
    voice: defaultVoice,
    voices: REALTIME_VOICES,
    hasApiKey: Boolean(apiKey),
  });
});

/**
 * List built-in Realtime voices available for session create.
 */
app.get("/api/voices", (_req, res) => {
  res.json({
    default: resolveRealtimeVoice(REALTIME_VOICE),
    voices: REALTIME_VOICES,
  });
});

/**
 * Mint an ephemeral client secret for browser WebRTC.
 * Browser never sees OPENAI_API_KEY.
 * Docs: POST /v1/realtime/client_secrets
 * Optional body.voice selects audio.output.voice (validated against REALTIME_VOICES).
 */
app.post("/api/session", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({
      error: "Server missing OPENAI_API_KEY. Set it in the environment / GitHub secret.",
    });
  }

  try {
    const safetyId =
      (typeof req.body?.safetyIdentifier === "string" &&
        req.body.safetyIdentifier.slice(0, 128)) ||
      "eff-off-anonymous";
    const voice = resolveRealtimeVoice(req.body?.voice);

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyId,
      },
      body: JSON.stringify(buildSessionBody(voice)),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      console.error("[eff-off] client_secrets error", response.status, data);
      return res.status(response.status).json({
        error: "OpenAI rejected session create",
        details: data,
      });
    }

    // Return only what the client needs
    res.json({
      value: data.value,
      expires_at: data.expires_at,
      model: REALTIME_MODEL,
      voice,
    });
  } catch (err) {
    console.error("[eff-off] /api/session failed", err);
    res.status(500).json({ error: "Failed to create realtime session" });
  }
});

// Legacy alias matching OpenAI console samples
app.get("/token", async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY missing" });
  }
  try {
    const voice = resolveRealtimeVoice(req.query?.voice);
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildSessionBody(voice)),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

if (isProd) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });

  app.listen(port, () => {
    console.log(`[eff-off] production on :${port} model=${REALTIME_MODEL}`);
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use(vite.middlewares);

  app.use(/.*/, async (req, res, next) => {
    try {
      const url = req.originalUrl;
      let template = fs.readFileSync(path.join(root, "index.html"), "utf-8");
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });

  app.listen(port, () => {
    console.log(`[eff-off] dev on http://localhost:${port} model=${REALTIME_MODEL}`);
  });
}
