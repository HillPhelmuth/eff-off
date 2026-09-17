import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSession, liveHealth, liveVoices } from "../cloudflare/api.js";

const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const env = {
  OPENAI_API_KEY: "test-secret",
  OPENAI_LIVE_MODEL: "test-model",
  OPENAI_LIVE_VOICE: "gleam",
};

test("Cloudflare health and voice handlers use request environment configuration", async () => {
  assert.deepEqual(await liveHealth(env).json(), {
    ok: true,
    name: "eff-off",
    model: "test-model",
    voice: "gleam",
    hasApiKey: true,
  });
  const voices = await liveVoices(env).json();
  assert.equal(voices.defaultVoice, "gleam");
  assert.ok(voices.voices.some((voice) => voice.id === "gleam"));
});

test("Cloudflare session handler validates input and exchanges SDP without exposing the key", async () => {
  let requestUrl;
  let requestBody;
  let requestHeaders;
  const fetchImpl = async (url, init) => {
    requestUrl = url;
    requestBody = JSON.parse(init.body);
    requestHeaders = init.headers;
    return Response.json({
      session: { id: "opaque-id" },
      transport: { type: "webrtc", sdp: offer },
    });
  };

  const invalid = await createLiveSession(
    new Request("https://example.test/api/session", {
      method: "POST",
      body: JSON.stringify({ sdp: "not-an-offer" }),
    }),
    env,
    fetchImpl,
  );
  assert.equal(invalid.status, 400);
  assert.equal(requestUrl, undefined);

  const response = await createLiveSession(
    new Request("https://example.test/api/session", {
      method: "POST",
      body: JSON.stringify({
        sdp: offer,
        voice: "gleam",
        safetyIdentifier: "friend! id",
      }),
    }),
    env,
    fetchImpl,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, {
    sessionId: "opaque-id",
    sdp: offer,
    model: "test-model",
    voice: "gleam",
  });
  assert.equal(requestUrl, "https://api.openai.com/v1/live/sessions");
  assert.equal(requestHeaders.Authorization, "Bearer test-secret");
  assert.equal(requestHeaders["OpenAI-Safety-Identifier"], "friendid");
  assert.equal(requestBody.session.model, "test-model");
  assert.equal(requestBody.session.audio.output.voice, "gleam");
  assert.equal(requestBody.session.store, false);
  assert.doesNotMatch(JSON.stringify(payload), /test-secret/);
});
