// The one exchange the landing page replays in the hero's phone (and shows finished in the steps).
// A real run, as the phone app showed it at 390 px: berth serve on a Mac named "Mac mini" (berth serve
// --name "Mac mini"), the phone asking over the Wi-Fi. That Mac had no Ollama, so berth proxied to its test
// upstream, whose one model is called "demo" and whose reply only says what is true of any model berth
// serves. The numbers are the ones the phone measured and printed under the answer.

export type HeroChat = {
  /** What the person typed on the phone. */
  question: string;
  /** The model's answer, as streamed (light markdown). */
  answer: string;
  /** The Ollama model tag the phone had picked, e.g. "qwen2.5:7b". */
  model: string;
  /** The Mac's name as berth shows it in the phone's header ("running on <mac>"). */
  mac: string;
  /** Tokens per second, as the phone app prints it under the answer. */
  tokPerSec: number;
  /** Time to first token, in seconds. */
  ttft: number;
  /** Tokens in the answer. */
  tokens: number;
  /** true while these are stand-ins; set false (or delete) with a real transcript. */
  temporary?: boolean;
};

export const HERO_CHAT: HeroChat = {
  question: "Where are you running right now?",
  answer:
    "On **Mac mini**. Your phone sent this question over your Wi-Fi, and the Mac is writing the answer back to you a few words at a time. The phone just shows it.\n\nThe phone is the screen. The Mac is the engine.",
  model: "demo",
  mac: "Mac mini",
  tokPerSec: 30.6,
  ttft: 0.2,
  tokens: 42,
};

/** The pairing address shown in the terminal and encoded in its QR code (an example token). */
export const PAIR_URL = "http://mac-mini.local:7770/?t=Q2vX9pLm4TzR8sKd0bWnYh3e";

/** The one command. */
export const COMMAND = "npx github:VedSoni-dev/berth serve";
