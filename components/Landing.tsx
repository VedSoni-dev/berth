"use client";
// The public front door at /: what berth is, your own machine read live, what works, and the way in.
// No sign-in here; the console at /app opens with Sign in with publik.
import { useEffect, useState } from "react";
import { Mark } from "./Mark";
import { PublikPitch } from "./PublikGate";
import { detectMachine, type Machine } from "@/lib/local";

const REPO = "https://github.com/VedSoni-dev/berth";
const LISTING = "https://publikhq.com/berth";
const FILM = "https://vedsoni-dev.github.io/berth/berth.mp4";

const WORKS: [string, string][] = [
  ["A model in a tab", "WebLLM on WebGPU. Pick a small open-weight model (Qwen, Llama, Gemma, Phi, SmolLM), press play, and it downloads once and runs on your GPU. Nothing to install."],
  ["A real local endpoint", "Connect Ollama on localhost and berth shows http://localhost:11434/v1 with copy, plus curl, Python and JS snippets and a Test endpoint button. Any app that speaks the OpenAI API can use it."],
  ["Pull any model", "Not a locked list: type any Ollama tag and watch it download with bytes and percent. Delete what you don't need."],
  ["Speed on every answer", "Tokens per second and time to first token under each reply, so you can see what your machine really does."],
  ["A privacy meter", "Counts network requests after the model loaded. In tab mode it stays at zero while you chat."],
  ["More than one machine", "Add another computer running Ollama on your network as a second node and send chats to whichever one you pick."],
];

const NOT_YET = [
  "Pooling memory across machines to run one model bigger than any single box (each machine runs whole models)",
  "A native app or menu-bar server; the tab engine has no HTTP endpoint (use Ollama for that)",
  "Thunderbolt or RDMA clustering",
];

export function Landing() {
  const [m, setM] = useState<Machine | null>(null);
  const [film, setFilm] = useState(true);
  useEffect(() => {
    void detectMachine().then(setM);
  }, []);
  return (
    <div className="landing">
      <header className="lp-top">
        <a className="brand" href="/">
          <Mark /> <span>berth</span>
        </a>
        <nav>
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href={LISTING} target="_blank" rel="noopener noreferrer">
            publik
          </a>
          <a className="btn primary" href="/app">
            Open berth →
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">free &amp; open source · on publik</p>
            <h1>
              A private AI server,
              <br />
              on the machine you&apos;re on.
            </h1>
            <p className="lede">
              berth runs open-weight models on your own hardware. Open a tab, pick a model, press play, and chat with it on your GPU, or connect Ollama
              and get an OpenAI-compatible endpoint your apps can call. Your prompts don&apos;t leave the machine.
            </p>
            <div className="hero-actions">
              <a className="btn primary big" href="/app">
                Open berth →
              </a>
              <a className="btn big" href={REPO} target="_blank" rel="noopener noreferrer">
                View the code
              </a>
            </div>
            <p className="small muted">No waitlist. Any computer with a WebGPU browser: Mac, Windows or Linux.</p>
          </div>

          <div className="hero-live" aria-label="Your machine, read live by this page">
            <div className="bar mini">
              <span className="picker">
                <span className="picker-k">model</span>
                <span className="picker-v">Qwen2.5 0.5B</span>
              </span>
              <span className="pill pill-running">
                <i />
                ready
              </span>
              <span className="chip">
                <span className="chip-k">endpoint</span>
                <code>localhost:11434/v1</code>
              </span>
              <span className="play on-hero">
                <span className="tri" /> Play
              </span>
            </div>
            <div className="canvas hero-canvas">
              <article className="node sel">
                <header>
                  <span className="dot on" />
                  <b>This machine</b>
                  <span className="live-tag">read live</span>
                </header>
                <dl>
                  <dt>platform</dt>
                  <dd>{m ? `${m.platform} · ${m.browser}` : "…"}</dd>
                  <dt>gpu</dt>
                  <dd>{m ? m.gpu ?? "no WebGPU here" : "…"}</dd>
                  <dt>cores</dt>
                  <dd>{m?.cores ?? "…"}</dd>
                </dl>
                <ul className="engines">
                  <li className={m?.webgpu ? "ok" : "no"}>
                    <span>in this tab</span>
                    <em>{m ? (m.webgpu ? "can run models" : "needs WebGPU") : "…"}</em>
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        {film && (
          <section className="film">
            <video src={FILM} controls playsInline muted preload="metadata" onError={() => setFilm(false)} />
          </section>
        )}

        <section className="works">
          <h2>What works today</h2>
          <div className="grid">
            {WORKS.map(([t, d]) => (
              <article key={t}>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
          <h2 className="h-not">Not yet</h2>
          <ul className="notyet">
            {NOT_YET.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>

        <section className="lp-publik">
          <h2>Free, because of publik</h2>
          <PublikPitch appName="berth" className="lp-pitch" />
          <p className="small muted">
            Signing in to the console is how publik counts usage. The models run on your machine either way; publik API is only used if you pick the optional
            cloud engine.
          </p>
          <a className="btn primary big" href="/app">
            Open berth →
          </a>
        </section>
      </main>

      <footer className="lp-foot">
        <span>
          free &amp; open source (MIT) · <a href={REPO}>GitHub</a> · built by{" "}
          <a href="https://x.com/forkthis_ai" target="_blank" rel="noopener noreferrer">
            @forkthis_ai
          </a>
        </span>
        <span>not affiliated with Apple or Claris</span>
      </footer>
    </div>
  );
}
