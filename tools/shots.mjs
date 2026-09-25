// Run the photo points (src/dev/shots.js) in a Chrome of their own without a window, on the
// real graphics card, and wait until the last picture is in:
//
//   node tools/shots.mjs <set> [--only quelle,meer] [--port 8123] [--headed] [--webgl]
//
// The pictures and numbers land in shots/<set>/. The development server
// (tools/capture-server.mjs) is started if it is not running yet. --headed shows the window;
// --webgl passes ?webgl to the game (for a renderer that can fall back to WebGL 2).

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const set = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(only|port|quality|probe)$/));
if (!set) {
  console.error("usage: node tools/shots.mjs <set> [--only a,b] [--port 8123] [--headed] [--webgl]");
  process.exit(1);
}
const port = Number(option("port") || 8123);
const only = option("only");
const headed = args.includes("--headed");

// Which points, in order (read from the game's own list, so the two never disagree).
const { SHOTS } = await import(join(root, "src/dev/shots.js"));
const list = only ? SHOTS.filter((s) => only.split(",").includes(s.name)) : SHOTS;
if (!list.length) {
  console.error("no such points");
  process.exit(1);
}

async function reachable() {
  try {
    return (await fetch(`http://localhost:${port}/`)).ok;
  } catch {
    return false;
  }
}
let server = null;
if (!(await reachable())) {
  server = spawn(process.execPath, [join(root, "tools/capture-server.mjs"), String(port)], { stdio: "inherit" });
  for (let i = 0; i < 50 && !(await reachable()); i++) await new Promise((r) => setTimeout(r, 100));
}

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(join(tmpdir(), "salmon-shots-"));
const query = new URLSearchParams({ shots: set });
if (only) query.set("only", only);
if (args.includes("--webgl")) query.set("webgl", "");
if (args.includes("--stages")) query.set("stages", "");
if (args.includes("--smoke")) query.set("smoke", "");
for (const flag of ["fixsun", "nomirror", "noamb"]) if (args.includes(`--${flag}`)) query.set(flag, "");
if (option("quality")) query.set("q", option("quality"));
if (option("probe")) query.set("probe", option("probe"));
const url = `http://localhost:${port}/?${query}`;
const chrome = spawn(
  CHROME,
  [
    ...(headed ? [] : ["--headless=new"]),
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1600,900",
    "--force-device-scale-factor=1",
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan,WebGPU",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
    url,
  ],
  { stdio: "ignore" },
);

const started = Date.now();
const done = async (shot) => {
  try {
    return (await stat(join(root, "shots", set, `${shot.name}.json`))).mtimeMs > started;
  } catch {
    return false;
  }
};
let finished = 0;
let lastProgress = Date.now();
while (finished < list.length) {
  await new Promise((r) => setTimeout(r, 1000));
  let count = 0;
  for (const shot of list) if (await done(shot)) count++;
  if (count > finished) {
    finished = count;
    lastProgress = Date.now();
    console.log(`${set}: ${finished}/${list.length}`);
  }
  // A point that takes over two minutes has hung.
  if (Date.now() - lastProgress > 120000) {
    console.error(`stuck after ${finished} of ${list.length}`);
    break;
  }
}
const closed = new Promise((r) => chrome.once("exit", r));
chrome.kill();
await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]);
server?.kill();
await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
console.log(finished === list.length ? `done: shots/${set}/` : "incomplete");
process.exit(finished === list.length ? 0 : 1);
