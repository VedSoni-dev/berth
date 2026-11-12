// berth serve: your Mac runs the model, your phone chats with it.
// One small HTTP server on your network that
//   - serves the phone app (over plain http on the LAN: an https page can't call a LAN address),
//   - proxies OpenAI-compatible chat to Ollama on this Mac (streaming),
//   - lets nothing through without the pairing token (in the QR code it prints),
//   - answers a loopback-only status for the berth dashboard ("phone paired").
// No dependencies: Node 18+ only.
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { qrTerminal } from "./qr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHONE = path.join(HERE, "phone");
export const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8")).version;
const DASHBOARDS = ["https://berth-delta.vercel.app", "http://localhost:3000"];

/* ---------------- this Mac ---------------- */

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "";
  }
};
export function machineName() {
  const n = process.platform === "darwin" ? sh("scutil", ["--get", "ComputerName"]) : "";
  return n || os.hostname().replace(/\.local$/, "");
}
function mdnsName() {
  if (process.platform === "darwin") {
    const n = sh("scutil", ["--get", "LocalHostName"]);
    if (n) return `${n}.local`;
  }
  const h = os.hostname();
  return h.includes(".") ? h : `${h}.local`;
}
const ipRank = (name) => (/^(en|eth|wlan|wl)/.test(name) ? 0 : /^(bridge|vmnet|vbox|docker|utun|tun|tailscale)/.test(name) ? 2 : 1);
function addresses() {
  const lan = [];
  const tailnet = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const a of list ?? []) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (a.internal) continue;
      // Tailscale hands out 100.64.0.0/10 on a tunnel interface
      const [p, q] = a.address.split(".").map(Number);
      if (/^(utun|tun|tailscale)/.test(name) && p === 100 && q >= 64 && q <= 127) tailnet.push(a.address);
      else lan.push({ name, address: a.address });
    }
  lan.sort((a, b) => ipRank(a.name) - ipRank(b.name));
  return { lan: lan.map((a) => a.address), tailnet };
}

/* ---------------- the pairing token ---------------- */

function berthHome() {
  const dir = process.env.BERTH_HOME || path.join(os.homedir(), ".berth");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function loadToken(fresh) {
  const file = path.join(berthHome(), "token");
  if (!fresh) {
    try {
      const t = fs.readFileSync(file, "utf8").trim();
      if (/^[A-Za-z0-9_-]{20,}$/.test(t)) return { token: t, isNew: false, file };
    } catch {
      /* first run */
    }
  }
  const t = crypto.randomBytes(18).toString("base64url");
  fs.writeFileSync(file, t + "\n", { mode: 0o600 });
  return { token: t, isNew: true, file };
}

/* ---------------- helpers ---------------- */

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};
const fail = (res, status, message, headers) => json(res, status, { error: { message } }, headers);
const isLoopback = (a = "") => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function deviceKind(ua = "") {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac browser";
  if (/Windows|Linux|CrOS/.test(ua)) return "computer";
  return "app";
}
async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const parts = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Request too large."), { status: 413 });
    parts.push(c);
  }
  return Buffer.concat(parts).toString("utf8");
}

