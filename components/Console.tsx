"use client";
// berth's console at /app: your machine as a node, a model picker and a play button, a chat drawer with
// tokens/sec, and an inspector with the endpoint and code. Everything is the person's own: their machine,
// their models, their conversation. Nothing here is sample data.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublikChoice, usePublik } from "./PublikGate";
import { Mark } from "./Mark";
import {
  DEFAULT_OLLAMA,
  DEFAULT_TAB_MODEL,
  TAB_MODELS,
  approxDownloadMB,
  cleanUrl,
  detectMachine,
  fmtBytes,
  fmtUptime,
  ollamaDelete,
  ollamaList,
  ollamaLoad,
  ollamaPing,
  ollamaPull,
  ollamaRunning,
  ollamaUnload,
  sseChat,
  tabCached,
  tabChat,
  tabDelete,
  tabLoad,
  tabStop,
  tabUnload,
  type Engine,
  type Machine,
  type Msg,
  type OllamaModel,
  type OllamaStatus,
  type Stats,
} from "@/lib/local";
import { SERVE_CMD, ago, berthStatus, type BerthStatus } from "@/lib/phone";

/* ---------------- saved settings (this browser only) ---------------- */

type Host = { id: string; label: string; url: string };
type Turn = { role: "user" | "assistant"; content: string; stats?: Stats; model?: string; engine?: Engine; error?: string; topUpUrl?: string };
type Saved = {
  onboarded: boolean;
  engine: Engine;
  tabModel: string;
  hosts: Host[];
  host: string;
  ollamaModel: string;
  tier: string;
  ownBase: string;
  ownModel: string;
  ownKey: string;
  system: string;
  turns: Turn[];
};
const KEY = "berth:v1";
const LOCAL_HOST: Host = { id: "local", label: "This machine", url: DEFAULT_OLLAMA };
const FRESH: Saved = {
  onboarded: false,
  engine: "tab",
  tabModel: DEFAULT_TAB_MODEL,
  hosts: [LOCAL_HOST],
  host: "local",
  ollamaModel: "",
  tier: "publik-fast",
  ownBase: "https://api.openai.com/v1",
  ownModel: "gpt-4o-mini",
  ownKey: "",
  system: "You are a helpful assistant running privately on the user's own machine. Be concise.",
  turns: [],
};
function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s ? { ...FRESH, ...s, hosts: s.hosts?.length ? s.hosts : [LOCAL_HOST] } : FRESH;
  } catch {
    return FRESH;
  }
}

const SUGGESTIONS = [
  "In two sentences: what is a context window?",
  "Write a haiku about a laptop fan spinning up.",
  "Give me 3 names for a sailing club, one line each.",
];

type Status = "idle" | "loading" | "running" | "error";

