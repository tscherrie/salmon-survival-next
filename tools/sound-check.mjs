// Render the game's sound offline in a Chrome without a window, measure it and check it
// against what it should be (tools/sound-check.html has the scenes and the measuring):
//
//   node tools/sound-check.mjs [--only bed_river,nip] [--wav <folder>] [--json <file>]
//
// --wav keeps each scene as a .wav to listen to (or to measure with other tools). Exits 1
// if a check fails (the checks are below the tables: loudness of the beds, cues heard on a
// phone, placing, the parts of the river told apart, silence when muted or hushed, no
// clipping, voices and nodes bounded; and what goes on for a while: a hunter's pulses
// thinning out, the heart when strength stays low, a miss heard only when there was one,
// loops that never come round the same, the sea's heave a few decibels). No dependencies:
// Node's own http, and Chrome.

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
// (Never left behind, however this ends.)
process.on("exit", () => chrome.kill("SIGKILL"));
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
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
  if (wavDir) {
    const length = await evaluate("lastWav.length");
    let text = "";
    for (let at = 0; at < length; at += 1 << 20) text += await evaluate(`lastWav.slice(${at}, ${at + (1 << 20)})`);
    await writeFile(join(wavDir, `${name}.wav`), Buffer.from(text, "base64"));
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
// (Not counting the click that comes before the samples are made.)
const loaded = results.filter((r) => r.name !== "early_start");
const starts = loaded.map((r) => r.startMs);
const made = loaded.map((r) => r.madeMs).filter((v) => v !== undefined);
if (made.length) console.log(`\nmaking the samples while loading: ${Math.min(...made)}-${Math.max(...made)} ms of work (in 4 ms slices)`);
console.log(`first click (building the graph): ${Math.min(...starts)}-${Math.max(...starts)} ms, ${Math.max(...results.map((r) => r.baseNodes))} nodes; ambient sounds made ${Math.max(...results.filter((r) => r.kind !== "stress").map((r) => r.bubbleNodes))} nodes in a scene at most; loudest peak ${Math.max(...results.map((r) => r.peak))} dBFS (${results.reduce((a, r) => (r.peak > a.peak ? r : a)).name})`);

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
// What the fish does: heard on a phone over the bed (a big fish's burst too).
for (const [name, least] of [["dash", 6], ["dash_L9", 6], ["jaws", 6], ["fall_cleared", 6], ["fall_failed", 6], ["denied", 4]]) if (get(name)) check(`${name} ≥ +${least} dB over the bed on a phone: ${get(name).dPhone}`, get(name).dPhone >= least);
if (get("charge")?.extra) {
  const e = get("charge").extra;
  check(`charge: a tone low at the start of the swing (+${e.low} dB at 240-420 Hz) and high at its top (+${e.high} dB at 700-1000 Hz), the sweet spot ticked (${e.ticks} ticks)`, e.low >= 2 && e.high >= 4 && e.ticks >= 1);
}
if (get("bed_winded")?.extra && get("bed_river")?.extra) {
  const d = get("bed_winded").extra.gills - get("bed_river").extra.gills;
  check(`bed_winded: the gills +1..+3.5 dB at 500-1500 Hz over bed_river (${d.toFixed(1)}), pulsing about 7 times a second (every ${get("bed_winded").extra.pulse} s)`, d >= 1 && d <= 3.5 && Math.abs(get("bed_winded").extra.pulse - 1 / 7) <= 0.02);
}
// Hunters: placed left and right, heard on a phone; pulses while hunting, thinning out when
// one keeps at it, none from a rival at the redd; the tick before a strike standing out and
// ending where the strike comes; a miss heard only when there was one; the heart heard,
// ducking the river, and gone after its ten seconds -- also when strength stays low.
for (const [name, sign] of [["warn_notice_left", 1], ["warn_notice_right", -1]])
  if (get(name)?.extra) check(`${name}: placed (${get(name).extra.pan} dB left over right at 250-700 Hz, ≥ 4), ≥ +5 dB on a phone (${get(name).dPhone})`, sign * get(name).extra.pan >= 4 && get(name).dPhone >= 5);
if (get("warn_hunt")?.extra) check(`warn_hunt: 5-9 pulses in 3.3 s: ${get("warn_hunt").extra.pulses}`, get("warn_hunt").extra.pulses >= 5 && get("warn_hunt").extra.pulses <= 9);
if (get("stalk_60s")?.extra) {
  const e = get("stalk_60s").extra;
  check(`stalk_60s: pulses at first (${e.first} in 8 s, ≥ 6), thinned out a minute on (${e.last} in 20 s, ≤ 9)`, e.first >= 6 && e.last <= 9);
}
if (get("redd_rival")?.extra) check(`redd_rival: no pulses from a rival (${get("redd_rival").extra.pulses})`, get("redd_rival").extra.pulses <= 1);
if (get("drive_notice")) check(`drive_notice: three goosanders noticing at once call as one (${get("drive_notice").shotNodes} nodes ≤ 7)`, get("drive_notice").shotNodes <= 7);
if (get("warn_coiled")?.extra) check(`warn_coiled: ≥ +8 dB on a phone (${get("warn_coiled").dPhone}), its tick +8 dB at 1.1-2.6 kHz (${get("warn_coiled").extra.tick})`, get("warn_coiled").dPhone >= 8 && get("warn_coiled").extra.tick >= 8);
for (const r of ["coil_short", "coil_long"].map(get).filter((r) => r?.extra)) check(`${r.name}: the last tick where the strike comes (${r.extra.last.toFixed(3)} s for a ${r.extra.coil} s coil, ±0.04)`, Math.abs(r.extra.last - r.extra.coil) <= 0.04);
if (get("hunter_miss")?.extra) check(`hunter_miss: the jaws snap shut on nothing (+${get("hunter_miss").extra.snap} dB at 2-3 kHz)`, get("hunter_miss").extra.snap >= 6);
if (get("kingfisher_kill")?.extra) {
  const e = get("kingfisher_kill").extra;
  check(`kingfisher_kill: nothing snaps as the dive starts (${e.early} dB at 2.5-3.5 kHz over the loudest before, ≤ 9: a bubble can ring there, a snap stands some 15 over it), the catch clacks (+${e.clack}, ≥ 8)`, e.early <= 9 && e.clack >= 8);
}
if (get("heron_bite")?.extra) {
  const e = get("heron_bite").extra;
  check(`heron_bite: no snap after a bite that hit (${e.snaps} onsets at 2-3.2 kHz), no croak (${e.croak} dB at 0.7-1.2 kHz, ≤ 2)`, e.snaps === 0 && e.croak <= 2);
}
if (get("heartbeat")?.extra) {
  const r = get("heartbeat");
  check(`heartbeat: ≥ +4 dB on a phone (${r.dPhone}), the river ducked 1.5-4.5 dB at 1.5-4 kHz (${r.extra.duck}), gone 11 s after (${r.extra.after} dB)`, r.dPhone >= 4 && r.extra.duck <= -1.5 && r.extra.duck >= -4.5 && r.extra.after <= 1);
}
if (get("heart_weak")?.extra) {
  const e = get("heart_weak").extra;
  check(`heart_weak: strength low for good, the heart beating at first (${e.on} of the time, the river ducked to ${e.ducked}), then not (${e.after}) and the river no longer ducked (${e.duck}), back with a blow (${e.again})`, e.on >= 0.95 && e.ducked <= 0.8 && e.after === 0 && e.duck >= 0.99 && e.again >= 0.95);
}
for (const r of ["kingfisher", "heron", "merganser", "seal", "bear"].map((k) => get(`call_${k}`)).filter(Boolean)) check(`${r.name} ≥ +5 dB over the bed on a phone, under water: ${r.dPhone}`, r.dPhone >= 5);
const calls = ["kingfisher", "heron", "merganser", "seal", "bear"].map((k) => get(`solo_call_${k}`)).filter(Boolean);
if (calls.length === 5) {
  // Told apart: by brightness (20 % apart), by where their energy lies (the shares of the
  // five bands at least 40 points apart in all: a bear's growl has a third of its energy
  // under 150 Hz, a heron's croak none), or by tone against noise (spectral flatness twice
  // or more: a heron's croak is a buzz, a seal's whoosh is noise).
  const clash = [];
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++) {
      const a = calls[i],
        b = calls[j];
      const brighter = Math.abs(a.centroid - b.centroid) / Math.min(a.centroid, b.centroid) >= 0.2;
      const apart = a.bands.reduce((sum, v, k) => sum + Math.abs(v - b.bands[k]), 0) >= 40;
      const grain = Math.max(a.flatness, b.flatness) / Math.max(1e-4, Math.min(a.flatness, b.flatness)) >= 2;
      if (!brighter && !apart && !grain) clash.push(`${a.name}/${b.name}`);
    }
  check(`the calls sound different (centroids ${calls.map((r) => r.centroid).join(", ")}; flatness ${calls.map((r) => r.flatness).join(", ")}): ${clash.length ? clash.join(" ") : "all apart"}`, !clash.length);
}
// The parts of the river sound different: each about as loud, brighter up in the brook and
// darkest at sea, their spectra apart, the big river surging, the sea heaving.
const REGIONS = ["brook", "upper", "middle", "lower", "estuary", "sea"].map((r) => get(`bed_${r}`));
if (REGIONS.every(Boolean)) {
  const [brook, upper, middle, lower, estuary, sea] = REGIONS;
  for (const r of REGIONS) check(`${r.name} about -28 LUFS (${r.full}), full and phone within 3 dB (${(r.full - r.phone).toFixed(1)})`, Math.abs(r.full + 28) <= 3 && r.full - r.phone <= 3);
  check(`brighter upstream, darkest at sea: centroids ${REGIONS.map((r) => r.centroid).join(" / ")}`, brook.centroid > upper.centroid && upper.centroid > middle.centroid && middle.centroid > lower.centroid && REGIONS.every((r) => r === sea || r.centroid > sea.centroid));
  const dist = (a, b) => a.bands.reduce((s, v, i) => s + Math.abs(10 * Math.log10((v + 0.01) / (b.bands[i] + 0.01))), 0) / a.bands.length;
  check(`spectra apart: brook/middle ${dist(brook, middle).toFixed(1)} dB, middle/sea ${dist(middle, sea).toFixed(1)} dB (≥ 3)`, dist(brook, middle) >= 3 && dist(middle, sea) >= 3);
  check(`the big river surges at 40-150 Hz: ${middle.extra.surge} dB (brook ${brook.extra.surge})`, middle.extra.surge >= 1.5 && middle.extra.surge >= brook.extra.surge + 1);
}
if (get("bed_sea_swell")?.extra) {
  const e = get("bed_sea_swell").extra;
  check(`the sea heaves at 150-500 Hz (${e.swell} dB, ≥ 1), about every ten seconds (${e.period} s), a few decibels and not a tide (400 ms loudness swings ${e.swing} dB, 2-5)`, e.swell >= 1 && e.period >= 7 && e.period <= 13 && e.swing >= 2 && e.swing <= 5);
}
// Rain pings from below (bright: past the water's top), none under ice; a flood clatters.
if (get("bed_rain")) check(`bed_rain about -25 LUFS: ${get("bed_rain").full}`, Math.abs(get("bed_rain").full + 25) <= 1.5);
if (get("bed_rain_under") && get("bed_river")) {
  const [a, b] = [get("bed_rain_under").bands[4], get("bed_river").bands[4]];
  check(`bed_rain_under: ${a} % above 4 kHz (≥ 15, and ≥ 4 times bed_river's ${b}), the pings never coming round the same (${get("bed_rain_under").extra.repeats.toFixed(2)} ≤ 0.6)`, a >= 15 && a >= 4 * b && get("bed_rain_under").extra.repeats <= 0.6);
}
if (get("bed_ice") && get("bed_river")) check(`bed_ice (rain 1): ${get("bed_ice").bands[4]} % above 4 kHz, at most 1.5 times bed_river's (${get("bed_river").bands[4]})`, get("bed_ice").bands[4] <= 1.5 * Math.max(0.1, get("bed_river").bands[4]));
if (get("bed_flood")?.extra && get("bed_roar_near")) check(`bed_flood clatters at 2-6 kHz (${get("bed_flood").extra.clatter} dB swing), no louder than a fall near by + 2 (${get("bed_flood").full} vs ${get("bed_roar_near").full})`, get("bed_flood").extra.clatter >= 3 && get("bed_flood").full <= get("bed_roar_near").full + 2);
if (get("floe_knock")) check(`floe_knock ≥ +6 dB over the bed on a phone: ${get("floe_knock").dPhone}`, get("floe_knock").dPhone >= 6);
// The river's small sounds: heard, but under the bed (400 ms loudness up by +0.3 to +4 dB).
if (get("mill")?.extra) check(`mill: its paddles slap (${get("mill").extra.slaps} in 8 s, 5-9), under the bed (Δ400ms ${get("mill").d400} ≤ +3)`, get("mill").extra.slaps >= 5 && get("mill").extra.slaps <= 9 && get("mill").d400 <= 3);
if (get("counter")) check(`counter heard but quiet (Δ400ms ${get("counter").d400}, +0.3..+3)`, get("counter").d400 >= 0.3 && get("counter").d400 <= 3);
// (Bread: a few plops at random, some of them faint, so heard by its band's loudest 50 ms.)
if (get("bread")?.extra) check(`bread heard (its plops +${get("bread").extra.plops} dB at 0.5-2.6 kHz, ≥ 3) but quiet (Δ400ms ${get("bread").d400} ≤ 3)`, get("bread").extra.plops >= 3 && get("bread").d400 <= 3);
if (get("ship")?.extra) {
  const e = get("ship").extra;
  check(`ship: its drone rises (+${e.rise} dB at 30-60 Hz) and is gone after (${e.after}), the screw throbs every ${e.throb} s (0.22-0.32)`, e.rise >= 3 && e.after <= 1.5 && e.throb >= 0.22 && e.throb <= 0.32);
}
if (get("grunts")?.extra && get("grunts_ref")?.extra) {
  const d = get("grunts").extra.peak - get("grunts_ref").extra.peak;
  check(`grunts: a run of knocks (${get("grunts").extra.knocks}), heard but in the ambience (the loudest 400 ms +${d.toFixed(1)} dB over the same moment without them, +0.5..+6 for the loudest of them)`, get("grunts").extra.knocks >= 2 && d >= 0.5 && d <= 6);
}
for (const name of ["ice_chirp"]) if (get(name)) check(`${name} heard but in the ambience (Δ400ms ${get(name).d400}, +0.3..+4)`, get(name).d400 >= 0.3 && get(name).d400 <= 4);
// The stages of a life: heard on a phone, each in a few nodes; a beaten hunter not the
// stage fanfare; spawning goes silent under its veil and the new generation rings in.
for (const [name, least] of [["fanfare", 9], ["chime_gold", 9], ["victory", 6], ["growth", 6], ["hatch", 6]])
  if (get(name)) check(`${name} ≥ +${least} dB over the bed on a phone (${get(name).dPhone}) in at most 6 nodes (${get(name).shotNodes})`, get(name).dPhone >= least && get(name).shotNodes <= 6);
