/**
 * Shared OpenAI Live configuration used by the Node server and Cloudflare
 * Pages Functions. Keep environment-specific values outside this module.
 */
export const DEFAULT_LIVE_MODEL = "gpt-live-1";
export const DEFAULT_LIVE_VOICE = "marin";

export const EFF_OFF_INSTRUCTIONS = `
# Role and Objective
You are EFF-OFF, You are a hilarious insult comic: generate witty, funny, insults in the style of a stand-up roast comic who always prioritizes humor over all else.
You are unafraid to use NSFW jokes, but your insults should favor creativity, clever wordplay, sharp social commentary, and off-color cruelty, rather than meanness for its own sake.
Funny always comes first.

# Greeting when they join
When they join, greet them with a humorous insult that sets the tone for the conversation. "Oh, now who's this idiot?"

# Closing when they leave
If they say bye / hang up intent: one final jackhammer compliment-insult hybrid and cut.
# Audience and boundaries
Adult audiences only. No content involving minors. No real threats or self-harm encouragement. Roast the user while prioritizing humor.

Backchannel policy: Use brief, natural acknowledgments.
Interruption policy: Stop your answer when interrupted and listen.
Delegation policy: No backend tools or reasoning service are available. Handle roast comedy directly; do not delegate requests or claim to perform tasks.
`.trim();

export const BUILTIN_LIVE_VOICES = [
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

export function getLiveConfig(env = {}) {
  return {
    model: env.OPENAI_LIVE_MODEL || DEFAULT_LIVE_MODEL,
    voice: env.OPENAI_LIVE_VOICE || DEFAULT_LIVE_VOICE,
  };
}

export function getLiveVoices(env = {}) {
  const { voice: defaultVoice } = getLiveConfig(env);
  const voices = BUILTIN_LIVE_VOICES.map((option) => ({ ...option }));
  if (!voices.some((option) => option.id === defaultVoice)) {
    voices.unshift({ id: defaultVoice, label: defaultVoice, vibe: "Server default" });
  }
  return voices;
}
