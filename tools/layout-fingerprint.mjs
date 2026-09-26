// The river's layout as one number: every collider of every block built round some places
// along the river, and how many plant vertices each block holds. A change to how things look
// (the stones' shapes, their material) must leave it exactly as it was; if it moves, some
// change drew one random number more or less, and everything after it in that stream moved.
//
//   node tools/layout-fingerprint.mjs [s ...]      (default: 240 2500 4250 11790)
//
// Runs the game's own terrain code in Node, with three.js from vendor/ and no pictures.
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const map = { three: "vendor/three.webgpu.js", "three/webgpu": "vendor/three.webgpu.js", "three/tsl": "vendor/three.tsl.js" };
registerHooks({
  resolve(specifier, context, next) {
    if (map[specifier]) return { url: pathToFileURL(join(root, map[specifier])).href, shortCircuit: true };
    if (specifier.startsWith("three/addons/")) return { url: pathToFileURL(join(root, "vendor/jsm", specifier.slice(13))).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.navigator ??= { userAgent: "node" };
globalThis.document = { createElement: () => ({ getContext: () => null, width: 1, height: 1, style: {} }) };

const THREE = await import("three");
THREE.ImageLoader.prototype.load = function () {
  return {};
};
const course = await import(pathToFileURL(join(root, "src/course.js")).href);
const { createTerrain } = await import(pathToFileURL(join(root, "src/terrain.js")).href);
const material = new THREE.MeshBasicMaterial();
const rocks = { brook: material, river: material, sea: material, wood: material };
let h = 2166136261;
const mix = (v) => {
  h = Math.imul(h ^ Math.round(v * 1e4), 16777619) >>> 0;
};
const places = process.argv.slice(2).map(Number);
for (const s of places.length ? places : [240, 2500, 4250, 11790]) {
  const terrain = createTerrain(new THREE.Scene(), { bedMaterial: material, surfaceMaterial: material, rocks, detail: true });
  const c = course.section(Math.min(s, course.S.coast));
  const at = course.place(s, c.thalweg, {});
  terrain.prime({ x: at.x, z: at.z, s, u: c.thalweg }, { radius: 140, near: 0.5, land: 60 });
  let colliders = 0,
    plantVerts = 0;
  for (const key of [...terrain.blocks.keys()].sort()) {
    const block = terrain.blocks.get(key);
    if (!block.content) continue;
    for (const k of block.content.colliders) {
      mix(k.x);
      mix(k.y);
      mix(k.z);
      mix(k.r);
      colliders++;
    }
    const n = block.content.plants?.geometry.attributes.position.count ?? 0;
    mix(n);
    plantVerts += n;
  }
  console.log(`s=${s} colliders=${colliders} plantVerts=${plantVerts}`);
}
console.log("fingerprint", h.toString(16));
