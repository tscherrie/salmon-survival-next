// A small web server for development: serves the game as Vercel would (a static folder),
// and keeps what the game sends back from a run of photo points (src/dev/shots.js) --
// the pictures in shots/<set>/<name>.jpg and the measurements in shots/<set>/<name>.json.
//
//   node tools/capture-server.mjs [port]      then open http://localhost:8123/?shots=<set>
//
// No dependencies: Node's own http and fs.

import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "shots");
const port = Number(process.argv[2] || process.env.PORT || 8123);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// A name the game may write under shots/: letters, digits, dashes, dots and one level of set.
const safeName = (name) => /^[\w.-]+(\/[\w.-]+)?$/.test(name) && !name.includes("..");

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function keep(request, response, name, kind) {
  if (!safeName(name)) return send(response, 400, "bad name");
  const data = await body(request);
  let file, bytes;
  if (kind === "capture") {
    // A data URL from canvas.toDataURL.
    const text = data.toString("utf8");
    const match = text.match(/^data:image\/(jpeg|png|webp);base64,(.*)$/s);
    if (!match) return send(response, 400, "not an image");
    file = join(shots, `${name}.${match[1] === "jpeg" ? "jpg" : match[1]}`);
    bytes = Buffer.from(match[2], "base64");
  } else {
    file = join(shots, `${name}.json`);
    bytes = data;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  console.log(`kept ${file.slice(root.length + 1)} (${(bytes.length / 1024).toFixed(0)} KB)`);
  send(response, 200, "ok");
}

function send(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function serve(request, response, path) {
  let file = normalize(join(root, decodeURIComponent(path)));
  if (!file.startsWith(root)) return send(response, 403, "outside");
  try {
    if ((await stat(file)).isDirectory()) {
      // A folder under shots/ lists its files (for the comparison page); others serve index.html.
      if (file.startsWith(shots)) {
        const names = (await readdir(file)).sort();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify(names));
      }
      file = join(file, "index.html");
    }
    const bytes = await readFile(file);
    response.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      // Always the file as it is now: modules change while working on them.
      "cache-control": "no-store",
    });
    response.end(bytes);
  } catch {
    send(response, 404, "not found");
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  try {
    if (request.method === "POST" && url.pathname.startsWith("/__capture/")) return await keep(request, response, url.pathname.slice(11), "capture");
    if (request.method === "POST" && url.pathname.startsWith("/__report/")) return await keep(request, response, url.pathname.slice(10), "report");
    if (request.method === "GET" || request.method === "HEAD") return await serve(request, response, url.pathname);
    send(response, 405, "method");
  } catch (error) {
    console.error(error);
    send(response, 500, String(error));
  }
}).listen(port, () => console.log(`Salmon Survival on http://localhost:${port}/ (pictures to ${shots.slice(root.length + 1)}/)`));
