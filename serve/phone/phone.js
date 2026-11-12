// berth on your phone. Talks only to the Mac that served this page: /api/info for the models,
// /v1/chat/completions (streamed) for answers. The pairing code rides along on every request.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = $("app").dataset.mac;
  const TOKEN = new URLSearchParams(location.search).get("t") || "";
  const AUTH = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};
  const KEY = "berth-phone:v1";
  const SUGGESTIONS = [
    "Explain how a heat pump works, like I'm 12.",
    "Write a two-line toast for a friend's 30th.",
    "Plan a 20-minute bodyweight workout.",
  ];

  /* ---------------- saved state (this phone only) ---------------- */
  let state = { model: "", turns: [] };
  try {
    state = { ...state, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    /* private mode */
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ model: state.model, turns: state.turns.slice(-60) }));
    } catch {
      /* full or private */
    }
  };

  let models = [];
  let upstream = null;
  let busy = null; // AbortController while answering

  /* ---------------- tiny, safe markdown ---------------- */
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  function md(src) {
    const blocks = [];
    src = src.replace(/\u0000/g, "").replace(/```[^\n]*\n?([\s\S]*?)(?:```|$)/g, (_, code) => {
      blocks.push(`<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
      return `\n\u0000${blocks.length - 1}\u0000\n`;
    });
    let html = "";
    let list = null;
    let para = [];
    const flush = () => {
      if (para.length) html += `<p>${para.map(inline).join("<br>")}</p>`;
      para = [];
    };
    const close = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    for (const line of src.split("\n")) {
      let m;
      if ((m = line.match(/^\u0000(\d+)\u0000$/))) { flush(); close(); html += blocks[+m[1]]; continue; }
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
  // models that think out loud: <think>…</think> inline, or a separate reasoning field
  const splitThink = (t) => {
    const open = t.indexOf("<think>");
    if (open === -1) return { think: "", text: t };
    const close = t.indexOf("</think>");
    if (close === -1) return { think: t.slice(open + 7), text: "", thinking: true };
    return { think: t.slice(open + 7, close), text: t.slice(0, open) + t.slice(close + 8).replace(/^\s+/, "") };
  };

  /* ---------------- drawing ---------------- */
  const msgs = $("msgs");
  const nearBottom = () => msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
  const toBottom = () => { msgs.scrollTop = msgs.scrollHeight; };
  const modelLabel = () => state.model || "no model yet";

  const metaHtml = (s) =>
    `<b>${s.tokPerSec}</b> tok/s · ${(s.ttftMs / 1000).toFixed(1)} s to first token · ${s.tokens} tokens · on ${esc(MAC)}`;

  function turnEl(t, i) {
    const el = document.createElement("div");
    el.className = `msg ${t.role === "user" ? "user" : "bot"}`;
    if (t.role === "user") {
      el.textContent = t.content;
      return el;
    }
    const { think, text, thinking } = splitThink(t.content || "");
    const reasoning = (t.reasoning || "") + think;
    let html = "";
    if (reasoning) html += `<details class="think"${thinking ? " open" : ""}><summary>${thinking || (t.live && !text) ? "thinking…" : "thought it through ▸"}</summary><div>${esc(reasoning)}</div></details>`;
    if (text) html += `<div class="txt">${md(text)}${t.live ? '<span class="caret"></span>' : ""}</div>`;
    else if (t.live && !reasoning) html += `<p class="wait"><i class="dot"></i>${t.slow ? `loading ${esc(t.model || "the model")} on ${esc(MAC)}…` : `${esc(MAC)} is thinking…`}</p>`;
    if (t.stats) html += `<div class="meta">${metaHtml(t.stats)}</div>`;
    if (t.error) html += `<div class="err" role="alert">${esc(t.error)}${i === state.turns.length - 1 ? '<br><button data-retry>Try again</button>' : ""}</div>`;
    el.innerHTML = html;
    return el;
  }

  function render() {
    msgs.textContent = "";
    if (upstream && !upstream.ok) {
      const b = document.createElement("p");
      b.className = "banner";
      b.innerHTML = `<b>${esc(MAC)} is on, but Ollama isn't running there.</b> Open the Ollama app on the Mac (or run <code>ollama serve</code>), then pull down to reload.`;
      msgs.append(b);
    }
    if (!state.turns.length) {
      const e = document.createElement("section");
      e.className = "empty";
      const m = state.model ? `<b>${esc(state.model)}</b>` : "the model";
      e.innerHTML = `<h1>Your phone asks.<br><em>Your Mac answers.</em></h1><p>${m} runs on <b>${esc(MAC)}</b>. This phone only sends your message and shows the answer as it's written.</p><div class="sugg">${SUGGESTIONS.map((s) => `<button type="button">${esc(s)}</button>`).join("")}</div>`;
      e.querySelectorAll(".sugg button").forEach((b) => b.addEventListener("click", () => send(b.textContent)));
      msgs.append(e);
    }
    state.turns.forEach((t, i) => msgs.append(turnEl(t, i)));
    const last = [...state.turns].reverse().find((t) => t.stats);
    $("speed").innerHTML = last ? `<b>${last.stats.tokPerSec}</b> tok/s` : "";
    $("modelName").textContent = modelLabel();
    $("input").placeholder = state.model ? `Ask ${state.model}` : "Ask your Mac anything";
    toBottom();
  }

  let raf = 0;
  function renderLast() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const stick = nearBottom();
      const i = state.turns.length - 1;
      const el = msgs.lastElementChild;
      if (el && el.classList.contains("bot")) el.replaceWith(turnEl(state.turns[i], i));
      else render();
      if (stick) toBottom();
    });
  }

  /* ---------------- talking to the Mac ---------------- */
  const conn = (cls, text) => {
    $("conn").className = `conn ${cls}`;
    $("connText").textContent = text;
  };

  async function loadInfo() {
    try {
      const r = await fetch("/api/info", { headers: AUTH, cache: "no-store" });
      if (r.status === 401) {
        conn("off", "not paired");
        return;
      }
      const j = await r.json();
      upstream = j.upstream;
      models = j.models || [];
      if (!models.some((m) => m.id === state.model)) state.model = (models.find((m) => m.loaded) || models[0] || {}).id || "";
      save();
      conn(upstream.ok ? "on" : "off", upstream.ok ? "connected" : "no Ollama");
    } catch {
      conn("off", "can't reach");
    }
    render();
  }

  function stats(t0, first, tokens) {
    const end = performance.now();
    const decode = first ? (end - first) / 1000 : 0;
    return {
      ttftMs: Math.round((first || end) - t0),
      tokens,
      totalMs: Math.round(end - t0),
      tokPerSec: decode > 0.05 ? +(Math.max(tokens - 1, 1) / decode).toFixed(1) : 0,
    };
  }

  async function send(text) {
    const q = (text || "").trim();
    if (!q || busy) return;
    if (!state.model) {
      $("modelSheet").showModal();
      return;
    }
    const history = state.turns.filter((t) => !t.error && t.content).map((t) => ({ role: t.role, content: splitThink(t.content).text || t.content }));
    state.turns.push({ role: "user", content: q });
    const turn = { role: "assistant", content: "", reasoning: "", model: state.model, live: true };
    state.turns.push(turn);
    $("input").value = "";
    grow();
    setBusy(new AbortController());
    render();
    const slow = setTimeout(() => { if (!turn.content && !turn.reasoning) { turn.slow = true; renderLast(); } }, 2500);
    const t0 = performance.now();
    let first = 0, pieces = 0, usage = 0;
    try {
      const r = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({ model: state.model, messages: [...history, { role: "user", content: q }], stream: true, stream_options: { include_usage: true } }),
        signal: busy.signal,
      });
      if (!r.ok || !r.body) {
        let msg = `${MAC} answered ${r.status}.`;
        try { msg = (await r.json()).error?.message || msg; } catch { /* not json */ }
        throw new Error(msg);
      }
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
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          let j;
          try { j = JSON.parse(data); } catch { continue; }
          if (j.error) throw new Error(j.error.message || String(j.error));
          const d = j.choices?.[0]?.delta || {};
          const piece = d.content || "";
          const thought = d.reasoning_content || d.reasoning || "";
          if (piece || thought) {
            if (!first) first = performance.now();
            pieces++;
            turn.content += piece;
            turn.reasoning += thought;
            renderLast();
          }
          if (j.usage?.completion_tokens) usage = j.usage.completion_tokens;
        }
      }
      turn.stats = stats(t0, first, usage || pieces);
    } catch (e) {
      if (e.name === "AbortError") {
        if (turn.content) turn.stats = stats(t0, first, usage || pieces);
        else turn.error = "Stopped.";
      } else if (e instanceof TypeError) {
        turn.error = `Can't reach ${MAC}. Is it awake, on the same Wi-Fi, and still running berth serve? Away from home, see ⓘ for Tailscale.`;
        conn("off", "can't reach");
      } else {
        turn.error = String(e.message || e).slice(0, 300);
      }
    } finally {
      clearTimeout(slow);
      turn.live = false;
      delete turn.slow;
      setBusy(null);
      save();
      render();
    }
  }

  function setBusy(ac) {
    busy = ac;
    const b = $("send");
    b.classList.toggle("stop", !!ac);
    b.setAttribute("aria-label", ac ? "Stop" : "Send");
    b.disabled = !ac && !$("input").value.trim();
  }

  /* ---------------- controls ---------------- */
  const input = $("input");
  function grow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
    if (!busy) $("send").disabled = !input.value.trim();
  }
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
  });
  $("ask").addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) busy.abort();
    else send(input.value);
  });
  msgs.addEventListener("click", (e) => {
    if (!e.target.closest("[data-retry]")) return;
    const last = state.turns.length - 1;
    const q = state.turns[last - 1]?.role === "user" ? state.turns[last - 1].content : "";
    state.turns.splice(last - 1, 2);
    send(q);
  });
  $("newChat").addEventListener("click", () => {
    if (busy) busy.abort();
    state.turns = [];
    save();
    render();
  });
  $("infoBtn").addEventListener("click", () => $("infoSheet").showModal());
  $("modelBtn").addEventListener("click", () => {
    const ul = $("models");
    ul.textContent = "";
    if (!models.length) {
      ul.innerHTML = `<li class="hint">${upstream?.ok ? "No models on the Mac yet. Pull one there: <code>ollama pull llama3.2</code>" : "The Mac's Ollama isn't answering."}</li>`;
    }
    for (const m of models) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(m.id === state.model));
      const bits = [m.params, m.quant, m.size ? `${(m.size / 1e9).toFixed(1)} GB` : null].filter(Boolean).join(" · ");
      b.innerHTML = `<b>${esc(m.id)}</b><span class="tick">${m.id === state.model ? "✓" : ""}</span><small>${esc(bits || "on the Mac")}${m.loaded ? ' · <span class="tag">in memory</span>' : ""}</small>`;
      b.addEventListener("click", () => {
        state.model = m.id;
        save();
        $("modelSheet").close();
        render();
      });
      li.append(b);
      ul.append(li);
    }
    $("modelSheet").showModal();
  });
  // tap outside a sheet closes it
  for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });

  // keep the dock above the iOS keyboard
  if (window.visualViewport) {
    const fit = () => {
      $("app").style.height = `${window.visualViewport.height}px`;
      window.scrollTo(0, 0);
    };
    window.visualViewport.addEventListener("resize", fit);
    fit();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !busy) loadInfo(); });

  render();
  loadInfo();
})();
