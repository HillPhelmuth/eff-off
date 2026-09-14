import { LIVE_VOICE } from "./prompt.js";

// Built-in choices documented at /api/docs/guides/live-conversations.
export const LIVE_VOICES = [
  { id: "marin", label: "Marin" },
  { id: "quartz", label: "Quartz", vibe: "Australian English · feminine" },
  { id: "ripple", label: "Ripple", vibe: "Australian English · masculine" },
  { id: "vesper", label: "Vesper", vibe: "British English · masculine" },
  { id: "willow", label: "Willow", vibe: "Irish English · feminine" },
  { id: "stone", label: "Stone", vibe: "Irish English · masculine" },
  { id: "gleam", label: "Gleam", vibe: "North American English · feminine" },
  { id: "meridian", label: "Meridian", vibe: "North American English · masculine" },
  { id: "bossa", label: "Bossa", vibe: "Brazilian Portuguese · feminine" },
  { id: "tempo", label: "Tempo", vibe: "Brazilian Portuguese · masculine" },
  { id: "beacon", label: "Beacon", vibe: "Filipino English · masculine" },
  { id: "delta", label: "Delta", vibe: "Southern U.S. English · feminine" },
  { id: "cinder", label: "Cinder", vibe: "Southern U.S. English · masculine" },
];

// Preserve a trusted deployment's configured voice as a selectable default.
if (!LIVE_VOICES.some(voice => voice.id === LIVE_VOICE)) {
  LIVE_VOICES.unshift({ id: LIVE_VOICE, label: LIVE_VOICE, vibe: "Server default" });
}
