import { liveHealth } from "../../cloudflare/api.js";

export function onRequestGet({ env }) {
  return liveHealth(env);
}
