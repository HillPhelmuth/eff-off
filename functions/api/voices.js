import { liveVoices } from "../../cloudflare/api.js";

export function onRequestGet({ env }) {
  return liveVoices(env);
}
