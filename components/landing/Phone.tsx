"use client";
// The phone app the Mac serves (serve/phone: index.html, phone.css, phone.js), rebuilt as React for the
// landing page: the same header, messages, dock and sheets, the same words, drawn with landing.css's
// bp-* rules (phone.css's rules under their own prefix, so nothing collides with the console's CSS).
// Every phone here is a picture (role="img"): its buttons are spans, nothing in it takes the focus.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HERO_CHAT, type HeroChat } from "./heroChat";

/* ---------------- phone.js's tiny, safe markdown, ported as is ---------------- */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
export function md(src: string): string {
  let html = "";
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) html += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  const close = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (const line of src.split("\n")) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { flush(); close(); html += `<h4>${inline(m[1])}</h4>`; continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flush(); if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flush(); if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; continue; }
    if (!line.trim()) { flush(); close(); continue; }
    close();
    para.push(line);
  }
  flush();
  close();
  return html;
}

/* ---------------- pieces ---------------- */
export const BerthMark = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    <path d="M12 3v5.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

function Top({ mac }: { mac: string }) {
  return (
    <div className="bp-top">
      <div className="bp-mac">
        <BerthMark />
        <div className="bp-mac-t">
          <span className="bp-mac-k">running on</span>
          <span className="bp-mac-n">{mac}</span>
        </div>
      </div>
      <span className="bp-conn is-on">
        <i className="bp-dot" />
        connected
      </span>
      <span className="bp-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </span>
    </div>
  );
}

function Dock({ model, speed, typed, send, ask = true }: { model: string; speed?: number | null; typed?: string | null; send: "off" | "on" | "stop"; ask?: boolean }) {
  return (
    <div className="bp-dock">
      <div className="bp-dock-row">
        <span className="bp-model">
          <span className="bp-model-v">{model}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
        <span className="bp-speed">{speed ? <><b>{speed}</b> tok/s</> : null}</span>
        <span className="bp-icon bp-icon--small" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 11v6" />
            <circle cx="12" cy="7.6" r=".6" fill="currentColor" />
          </svg>
        </span>
      </div>
      {ask && <div className="bp-ask">
        <span className={`bp-input ${typed ? "" : "is-empty"}`}>
          {typed ? <>{typed}<span className="bp-field-caret" /></> : `Ask ${model}`}
        </span>
        <span className={`bp-send ${send === "stop" ? "is-stop" : send === "off" ? "is-off" : ""}`}>
          {send === "stop" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          )}
        </span>
      </div>}
    </div>
  );
}

const meta = (c: HeroChat) => (
  <div className="bp-meta">
    <span><b>{c.tokPerSec}</b> tok/s</span>
    <span>{c.ttft.toFixed(1)} s to first token</span>
    <span>{c.tokens} tokens</span>
    <span>on {c.mac}</span>
  </div>
);

const SUGGESTIONS = ["Explain how a heat pump works, like I'm 12.", "Write a two-line toast for a friend's 30th.", "Plan a 20-minute bodyweight workout."];