if (get("victory") && get("fanfare")) check(`victory its own (centroid ${get("victory").centroid} against the fanfare's ${get("fanfare").centroid})`, Math.abs(get("victory").centroid - get("fanfare").centroid) / get("fanfare").centroid >= 0.2);
if (get("ending")?.extra) check(`ending: a closing swell heard for 2 s (+${get("ending").extra.swell} dB; on a phone +${get("ending").extra.phone}, and +${get("ending").dPhone} at its height) in at most 6 nodes (${get("ending").shotNodes})`, get("ending").extra.swell >= 2 && get("ending").extra.phone >= 2 && get("ending").dPhone >= 5 && get("ending").shotNodes <= 6);
if (get("spawn_veil")?.extra) {
  const e = get("spawn_veil").extra;
  check(`spawn_veil: the pad heard (+${e.pad} dB at 200-700 Hz), silent under the veil (${e.veiled} LUFS ≤ -55), the hatch bell rings (+${e.hatch} dB on a phone)`, e.pad >= 1.5 && e.veiled <= -55 && e.hatch >= 6);
}
if (get("bed_home") && get("bed_river")) {
  const d = get("bed_home").full - get("bed_river").full;
  check(`bed_home: the home brook's scent heard over the river (+${d.toFixed(1)} dB, +1..+5), a phone plays it (${(get("bed_home").full - get("bed_home").phone).toFixed(1)}), nothing in it coming round (${get("bed_home").extra.repeats.toFixed(2)} ≤ 0.6; its old loop 0.94)`, d >= 1 && d <= 5 && get("bed_home").full - get("bed_home").phone <= 3 && get("bed_home").extra.repeats <= 0.6);
}
// Weather: the flash cracks (from under the water a little less than in the air, as all
// that comes from above), the thunder still rolls, a storm swells up and brightens.
if (get("lightning_near")) check(`lightning_near ≥ +6 dB at the flash: ${get("lightning_near").dFull}`, get("lightning_near").dFull >= 6);
if (get("lightning_near") && get("lightning_above")) check(`lightning under water under its height in the air (${get("lightning_near").dFull} against ${get("lightning_above").dFull}, by 1-6 dB)`, get("lightning_above").dFull - get("lightning_near").dFull >= 1 && get("lightning_above").dFull - get("lightning_near").dFull <= 6);
if (get("thunder_near")) check(`thunder_near ≥ +6 dB (full band): ${get("thunder_near").dFull}`, get("thunder_near").dFull >= 6);
if (get("storm_swell")?.extra) {
  const e = get("storm_swell").extra;
  check(`storm_swell: +3..+7 dB (Δ400ms ${e.d400}; on a phone +${e.phone}, ≥ 2)`, e.d400 >= 3 && e.d400 <= 7 && e.phone >= 2);
}
if (get("storm_alone")?.extra) check(`storm_alone: brightening as it swells (${Math.round(get("storm_alone").extra.early)} → ${Math.round(get("storm_alone").extra.late)} Hz)`, get("storm_alone").extra.late > 1.2 * get("storm_alone").extra.early);
// Nothing clips: the limiter holds every scene's peaks under full scale.
const peaky = results.filter((r) => r.peak > -1);
check(`every scene's peak ≤ -1 dBFS: ${peaky.length ? peaky.map((r) => `${r.name} ${r.peak}`).join(", ") : `loudest ${Math.max(...results.map((r) => r.peak))}`}`, !peaky.length);
if (get("early_start")?.extra) {
  const r = get("early_start");
  check(`early_start: a click before the samples are made (${r.extra.making} jobs left) waits only for the beds' noise (${r.startMs} ms), and all is made after (${r.unbanked} not yet buffers)`, r.extra.making > 0 && r.unbanked === 0);
}
if (get("stress_30s")) {
  const r = get("stress_30s");
  check(`stress_30s: at most 48 voices at once (${r.maxLive}), at most 3000 nodes made (${r.nodes}), base graph at most 95 nodes (${r.baseNodes}), no sample held twice (${r.unbanked} not yet buffers)`, r.maxLive <= 48 && r.nodes <= 3000 && r.baseNodes <= 95 && r.unbanked === 0);
}
console.log("");
for (const [what, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
if (errors.length) console.log(`\npage errors:\n${errors.join("\n")}`);
process.exit(checks.every(([, ok]) => ok) && !errors.length ? 0 : 1);
