"use client";
// The two local engines and the optional cloud one. Everything here runs in the browser.
//   tab    : WebLLM on WebGPU, the model's weights live in this browser's cache and run on this GPU.
//   ollama : an Ollama server on this machine (or another one on your network), OpenAI-compatible /v1.
//   cloud  : publik API (or your own OpenAI-compatible key). Leaves the machine; labelled that way.

export type Engine = "tab" | "ollama" | "cloud";
export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type Stats = { ttftMs: number; tokPerSec: number; tokens: number; totalMs: number };

/* ---------------- this machine ---------------- */

export type Machine = {
  platform: string;
  browser: string;
  cores: number | null;
  memoryGB: number | null; // navigator.deviceMemory, capped at 8 by the browser
  webgpu: boolean;
  gpu: string | null;
  gpuVendor: string | null;
  f16: boolean;
  maxBufferMB: number | null;
};

export async function detectMachine(): Promise<Machine> {
  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string }; deviceMemory?: number };
  const platform =
    nav.userAgentData?.platform ||
    (/Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Unknown");
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const m: Machine = {
    platform: platform === "macOS" || platform === "MacIntel" ? "macOS" : platform,
    browser,
    cores: navigator.hardwareConcurrency || null,
    memoryGB: nav.deviceMemory ?? null,
    webgpu: false,
    gpu: null,
    gpuVendor: null,
    f16: false,
    maxBufferMB: null,
  };
  try {
    const gpu = (navigator as unknown as { gpu?: GPUish }).gpu;
    const adapter = gpu ? await gpu.requestAdapter({ powerPreference: "high-performance" }) : null;
    if (adapter) {
      m.webgpu = true;
      const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
      const vendor = info?.vendor || "";
      const arch = info?.architecture || "";
      m.gpuVendor = vendor ? vendor[0].toUpperCase() + vendor.slice(1) : null;
      m.gpu = info?.description || [m.gpuVendor, arch].filter(Boolean).join(" ") || "WebGPU adapter";
      m.f16 = adapter.features?.has?.("shader-f16") ?? false;
      m.maxBufferMB = adapter.limits?.maxBufferSize ? Math.round(adapter.limits.maxBufferSize / 1048576) : null;
    }
  } catch {
    /* no WebGPU */
  }
  return m;
}

type GPUish = {
  requestAdapter(o?: unknown): Promise<{
    info?: { vendor?: string; architecture?: string; description?: string };
    requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; description?: string }>;
    features?: { has(f: string): boolean };
    limits?: { maxBufferSize?: number };
  } | null>;
};

/* ---------------- engine 1: in this tab (WebLLM) ---------------- */

export type TabModel = { id: string; label: string; family: string; params: string; vramMB: number; note: string };

export const TAB_MODELS: TabModel[] = [
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M", family: "SmolLM2", params: "360M", vramMB: 376, note: "tiny, fastest download" },
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 0.5B", family: "Qwen2.5", params: "0.5B", vramMB: 945, note: "small, good first model" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", family: "Llama 3.2", params: "1B", vramMB: 879, note: "solid all-rounder" },
  { id: "Qwen3-0.6B-q4f16_1-MLC", label: "Qwen3 0.6B", family: "Qwen3", params: "0.6B", vramMB: 1403, note: "thinks before answering" },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B", family: "Qwen2.5", params: "1.5B", vramMB: 1630, note: "noticeably smarter" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B", family: "Gemma 2", params: "2B", vramMB: 1895, note: "needs shader-f16" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", family: "Llama 3.2", params: "3B", vramMB: 2264, note: "best quality here" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi-3.5 mini", family: "Phi-3.5", params: "3.8B", vramMB: 3672, note: "large, 8 GB+ machines" },
];

export const DEFAULT_TAB_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

/** Rough size of the download, from the model's VRAM need (weights are most of it). */
export const approxDownloadMB = (m: TabModel) => Math.round(m.vramMB * 0.62);

type WebLLM = typeof import("@mlc-ai/web-llm");
type MLCEngine = import("@mlc-ai/web-llm").MLCEngineInterface;
let webllm: WebLLM | null = null;
let engine: MLCEngine | null = null;
let loadedTabModel: string | null = null;

async function lib(): Promise<WebLLM> {
  if (!webllm) webllm = await import("@mlc-ai/web-llm");
  return webllm;
}

export async function tabCached(ids: string[]): Promise<Record<string, boolean>> {
  const w = await lib();
  const out: Record<string, boolean> = {};
  for (const id of ids) {
    try {
      out[id] = await w.hasModelInCache(id);
    } catch {
      out[id] = false;
    }
  }
  return out;
}

export async function tabDelete(id: string) {
  const w = await lib();
  if (loadedTabModel === id) await tabUnload();
  await w.deleteModelAllInfoInCache(id);
}

export type LoadProgress = { fraction: number; text: string; seconds: number };

export async function tabLoad(id: string, onProgress: (p: LoadProgress) => void): Promise<void> {
  const w = await lib();
  const cb = (r: { progress: number; text: string; timeElapsed: number }) =>
    onProgress({ fraction: r.progress, text: r.text, seconds: r.timeElapsed });
  if (!engine) {
    engine = await w.CreateMLCEngine(id, { initProgressCallback: cb });
  } else {
    engine.setInitProgressCallback(cb);
    await engine.reload(id);
  }
  loadedTabModel = id;
}

export async function tabUnload() {
  if (engine) {
    try {
      await engine.unload();
    } catch {
      /* already gone */
    }
  }
  loadedTabModel = null;
}

export const tabLoaded = () => loadedTabModel;

export function tabStop() {
  engine?.interruptGenerate();
}