function Empty({ c }: { c: HeroChat }) {
  return (
    <div className="bp-empty">
      <p className="bp-empty-h">
        Your phone asks.
        <br />
        <em>Your Mac answers.</em>
      </p>
      <p className="bp-empty-p">
        <b>{c.model}</b> runs on <b>{c.mac}</b>. This phone only sends your message and shows the answer as it&apos;s written.
      </p>
      <div className="bp-sugg">
        {SUGGESTIONS.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  );
}

/** The device: a bezel and a screen, holding the app. A picture, never a control. */
export function Device({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`bp-device ui ui-phone ${className}`} role="img" aria-label={label}>
      <div className="bp-screen">
        <div className="bp-app">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- the replay: one exchange, typed, sent and streamed ---------------- */
type Frame = { phase: "done" | "empty" | "typing" | "thinking" | "streaming"; typed: string; shown: string; ms: number };

function timeline(c: HeroChat, first: boolean): Frame[] {
  const f: Frame[] = [];
  f.push({ phase: "done", typed: "", shown: c.answer, ms: first ? 2600 : 6200 });
  f.push({ phase: "empty", typed: "", shown: "", ms: 700 });
  for (let i = 1; i <= c.question.length; i++) {
    const ch = c.question[i - 1];
    f.push({ phase: "typing", typed: c.question.slice(0, i), shown: "", ms: ch === " " ? 95 : 52 });
  }
  f.push({ phase: "typing", typed: c.question, shown: "", ms: 420 });
  f.push({ phase: "thinking", typed: "", shown: "", ms: Math.max(450, Math.round(c.ttft * 1000)) });
  // the answer arrives at the model's own speed: its tokens over tokPerSec, in word-sized pieces
  const pieces = c.answer.match(/\s*\S+/g) ?? [c.answer];
  const each = Math.max(12, Math.round(((c.tokens / Math.max(c.tokPerSec, 1)) * 1000) / pieces.length));
  let shown = "";
  for (const p of pieces) {
    shown += p;
    f.push({ phase: "streaming", typed: "", shown, ms: each });
  }
  return f;
}

const ROUNDS = 3;
const PAUSE_SVG = (
  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.25" y="3.25" width="2.75" height="9.5" rx="0.9" /><rect x="9" y="3.25" width="2.75" height="9.5" rx="0.9" /></svg>
);
const PLAY_SVG = (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.25 3.7v8.6c0 .62.68 1 1.2.66l6.5-4.3c.47-.31.47-1 0-1.32l-6.5-4.3c-.52-.34-1.2.04-1.2.66Z" /></svg>
);

/** The hero's phone. Server-rendered on its finished picture (the exchange answered), which is also what
 *  reduced motion and no script show; after load it replays the exchange three times, then rests. */
export function HeroPhone({ c = HERO_CHAT }: { c?: HeroChat }) {
  const done: Frame = { phase: "done", typed: "", shown: c.answer, ms: 0 };
  const [frame, setFrame] = useState<Frame>(done);
  const [running, setRunning] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const run = useRef<{ frames: Frame[]; i: number; round: number; t: ReturnType<typeof setTimeout> | null }>({ frames: [], i: 0, round: 0, t: null });

  const step = () => {
    const r = run.current;
    if (r.i >= r.frames.length) {
      r.round += 1;
      if (r.round >= ROUNDS) {
        setFrame(done);
        setRunning(false);
        r.t = null;
        return;
      }
      r.frames = timeline(c, false);
      r.i = 0;
    }
    const fr = r.frames[r.i++];
    setFrame(fr);
    r.t = setTimeout(step, fr.ms);
  };
  const start = (fresh: boolean) => {
    const r = run.current;
    if (r.t) clearTimeout(r.t);
    if (fresh) {
      r.frames = timeline(c, true);
      r.i = 0;
      r.round = 0;
    }
    setRunning(true);
    step();
  };
  const pause = () => {
    const r = run.current;
    if (r.t) clearTimeout(r.t);
    r.t = null;
    setRunning(false);
  };

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (q.matches) return;
    setCanPlay(true);
    start(true);
    const onChange = () => {
      if (q.matches) {
        pause();
        setFrame(done);
        setCanPlay(false);
      }
    };
    q.addEventListener("change", onChange);
    const r = run.current;
    return () => {
      q.removeEventListener("change", onChange);
      if (r.t) clearTimeout(r.t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    if (running) pause();
    else start(run.current.round >= ROUNDS || run.current.frames.length === 0);
  };

  const showChat = frame.phase === "thinking" || frame.phase === "streaming" || frame.phase === "done";
  const label = `berth on a phone, running on ${c.mac}. Someone asks ${c.model}: "${c.question}" The answer streams in, and under it: ${c.tokPerSec} tokens a second.`;
  // the hero's picture: the frame holds the grain ground (fx.js draws it, held still), the phone, and the
  // replay's pause disc as the frame's own child (so system.js adds no second one)
  return (
    <div
      className="hero__media frame span-6 start-7 lp-hero-frame"
      data-fx="grain-gradient"
      data-fx-seed="7"
      data-fx-params='{"speed":0,"grainMotion":0,"calm":0.55,"calmX":0.5,"calmY":0.5}'
    >
      <div className="stage">
        <div className="lp-hero-phone">
      <Device label={label} className="bp-device--hero">
        <Top mac={c.mac} />
        <div className="bp-msgs">
          {!showChat && <Empty c={c} />}
          {showChat && <div className="bp-msg bp-msg--user">{c.question}</div>}
          {frame.phase === "thinking" && (
            <p className="bp-wait">
              <i className="bp-dot" />
              {c.mac} is thinking…
            </p>
          )}
          {(frame.phase === "streaming" || frame.phase === "done") && (
            <div className="bp-msg bp-msg--bot">
              <div className="bp-txt" dangerouslySetInnerHTML={{ __html: md(frame.shown) + (frame.phase === "streaming" ? '<span class="bp-caret"></span>' : "") }} />
              {frame.phase === "done" && meta(c)}
            </div>
          )}
        </div>
        <Dock
          model={c.model}
          speed={frame.phase === "done" ? c.tokPerSec : null}
          typed={frame.phase === "typing" ? frame.typed : null}
          send={frame.phase === "thinking" || frame.phase === "streaming" ? "stop" : frame.phase === "typing" && frame.typed ? "on" : "off"}
        />
      </Device>
        </div>
      </div>
      {canPlay && (
        <button type="button" className={`ui-pause loop-pause ${running ? "" : "is-paused"}`} aria-label={running ? "Pause animation" : "Play animation"} title={running ? "Pause animation" : "Play animation"} onClick={toggle}>
          {running ? PAUSE_SVG : PLAY_SVG}
        </button>
      )}
    </div>
  );
}

/* ---------------- still views, for the steps ---------------- */
export function PhoneFirstScreen({ c = HERO_CHAT }: { c?: HeroChat }) {
  return (
    <Device label={`berth's first screen on the phone after scanning: running on ${c.mac}, connected. Your phone asks. Your Mac answers.`}>
      <Top mac={c.mac} />
      <div className="bp-msgs">
        <Empty c={c} />
      </div>
      <Dock model={c.model} send="off" />
    </Device>
  );
}

export function PhoneAnswered({ c = HERO_CHAT }: { c?: HeroChat }) {
  return (
    <Device label={`The answer from ${c.model} on the phone, with ${c.tokPerSec} tokens a second under it.`}>
      <Top mac={c.mac} />
      <div className="bp-msgs">
        <div className="bp-msg bp-msg--user">{c.question}</div>
        <div className="bp-msg bp-msg--bot">
          <div className="bp-txt" dangerouslySetInnerHTML={{ __html: md(c.answer) }} />
          {meta(c)}
        </div>
      </div>
      <Dock model={c.model} speed={c.tokPerSec} send="off" />
    </Device>
  );
}

/* ---------------- fragments of the app, for the cards ---------------- */
export type SheetModel = { id: string; bits: string; loaded?: boolean };

/** The model sheet ("Models on <mac>"), as the phone shows it over the chat. */
export function ModelsSheet({ mac, models, pick }: { mac: string; models: SheetModel[]; pick: string }) {
  return (
    <div className="bp-sheet ui ui-phone" role="img" aria-label={`The model sheet on the phone: the models on ${mac}, with ${pick} picked.`}>
      <div className="bp-grab" />
      <p className="bp-sheet-h">Models on {mac}</p>
      <ul className="bp-models">
        {models.map((m) => (
          <li key={m.id} className={m.id === pick ? "is-on" : ""}>
            <b>{m.id}</b>
            <span className="bp-tick">{m.id === pick ? "✓" : ""}</span>
            <small>
              {m.bits}
              {m.loaded && <> · <span className="bp-tag">in memory</span></>}
            </small>
          </li>
        ))}
      </ul>
      <p className="bp-hint">
        Add one on the Mac: <code>ollama pull qwen2.5:7b</code>. It shows up here.
      </p>
    </div>
  );
}

/** The end of an answer: its last line, the speed line under it, and the dock. */
export function SpeedFragment({ c = HERO_CHAT }: { c?: HeroChat }) {
  const last = c.answer.split("\n").filter((l) => l.trim()).slice(-1)[0] ?? c.answer;
  return (
    <div className="bp-frag ui ui-phone" role="img" aria-label={`The line under an answer: ${c.tokPerSec} tokens a second, ${c.ttft.toFixed(1)} seconds to the first token, ${c.tokens} tokens, on ${c.mac}.`}>
      <div className="bp-msgs bp-msgs--frag">
        <div className="bp-msg bp-msg--bot">
          <div className="bp-txt" dangerouslySetInnerHTML={{ __html: md(last.replace(/^\s*\d+[.)]\s+/, "")) }} />
          {meta(c)}
        </div>
      </div>
      <Dock model={c.model} speed={c.tokPerSec} send="off" ask={false} />
    </div>
  );
}

/** The "How this works" sheet's Home Screen part, with the app's icon. */
export function HomeSheet({ mac }: { mac: string }) {
  return (
    <div className="bp-sheet ui ui-phone" role="img" aria-label="The phone app's sheet on putting berth on the Home Screen, with berth's icon.">
      <div className="bp-grab" />
      <div className="bp-appicon">
        <span className="bp-appicon-tile"><BerthMark size={30} /></span>
        <span>berth</span>
      </div>
      <p className="bp-sheet-h">Put it on your Home Screen</p>
      <p className="bp-sheet-p">iPhone: Share, then Add to Home Screen. Android: the ⋮ menu, then Add to Home screen.</p>
      <p className="bp-sheet-h bp-sheet-h--sm">Your Mac is the engine</p>
      <p className="bp-sheet-p">The model runs on <b>{mac}</b>. This phone sends your message over your Wi-Fi and shows the answer as the Mac writes it.</p>
    </div>
  );
}

/** What a phone without the pairing code sees. */
export function PairScreen({ mac }: { mac: string }) {
  return (
    <div className="bp-pair ui ui-phone" role="img" aria-label={`The page a phone sees without the pairing code: Pair with ${mac}.`}>
      <BerthMark size={40} />
      <p className="bp-pair-h">Pair with {mac}</p>
      <p className="bp-pair-p">
        This is berth, serving models from a Mac on your network. To chat, scan the QR code that <code>berth serve</code> printed in the Mac&apos;s terminal.
      </p>
    </div>
  );
}
