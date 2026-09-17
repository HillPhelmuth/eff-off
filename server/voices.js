import { LIVE_VOICE } from "./prompt.js";
import { BUILTIN_LIVE_VOICES } from "./shared/live.js";

// Built-in choices documented at /api/docs/guides/live-conversations.
export const LIVE_VOICES = BUILTIN_LIVE_VOICES.map((voice) => ({ ...voice }));

// Preserve a trusted deployment's configured voice as a selectable default.
if (!LIVE_VOICES.some(voice => voice.id === LIVE_VOICE)) {
  LIVE_VOICES.unshift({ id: LIVE_VOICE, label: LIVE_VOICE, vibe: "Server default" });
}
