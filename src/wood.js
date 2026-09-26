// Wood: every stick, branch, root and drowned trunk in the river, as limbs that taper, bend
// and wobble a little, with ends that are broken, sawn or gnawed, the bark laid on along the
// grain; drift trunks with the stubs of their branches and the plate of roots they were torn
// out with. A stretch of river (or a place) gathers its wood into one batch, drawn at once.
//
// Everything random here comes from the piece's own stream, seeded from what the caller
// already knows about it: never from the river's streams.
import * as THREE from "three";
import { randomGenerator } from "../shared/random.js";
import { rockNoise } from "./render/rocks.js";

const TAU = Math.PI * 2;
const smooth01 = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// A stream of its own for a piece, from a few numbers that tell it apart.
export function woodRandom(...values) {
  let h = 2166136261;
  for (const v of values) h = Math.imul(h ^ Math.round(v * 1000), 16777619) >>> 0;
  return randomGenerator(h % 2147483647 || 7);
}

// The legacy tube's vertex count (terrain.js used to draw one number per vertex for a
// drowned trunk's colour; the stream must still see as many draws).
export function legacyTubeVertices(points, r0) {
  const length = new THREE.CatmullRomCurve3(points).getLength();
  const rows = Math.max(6, Math.min(48, Math.ceil(length * 1.2)));
  const cols = r0 > 0.4 ? 14 : 8;
  return (rows + 1) * (cols + 1) + 4 * cols + 2;
}