export async function tabChat(messages: Msg[], onText: (t: string) => void): Promise<Stats> {
  if (!engine || !loadedTabModel) throw new Error("No model is running. Press play first.");
  const t0 = performance.now();
  let first = 0;
  let pieces = 0;
  let usageTokens = 0;
  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.7,
    max_tokens: 1024,
  });
  for await (const chunk of stream) {
    const d = chunk.choices?.[0]?.delta?.content;
    if (d) {
      if (!first) first = performance.now();
      pieces++;
      onText(d);
    }
    if (chunk.usage) usageTokens = chunk.usage.completion_tokens;
  }
  return stats(t0, first, usageTokens || pieces);
}

function stats(t0: number, first: number, tokens: number): Stats {
  const end = performance.now();
  const ttft = first ? first - t0 : end - t0;
  const decode = first ? (end - first) / 1000 : 0;
  return { ttftMs: Math.round(ttft), tokens, totalMs: Math.round(end - t0), tokPerSec: decode > 0.05 ? +(Math.max(tokens - 1, 1) / decode).toFixed(1) : 0 };
}

/* ---------------- engine 2: Ollama on this machine (or your network) ---------------- */

export const DEFAULT_OLLAMA = "http://localhost:11434";
export const cleanUrl = (u: string) => u.trim().replace(/\/+$/, "").replace(/\/v1$/, "");

export type OllamaModel = { name: string; size: number; params?: string; quant?: string; family?: string };
export type OllamaStatus = { ok: true; version: string } | { ok: false; reason: string };

async function oj<T>(url: string, init?: RequestInit, ms = 4000): Promise<T> {
  const r = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => "")}`.trim());
  return r.json() as Promise<T>;
}

export async function ollamaPing(base: string): Promise<OllamaStatus> {
  try {
    const v = await oj<{ version: string }>(`${cleanUrl(base)}/api/version`, undefined, 2500);
    return { ok: true, version: v.version };
  } catch (e) {
    const msg = String((e as Error).message || e);
    return { ok: false, reason: /403/.test(msg) ? "forbidden" : "unreachable" };
  }
}

export async function ollamaList(base: string): Promise<OllamaModel[]> {
  const j = await oj<{ models: { name: string; size: number; details?: { parameter_size?: string; quantization_level?: string; family?: string } }[] }>(
    `${cleanUrl(base)}/api/tags`,
  );
  return (j.models || []).map((m) => ({ name: m.name, size: m.size, params: m.details?.parameter_size, quant: m.details?.quantization_level, family: m.details?.family }));
}

export async function ollamaRunning(base: string): Promise<{ name: string; size_vram: number; expires_at: string }[]> {
  try {
    const j = await oj<{ models: { name: string; size_vram: number; expires_at: string }[] }>(`${cleanUrl(base)}/api/ps`);
    return j.models || [];
  } catch {
    return [];
  }
}

/** Loads the model into memory (no prompt) and keeps it there for 30 minutes. */
export async function ollamaLoad(base: string, model: string) {
  await oj(`${cleanUrl(base)}/api/generate`, { method: "POST", body: JSON.stringify({ model, keep_alive: "30m" }) }, 180_000);
}

export async function ollamaUnload(base: string, model: string) {
  await oj(`${cleanUrl(base)}/api/generate`, { method: "POST", body: JSON.stringify({ model, keep_alive: 0 }) }, 15_000);
}

export async function ollamaDelete(base: string, model: string) {
  const r = await fetch(`${cleanUrl(base)}/api/delete`, { method: "DELETE", body: JSON.stringify({ model }) });
  if (!r.ok) throw new Error(`Could not delete ${model} (${r.status})`);
}

export type PullProgress = { status: string; completed: number; total: number };

export async function ollamaPull(base: string, model: string, onProgress: (p: PullProgress) => void, signal: AbortSignal) {
  const r = await fetch(`${cleanUrl(base)}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }), signal });
  if (!r.ok || !r.body) throw new Error(`Pull failed (${r.status})`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
      if (j.error) throw new Error(j.error);
      onProgress({ status: j.status || "", completed: j.completed || 0, total: j.total || 0 });
    }
  }
}

/** Reads an OpenAI-style SSE stream; returns stats. Works for Ollama's /v1, publik and any compatible API. */
export async function sseChat(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  onText: (t: string) => void,
  signal: AbortSignal,
): Promise<Stats> {
  const t0 = performance.now();
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => "");
    let j: { error?: { message?: string; top_up_url?: string } | string } = {};
    try {
      j = JSON.parse(text);
    } catch {
      /* not json */
    }
    const err = typeof j.error === "string" ? j.error : j.error?.message;
    const e = new Error(err || `The server answered ${r.status}.`) as Error & { topUpUrl?: string; status?: number };
    e.status = r.status;
    if (typeof j.error === "object" && j.error?.top_up_url) e.topUpUrl = j.error.top_up_url;
    throw e;
  }
  if ((r.headers.get("content-type") || "").includes("application/json")) {
    // a server that ignored stream: true and answered in one piece
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { completion_tokens?: number } };
    const text = j.choices?.[0]?.message?.content ?? "";
    const tFirst = performance.now();
    if (text) onText(text);
    return stats(t0, tFirst, j.usage?.completion_tokens || Math.ceil(text.length / 4));
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let first = 0;
  let pieces = 0;
  let usage = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { completion_tokens?: number } };
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          if (!first) first = performance.now();
          pieces++;
          onText(d);
        }
        if (j.usage?.completion_tokens) usage = j.usage.completion_tokens;
      } catch {
        /* partial line */
      }
    }
  }
  return stats(t0, first, usage || pieces);
}

export const fmtBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`;

export const fmtUptime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};
