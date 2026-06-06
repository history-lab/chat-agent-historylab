#!/usr/bin/env node
// tools/chat-cli.mjs
// Local terminal REPL against a deployed HistoryLab chat worker.
// Bypasses the React UI + auth entirely — just streams SSE from the
// /api/chat/:id/messages endpoint.
//
// Usage:
//   node tools/chat-cli.mjs                          # defaults to agent-3
//   node tools/chat-cli.mjs --url <base-url>         # custom worker
//   node tools/chat-cli.mjs --user me --convo demo   # custom convo id

import readline from "node:readline/promises";
import { stdin as input, stdout as output, argv } from "node:process";

const DEFAULTS = {
  url: "https://history-lab-chat-agent-3.nchimicles.workers.dev",
  user: "cli-user",
  collection: "80650a98-fe49-429a-afbd-9dde66e2d02b",
  convo: `cli-${Date.now()}`,
};

function parseArgs(args) {
  const out = { ...DEFAULTS };
  for (let i = 2; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === "--url" && v) { out.url = v; i++; }
    else if (k === "--user" && v) { out.user = v; i++; }
    else if (k === "--convo" && v) { out.convo = v; i++; }
    else if (k === "--collection" && v) { out.collection = v; i++; }
    else if (k === "--help" || k === "-h") {
      console.log("usage: node tools/chat-cli.mjs [--url <url>] [--user <id>] [--convo <id>] [--collection <id>]");
      process.exit(0);
    }
  }
  return out;
}

const opts = parseArgs(argv);
const chatId = Buffer.from(`${opts.user}|${opts.collection}|${opts.convo}`).toString("base64");
const endpoint = `${opts.url.replace(/\/$/, "")}/api/chat/${encodeURIComponent(chatId)}/messages`;

// ANSI helpers
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

console.log(`${c.dim}endpoint: ${endpoint}${c.reset}`);
console.log(`${c.dim}convo:    ${opts.user} | ${opts.collection} | ${opts.convo}${c.reset}`);
console.log(`${c.dim}(type 'exit' or Ctrl-C to quit, 'reset' to start a new convo)${c.reset}\n`);

let messages = [];

// Fetch any persisted history so the convo can be resumed
try {
  const r = await fetch(endpoint, { method: "GET" });
  if (r.ok) {
    const prior = await r.json();
    if (Array.isArray(prior) && prior.length > 0) {
      messages = prior;
      console.log(`${c.dim}loaded ${prior.length} prior message(s) from server${c.reset}\n`);
    }
  }
} catch (err) {
  console.log(`${c.dim}(no prior history)${c.reset}\n`);
}

const rl = readline.createInterface({ input, output });

function uid() {
  return Math.random().toString(36).slice(2, 12);
}

function extractText(msg) {
  if (!Array.isArray(msg.parts)) return "";
  return msg.parts
    .filter((p) => p?.type === "text")
    .map((p) => p.text || "")
    .join("");
}

async function streamTurn(userText) {
  const userMsg = {
    id: uid(),
    role: "user",
    parts: [{ type: "text", text: userText }],
  };
  messages.push(userMsg);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    console.log(`${c.red}HTTP ${res.status}: ${await res.text()}${c.reset}\n`);
    messages.pop(); // roll back the user message
    return;
  }

  // Parse SSE stream of UIMessageChunk events
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assistantText = "";
  const toolCalls = new Map(); // toolCallId → { name, input }
  let lastEventWasText = false;
  let firstChunk = true;

  process.stdout.write(`${c.bold}${c.green}assistant${c.reset} `);

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]" || !payload) continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      switch (evt.type) {
        case "start":
        case "start-step":
          if (firstChunk) firstChunk = false;
          break;
        case "text-start":
          if (lastEventWasText) process.stdout.write("\n");
          break;
        case "text-delta":
          if (typeof evt.delta === "string") {
            process.stdout.write(evt.delta);
            assistantText += evt.delta;
            lastEventWasText = true;
          }
          break;
        case "text-end":
          break;
        case "tool-input-start": {
          if (lastEventWasText) { process.stdout.write("\n"); lastEventWasText = false; }
          const t = evt.toolName || "?";
          toolCalls.set(evt.toolCallId, { name: t, input: undefined });
          process.stdout.write(`${c.cyan}→ ${t}${c.reset} ${c.dim}(building input...)${c.reset}\n`);
          break;
        }
        case "tool-input-available": {
          const tc = toolCalls.get(evt.toolCallId);
          if (tc) tc.input = evt.input;
          const inputStr = JSON.stringify(evt.input);
          const trimmed = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr;
          process.stdout.write(`${c.dim}  input: ${trimmed}${c.reset}\n`);
          break;
        }
        case "tool-output-available": {
          const tc = toolCalls.get(evt.toolCallId);
          const name = tc?.name || "?";
          const out = evt.output;
          let summary = "";
          if (out && typeof out === "object") {
            if (Array.isArray(out.documents)) summary = `${out.documents.length} documents`;
            else if (Array.isArray(out.data)) summary = `${out.data.length} rows${out.total != null ? ` (total ${out.total})` : ""}`;
            else if (out.error) summary = `ERROR: ${out.error}`;
            else if (out.doc_id) summary = `doc ${out.doc_id}`;
            else summary = Object.keys(out).slice(0, 4).join(", ");
          } else {
            summary = String(out).slice(0, 80);
          }
          const colour = (out && out.error) ? c.red : c.green;
          process.stdout.write(`${colour}  ← ${name}: ${summary}${c.reset}\n`);
          break;
        }
        case "tool-output-error":
        case "error": {
          process.stdout.write(`${c.red}  ! ${evt.errorText || evt.error || "tool error"}${c.reset}\n`);
          break;
        }
        case "finish-step":
        case "finish":
          break;
        default:
          // unknown chunk type — quiet by default
          break;
      }
    }
  }

  if (!assistantText.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write("\n");

  // Persist the assistant message locally so the next turn carries history.
  // The server also persists via toUIMessageStreamResponse.onFinish, so on the
  // next POST we send the full history (server overwrites with the same array).
  messages.push({
    id: uid(),
    role: "assistant",
    parts: [{ type: "text", text: assistantText }],
  });
}

while (true) {
  let prompt;
  try {
    prompt = await rl.question(`${c.bold}${c.blue}you>${c.reset} `);
  } catch {
    break;
  }
  const trimmed = prompt.trim();
  if (!trimmed) continue;
  if (trimmed === "exit" || trimmed === "quit") break;
  if (trimmed === "reset") {
    messages = [];
    console.log(`${c.dim}(cleared local history — server still has it under the same convo id)${c.reset}\n`);
    continue;
  }
  if (trimmed === "history") {
    console.log(`${c.dim}${messages.length} message(s):${c.reset}`);
    messages.forEach((m, i) => {
      const text = extractText(m);
      console.log(`  ${i} ${m.role}: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`);
    });
    console.log("");
    continue;
  }
  try {
    await streamTurn(trimmed);
  } catch (err) {
    console.log(`${c.red}error: ${err.message}${c.reset}\n`);
  }
}

rl.close();
process.exit(0);
