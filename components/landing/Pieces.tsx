"use client";
// The landing page's small live parts: the copy button, the Mac's terminal, the dashboard's window and the film.
import { useEffect, useState } from "react";
import { detectMachine, type Machine } from "@/lib/local";
import { COMMAND, HERO_CHAT, PAIR_URL } from "./heroChat";
import { QR_PATH, QR_SIZE } from "./qr";
import { BerthMark } from "./Phone";

/* ---------------- the command, and the button that copies it ---------------- */
/** The command as the hero sets it: one line where it fits, broken after "github:" and "berth" where it doesn't. */
export function CommandLine() {
  return (
    <p className="cmd-line">
      <code>
        npx <wbr />
        github:VedSoni-dev/<wbr />
        berth serve
      </code>
    </p>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // an http page or an old browser: a hidden field and the old copy command
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** The page's main action. It copies COMMAND; the glyph turns into a check for 1.8 s and a status line says so. */
export function CopyCommand({ xl = false, className = "" }: { xl?: boolean; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <>
      <button
        type="button"
        className={`btn btn--primary${xl ? " btn--xl" : ""} ${className}`}
        data-copied={state === "copied" ? "" : undefined}
        onClick={() => void copyText(COMMAND).then((ok) => setState(ok ? "copied" : "failed"))}
      >
        Copy the command
        <svg className="cp-glyph" viewBox="0 0 16 16" aria-hidden="true">
          {state === "copied" ? (
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 3.2V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>
      <span className="sr-only" role="status">
        {state === "copied" ? "Copied: paste it into Terminal on your Mac." : state === "failed" ? `Select the command and copy it: ${COMMAND}` : ""}
      </span>
    </>
  );
}

/* ---------------- the Mac's terminal: berth serve, as it prints ---------------- */
export function TerminalServe() {
  const c = HERO_CHAT;
  return (
    <div className="bt-term ui ui-panel" role="img" aria-label={`The Mac's terminal after ${COMMAND}: berth is serving ${c.mac} to your phone, with a QR code and the address ${PAIR_URL}.`}>
      <div className="bt-term__head">
        <span className="ui-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="bt-term__title">Terminal</span>
        <span className="bt-term__meta">zsh</span>
      </div>
      <div className="bt-term__body">
        <span className="is-cmd">{COMMAND}</span>
        <span className="is-gap" />
        <span><b>berth</b> is serving <b>{c.mac}</b> to your phone <span className="is-dim">(v0.2.0)</span></span>
        <svg className="bt-qr" viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} shapeRendering="crispEdges" aria-hidden="true">
          <rect width={QR_SIZE} height={QR_SIZE} fill="#fff" />
          <path d={QR_PATH} fill="#000" />
        </svg>
        <span>Scan it with your phone&apos;s camera (same Wi-Fi), or open:</span>
        <span className="is-url">{PAIR_URL}</span>
        <span className="is-gap" />
        <span>Models: Ollama at http://127.0.0.1:11434, 3 (qwen2.5:7b, llama3.2:3b, gemma3:4b)</span>
        <span className="is-dim">Ctrl-C to stop.</span>
      </div>
    </div>
  );
}

/* ---------------- the dashboard at /app: its bar, this machine read live, the privacy meter ---------------- */
export function DashboardWindow() {
  const [m, setM] = useState<Machine | null>(null);
  useEffect(() => {
    void detectMachine().then(setM);
  }, []);
  return (
    <div className="bd-win ui ui-panel" role="img" aria-label="berth's dashboard: a small model running in this browser tab, the machine read live, and 0 network requests since the model loaded.">
      <div className="bd-bar">
        <span className="bd-brand"><BerthMark size={16} /> berth</span>
        <span className="bd-seg"><span className="is-on">In this tab</span><span>Ollama</span><span>Cloud</span></span>
        <span className="bd-picker"><span className="bd-k">model</span><span className="bd-v">Qwen2.5 0.5B</span></span>
        <span className="bd-pill"><i />running</span>
        <span className="bd-play"><span className="bd-sq" />Stop</span>
      </div>
      <div className="bd-canvas">
        <div className="bd-node">
          <div className="bd-node__head"><span className="bd-dot" /><b>This machine</b><span className="bd-live">read live</span></div>
          <dl>
            <dt>platform</dt>
            <dd>{m ? `${m.platform} · ${m.browser}` : "reading"}</dd>
            <dt>gpu</dt>
            <dd>{m ? (m.webgpu ? "WebGPU ready" : "no WebGPU here") : "reading"}</dd>
            <dt>cores</dt>
            <dd>{m ? m.cores ?? "not reported" : "reading"}</dd>
          </dl>
          <ul className="bd-engines">
            <li className={m?.webgpu ? "ok" : "no"}><span>in this tab</span><em>{m ? (m.webgpu ? "can run models" : "needs WebGPU") : "…"}</em></li>
            <li className="no"><span>ollama</span><em>not found</em></li>
          </ul>
        </div>
        <div className="bd-privacy">
          <b>0</b>
          <span>network requests since the model loaded <em>· prompts stay on this machine</em></span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- the film: a real video, gone if the file isn't there ---------------- */
export const FILM = "https://vedsoni-dev.github.io/berth/berth.mp4";

export function FilmSection() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <section className="section ground-inverse" id="film" aria-labelledby="film-h">
      <div className="wrap">
        <div className="section-head">
          <h2 id="film-h">The berth film</h2>
        </div>
        {/* CLIENT FILE film: https://vedsoni-dev.github.io/berth/berth.mp4 (16:9, H.264); a new cut is being made.
            The section removes itself when the file does not load. */}
        <figure className="frame frame--photo fit-screen film-frame">
          <video className="frame__img" src={FILM} controls playsInline muted preload="metadata" onError={() => setOk(false)} />
        </figure>
      </div>
    </section>
  );
}
