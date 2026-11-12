"use client";
// The phone side of berth, as the dashboard sees it: `berth serve` runs on this Mac and answers a
// loopback-only status at http://localhost:7770/berth/status (no pairing code in it). The dashboard
// shows whether it's running and whether a phone is paired.

export const SERVE_CMD = "npx github:VedSoni-dev/berth serve";
export const BERTH_LOCAL = "http://localhost:7770";

export type PhoneSeen = { kind: string; lastSeenAgo: number; answers: number; tokens: number };
export type BerthStatus = {
  berth: string;
  mac: string;
  address: string;
  upSince: number;
  upstream: { ok: boolean; label: string; url: string; models: number };
  paired: boolean;
  phones: PhoneSeen[];
  answers: number;
  tokens: number;
};

/** null when berth serve isn't running on this machine (or this browser can't reach it). */
export async function berthStatus(): Promise<BerthStatus | null> {
  try {
    const r = await fetch(`${BERTH_LOCAL}/berth/status`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = (await r.json()) as BerthStatus;
    return j && typeof j.berth === "string" ? j : null;
  } catch {
    return null;
  }
}

export const ago = (ms: number) =>
  ms < 5000 ? "just now" : ms < 60_000 ? `${Math.round(ms / 1000)} s ago` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`;
