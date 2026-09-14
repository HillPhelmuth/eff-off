function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export async function fetchVoices() {
  const response = await fetch("/api/voices");
  if (!response.ok) throw new Error("Could not load voice options. Using Marin.");
  const data = await response.json();
  if (!Array.isArray(data.voices) || !data.voices.length ||
      !data.voices.every(v => typeof v.id === "string" && typeof v.label === "string") ||
      !data.voices.some(v => v.id === data.defaultVoice)) {
    throw new Error("Invalid voice options. Using Marin.");
  }
  return data;
}

export async function startSession({ onEvent = () => {}, safetyIdentifier, signal, voice } = {}, dependencies = {}) {
  const {
    createPeer = () => new RTCPeerConnection(),
    getMicrophone = () => navigator.mediaDevices.getUserMedia({ audio: true }),
    createAudio = () => document.createElement("audio"),
    fetchImpl = fetch, uuid = () => crypto.randomUUID(),
    connectTimeoutMs = 30000, closeTimeoutMs = 5000, greetingTimeoutMs = 10000,
  } = dependencies;
  const peer = createPeer();
  const audio = createAudio();
  audio.autoplay = true;
  const controller = new AbortController();
  const ready = deferred();
  const stopped = deferred();
  const ice = deferred();
  const failure = deferred();
  let microphone, channel, closing = false, disposed = false, started = false, connected = false;
  let closeTimer, greetingTimer, greetingId;
  const listeners = [];
  const bind = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  };
  const stopMedia = () => {
    microphone?.getTracks().forEach(track => track.stop());
    audio.pause();
    audio.srcObject = null;
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(closeTimer);
    clearTimeout(greetingTimer);
    clearTimeout(connectTimer);
    stopMedia();
    listeners.splice(0).forEach(remove => remove());
    signal?.removeEventListener("abort", abort);
    channel?.close();
    peer.close();
    controller.abort();
    stopped.resolve();
  };
  const send = event => channel.send(JSON.stringify(event));
  const close = () => {
    if (closing || disposed) return stopped.promise;
    closing = true;
    stopMedia();
    clearTimeout(greetingTimer);
    if (channel?.readyState === "open" && started) {
      closeTimer = setTimeout(() => {
        onEvent("error", new Error("Live session finalization timed out; final usage is unconfirmed."));
        cleanup();
      }, closeTimeoutMs);
      try { send({ type: "session.close" }); } catch { cleanup(); }
    } else cleanup();
    return stopped.promise;
  };
  const fail = error => {
    failure.reject(error);
    ready.reject(error);
    ice.reject(error);
    controller.abort(error);
    if (connected) onEvent("connection_error", error);
    void close();
  };
  const abort = () => fail(new Error("Connection cancelled."));
  const connectTimer = setTimeout(() => fail(new Error("Live connection timed out.")), connectTimeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  const checkActive = () => {
    if (disposed || closing || signal?.aborted) throw new Error("Connection cancelled.");
  };
  bind(peer, "icegatheringstatechange", () => {
    if (peer.iceGatheringState === "complete") ice.resolve();
  });
  bind(peer, "connectionstatechange", () => {
    if (!closing && ["failed", "closed"].includes(peer.connectionState)) fail(new Error("Live connection lost."));
  });
  bind(peer, "track", event => {
    if (closing || disposed) return;
    audio.srcObject = event.streams[0];
    audio.play().catch(() => fail(new Error("Audio playback was blocked. Reconnect and allow audio playback.")));
  });
  try {
    const connect = async () => {
      checkActive();
      // getUserMedia cannot be aborted: stop a late stream even after timeout/unmount.
      const capture = getMicrophone().then(stream => {
        if (closing || disposed) {
          stream.getTracks().forEach(track => track.stop());
          throw new Error("Connection cancelled.");
        }
        return stream;
      });
      microphone = await Promise.race([capture, ready.promise]);
      checkActive();
      for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);
      channel = peer.createDataChannel("oai-events");
      bind(channel, "close", () => {
        if (!disposed) {
          if (!closing) fail(new Error("Live event channel closed unexpectedly."));
          else {
            onEvent("error", new Error("Connection closed before final usage was confirmed."));
            cleanup();
          }
        }
      });
      bind(channel, "error", () => fail(new Error("Live event channel failed.")));
      bind(channel, "message", ({ data }) => {
        let event;
        try { event = JSON.parse(data); } catch { onEvent("error", new Error("Invalid Live event.")); return; }
        if (event.type === "session.closed") {
          ready.reject(new Error("Live session ended before connection completed."));
          onEvent("session.closed", event);
          cleanup();
          return;
        }
        if (closing || disposed) return;
        if (event.type === "session.started" && !started) {
          started = true;
          greetingId = uuid();
          greetingTimer = setTimeout(() => onEvent("error", new Error("Opening greeting was not acknowledged.")), greetingTimeoutMs);
          send({ type: "session.instructions.append", event_id: greetingId, delegation_id: null,
            content: "Greet immediately in English with one short, funny opening roast without waiting for the caller to speak. Then pause and listen." });
          ready.resolve(event);
        } else if (event.type === "session.instructions.appended" && event.client_event_id === greetingId) {
          clearTimeout(greetingTimer);
        } else if (event.type === "session.delegation.created" && event.delegation?.target === "client") {
          send({ type: "session.commentary.append", event_id: uuid(), delegation_id: event.delegation.id,
            content: "No backend capabilities are available. No task was performed. Continue the roast-comedy conversation." });
        } else if (event.type === "error") {
          if (event.error?.event_id === greetingId || event.client_event_id === greetingId) clearTimeout(greetingTimer);
          if (!started) fail(new Error(event.error?.message || "Live startup failed."));
        }
        onEvent(event.type, event);
      });
      const offer = await peer.createOffer();
      checkActive();
      await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== "complete") await ice.promise;
      checkActive();
      const response = await fetchImpl("/api/session", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ sdp: peer.localDescription.sdp, safetyIdentifier: safetyIdentifier || uuid(), voice }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create Live session.");
      if (!payload.sessionId || typeof payload.sdp !== "string" || !payload.sdp.startsWith("v=0")) {
        throw new Error("Invalid Live session answer.");
      }
      checkActive();
      await peer.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      await ready.promise;
      checkActive();
      clearTimeout(connectTimer);
      connected = true;
      return { sessionId: payload.sessionId, model: payload.model, voice: payload.voice, microphone, close };
      };
    return await Promise.race([connect(), failure.promise]);
  } catch (error) {
    fail(error);
    throw error;
  }
}
