// Render the game's sound offline in a Chrome without a window, measure it and check it
// against what it should be (tools/sound-check.html has the scenes and the measuring):
//
//   node tools/sound-check.mjs [--only bed_river,nip] [--wav <folder>] [--json <file>]
//
// --wav keeps each scene as a .wav to listen to (or to measure with other tools). Exits 1
// if a check fails. No dependencies: Node's own http, and Chrome.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const only = option("only")?.split(",");
const wavDir = option("wav");

const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(request.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, { "content-type": extname(path) === ".html" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(0);
const port = server.address().port;

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(join(tmpdir(), "salmon-sound-"));
const debugPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 100 && !ws; i++) {
  await sleep(150);
  try {
    const page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const k = ++id;
    pending.set(k, r);
    ws.send(JSON.stringify({ id: k, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
};
await send("Runtime.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${port}/tools/sound-check.html` });
for (let i = 0; i < 100 && !(await evaluate("!!window.ready")); i++) await sleep(100);

const names = (await evaluate("scenes()")).filter((n) => !only || only.includes(n));
if (wavDir) await mkdir(wavDir, { recursive: true });
const results = [];
for (const name of names) {
  const r = await evaluate(`runScene(${JSON.stringify(name)}, ${!!wavDir})`);
  if (r.wav) {
    await writeFile(join(wavDir, `${name}.wav`), Buffer.from(r.wav, "base64"));
    delete r.wav;
  }
  results.push(r);
}
chrome.kill();
server.close();
await rm(profile, { recursive: true, force: true }).catch(() => {});
if (option("json")) await writeFile(option("json"), JSON.stringify(results, null, 1));

// ---- The tables.
const pad = (v, n) => String(v ?? "").padStart(n);
const byKind = (kind) => results.filter((r) => r.kind === kind);
if (byKind("bed").length) {
  console.log(`\nbeds (3-8 s)            ${pad("LUFS", 6)} ${pad("phone", 6)} ${pad("diff", 5)} ${pad("centr", 6)}   %<150 150-500 .5-1.5k 1.5-4k >4k  nodes`);
  for (const r of byKind("bed")) console.log(`${r.name.padEnd(23)} ${pad(r.full, 6)} ${pad(r.phone, 6)} ${pad((r.full - r.phone).toFixed(1), 5)} ${pad(r.centroid, 6)}   ${r.bands.map((b) => pad(b.toFixed(1), 5)).join(" ")}  ${r.baseNodes}`);
}
if (byKind("cross").length) {
  console.log(`\ncrossing the surface     under  above  jump  jump100 | phone: under  above  jump  jump100`);
  for (const r of byKind("cross")) console.log(`${r.name.padEnd(23)} ${pad(r.under, 6)} ${pad(r.above, 6)} ${pad(r.jump, 5)} ${pad(r.jump100, 7)} |       ${pad(r.underPhone, 6)} ${pad(r.abovePhone, 6)} ${pad(r.jumpPhone, 5)} ${pad(r.jump100Phone, 7)}`);
}
if (byKind("silent").length) {
  console.log(`\nshould be silent (3-8 s)  LUFS`);
  for (const r of byKind("silent")) console.log(`${r.name.padEnd(23)} ${pad(r.full, 7)}`);
}
if (byKind("shot").length) {
  console.log(`\none-shots over the bed   bed  Δ50ms  Δphone  Δ400ms  centr  nodes`);
  for (const r of byKind("shot")) console.log(`${r.name.padEnd(23)} ${pad(r.bedFull, 5)} ${pad(r.dFull, 6)} ${pad(r.dPhone, 7)} ${pad(r.d400, 7)} ${pad(r.centroid, 6)} ${pad(r.shotNodes, 6)}`);
}
if (byKind("solo").length) {
  console.log(`\non their own              LUFS(400ms) centroid  %<150 150-500 .5-1.5k 1.5-4k >4k`);
  for (const r of byKind("solo")) console.log(`${r.name.padEnd(23)} ${pad(r.full, 8)} ${pad(r.centroid, 9)}   ${r.bands.map((b) => pad(b.toFixed(1), 5)).join(" ")}`);
}
if (byKind("stress").length) {
  console.log(`\nstress                   LUFS  loudest  peak  most voices  nodes made  base  sample MB  update µs`);
  for (const r of byKind("stress")) console.log(`${r.name.padEnd(23)} ${pad(r.full, 5)} ${pad(r.loudest, 8)} ${pad(r.peak, 5)} ${pad(r.maxLive, 12)} ${pad(r.nodes, 11)} ${pad(r.baseNodes, 5)} ${pad(((r.bytes ?? 0) / 1e6).toFixed(1), 10)} ${pad(r.updateUs, 10)}`);
}
const extras = results.filter((r) => r.extra);
if (extras.length) {
  console.log(`\nmeasured for their checks`);
  for (const r of extras) console.log(`${r.name.padEnd(23)} ${Object.entries(r.extra).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join("/") : v}`).join("  ")}`);
}
const starts = results.map((r) => r.startMs);
console.log(`\nfirst click (building the graph): ${Math.min(...starts)}-${Math.max(...starts)} ms, ${Math.max(...results.map((r) => r.baseNodes))} nodes; ambient sounds made ${Math.max(...results.filter((r) => r.kind !== "stress").map((r) => r.bubbleNodes))} nodes in a scene at most; loudest peak ${Math.max(...results.map((r) => r.peak))} dBFS (${results.reduce((a, r) => (r.peak > a.peak ? r : a)).name})`);

// ---- The checks.
const get = (name) => results.find((r) => r.name === name);
const checks = [];
const check = (what, ok) => checks.push([what, ok]);
for (const name of ["muted_then_leap", "hushed_then_chime", "hidden_then_thunder"]) if (get(name)) check(`${name} silent (≤ -70 LUFS): ${get(name).full}`, get(name).full <= -70);
if (get("bed_river")) {
  const r = get("bed_river");
  check(`bed_river about -28 LUFS: ${r.full}`, Math.abs(r.full + 28) <= 2);
  check(`bed_river full and phone within 3 dB: ${(r.full - r.phone).toFixed(1)}`, Math.abs(r.full - r.phone) <= 3);
}
for (const name of ["thump_body", "thump_rock", "thump_wood", "thump_net", "thump_hook", "nip"]) if (get(name)) check(`${name} ≥ +6 dB over the bed on a phone: ${get(name).dPhone}`, get(name).dPhone >= 6);
const splashes = ["solo_splash_L0.3", "solo_splash_L1", "solo_splash_L3", "solo_splash_L5.5"].map(get);
if (splashes.every(Boolean)) check(`splash centroid falls with size: ${splashes.map((r) => r.centroid).join(" > ")}`, splashes.every((r, i) => i === 0 || r.centroid < splashes[i - 1].centroid));
for (const r of byKind("cross")) if (r.name !== "leap_whole") check(`${r.name}: in the air within 4 dB (${(r.above - r.under).toFixed(1)}), no jump over 4 dB (${r.jump})`, Math.abs(r.above - r.under) <= 4 && r.jump <= 4);
// Nothing clips: the limiter holds every scene's peaks under full scale.
const peaky = results.filter((r) => r.peak > -1);
check(`every scene's peak ≤ -1 dBFS: ${peaky.length ? peaky.map((r) => `${r.name} ${r.peak}`).join(", ") : `loudest ${Math.max(...results.map((r) => r.peak))}`}`, !peaky.length);
if (get("stress_30s")) {
  const r = get("stress_30s");
  check(`stress_30s: at most 48 voices at once (${r.maxLive}), at most 3000 nodes made (${r.nodes}), base graph at most 95 nodes (${r.baseNodes})`, r.maxLive <= 48 && r.nodes <= 3000 && r.baseNodes <= 95);
}
console.log("");
for (const [what, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
if (errors.length) console.log(`\npage errors:\n${errors.join("\n")}`);
process.exit(checks.every(([, ok]) => ok) && !errors.length ? 0 : 1);