// Wood merged into one geometry, in typed arrays grown as needed. Each vertex carries
//   uv       around the limb (whole turns of the bark photograph) and along it
//   color.r  its shade; color.g its share of moss; color.b bare wood (0 bark, up to 0.9
//            weathered bare wood), 1 on an end cut across the grain
export class WoodBatch {
  constructor() {
    this.count = 0;
    this.indexCount = 0;
    this.position = new Float32Array(3 * 2048);
    this.normal = new Float32Array(3 * 2048);
    this.uv = new Float32Array(2 * 2048);
    this.color = new Float32Array(3 * 2048);
    this.index = new Uint32Array(3 * 4096);
    this.minY = Infinity;
    this.maxY = -Infinity;
  }
  reserve(vertices, indices) {
    const need = this.count + vertices;
    if (need * 3 > this.position.length) {
      const size = Math.ceil(need * 1.5);
      for (const [name, n] of [
        ["position", 3],
        ["normal", 3],
        ["uv", 2],
        ["color", 3],
      ]) {
        const next = new Float32Array(size * n);
        next.set(this[name].subarray(0, this.count * n));
        this[name] = next;
      }
    }
    if (this.indexCount + indices > this.index.length) {
      const next = new Uint32Array(Math.ceil((this.indexCount + indices) * 1.5));
      next.set(this.index.subarray(0, this.indexCount));
      this.index = next;
    }
  }
  vertex(x, y, z, nx, ny, nz, u, v, r, g, b) {
    this.reserve(1, 0);
    const i = this.count++;
    this.position.set([x, y, z], i * 3);
    this.normal.set([nx, ny, nz], i * 3);
    this.uv.set([u, v], i * 2);
    this.color.set([r, g, b], i * 3);
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    return i;
  }
  triangle(a, b, c) {
    this.reserve(0, 3);
    this.index[this.indexCount++] = a;
    this.index[this.indexCount++] = b;
    this.index[this.indexCount++] = c;
  }
  get empty() {
    return this.count === 0;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.position.slice(0, this.count * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.normal.slice(0, this.count * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(this.uv.slice(0, this.count * 2), 2));
    g.setAttribute("color", new THREE.BufferAttribute(this.color.slice(0, this.count * 3), 3));
    const index = this.count < 65536 ? new Uint16Array(this.index.subarray(0, this.indexCount)) : this.index.slice(0, this.indexCount);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// What kind of piece it is sets its defaults: how gnarled, how much bare wood, its ends.
const KINDS = {
  // A trunk the river has carried: bark coming off, a broken top, often its roots.
  drift: { gnarl: 0.12, bare: 0.25, end0: "snapped", end1: "snapped", wad: 0.6, stubs: [3, 6], flare: 0.35, moss: 0.35 },
  // A drowned trunk on the bed: sawn once, long in the water, grey and bare.
  drowned: { gnarl: 0.1, bare: 0.35, end0: "sawn", end1: "snapped", stubs: [2, 5], flare: 0.2, moss: 0.45 },
  // A branch hanging from the bank into the water.
  branch: { gnarl: 0.5, bare: 0.05, end0: "hidden", end1: "point" },
  // A twig on the bed.
  twig: { gnarl: 0.6, bare: 0.3, end0: "snapped", end1: "point" },
  // A beaver's stick: peeled pale, gnawed to a point at both ends.
  stick: { gnarl: 0.25, bare: 0.85, end0: "gnawed", end1: "gnawed" },
  // A root: tapering to nothing.
  root: { gnarl: 0.7, bare: 0.1, end0: "hidden", end1: "point" },
  // A mast or a timber: straight, sawn.
  mast: { gnarl: 0.02, bare: 0.4, end0: "sawn", end1: "snapped" },
};

// A limb through points, radius r0 at the first and r1 at the last. Options: kind (above),
// seed (its own stream), bright, moss, and any of the kind's defaults. Returns the batch.
export function woodLimb(batch, points, r0, r1, options = {}) {
  const K = { ...KINDS[options.kind ?? "drift"], ...options };
  const rng = woodRandom(options.seed ?? 1, points[0].x, points[0].z, r0);
  const bright = K.bright ?? 0.7;
  const moss = options.moss ?? K.moss ?? 0.6;
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rMean = (r0 + r1) / 2;
  // Rings by length, closer where the limb is thick at its foot; a stick needs few.
  const spacing = Math.max(0.45 * rMean, 0.3);
  const rings = Math.max(3, Math.min(64, Math.ceil(length / spacing)));
  const cols = rMean >= 0.6 ? 16 : rMean >= 0.2 ? 10 : rMean >= 0.06 ? 6 : 4;
  // Its bark photograph: a whole number of turns round it (no seam), tiles as long as wide.
  const T = Math.min(3, Math.max(0.35, 4 * rMean));
  const turns = Math.max(1, Math.round((TAU * rMean) / T));
  // Frames carried along the curve without twisting.
  const P = [],
    Tn = [],
    N = [],
    B = [];
  const at = new THREE.Vector3(),
    tangent = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    curve.getPointAt(t, at);
    curve.getTangentAt(t, tangent);
    P.push(at.clone());
    Tn.push(tangent.clone());
  }
  {
    const t0 = Tn[0];
    const ref = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    N.push(new THREE.Vector3().crossVectors(t0, ref).normalize());
    B.push(new THREE.Vector3().crossVectors(t0, N[0]).normalize());
    for (let i = 1; i <= rings; i++) {
      const n = N[i - 1].clone();
      n.addScaledVector(Tn[i], -n.dot(Tn[i])).normalize();
      N.push(n);
      B.push(new THREE.Vector3().crossVectors(Tn[i], n).normalize());
    }
  }
  // The line wanders a little between its ends (the ends stay put: joints and colliders).
  const gnarl = K.gnarl * rMean;
  const l1 = Math.max(1.5, rMean * (10 + rng() * 6)),
    l2 = Math.max(1.2, rMean * (10 + rng() * 6));
  const p1 = rng() * TAU,
    p2 = rng() * TAU;
  const phase = rng() * TAU,
    phase2 = rng() * TAU,
    twist = (rng() - 0.5) * 6;
  const flare = K.flare ?? 0;
  const lobes = 4 + Math.floor(rng() * 3),
    lobeTurn = rng() * TAU;
  const radius = (t, a) => {
    const along = t * length;
    const taper = r1 + (r0 - r1) * Math.pow(1 - t, 1.2);
    const foot = flare ? 1 + flare * Math.exp(-along / (0.9 * r0)) * (1 + 0.6 * Math.pow(Math.max(0, Math.cos(lobes * (a - lobeTurn))), 3)) : 1;
    const section = 1 + 0.08 * Math.sin(2 * a + phase + t * twist) + 0.04 * Math.sin(3 * a + phase2 - t * twist);
    return taper * foot * section;
  };
  const offsetAt = (i, t) => {
    const along = t * length;
    const w = smooth01(0, 0.15, t) * smooth01(1, 0.85, t) * gnarl;
    const a = Math.sin((TAU * along) / l1 + p1) * w,
      b = Math.sin((TAU * along) / l2 + p2) * w;
    return new THREE.Vector3().copy(P[i]).addScaledVector(N[i], a).addScaledVector(B[i], b);
  };
  // The ring grid.
  const grid = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = offsetAt(i, t);
    const ring = [];
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      const dir = new THREE.Vector3().copy(N[i]).multiplyScalar(Math.cos(a)).addScaledVector(B[i], Math.sin(a));
      ring.push(c.clone().addScaledVector(dir, radius(t, a)));
    }
    grid.push(ring);
  }
  // Normals from the grid itself (bumps and flares shade), wrapping round each ring.
  const normalAt = (i, j) => {
    const jn = j === cols ? 1 : j + 1,
      jp = j === 0 ? cols - 1 : j - 1;
    const around = new THREE.Vector3().subVectors(grid[i][jn], grid[i][jp]);
    const along = new THREE.Vector3().subVectors(grid[Math.min(rings, i + 1)][j], grid[Math.max(0, i - 1)][j]);
    const n = new THREE.Vector3().crossVectors(around, along).normalize();
    // (Pointing out of the limb, whichever way the rings run.)
    const centre = offsetAt(i, i / rings);
    if (n.dot(new THREE.Vector3().subVectors(grid[i][j], centre)) < 0) n.negate();
    return n;
  };
  // Bare patches where the bark has come off: a noise that goes round the limb exactly.
  const bareAt = (t, a) => {
    const along = t * length;
    const nz = rockNoise(Math.cos(a) * 1.3 + 7.1, Math.sin(a) * 1.3 + 3.3, along / Math.max(0.5, rMean * 3) + phase);
    return smooth01(0.6, 0.78, nz + K.bare * 0.7 - 0.25) * 0.9;
  };
  const mossShare = moss * Math.min(1, rMean / 0.15);
  const start = batch.count;
  let v = 0;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    v = (t * length) / T;
    for (let j = 0; j <= cols; j++) {
      const q = grid[i][j];
      const n = normalAt(i, j);
      const a = (j / cols) * TAU;
      const shade = bright * (1 - 0.25 * Math.max(0, -n.y));
      batch.vertex(q.x, q.y, q.z, n.x, n.y, n.z, (j / cols) * turns + twist * 0.02 * t, v, shade, mossShare, bareAt(t, a));
    }
  }
  const stride = cols + 1;
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < cols; j++) {
      const k = start + i * stride + j;
      batch.triangle(k, k + 1, k + stride);
      batch.triangle(k + 1, k + stride + 1, k + stride);
    }
  // The ends.
  for (const [end, kind] of [
    [0, K.end0],
    [1, K.end1],
  ]) {
    if (kind === "hidden") continue;
    const i = end * rings;
    const outward = end ? Tn[i].clone() : Tn[i].clone().negate();
    const centre = offsetAt(i, end);
    const ringStart = start + i * stride;
    const r = radius(end, 0);
    if (kind === "sawn") {
      // Across the grain: a flat face, the heartwood a little sunk in.
      const rim = batch.count;
      for (let j = 0; j < cols; j++) {
        const q = grid[i][j];
        const a = (j / cols) * TAU;
        batch.vertex(q.x, q.y, q.z, outward.x, outward.y, outward.z, Math.cos(a), Math.sin(a), bright, 0, 1);
      }
      const mid = batch.vertex(centre.x - outward.x * r * 0.12, centre.y - outward.y * r * 0.12, centre.z - outward.z * r * 0.12, outward.x, outward.y, outward.z, 0, 0, bright * 0.9, 0, 1);
      for (let j = 0; j < cols; j++) {
        const j1 = (j + 1) % cols;
        if (end) batch.triangle(rim + j, rim + j1, mid);
        else batch.triangle(rim + j1, rim + j, mid);
      }
    } else {
      // Broken off (splinters), gnawed to a point, or tapering out: rings pulled out along
      // the limb and drawn in, closed at a tip.
      const steps = kind === "snapped" ? 2 : 1;
      let prev = ringStart;
      const bareEnd = kind === "point" ? bareAt(end, 0) : 0.9;
      for (let s = 1; s <= steps; s++) {
        const f = s / (steps + 1);
        const ring = batch.count;
        for (let j = 0; j <= cols; j++) {
          const a = (j / cols) * TAU;
          const jag = kind === "snapped" ? 0.4 + rng() * 1.2 : 1;
          const reach = r * (kind === "gnawed" ? 1.3 : kind === "point" ? 1.5 : 0.35) * f * jag;
          const shrink = kind === "snapped" ? 1 - f * (0.35 + rng() * 0.3) : 1 - f;
          const dir = new THREE.Vector3().copy(N[i]).multiplyScalar(Math.cos(a)).addScaledVector(B[i], Math.sin(a));
          const q = centre.clone().addScaledVector(outward, reach).addScaledVector(dir, radius(end, a) * shrink);
          const n = dir.clone().multiplyScalar(0.6).addScaledVector(outward, 0.8).normalize();
          batch.vertex(q.x, q.y, q.z, n.x, n.y, n.z, (j / cols) * turns, v + (end ? 1 : -1) * f * r / T, bright, mossShare * 0.3, Math.max(bareEnd, 0.6));
        }
        for (let j = 0; j < cols; j++) {
          const a0 = prev + j,
            b0 = ring + j;
          if (end) {
            batch.triangle(a0, a0 + 1, b0);
            batch.triangle(a0 + 1, b0 + 1, b0);
          } else {
            batch.triangle(a0 + 1, a0, b0);
            batch.triangle(b0 + 1, a0 + 1, b0);
          }
        }
        prev = ring;
      }
      const reach = r * (kind === "gnawed" ? 2.2 : kind === "point" ? 2.5 : 0.5 + rng() * 0.6);
      const tip = centre.clone().addScaledVector(outward, kind === "snapped" ? reach * 0.6 : reach);
      const t = batch.vertex(tip.x, tip.y, tip.z, outward.x, outward.y, outward.z, 0.5 * turns, v + (end ? 1 : -1) * reach / T, bright * 0.9, 0, Math.max(bareEnd, 0.6));
      for (let j = 0; j < cols; j++) {
        if (end) batch.triangle(prev + j, prev + j + 1, t);
        else batch.triangle(prev + j + 1, prev + j, t);
      }
    }
  }
  // A drift trunk: its roots torn out with it, and the stubs of its branches.
  if (options.kind === "drift" || options.kind === "drowned") {
    const stubs = K.stubs ? K.stubs[0] + Math.floor(rng() * (K.stubs[1] - K.stubs[0] + 1)) : 0;
    for (let k = 0; k < stubs; k++) {
      const t = 0.3 + rng() * 0.62;
      const i = Math.round(t * rings);
      const a = rng() * TAU;
      const dir = new THREE.Vector3().copy(N[i]).multiplyScalar(Math.cos(a)).addScaledVector(B[i], Math.sin(a));
      const base = offsetAt(i, i / rings).addScaledVector(dir, radius(i / rings, a) * 0.6);
      const r = radius(i / rings, a) * (0.18 + rng() * 0.17);
      const out = dir.clone().addScaledVector(Tn[i], 0.6).normalize();
      const len = r * (2 + rng() * 5) + radius(i / rings, a) * 0.4;
      woodLimb(batch, [base, base.clone().addScaledVector(out, len * 0.55), base.clone().addScaledVector(out, len)], r, r * 0.75, { kind: "twig", seed: (options.seed ?? 1) * 31 + k, bright: bright * 0.95, moss: moss * 0.5, bare: 0.5, end0: "hidden", end1: "snapped", gnarl: 0.15 });
    }
    if (options.kind === "drift" && rng() < K.wad) {
      // The root plate at the foot: roots out and back from the flare, sagging.
      const roots = 6 + Math.floor(rng() * 4);
      for (let k = 0; k < roots; k++) {
        const a = lobeTurn + (k / roots) * TAU + (rng() - 0.5) * 0.5;
        const dir = new THREE.Vector3().copy(N[0]).multiplyScalar(Math.cos(a)).addScaledVector(B[0], Math.sin(a));
        const back = Tn[0].clone().negate();
        const heading = dir.clone().lerp(back, 0.3 + rng() * 0.5).normalize();
        const len = r0 * (1.2 + rng() * 1.2);
        const pts = [offsetAt(0, 0).addScaledVector(dir, r0 * 0.55)];
        for (let s = 1; s <= 3; s++) {
          const q = pts[s - 1].clone().addScaledVector(heading, len / 3);
          q.y -= len * 0.08 * s;
          pts.push(q);
        }
        const rr = r0 * (0.3 + rng() * 0.15);
        woodLimb(batch, pts, rr, rr * 0.08, { kind: "root", seed: (options.seed ?? 1) * 17 + k, bright: bright * 0.85, moss: moss * 0.4, bare: 0.3 });
      }
    }
  }
  return batch;
}