const STATIC = {
  "/phone.css": ["phone.css", "text/css; charset=utf-8"],
  "/phone.js": ["phone.js", "text/javascript; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/icon-192.png": ["icon-192.png", "image/png"],
  "/icon-512.png": ["icon-512.png", "image/png"],
  "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
};

/* ---------------- the server ---------------- */

export async function serve(opts = {}) {
  const port = Number(opts.port ?? 7770);
  const bind = opts.host ?? "0.0.0.0";
  const upstream = String(opts.ollama ?? process.env.BERTH_OLLAMA ?? "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/\/v1$/, "");
  const origins = new Set([...DASHBOARDS, ...(opts.origins ?? [])]);
  const { token, isNew, file: tokenFile } = loadToken(!!opts.newToken);
  const TOKEN = Buffer.from(token);
  const mac = opts.name || machineName();
  const mdns = mdnsName();
  const started = Date.now();
  const devices = new Map(); // ip|kind -> { kind, firstSeen, lastSeen, answers, tokens }
  const totals = { answers: 0, tokens: 0 };

  const tokenOf = (req, url) => {
    const h = req.headers.authorization || "";
    if (/^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim();
    const q = url.searchParams.get("t");
    if (q) return q;
    const c = /(?:^|;\s*)berth_t=([^;]+)/.exec(req.headers.cookie || "");
    return c ? decodeURIComponent(c[1]) : "";
  };
  const authed = (t) => {
    const b = Buffer.from(String(t));
    return b.length === TOKEN.length && crypto.timingSafeEqual(b, TOKEN);
  };
  const seen = (req) => {
    const ip = req.socket.remoteAddress || "";
    const kind = deviceKind(req.headers["user-agent"]);
    const key = `${ip}|${kind}`;
    const d = devices.get(key) ?? { kind, local: isLoopback(ip), firstSeen: Date.now(), lastSeen: 0, answers: 0, tokens: 0 };
    d.lastSeen = Date.now();
    devices.set(key, d);
    return d;
  };

  /* ---- upstream (Ollama, or any OpenAI-compatible server) ---- */
  const up = async (p, init = {}, ms = 4000) => fetch(upstream + p, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
  let upKind = null; // "ollama" | "openai"
  async function upstreamInfo() {
    try {
      const v = await (await up("/api/version", {}, 1500)).json();
      if (v?.version) {
        upKind = "ollama";
        const [tags, ps] = await Promise.all([up("/api/tags").then((r) => r.json()), up("/api/ps").then((r) => r.json()).catch(() => ({ models: [] }))]);
        const running = new Set((ps.models || []).map((m) => m.name));
        const models = (tags.models || []).map((m) => ({
          id: m.name,
          size: m.size,
          params: m.details?.parameter_size || null,
          quant: m.details?.quantization_level || null,
          family: m.details?.family || null,
          loaded: running.has(m.name),
        }));
        return { ok: true, kind: "ollama", label: `Ollama ${v.version}`, models };
      }
    } catch {
      /* not Ollama, or not running */
    }
    try {
      const r = await up("/v1/models", {}, 2000);
      if (r.ok) {
        upKind = "openai";
        const j = await r.json();
        return { ok: true, kind: "openai", label: "OpenAI-compatible server", models: (j.data || []).map((m) => ({ id: m.id, size: null, params: null, quant: null, family: null, loaded: false })) };
      }
    } catch {
      /* nothing there */
    }
    return { ok: false, kind: null, label: "not running", models: [] };
  }

  async function chat(req, res, dev) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return fail(res, e.status || 400, e.status ? e.message : "The request body must be JSON.");
    }
    if (!Array.isArray(body.messages)) return fail(res, 400, "messages is required.");
    if (body.stream) body.stream_options = { include_usage: true, ...(body.stream_options || {}) };
    if (upKind === "ollama" && !body.keep_alive) body.keep_alive = "30m";
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ac.abort(); // the phone hung up: stop generating on the Mac
    });
    let r;
    try {
      r = await fetch(upstream + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
    } catch {
      return fail(res, 502, `${mac} couldn't reach Ollama at ${upstream}. Open the Ollama app (or run \`ollama serve\`) on the Mac and try again.`);
    }
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store", "x-accel-buffering": "no" });
    req.socket.setNoDelay(true);
    let tail = "";
    let tokens = 0;
    try {
      for await (const chunk of r.body) {
        res.write(chunk);
        // count tokens from the usage line as it passes (for the dashboard)
        tail = (tail + Buffer.from(chunk).toString("utf8")).slice(-4000);
        const m = tail.match(/"completion_tokens"\s*:\s*(\d+)/g);
        if (m) tokens = Number(m[m.length - 1].replace(/\D/g, ""));
      }
      res.end();
      if (r.ok) {
        dev.answers++;
        dev.tokens += tokens;
        totals.answers++;
        totals.tokens += tokens;
      }
    } catch {
      res.end();
    }
  }

  /* ---- the phone app ---- */
  const page = fs.readFileSync(path.join(PHONE, "index.html"), "utf8");
  const phoneHtml = () => page.replaceAll("{{MAC}}", esc(mac)).replaceAll("{{TOKEN}}", encodeURIComponent(token)).replaceAll("{{VERSION}}", VERSION);
  const unpairedHtml = () =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>berth · pair</title><meta name="color-scheme" content="light dark"><link rel="stylesheet" href="/phone.css"></head><body class="unpaired"><main><svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 3v5.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><h1>Pair with ${esc(mac)}</h1><p>This is berth, serving models from a Mac on your network. To chat, scan the QR code that <code>berth serve</code> printed in the Mac's terminal.</p></main></body></html>`;
  const manifest = () =>
    JSON.stringify({
      name: `berth · ${mac}`,
      short_name: "berth",
      description: `Chat with the models on ${mac}.`,
      start_url: `/?t=${encodeURIComponent(token)}`,
      scope: "/",
      display: "standalone",
      background_color: "#0d1210",
      theme_color: "#0d1210",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    });

  /* ---- routes ---- */
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://berth");
    const p = url.pathname;
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    try {
      // the dashboard's status check: this Mac only, readable by the berth dashboard
      if (p === "/berth/status") {
        if (!isLoopback(req.socket.remoteAddress)) return fail(res, 404, "Not found.");
        const origin = req.headers.origin;
        const cors = origin && origins.has(origin) ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-private-network": "true" } : {};
        if (req.method === "OPTIONS") {
          res.writeHead(204, { ...cors, "access-control-allow-methods": "GET", "access-control-allow-headers": "content-type", "access-control-max-age": "600" });
          return res.end();
        }
        const info = await upstreamInfo();
        const phones = [...devices.values()]
          .filter((d) => !d.local)
          .sort((a, b) => b.lastSeen - a.lastSeen)
          .map((d) => ({ kind: d.kind, lastSeenAgo: Date.now() - d.lastSeen, answers: d.answers, tokens: d.tokens }));
        return json(res, 200, {
          berth: VERSION,
          mac,
          address: `${mdns}:${port}`,
          upSince: started,
          upstream: { ok: info.ok, label: info.label, url: upstream, models: info.models.length },
          paired: phones.length > 0,
          phones,
          answers: totals.answers,
          tokens: totals.tokens,
        }, cors);
      }

      if (STATIC[p] && req.method === "GET") {
        const [f, type] = STATIC[p];
        res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
        return res.end(fs.readFileSync(path.join(PHONE, f)));
      }

      const ok = authed(tokenOf(req, url));

      if (p === "/" && req.method === "GET") {
        if (!ok) {
          res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          return res.end(unpairedHtml());
        }
        seen(req);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": `berth_t=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
        });
        return res.end(phoneHtml());
      }

      if (!ok) return fail(res, 401, `Not paired. Scan the QR code that berth serve printed on ${mac}.`, { "www-authenticate": 'Bearer realm="berth"' });
      const dev = seen(req);

      if (p === "/manifest.webmanifest") {
        res.writeHead(200, { "content-type": "application/manifest+json", "cache-control": "no-store" });
        return res.end(manifest());
      }
      if (p === "/api/info" && req.method === "GET") {
        const info = await upstreamInfo();
        return json(res, 200, { mac, berth: VERSION, upstream: { ok: info.ok, kind: info.kind, label: info.label }, models: info.models });
      }
      if (p === "/v1/models" && req.method === "GET") {
        const info = await upstreamInfo();
        return json(res, 200, { object: "list", data: info.models.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: mac })) });
      }
      if (p === "/v1/chat/completions" && req.method === "POST") {
        if (!upKind) await upstreamInfo();
        return await chat(req, res, dev);
      }
      return fail(res, 404, "Not found.");
    } catch (e) {
      if (!res.headersSent) fail(res, 500, String(e?.message || e).slice(0, 200));
      else res.end();
    }
  });
  server.keepAliveTimeout = 65_000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, resolve);
  }).catch((e) => {
    if (e.code === "EADDRINUSE") throw new Error(`Port ${port} is already in use. Is berth already running? Or pick another: berth serve --port 7771`);
    throw e;
  });

  /* ---- what the terminal shows ---- */
  const { lan, tailnet } = addresses();
  const q = `/?t=${encodeURIComponent(token)}`;
  const named = `http://${mdns}:${port}${q}`;
  const byIp = lan[0] ? `http://${lan[0]}:${port}${q}` : null;
  const pairUrl = opts.ip && byIp ? byIp : named;
  const info = await upstreamInfo();
  const out = opts.log ?? ((s) => process.stdout.write(s + "\n"));
  const dim = (s) => (opts.color === false ? s : `\x1b[2m${s}\x1b[0m`);
  const bold = (s) => (opts.color === false ? s : `\x1b[1m${s}\x1b[0m`);
  out("");
  out(`  ${bold("berth")} is serving ${bold(mac)} to your phone ${dim(`(v${VERSION})`)}`);
  out("");
  out(qrTerminal(pairUrl, { quiet: 2, color: opts.color !== false }).replace(/^/gm, "  "));
  out("");
  out(`  Scan it with your phone's camera (same Wi-Fi), or open:`);
  out(`  ${pairUrl}`);
  if (pairUrl === named && byIp) out(dim(`  Android, or if that doesn't load: ${byIp}  (or run with --ip)`));
  out("");
  if (info.ok) {
    const names = info.models.map((m) => m.id);
    out(`  Models: ${info.label} at ${upstream}, ${names.length ? `${names.length} (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""})` : "none yet: ollama pull llama3.2"}`);
  } else {
    out(`  ${bold("Ollama isn't answering")} at ${upstream}. Install it from ollama.com, open it, then pull a model: ollama pull llama3.2`);
  }
  if (tailnet.length) out(`  Away from home (Tailscale): http://${tailnet[0]}:${port}${q}`);
  else out(dim(`  Away from home: put this Mac and your phone on Tailscale and open the Mac's Tailscale address the same way.`));
  out(dim(`  Pairing token: ${isNew ? "new, saved" : "kept"} in ${tokenFile}. berth serve --new-token unpairs every phone.`));
  out(dim(`  Ctrl-C to stop.`));
  out("");

  return {
    server,
    url: pairUrl,
    port,
    close: () => new Promise((r) => server.close(r)),
  };
}
