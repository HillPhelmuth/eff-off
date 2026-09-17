import { createLiveSession, json, liveHealth, liveVoices } from "./api.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      return request.method === "GET"
        ? liveHealth(env)
        : json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    }
    if (pathname === "/api/voices") {
      return request.method === "GET"
        ? liveVoices(env)
        : json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    }
    if (pathname === "/api/session") {
      return request.method === "POST"
        ? createLiveSession(request, env)
        : json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    }
    if (pathname === "/token") {
      return json({
        error: "Token endpoint retired. POST an SDP offer to /api/session.",
      }, 410);
    }
    if (pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
