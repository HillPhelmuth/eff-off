import { createLiveSession } from "../../cloudflare/api.js";

export function onRequestPost({ request, env }) {
  return createLiveSession(request, env);
}
