#!/usr/bin/env node
// berth: your phone chats with the models on your Mac.
//   npx github:VedSoni-dev/berth serve      (or: npm run serve, from a clone)
import { serve, VERSION } from "../serve/server.mjs";

const HELP = `berth ${VERSION}: your phone chats with the open-weight models on this Mac.

Usage
  berth serve [options]   Serve this Mac's Ollama models to your phone (the default)
  berth help              This text

Options
  --port <n>          Port on your network (default 7770)
  --ollama <url>      Where Ollama runs (default http://127.0.0.1:11434). Any
                      OpenAI-compatible server works too (LM Studio, llama.cpp).
  --ip                Put the IP address in the QR code instead of <mac>.local
                      (Android phones often can't open .local names)
  --new-token         Make a new pairing code; every paired phone has to scan again
  --name <text>       What the phone calls this Mac (default: its computer name)
  --host <addr>       Address to listen on (default 0.0.0.0, every network)
  --origin <url>      Another dashboard origin allowed to read this Mac's status

The phone app, the proxy and the token check all run on this Mac. Nothing goes
through a server of ours.`;

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("-") ? argv.shift() : "serve";
const opts = { origins: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) {
      console.error(`berth: ${a} needs a value`);
      process.exit(2);
    }
    return v;
  };
  if (a === "--port" || a === "-p") opts.port = Number(val());
  else if (a === "--ollama" || a === "--upstream") opts.ollama = val();
  else if (a === "--ip") opts.ip = true;
  else if (a === "--new-token") opts.newToken = true;
  else if (a === "--name") opts.name = val();
  else if (a === "--host") opts.host = val();
  else if (a === "--origin") opts.origins.push(val().replace(/\/+$/, ""));
  else if (a === "--no-color") opts.color = false;
  else if (a === "--help" || a === "-h") {
    console.log(HELP);
    process.exit(0);
  } else if (a === "--version" || a === "-v") {
    console.log(VERSION);
    process.exit(0);
  } else {
    console.error(`berth: unknown option ${a}\n\n${HELP}`);
    process.exit(2);
  }
}

if (cmd === "help") {
  console.log(HELP);
} else if (cmd === "serve") {
  if (opts.color === undefined && !process.stdout.isTTY) opts.color = false;
  try {
    const s = await serve(opts);
    const stop = () => {
      console.log("\n  berth stopped. Your phone will reconnect when you run it again.");
      void s.close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (e) {
    console.error(`\n  berth: ${e.message}\n`);
    process.exit(1);
  }
} else {
  console.error(`berth: unknown command ${cmd}\n\n${HELP}`);
  process.exit(2);
}