export function Console() {
  const { choice } = usePublik();
  const [s, setS] = useState<Saved>(FRESH);
  const [hydrated, setHydrated] = useState(false);
  const set = useCallback((p: Partial<Saved>) => setS((o) => ({ ...o, ...p })), []);

  const [machine, setMachine] = useState<Machine | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [statusNote, setStatusNote] = useState("");
  const [progress, setProgress] = useState<{ fraction: number; text: string } | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [hostState, setHostState] = useState<Record<string, { st: OllamaStatus | null; models: OllamaModel[]; running: string[] }>>({});
  const [pull, setPull] = useState<{ model: string; status: string; completed: number; total: number } | null>(null);
  const pullAbort = useRef<AbortController | null>(null);
  const [library, setLibrary] = useState(false);
  const [addHost, setAddHost] = useState(false);
  const [toast, setToast] = useState("");

  // hydrate from this browser
  useEffect(() => {
    setS(load());
    setHydrated(true);
    void detectMachine().then(setMachine);
    void tabCached(TAB_MODELS.map((m) => m.id)).then(setCached).catch(() => {});
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  }, [s, hydrated]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // berth serve on this Mac (the phone side): undefined while checking, null when it isn't running
  const [phone, setPhone] = useState<BerthStatus | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (document.hidden) return;
      const st = await berthStatus();
      if (live) setPhone(st);
    };
    void check();
    const t = setInterval(() => void check(), 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const host = s.hosts.find((h) => h.id === s.host) ?? s.hosts[0];

  const refreshHost = useCallback(async (h: Host) => {
    const st = await ollamaPing(h.url);
    let models: OllamaModel[] = [];
    let running: string[] = [];
    if (st.ok) {
      models = await ollamaList(h.url).catch(() => []);
      running = (await ollamaRunning(h.url)).map((r) => r.name);
    }
    setHostState((o) => ({ ...o, [h.id]: { st, models, running } }));
    return { st, models, running };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    s.hosts.forEach((h) => void refreshHost(h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, s.hosts.length]);

  // pick an installed Ollama model when none is chosen
  useEffect(() => {
    const hs = hostState[host.id];
    if (s.engine === "ollama" && hs?.models.length && !hs.models.some((m) => m.name === s.ollamaModel)) set({ ollamaModel: hs.models[0].name });
  }, [hostState, host.id, s.engine, s.ollamaModel, set]);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 1800);
  };
  const copy = (t: string, what = "Copied") => {
    void navigator.clipboard?.writeText(t).then(() => flash(what));
  };

  /* ---------------- play / stop ---------------- */

  const currentModel = s.engine === "tab" ? s.tabModel : s.engine === "ollama" ? s.ollamaModel : choice === "own_key" ? s.ownModel : s.tier;
  const modelLabel = s.engine === "tab" ? TAB_MODELS.find((m) => m.id === s.tabModel)?.label ?? s.tabModel : currentModel || "no model";

  const play = async () => {
    setStatusNote("");
    if (s.engine === "tab") {
      if (!machine?.webgpu) {
        setStatus("error");
        setStatusNote("This browser has no WebGPU. Use Chrome or Edge 113+, Safari 26+, or switch the engine to Ollama.");
        return;
      }
      setStatus("loading");
      setProgress({ fraction: 0, text: "Starting" });
      try {
        await tabLoad(s.tabModel, (p) => setProgress({ fraction: p.fraction, text: p.text }));
        setStatus("running");
        setLoadedAt(Date.now());
        setLoadedModel(s.tabModel);
        setCached((c) => ({ ...c, [s.tabModel]: true }));
      } catch (e) {
        setStatus("error");
        setStatusNote(String((e as Error).message || e).slice(0, 240));
      } finally {
        setProgress(null);
      }
    } else if (s.engine === "ollama") {
      if (!s.ollamaModel) {
        setLibrary(true);
        return;
      }
      setStatus("loading");
      setProgress({ fraction: -1, text: `Loading ${s.ollamaModel} into memory on ${host.label.toLowerCase()}` });
      try {
        await ollamaLoad(host.url, s.ollamaModel);
        setStatus("running");
        setLoadedAt(Date.now());
        setLoadedModel(s.ollamaModel);
        void refreshHost(host);
      } catch (e) {
        setStatus("error");
        setStatusNote(`Ollama at ${host.url} didn't load it: ${String((e as Error).message || e).slice(0, 160)}`);
      } finally {
        setProgress(null);
      }
    } else {
      setStatus("running");
      setLoadedAt(Date.now());
      setLoadedModel(currentModel);
    }
  };

  const stop = async () => {
    if (s.engine === "tab") await tabUnload();
    if (s.engine === "ollama" && loadedModel) await ollamaUnload(host.url, loadedModel).catch(() => {});
    setStatus("idle");
    setLoadedAt(null);
    setLoadedModel(null);
    void refreshHost(host);
  };

  // switching engine or model stops what was running
  const switchTo = async (p: Partial<Saved>) => {
    if (status === "running" || status === "loading") await stop();
    set(p);
  };

  /* ---------------- chat ---------------- */

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [drawer, setDrawer] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [s.turns]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    if (status !== "running") {
      flash("Press play to load the model first");
      return;
    }
    const history: Msg[] = [{ role: "system", content: s.system }, ...s.turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })), { role: "user", content: q }];
    setDraft("");
    setBusy(true);
    const model = loadedModel ?? currentModel;
    setS((o) => ({ ...o, turns: [...o.turns, { role: "user", content: q }, { role: "assistant", content: "", model: s.engine === "tab" ? modelLabel : model, engine: s.engine }] }));
    const append = (d: string) =>
      setS((o) => {
        const turns = o.turns.slice();
        const last = turns[turns.length - 1];
        turns[turns.length - 1] = { ...last, content: last.content + d };
        return { ...o, turns };
      });
    const finish = (p: Partial<Turn>) =>
      setS((o) => {
        const turns = o.turns.slice();
        turns[turns.length - 1] = { ...turns[turns.length - 1], ...p };
        return { ...o, turns };
      });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let st: Stats;
      if (s.engine === "tab") st = await tabChat(history, append);
      else if (s.engine === "ollama") st = await sseChat(`${cleanUrl(host.url)}/v1/chat/completions`, {}, { model, messages: history }, append, ac.signal);
      else if (choice === "own_key") {
        if (!s.ownKey) throw new Error("Add your API key in the inspector, or switch to your publik plan.");
        st = await sseChat(`${s.ownBase.replace(/\/+$/, "")}/chat/completions`, { authorization: `Bearer ${s.ownKey}` }, { model: s.ownModel, messages: history }, append, ac.signal);
      } else st = await sseChat("/api/publik/chat", {}, { tier: s.tier, messages: history, max_tokens: 1024 }, append, ac.signal);
      finish({ stats: st });
    } catch (e) {
      const err = e as Error & { topUpUrl?: string };
      if (err.name === "AbortError") finish({});
      else finish({ error: String(err.message || err), topUpUrl: err.topUpUrl });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };
  const stopAnswer = () => {
    if (s.engine === "tab") tabStop();
    abortRef.current?.abort();
  };

  /* ---------------- privacy meter: requests after the model loaded ---------------- */

  const [netAfter, setNetAfter] = useState<string[]>([]);
  useEffect(() => {
    setNetAfter([]);
    if (status !== "running" || !loadedAt) return;
    const since = performance.now();
    const localHosts = new Set(s.hosts.map((h) => new URL(h.url).host));
    const po = new PerformanceObserver((list) => {
      const hits = list
        .getEntries()
        .filter((e) => e.startTime >= since)
        .map((e) => e.name)
        .filter((n) => {
          try {
            return !localHosts.has(new URL(n).host);
          } catch {
            return false;
          }
        });
      if (hits.length) setNetAfter((o) => [...o, ...hits].slice(-50));
    });
    try {
      po.observe({ type: "resource", buffered: false });
    } catch {
      /* unsupported */
    }
    return () => po.disconnect();
  }, [status, loadedAt, s.hosts]);

  /* ---------------- derived ---------------- */

  const hs = hostState[host.id];
  const ollamaOk = !!hs?.st?.ok;
  const endpoint = s.engine === "ollama" ? `${cleanUrl(host.url)}/v1` : s.engine === "cloud" ? (choice === "own_key" ? s.ownBase : "publik API (cloud)") : "in this tab";
  const lastStats = [...s.turns].reverse().find((t) => t.stats)?.stats;
  const tabModel = TAB_MODELS.find((m) => m.id === s.tabModel);

  if (!hydrated) return <div className="boot" />;

  return (
    <div className="console">
      {/* ---------- top bar ---------- */}
      <header className="bar">
        <a className="brand" href="/" title="berth home">
          <Mark /> <span>berth</span>
        </a>
        <div className="bar-mid">
          <div className="seg" role="group" aria-label="Engine">
            {(
              [
                ["tab", "In this tab"],
                ["ollama", "Ollama"],
                ["cloud", "Cloud"],
              ] as [Engine, string][]
            ).map(([e, l]) => (
              <button key={e} aria-pressed={s.engine === e} onClick={() => void switchTo({ engine: e })}>
                {l}
              </button>
            ))}
          </div>
          <button className="picker" onClick={() => setLibrary(true)} title="Pick a model">
            <span className="picker-k">model</span>
            <span className="picker-v">{modelLabel}</span>
            <span aria-hidden>▾</span>
          </button>
          <span className={`pill pill-${status}`}>
            <i />
            {status === "loading" ? "loading" : status === "running" ? "running" : status === "error" ? "error" : "idle"}
          </span>
          <button className="chip" onClick={() => s.engine === "ollama" && copy(endpoint, "Endpoint copied")} title={s.engine === "ollama" ? "Copy endpoint" : endpoint}>
            <span className="chip-k">endpoint</span>
            <code>{endpoint}</code>
            {s.engine === "ollama" && <span aria-hidden>⧉</span>}
          </button>
        </div>
        <button
          className={`play ${status === "running" ? "on" : ""}`}
          onClick={() => void (status === "running" ? stop() : status === "loading" ? undefined : play())}
          disabled={status === "loading"}
          aria-label={status === "running" ? "Stop the model" : "Load and run the model"}
        >
          {status === "running" ? <span className="sq" /> : status === "loading" ? <span className="spin" /> : <span className="tri" />}
          <span>{status === "running" ? "Stop" : status === "loading" ? "Loading" : "Play"}</span>
        </button>
      </header>

      <div className="body">
        {/* ---------- canvas ---------- */}
        <section className="canvas" aria-label="Machines">
          <div className="nodes">
            {s.hosts.map((h, i) => {
              const st = hostState[h.id];
              const selected = (s.engine !== "ollama" && h.id === "local") || (s.engine === "ollama" && h.id === s.host);
              const isLocal = h.id === "local";
              return (
                <div key={h.id} className="node-wrap">
                  {i > 0 && <div className="edge" aria-hidden />}
                  <article className={`node ${selected ? "sel" : ""}`} onClick={() => s.engine === "ollama" && set({ host: h.id })}>
                    <header>
                      <span className={`dot ${selected && status === "running" ? "on" : ""}`} />
                      <b>{h.label}</b>
                      {!isLocal && (
                        <button
                          className="x"
                          aria-label={`Remove ${h.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            set({ hosts: s.hosts.filter((x) => x.id !== h.id), host: s.host === h.id ? "local" : s.host });
                          }}
                        >
                          ×
                        </button>
                      )}
                    </header>
                    {isLocal && machine && (
                      <dl>
                        <dt>platform</dt>
                        <dd>
                          {machine.platform} · {machine.browser}
                        </dd>
                        <dt>gpu</dt>
                        <dd>{machine.gpu ?? "no WebGPU"}</dd>
                        <dt>cores</dt>
                        <dd>{machine.cores ?? "?"}</dd>
                        <dt>memory</dt>
                        <dd>{machine.memoryGB ? `${machine.memoryGB >= 8 ? "8+ " : machine.memoryGB} GB (browser estimate)` : "not reported"}</dd>
                        <dt>fp16</dt>
                        <dd>{machine.webgpu ? (machine.f16 ? "yes" : "no") : "n/a"}</dd>
                      </dl>
                    )}
                    {isLocal && !machine && <p className="muted small">Reading this machine…</p>}
                    <ul className="engines">
                      {isLocal && (
                        <li className={machine?.webgpu ? "ok" : "no"}>
                          <span>in this tab</span>
                          <em>{machine?.webgpu ? "WebGPU ready" : "no WebGPU"}</em>
                        </li>
                      )}
                      <li className={st?.st?.ok ? "ok" : "no"}>
                        <span>ollama {isLocal ? "" : new URL(h.url).host}</span>
                        <em>{st?.st ? (st.st.ok ? `v${st.st.version} · ${st.models.length} models` : st.st.reason === "forbidden" ? "blocked: allow this site" : "not found") : "checking…"}</em>
                      </li>
                    </ul>
                    {selected && loadedModel && (
                      <p className="node-run">
                        <span className="dot on" /> {s.engine === "tab" ? tabModel?.label : loadedModel} · up {loadedAt ? fmtUptime(now - loadedAt) : ""}
                      </p>
                    )}
                    {selected && progress && (
                      <div className="prog" role="progressbar" aria-valuenow={Math.round(Math.max(progress.fraction, 0) * 100)}>
                        <div className={progress.fraction < 0 ? "indet" : ""} style={{ width: progress.fraction < 0 ? "30%" : `${Math.max(2, progress.fraction * 100)}%` }} />
                      </div>
                    )}
                    {selected && progress && <p className="prog-t">{progress.text}</p>}
                  </article>
                </div>
              );
            })}
            <div className="node-wrap">
              <div className="edge" aria-hidden />
              <PhoneNode st={phone} copy={copy} />
            </div>
            <button className="add-node" onClick={() => setAddHost(true)}>
              + add a machine
              <small>another computer running Ollama on your network</small>
            </button>
          </div>
          {statusNote && (
            <p className="note err" role="alert">
              {statusNote}
            </p>
          )}
          {s.engine === "ollama" && hs?.st && !hs.st.ok && <OllamaSetup url={host.url} reason={hs.st.reason} onRetry={() => void refreshHost(host)} copy={copy} />}
          {s.engine === "cloud" && (
            <p className="note warn">
              Cloud mode sends your prompts to {choice === "own_key" ? "the API you set" : "publik API"}. It is here to compare speed and to answer when this machine can&apos;t run a model.
              Your local engines never leave the machine.
            </p>
          )}
        </section>

        {/* ---------- inspector ---------- */}
        <aside className="inspector" aria-label="Inspector">
          <h2>Server</h2>
          <dl className="kv">
            <dt>status</dt>
            <dd>{status}</dd>
            <dt>engine</dt>
            <dd>{s.engine === "tab" ? "WebLLM · WebGPU" : s.engine === "ollama" ? `Ollama ${hs?.st?.ok ? "v" + hs.st.version : ""}` : choice === "own_key" ? "your API key" : "publik API"}</dd>
            <dt>model</dt>
            <dd>{loadedModel ? (s.engine === "tab" ? tabModel?.label : loadedModel) : "none loaded"}</dd>
            <dt>uptime</dt>
            <dd>{loadedAt ? fmtUptime(now - loadedAt) : "–"}</dd>
            {s.engine === "tab" && (
              <>
                <dt>memory</dt>
                <dd>~{tabModel ? (tabModel.vramMB / 1024).toFixed(1) : "?"} GB GPU</dd>
              </>
            )}
            <dt>last answer</dt>
            <dd>{lastStats ? `${lastStats.tokPerSec} tok/s · ${lastStats.ttftMs} ms to first token` : "–"}</dd>
          </dl>

          {s.engine !== "cloud" && (
            <div className={`privacy ${netAfter.length ? "leak" : ""}`}>
              <b>{status === "running" ? netAfter.length : "–"}</b>
              <span>
                network requests since the model loaded
                {status === "running" && !netAfter.length && <em> · prompts stay on this machine</em>}
              </span>
              {netAfter.length > 0 && (
                <details>
                  <summary>show</summary>
                  <ul>
                    {netAfter.map((n, i) => (
                      <li key={i}>{n.replace(/^https?:\/\//, "").slice(0, 70)}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {s.engine === "tab" && (
            <div className="block">
              <h3>Endpoint</h3>
              <p className="small muted">
                A browser tab can&apos;t open a port, so this engine has no HTTP endpoint: chat with it below. For an OpenAI-compatible endpoint your
                apps and agents can call, switch to <button className="link" onClick={() => void switchTo({ engine: "ollama" })}>Ollama</button>.
              </p>
            </div>
          )}

          {s.engine === "ollama" && <Snippets base={`${cleanUrl(host.url)}/v1`} model={s.ollamaModel || "llama3.2"} copy={copy} />}

          {s.engine === "cloud" && (
            <div className="block">
              <h3>Cloud</h3>
              <PublikChoice />
              {choice === "own_key" ? (
                <div className="form">
                  <label>
                    Base URL (OpenAI-compatible)
                    <input value={s.ownBase} onChange={(e) => set({ ownBase: e.target.value })} />
                  </label>
                  <label>
                    Model
                    <input value={s.ownModel} onChange={(e) => set({ ownModel: e.target.value })} />
                  </label>
                  <label>
                    API key <small>(kept in this browser only, sent straight to that URL)</small>
                    <input type="password" value={s.ownKey} onChange={(e) => set({ ownKey: e.target.value })} placeholder="sk-…" />
                  </label>
                </div>
              ) : (
                <label className="form">
                  publik tier
                  <select value={s.tier} onChange={(e) => void switchTo({ tier: e.target.value })}>
                    <option value="publik-fast">publik-fast</option>
                    <option value="publik-balanced">publik-balanced</option>
                    <option value="publik-smart">publik-smart</option>
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="block">
            <h3>System prompt</h3>
            <textarea rows={3} value={s.system} onChange={(e) => set({ system: e.target.value })} />
          </div>
          <p className="foot">free &amp; open source · not affiliated with Apple or Claris</p>
        </aside>
      </div>

      {/* ---------- chat drawer ---------- */}
      <section className={`drawer ${drawer ? "open" : ""}`} aria-label="Chat">
        <header>
          <button className="drawer-h" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer}>
            Chat <span className="muted">· {modelLabel}</span> <span aria-hidden>{drawer ? "▾" : "▴"}</span>
          </button>
          {lastStats && (
            <span className="stat">
              <b>{lastStats.tokPerSec}</b> tok/s · <b>{lastStats.ttftMs}</b> ms TTFT
            </span>
          )}
          {s.turns.length > 0 && (
            <button className="link" onClick={() => set({ turns: [] })}>
              clear
            </button>
          )}
        </header>
        {drawer && (
          <>
            <div className="msgs" ref={scroller}>
              {s.turns.length === 0 && (
                <HowTo
                  phone={phone}
                  copy={copy}
                  engine={s.engine}
                  status={status}
                  modelLabel={modelLabel}
                  sizeMB={s.engine === "tab" && tabModel ? approxDownloadMB(tabModel) : null}
                  cached={s.engine === "tab" ? !!cached[s.tabModel] : true}
                  onPlay={() => void play()}
                  onAsk={(q) => void send(q)}
                  onEndpoint={() => void switchTo({ engine: "ollama" })}
                />
              )}
              {s.turns.map((t, i) => (
                <div key={i} className={`msg ${t.role}`}>
                  {t.role === "assistant" && <span className="who">{t.model}</span>}
                  <div className="txt">{t.content || (busy && i === s.turns.length - 1 ? <span className="caret" /> : "")}</div>
                  {t.error && (
                    <p className="err small" role="alert">
                      {t.error}
                      {t.topUpUrl && (
                        <>
                          {" "}
                          <a href={t.topUpUrl} target="_blank" rel="noopener noreferrer">
                            Top up on publik
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  {t.stats && (
                    <span className="meta">
                      {t.stats.tokPerSec} tok/s · {t.stats.ttftMs} ms to first token · {t.stats.tokens} tokens · {(t.stats.totalMs / 1000).toFixed(1)} s
                    </span>
                  )}
                </div>
              ))}
            </div>
            <form
              className="ask"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <textarea
                rows={1}
                value={draft}
                placeholder={status === "running" ? `Message ${modelLabel}…` : "Press play to load the model, then ask anything"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
              />
              {busy ? (
                <button type="button" onClick={stopAnswer} className="btn">
                  Stop
                </button>
              ) : (
                <button className="btn primary" disabled={!draft.trim()}>
                  Send
                </button>
              )}
            </form>
          </>
        )}
      </section>

      {library && (
        <Library
          s={s}
          machine={machine}
          cached={cached}
          host={host}
          hs={hs}
          pull={pull}
          onClose={() => setLibrary(false)}
          onPickTab={(id) => {
            void switchTo({ tabModel: id, engine: "tab" });
            setLibrary(false);
          }}
          onPickOllama={(name) => {
            void switchTo({ ollamaModel: name, engine: "ollama" });
            setLibrary(false);
          }}
          onDeleteTab={async (id) => {
            await tabDelete(id).catch(() => {});
            setCached((c) => ({ ...c, [id]: false }));
            if (loadedModel === id) void stop();
          }}
          onDeleteOllama={async (name) => {
            await ollamaDelete(host.url, name).catch((e) => flash(String(e.message)));
            void refreshHost(host);
          }}
          onPull={async (name) => {
            const ac = new AbortController();
            pullAbort.current = ac;
            setPull({ model: name, status: "starting", completed: 0, total: 0 });
            try {
              await ollamaPull(host.url, name, (p) => setPull({ model: name, ...p }), ac.signal);
              await refreshHost(host);
              await switchTo({ ollamaModel: name, engine: "ollama" });
              flash(`${name} is ready`);
            } catch (e) {
              if ((e as Error).name !== "AbortError") flash(String((e as Error).message).slice(0, 120));
            } finally {
              setPull(null);
            }
          }}
          onCancelPull={() => pullAbort.current?.abort()}
          onRefresh={() => void refreshHost(host)}
        />
      )}

      {addHost && (
        <AddHost
          onClose={() => setAddHost(false)}
          onAdd={(label, url) => {
            const h = { id: `h${Date.now().toString(36)}`, label, url: cleanUrl(url) };
            set({ hosts: [...s.hosts, h], host: h.id, engine: "ollama" });
            setAddHost(false);
            void refreshHost(h);
          }}
        />
      )}

      {!s.onboarded && (
        <Onboarding
          machine={machine}
          ollama={hostState.local?.st ?? null}
          ollamaModels={hostState.local?.models ?? []}
          cached={cached}
          retryOllama={() => void refreshHost(LOCAL_HOST)}
          copy={copy}
          onDone={(p) => {
            set({ ...p, onboarded: true, host: "local" });
            setTimeout(() => document.querySelector<HTMLButtonElement>(".play")?.click(), 50);
          }}
          onSkip={() => set({ onboarded: true })}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------------- your phone (berth serve) ---------------- */

function PhoneNode({ st, copy }: { st: BerthStatus | null | undefined; copy: (t: string, what?: string) => void }) {
  const paired = !!st?.paired;
  const p = st?.phones[0];
  return (
    <article className={`node phone-node ${paired ? "sel" : ""}`} aria-label="Use it from your phone">
      <header>
        <span className={`dot ${paired ? "on" : ""}`} />
        <b>Your phone</b>
        <span className={`live-tag ${paired ? "" : "off"}`}>{st === undefined ? "checking" : !st ? "not running" : paired ? "paired" : "not paired"}</span>
      </header>
      {st === undefined && <p className="muted small">Looking for berth serve on this Mac…</p>}
      {st === null && (
        <>
          <h4>Use it from your phone</h4>
          <p className="small">Chat on your phone with the models Ollama runs on this Mac. Run this in Terminal:</p>
          <div className="cmd">
            <code>{SERVE_CMD}</code>
            <button className="link" onClick={() => copy(SERVE_CMD, "Command copied")}>
              copy
            </button>
          </div>
          <ul className="phone-why">
            <li>Serves a phone app over your Wi-Fi and prints a QR code to scan</li>
            <li>Your phone sends the question; this Mac runs the model</li>
            <li>A pairing code guards it; nothing goes through our servers</li>
          </ul>
        </>
      )}
      {st && (
        <>
          <dl>
            {paired && p ? (
              <>
                <dt>phone</dt>
                <dd>
                  {p.kind} · seen {ago(p.lastSeenAgo)}
                </dd>
                <dt>answers</dt>
                <dd>
                  {st.answers} · {st.tokens.toLocaleString()} tokens from this Mac
                </dd>
              </>
            ) : (
              <>
                <dt>phone</dt>
                <dd>not paired yet</dd>
              </>
            )}
            <dt>serving</dt>
            <dd>{st.address}</dd>
            <dt>models</dt>
            <dd>{st.upstream.ok ? `${st.upstream.label} · ${st.upstream.models} model${st.upstream.models === 1 ? "" : "s"}` : "Ollama isn't running"}</dd>
          </dl>
          <p className="node-run">
            {paired ? (
              <>
                <span className="dot on" /> {st.mac} is answering your phone
              </>
            ) : (
              <span className="muted">Scan the QR code in your terminal with your phone&apos;s camera.</span>
            )}
          </p>
        </>
      )}
    </article>
  );
}

/* ---------------- the inline how-to (empty chat) ---------------- */

function HowTo(p: {
  phone: BerthStatus | null | undefined;
  copy: (t: string, what?: string) => void;
  engine: Engine;
  status: Status;
  modelLabel: string;
  sizeMB: number | null;
  cached: boolean;
  onPlay: () => void;
  onAsk: (q: string) => void;
  onEndpoint: () => void;
}) {
  const running = p.status === "running";
  return (
    <div className="howto">
      <ol>
        <li className={p.phone?.paired ? "done" : ""}>
          <b>Use it from your phone.</b> Run <code>{SERVE_CMD}</code>{" "}
          <button className="link" onClick={() => p.copy(SERVE_CMD, "Command copied")}>
            copy
          </button>{" "}
          in Terminal on your Mac and scan the QR code it prints. Your phone chats; the Mac runs the model through Ollama.{" "}
          {p.phone ? (
            p.phone.paired ? (
              <em className="ok-note">Paired: {p.phone.phones[0]?.kind ?? "a phone"} is using {p.phone.mac}.</em>
            ) : (
              <em className="ok-note">berth is serving {p.phone.mac}; scan the QR code in your terminal.</em>
            )
          ) : null}
        </li>
        <li className={running ? "done" : ""}>
          <b>Load {p.modelLabel}.</b>{" "}
          {p.engine === "tab" ? (
            p.cached ? (
              <>It&apos;s already in this browser&apos;s cache, so loading takes seconds.</>
            ) : (
              <>
                The first time, its weights download once (about {p.sizeMB} MB) into this browser&apos;s cache.
              </>
            )
          ) : p.engine === "ollama" ? (
            <>Ollama loads it into memory and keeps it there for 30 minutes.</>
          ) : (
            <>Cloud answers come from the API you picked.</>
          )}{" "}
          {!running && p.status !== "loading" && (
            <button className="link" onClick={p.onPlay}>
              Play ▶
            </button>
          )}
        </li>
        <li>
          <b>Ask it something.</b> Tap one to try it on your model:
          <span className="chips">
            {SUGGESTIONS.map((q) => (
              <button key={q} className="sugg" disabled={!running} onClick={() => p.onAsk(q)}>
                {q}
              </button>
            ))}
          </span>
        </li>
        <li>
          <b>Use it from your code.</b>{" "}
          {p.engine === "ollama" ? (
            <>Copy the endpoint in the top bar, or a snippet from the inspector. It speaks the OpenAI API.</>
          ) : (
            <>
              Switch to <button className="link" onClick={p.onEndpoint}>Ollama</button> for a local OpenAI-compatible endpoint at <code>localhost:11434/v1</code>.
            </>
          )}
        </li>
      </ol>
    </div>
  );
}

/* ---------------- Ollama setup card ---------------- */

function OllamaSetup({ url, reason, onRetry, copy }: { url: string; reason: string; onRetry: () => void; copy: (t: string) => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const cmds = isLocal
    ? [
        ["Install Ollama (macOS, Linux)", "curl -fsSL https://ollama.com/install.sh | sh"],
        ["Let this page talk to it (Mac app)", `launchctl setenv OLLAMA_ORIGINS "${origin}" && osascript -e 'quit app "Ollama"' && open -a Ollama`],
        ["…or run it in a terminal", `OLLAMA_ORIGINS="${origin}" ollama serve`],
      ]
    : [["On that machine", `OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS="${origin}" ollama serve`]];
  return (
    <div className="setup">
      <h3>{reason === "forbidden" ? "Ollama is running, but it doesn't allow this page yet" : `No Ollama at ${url}`}</h3>
      <p className="small muted">
        berth talks to Ollama straight from this tab; nothing goes through our server. {isLocal && "On Windows, get the installer at ollama.com/download."}
      </p>
      {cmds.map(([label, c]) => (
        <div key={label} className="cmd">
          <span>{label}</span>
          <code>{c}</code>
          <button className="link" onClick={() => copy(c)}>
            copy
          </button>
        </div>
      ))}
      <p className="small muted">Chrome may ask to allow this site to reach devices on your local network: say Allow. Safari blocks it; use Chrome or Edge.</p>
      <button className="btn" onClick={onRetry}>
        Check again
      </button>
    </div>
  );
}

/* ---------------- snippets + test ---------------- */

function Snippets({ base, model, copy }: { base: string; model: string; copy: (t: string) => void }) {
  const [tab, setTab] = useState<"curl" | "python" | "js">("curl");
  const [test, setTest] = useState<string>("");
  const code = useMemo(
    () => ({
      curl: `curl ${base}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Hello"}]}'`,
      python: `from openai import OpenAI\n\nclient = OpenAI(base_url="${base}", api_key="local")\nr = client.chat.completions.create(\n    model="${model}",\n    messages=[{"role": "user", "content": "Hello"}],\n)\nprint(r.choices[0].message.content)`,
      js: `import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "${base}", apiKey: "local" });\nconst r = await client.chat.completions.create({\n  model: "${model}",\n  messages: [{ role: "user", content: "Hello" }],\n});\nconsole.log(r.choices[0].message.content);`,
    }),
    [base, model],
  );
  const run = async () => {
    setTest("…");
    try {
      const t0 = performance.now();
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 8 }),
      });
      const j = await r.json();
      setTest(`${r.status} in ${Math.round(performance.now() - t0)} ms\n${JSON.stringify(j, null, 2).slice(0, 900)}`);
    } catch (e) {
      setTest(`Failed: ${String((e as Error).message)}`);
    }
  };
  return (
    <div className="block">
      <h3>Endpoint</h3>
      <div className="cmd">
        <code>{base}</code>
        <button className="link" onClick={() => copy(base)}>
          copy
        </button>
      </div>
      <div className="tabs">
        {(["curl", "python", "js"] as const).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <button className="link" onClick={() => copy(code[tab])}>
          copy
        </button>
      </div>
      <pre className="code">{code[tab]}</pre>
      <button className="btn" onClick={() => void run()}>
        Test endpoint
      </button>
      {test && <pre className="code out">{test}</pre>}
    </div>
  );
}

/* ---------------- model library ---------------- */

function Library(p: {
  s: Saved;
  machine: Machine | null;
  cached: Record<string, boolean>;
  host: Host;
  hs?: { st: OllamaStatus | null; models: OllamaModel[]; running: string[] };
  pull: { model: string; status: string; completed: number; total: number } | null;
  onClose: () => void;
  onPickTab: (id: string) => void;
  onPickOllama: (name: string) => void;
  onDeleteTab: (id: string) => void;
  onDeleteOllama: (name: string) => void;
  onPull: (name: string) => void;
  onCancelPull: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<"tab" | "ollama">(p.s.engine === "ollama" ? "ollama" : "tab");
  const [tag, setTag] = useState("");
  const budgetMB = p.machine?.memoryGB ? p.machine.memoryGB * 1024 * 0.6 : 4800;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Models" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Models</h2>
          <div className="seg">
            <button aria-pressed={tab === "tab"} onClick={() => setTab("tab")}>
              In this tab
            </button>
            <button aria-pressed={tab === "ollama"} onClick={() => setTab("ollama")}>
              Ollama · {p.host.label}
            </button>
          </div>
          <button className="x" onClick={p.onClose} aria-label="Close">
            ×
          </button>
        </header>
        {tab === "tab" ? (
          <ul className="models">
            {TAB_MODELS.map((m) => {
              const fits = m.vramMB <= budgetMB && (m.id.startsWith("gemma") ? p.machine?.f16 !== false : true);
              return (
                <li key={m.id} className={p.s.tabModel === m.id ? "cur" : ""}>
                  <div>
                    <b>{m.label}</b> <span className="muted small">{m.note}</span>
                    <div className="tags">
                      <span>{m.params}</span>
                      <span>~{approxDownloadMB(m)} MB download</span>
                      <span>{(m.vramMB / 1024).toFixed(1)} GB GPU</span>
                      {p.cached[m.id] ? <span className="ok">downloaded</span> : null}
                      <span className={fits ? "ok" : "warn"}>{fits ? "fits this machine" : "may not fit"}</span>
                    </div>
                  </div>
                  <div className="row-actions">
                    {p.cached[m.id] && (
                      <button className="link" onClick={() => p.onDeleteTab(m.id)}>
                        remove
                      </button>
                    )}
                    <button className="btn" onClick={() => p.onPickTab(m.id)}>
                      {p.s.tabModel === m.id && p.s.engine === "tab" ? "Selected" : "Use"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div>
            {!p.hs?.st?.ok ? (
              <p className="note">
                No Ollama reachable at {p.host.url}. Close this and follow the setup card, then{" "}
                <button className="link" onClick={p.onRefresh}>
                  check again
                </button>
                .
              </p>
            ) : (
              <>
                <form
                  className="pullform"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (tag.trim() && !p.pull) p.onPull(tag.trim());
                  }}
                >
                  <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Pull any model: llama3.2:3b, qwen3:4b, gemma3:4b, mistral…" />
                  <button className="btn primary" disabled={!tag.trim() || !!p.pull}>
                    Pull
                  </button>
                </form>
                {p.pull && (
                  <div className="pullprog">
                    <div className="row">
                      <b>{p.pull.model}</b>
                      <span className="muted small">
                        {p.pull.status}
                        {p.pull.total ? ` · ${fmtBytes(p.pull.completed)} / ${fmtBytes(p.pull.total)} · ${Math.round((p.pull.completed / p.pull.total) * 100)}%` : ""}
                      </span>
                      <button className="link" onClick={p.onCancelPull}>
                        cancel
                      </button>
                    </div>
                    <div className="prog">
                      <div style={{ width: p.pull.total ? `${(p.pull.completed / p.pull.total) * 100}%` : "4%" }} />
                    </div>
                    <p className="muted small">from registry.ollama.ai, stored by Ollama on {p.host.label.toLowerCase()}</p>
                  </div>
                )}
                {p.hs.models.length === 0 && !p.pull && <p className="muted small">No models on this Ollama yet. Pull one above; llama3.2:1b (1.3 GB) is a quick start.</p>}
                <ul className="models">
                  {p.hs.models.map((m) => (
                    <li key={m.name} className={p.s.ollamaModel === m.name ? "cur" : ""}>
                      <div>
                        <b>{m.name}</b>
                        <div className="tags">
                          <span>{fmtBytes(m.size)}</span>
                          {m.params && <span>{m.params}</span>}
                          {m.quant && <span>{m.quant}</span>}
                          {p.hs?.running.includes(m.name) && <span className="ok">in memory</span>}
                        </div>
                      </div>
                      <div className="row-actions">
                        <button className="link" onClick={() => confirm(`Delete ${m.name} from Ollama?`) && p.onDeleteOllama(m.name)}>
                          delete
                        </button>
                        <button className="btn" onClick={() => p.onPickOllama(m.name)}>
                          {p.s.ollamaModel === m.name && p.s.engine === "ollama" ? "Selected" : "Use"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- add a machine ---------------- */

function AddHost({ onClose, onAdd }: { onClose: () => void; onAdd: (label: string, url: string) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("http://192.168.1.20:11434");
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add a machine" onClick={onClose}>
      <form
        className="sheet small-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onAdd(label.trim() || new URL(cleanUrl(url)).hostname, url);
        }}
      >
        <header>
          <h2>Add a machine</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="small muted">
          Another computer on your network running Ollama. berth sends your chat to whichever machine you select. That&apos;s request routing, not memory
          pooling: each machine still runs whole models on its own.
        </p>
        <label>
          Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Studio upstairs" />
        </label>
        <label>
          Ollama URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button className="btn primary">Add machine</button>
      </form>
    </div>
  );
}

/* ---------------- first run ---------------- */

function Onboarding(p: {
  machine: Machine | null;
  ollama: OllamaStatus | null;
  ollamaModels: OllamaModel[];
  cached: Record<string, boolean>;
  retryOllama: () => void;
  copy: (t: string) => void;
  onDone: (p: Partial<Saved>) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [engine, setEngine] = useState<Engine>("tab");
  const [model, setModel] = useState(DEFAULT_TAB_MODEL);
  const [om, setOm] = useState("");
  useEffect(() => {
    if (p.machine && !p.machine.webgpu && p.ollama?.ok) setEngine("ollama");
  }, [p.machine, p.ollama]);
  const m = p.machine;
  return (
    <div className="modal onb" role="dialog" aria-modal="true" aria-label="Set up berth">
      <div className="sheet">
        <p className="step">Step {step + 1} of 3</p>
        {step === 0 && (
          <>
            <h2>This is your machine.</h2>
            <p className="muted">berth runs open-weight models here, on your own hardware. Your prompts and answers don&apos;t leave it.</p>
            <p className="muted small">
              On a Mac with Ollama? Run <code>{SERVE_CMD}</code> and chat with its models from your phone. The dashboard shows when a phone is paired.
            </p>
            <div className="node sel onb-node">
              <header>
                <span className="dot" />
                <b>This machine</b>
              </header>
              {m ? (
                <dl>
                  <dt>platform</dt>
                  <dd>
                    {m.platform} · {m.browser}
                  </dd>
                  <dt>gpu</dt>
                  <dd>{m.gpu ?? "no WebGPU in this browser"}</dd>
                  <dt>cores</dt>
                  <dd>{m.cores ?? "?"}</dd>
                </dl>
              ) : (
                <p className="muted small">Reading this machine…</p>
              )}
            </div>
            <div className="onb-actions">
              <button className="link" onClick={p.onSkip}>
                skip setup
              </button>
              <button className="btn primary" onClick={() => setStep(1)}>
                Next
              </button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Where should the model run?</h2>
            <div className="choices">
              <button className={`choice ${engine === "tab" ? "on" : ""}`} onClick={() => setEngine("tab")} disabled={!!m && !m.webgpu}>
                <b>In this tab</b>
                <span>Nothing to install. The model downloads once into this browser and runs on your GPU through WebGPU.</span>
                <em>{m?.webgpu ? "WebGPU ready" : "needs WebGPU (Chrome, Edge, Safari 26)"}</em>
              </button>
              <button className={`choice ${engine === "ollama" ? "on" : ""}`} onClick={() => setEngine("ollama")}>
                <b>Ollama on this machine</b>
                <span>A real OpenAI-compatible endpoint at localhost:11434/v1 that your apps and agents can call. Any model tag.</span>
                <em>{p.ollama ? (p.ollama.ok ? `found v${p.ollama.version}` : p.ollama.reason === "forbidden" ? "found, needs one setting" : "not installed yet") : "checking…"}</em>
              </button>
            </div>
            {engine === "ollama" && p.ollama && !p.ollama.ok && <OllamaSetup url={DEFAULT_OLLAMA} reason={p.ollama.reason} onRetry={p.retryOllama} copy={p.copy} />}
            <div className="onb-actions">
              <button className="link" onClick={() => setStep(0)}>
                back
              </button>
              <button className="btn primary" onClick={() => setStep(2)} disabled={engine === "ollama" && !p.ollama?.ok}>
                Next
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Pick your first model.</h2>
            {engine === "tab" ? (
              <>
                <p className="muted small">Start small: it downloads in under a minute on most connections. You can switch any time from the model picker.</p>
                <ul className="models compact">
                  {TAB_MODELS.slice(0, 5).map((x) => (
                    <li key={x.id} className={model === x.id ? "cur" : ""} onClick={() => setModel(x.id)}>
                      <div>
                        <b>{x.label}</b> <span className="muted small">{x.note}</span>
                        <div className="tags">
                          <span>~{approxDownloadMB(x)} MB</span>
                          {p.cached[x.id] && <span className="ok">downloaded</span>}
                        </div>
                      </div>
                      <input type="radio" readOnly checked={model === x.id} aria-label={x.label} />
                    </li>
                  ))}
                </ul>
              </>
            ) : p.ollamaModels.length ? (
              <ul className="models compact">
                {p.ollamaModels.map((x) => (
                  <li key={x.name} className={om === x.name ? "cur" : ""} onClick={() => setOm(x.name)}>
                    <div>
                      <b>{x.name}</b>
                      <div className="tags">
                        <span>{fmtBytes(x.size)}</span>
                        {x.params && <span>{x.params}</span>}
                      </div>
                    </div>
                    <input type="radio" readOnly checked={om === x.name} aria-label={x.name} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Your Ollama has no models yet. Finish setup, then open the model picker and pull one (llama3.2:1b is a quick start).</p>
            )}
            <div className="onb-actions">
              <button className="link" onClick={() => setStep(1)}>
                back
              </button>
              <button
                className="btn primary"
                onClick={() =>
                  p.onDone(engine === "tab" ? { engine: "tab", tabModel: model } : { engine: "ollama", ollamaModel: om || p.ollamaModels[0]?.name || "" })
                }
              >
                {engine === "tab" || om || p.ollamaModels.length ? "Load it ▶" : "Finish"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
