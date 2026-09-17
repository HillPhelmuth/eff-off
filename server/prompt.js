/**
 * Node-server configuration wrapper around the shared Live definitions.
 * Cloudflare Pages Functions read the same definitions from server/shared/live.js
 * through their request environment instead of process.env.
 */
import {
  EFF_OFF_INSTRUCTIONS,
  DEFAULT_LIVE_MODEL,
  DEFAULT_LIVE_VOICE,
} from "./shared/live.js";

export { EFF_OFF_INSTRUCTIONS };
export const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || DEFAULT_LIVE_MODEL;
export const LIVE_VOICE = process.env.OPENAI_LIVE_VOICE || DEFAULT_LIVE_VOICE;
