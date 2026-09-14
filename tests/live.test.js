import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createApi } from "../server/api.js";
import { createCaptions } from "../client/src/captions.js";
import { startSession } from "../client/src/agent.js";

const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const answer = { session: { id: "opaque-id" }, transport: { type: "webrtc", sdp: offer } };
const result = { sessionId: "opaque-id", sdp: offer, model: "gpt-live-1", voice: "marin" };
async function server(t, fetchImpl, apiKey = "test-secret") {
  const app = express();
  app.use(createApi({ fetchImpl, apiKey }));
  const http = app.listen(0, "127.0.0.1");
  await new Promise(resolve => http.once("listening", resolve));
  t.after(() => new Promise(resolve => { http.closeAllConnections(); http.close(resolve); }));
  return (path = "/api/session", body = { sdp: offer }) => fetch(`http://127.0.0.1:${http.address().port}${path}`, {
    method: path === "/api/session" ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(path === "/api/session" ? { body: JSON.stringify(body) } : {}),
  });
}
test("server exchanges SDP, owns configuration, and never returns its key", async t => {
  const request = await server(t, async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/live/sessions");
    assert.equal(init.headers.Authorization, "Bearer test-secret");
    const body = JSON.parse(init.body);
    assert.equal(body.transport.sdp, offer);
    assert.equal(body.session.model, "gpt-live-1");
    assert.equal(body.session.audio.output.voice, "marin");
    assert.deepEqual(body.session.delegation, { type: "client" });
    assert.equal(body.session.store, false);
    assert.equal(body.session.reasoning, undefined);
    assert.match(body.session.instructions, /Funny always comes first/);
    assert.match(body.session.instructions, /No content involving minors/);
    return Response.json(answer);
  });
  assert.deepEqual(await (await request(undefined, { sdp: offer, model: "bad", instructions: "bad" })).json(), result);
  assert.equal((await request("/token")).status, 410);
});
test("server rejects invalid input before contacting OpenAI", async t => {
  const request = await server(t, () => { throw new Error("Must not call upstream"); });
  for (const body of [{}, { sdp: " " }, { sdp: 3 }, { sdp: "v=0\r\n" }]) {
    assert.equal((await request(undefined, body)).status, 400);
  }
});
for (const [name, upstream, expected] of [
  ["upstream rejection", () => new Response("private details", { status: 403 }), 403],
  ["invalid JSON", () => new Response("not json"), 502],
  ["invalid answer", () => Response.json({}), 502],
  ["network failure", () => { throw new Error("private details"); }, 502],
  ["upstream timeout", () => { throw new DOMException("timeout", "TimeoutError"); }, 504],
]) test(name, async t => {
  const request = await server(t, upstream);
  const response = await request();
  assert.equal(response.status, expected);
  assert.doesNotMatch(await response.text(), /private details|test-secret/);
});
test("missing API key is reported without an upstream request", async t => {
  const request = await server(t, () => assert.fail(), "");
  assert.equal((await request()).status, 503);
});
const fragment = (speaker, delta, start, end, id) => ({ type: `session.${speaker}_transcript.delta`, delta, start_ms: start, end_ms: end, event_id: id });
test("captions preserve overlapping speakers, late text, spaces, stable rows and session isolation", () => {
  const append = createCaptions();
  let rows = append(fragment("output", " there", 500, 800, "a"));
  const id = rows[0].id;
  append(fragment("input", " yes yes ", 600, 900, "b"));
  rows = append(fragment("output", "Hi", 0, 400, "c"));
  assert.equal(rows[0].text, "Hi there");
  assert.equal(rows[0].id, id);
  assert.equal(rows[1].text, " yes yes ");
  rows = append(fragment("output", "Again", 2500, 3000, "d"));
  assert.equal(rows.length, 3);
  assert.equal(append(fragment("output", "Again", 2500, 3000, "d")).length, 3);
  assert.equal(createCaptions()(fragment("input", "New", 0, 1, "b")).length, 1);
});
class Surface extends EventTarget {
  emit(type, values = {}) { const event = new Event(type); Object.assign(event, values); this.dispatchEvent(event); }
}
function fixture(options = {}) {
  const channel = new Surface();
  channel.readyState = "open";
  channel.sent = [];
  channel.send = text => {
    const event = JSON.parse(text); channel.sent.push(event);
    if (event.type === "session.instructions.append" && options.ack !== false) queueMicrotask(() => receive({ type: "session.instructions.appended", client_event_id: event.event_id }));
    if (event.type === "session.close" && options.finalize !== false) queueMicrotask(() => receive({ type: "session.closed", usage: { seconds: 1 } }));
  };
  channel.close = () => { channel.readyState = "closed"; };
  const receive = event => channel.emit("message", { data: JSON.stringify(event) });
  const peer = new Surface();
  peer.iceGatheringState = options.waitIce ? "gathering" : "complete";
  peer.addTrack = () => {};
  peer.createDataChannel = label => { assert.equal(label, "oai-events"); return channel; };
  peer.createOffer = async () => ({ type: "offer", sdp: offer });
  peer.setLocalDescription = async value => { peer.localDescription = value; };
  peer.setRemoteDescription = async value => {
    assert.deepEqual(value, { type: "answer", sdp: offer });
    if (options.start !== false) receive({ type: "session.started", session: { id: "opaque-id" } });
  };
  peer.close = () => { peer.closed = true; };
  const track = { stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const audio = { pause() { this.paused = true; }, play: async () => {}, srcObject: null };
  const events = [];
  let calls = 0;
  const deps = {
    createPeer: () => peer, createAudio: () => audio, getMicrophone: async () => stream,
    uuid: () => "command-id", connectTimeoutMs: 80, closeTimeoutMs: 10,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "/api/session");
      assert.equal(JSON.parse(init.body).sdp, offer);
      assert.equal(init.headers.Authorization, undefined);
      return Response.json(result);
    },
  };
  return { channel, peer, stream, track, audio, events, deps, receive, calls: () => calls,
    start: (extra = {}) => startSession({ onEvent: (...args) => events.push(args), ...extra }, deps) };
}
test("WebRTC waits for ICE/start, greets once, acknowledges and handles unexpected delegation", async () => {
  const f = fixture({ waitIce: true, start: false });
  let resolved = false;
  const pending = f.start().then(value => { resolved = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.calls(), 0);
  f.peer.iceGatheringState = "complete"; f.peer.emit("icegatheringstatechange");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(resolved, false);
  assert.equal(f.channel.sent.length, 0);
  f.receive({ type: "session.started" });
  const session = await pending;
  f.receive({ type: "session.started" });
  assert.equal(f.channel.sent.length, 1);
  f.receive({ type: "session.delegation.created", delegation: { id: "opaque-delegation", target: "client" } });
  assert.equal(f.channel.sent[1].delegation_id, "opaque-delegation");
  assert.equal(f.channel.sent[1].type, "session.commentary.append");
  assert.ok(f.events.some(([name]) => name === "session.instructions.appended"));
  const closing = session.close();
  assert.equal(f.track.stopped, true);
  assert.equal(f.audio.paused, true);
  assert.notEqual(f.peer.closed, true);
  await closing;
  assert.equal(f.peer.closed, true);
});
test("hangup timeout frees all resources and reports incomplete finalization", async () => {
  const f = fixture({ finalize: false });
  const session = await f.start();
  await session.close();
  assert.equal(f.peer.closed, true);
  assert.match(f.events.find(([name]) => name === "error")[1].message, /finalization timed out/);
});
test("connection timeout and late microphone permission do not leak capture", async () => {
  const f = fixture();
  let allow;
  f.deps.getMicrophone = () => new Promise(resolve => { allow = resolve; });
  await assert.rejects(f.start(), /timed out/);
  allow(f.stream);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.track.stopped, true);
  assert.equal(f.peer.closed, true);
});
test("microphone denial cleans up", async () => {
  const f = fixture();
  f.deps.getMicrophone = async () => { throw new Error("Permission denied"); };
  await assert.rejects(f.start(), /Permission denied/);
  assert.equal(f.peer.closed, true);
});
test("abort during startup closes microphone and transport", async () => {
  const f = fixture({ start: false });
  const controller = new AbortController();
  const pending = f.start({ signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.track.stopped, true);
  assert.equal(f.peer.closed, true);
});
test("startup rejection and runtime loss are surfaced", async () => {
  const f = fixture({ start: false });
  const pending = f.start();
  await new Promise(resolve => setTimeout(resolve, 5));
  f.receive({ type: "error", error: { message: "Startup rejected" } });
  await assert.rejects(pending, /Startup rejected/);
  const g = fixture();
  await g.start();
  g.peer.connectionState = "failed"; g.peer.emit("connectionstatechange");
  assert.ok(g.events.some(([name]) => name === "connection_error"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(g.peer.closed, true);
});
test("late caption fragments merge groups without changing the earliest row ID", () => {
  const append = createCaptions();
  const first = append(fragment("output", "A", 0, 200))[0].id;
  append(fragment("output", "C", 2200, 2400));
  const rows = append(fragment("output", "B", 1000, 1500));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, first);
  assert.equal(rows[0].text, "ABC");
});
test("greeting acknowledgment timeout is visible without closing a working call", async () => {
  const f = fixture({ ack: false });
  f.deps.greetingTimeoutMs = 5;
  const session = await f.start();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.match(f.events.find(([name]) => name === "error")[1].message, /not acknowledged/);
  assert.notEqual(f.peer.closed, true);
  await session.close();
});
test("greeting rejection clears its timer and reports the API error", async () => {
  const f = fixture({ ack: false });
  f.deps.greetingTimeoutMs = 5;
  const session = await f.start();
  f.receive({ type: "error", error: { event_id: "command-id", message: "Greeting rejected" } });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.events.filter(([name]) => name === "error").length, 1);
  await session.close();
});
test("timeout covers a stalled offer and cleans up", async () => {
  const f = fixture();
  f.peer.createOffer = () => new Promise(() => {});
  await assert.rejects(f.start(), /timed out/);
  assert.equal(f.track.stopped, true);
  assert.equal(f.peer.closed, true);
});
test("invalid HTTP answer releases browser resources", async () => {
  const f = fixture();
  f.deps.fetchImpl = async () => Response.json({ sessionId: "x" });
  await assert.rejects(f.start(), /Invalid Live session answer/);
  assert.equal(f.track.stopped, true);
  assert.equal(f.peer.closed, true);
});
test("voice catalogue includes the default and server validates selected voices", async t => {
  let selected;
  let calls = 0;
  const request = await server(t, async (_url, init) => {
    calls++;
    selected = JSON.parse(init.body).session.audio.output.voice;
    return Response.json(answer);
  });
  const catalogue = await (await request('/api/voices')).json();
  assert.equal(catalogue.defaultVoice, 'marin');
  assert.ok(catalogue.voices.some(v => v.id === 'cinder'));
  const response = await request(undefined, { sdp: offer, voice: 'cinder' });
  assert.equal(response.status, 200);
  assert.equal(selected, 'cinder');
  assert.equal((await response.json()).voice, 'cinder');
  for (const voice of ['unknown', '', null, 123, { id: 'cinder' }]) {
    assert.equal((await request(undefined, { sdp: offer, voice })).status, 400);
  }
  assert.equal(calls, 1);
});
test("browser sends the selected voice with the SDP offer", async () => {
  const f = fixture();
  f.deps.fetchImpl = async (_url, init) => {
    assert.equal(JSON.parse(init.body).voice, 'cinder');
    return Response.json({ ...result, voice: 'cinder' });
  };
  const session = await f.start({ voice: 'cinder' });
  assert.equal(session.voice, 'cinder');
  await session.close();
});
