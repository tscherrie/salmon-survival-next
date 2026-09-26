// Stones: a generator of rock shapes, the catalog the river draws its stones from, and the
// batch a stretch of river merges them into.
//
// A shape starts from a geodesic sphere whose every vertex is shared (no seam, no poles),
// and each of its directions is pushed out onto a signed-distance rock: a rounded polytope
// (a smooth maximum over cutting planes), weathered with slow noise. Families differ in
// their planes and how sharply they meet: blocks broken along joints, slabs split along
// their bedding, wedges with a face sheared off, boulders and cobbles worn round by the
// water, lumps of earth. The shape is then fitted into the unit box (-1..1 on every axis):
// the placement's radii give each stone its proportions, and the box is what its collider
// and its seat were always made for.
//
// Everything random here comes from the shape's own stream: never from the river's.
import * as THREE from "three";
import { randomGenerator } from "../../shared/random.js";

const TAU = Math.PI * 2;
const smooth01 = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Value noise over a hashed lattice (a table, no sine: the same on every machine).
const PERM = new Uint8Array(512);
{
  const r = randomGenerator(90210);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const VAL = new Float32Array(256).map((_, i) => PERM[(i * 7 + 3) & 255] / 255);
export function rockNoise(x, y, z) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const X = ix & 255,
    Y = iy & 255,
    Z = iz & 255;
  const h = (a, b, c) => VAL[PERM[PERM[PERM[X + a] + Y + b] + Z + c]];
  const x00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * fx;
  const x10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * fx;
  const x01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * fx;
  const x11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy,
    y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

// ---------------------------------------------------------------------------------------
// Spheres with every vertex shared.
const ICOSAHEDRON = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const dirs = [];
  for (const p of base) {
    const l = Math.hypot(p[0], p[1], p[2]);
    dirs.push(p[0] / l, p[1] / l, p[2] / l);
  }
  const faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  return { dirs, faces };
})();

// Each triangle of the icosahedron cut into freq x freq smaller ones (any frequency: 2 gives
// 80 triangles, 3 gives 180, 4 gives 320, 8 gives 1280).
export function geodesic(freq) {
  const { dirs: base, faces: baseFaces } = ICOSAHEDRON;
  const dirs = [];
  const index = new Map();
  const vertex = (x, y, z) => {
    const l = Math.hypot(x, y, z);
    x /= l;
    y /= l;
    z /= l;
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let i = index.get(key);
    if (i === undefined) {
      i = dirs.length / 3;
      dirs.push(x, y, z);
      index.set(key, i);
    }
    return i;
  };
  const faces = [];
  for (let f = 0; f < baseFaces.length; f += 3) {
    const a = baseFaces[f] * 3,
      b = baseFaces[f + 1] * 3,
      c = baseFaces[f + 2] * 3;
    const grid = [];
    for (let i = 0; i <= freq; i++) {
      grid.push([]);
      for (let j = 0; j <= freq - i; j++) {
        const u = i / freq,
          v = j / freq;
        grid[i].push(vertex(base[a] + (base[b] - base[a]) * u + (base[c] - base[a]) * v, base[a + 1] + (base[b + 1] - base[a + 1]) * u + (base[c + 1] - base[a + 1]) * v, base[a + 2] + (base[b + 2] - base[a + 2]) * u + (base[c + 2] - base[a + 2]) * v));
      }
    }
    for (let i = 0; i < freq; i++)
      for (let j = 0; j < freq - i; j++) {
        faces.push(grid[i][j], grid[i + 1][j], grid[i][j + 1]);
        if (j < freq - i - 1) faces.push(grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      }
  }
  return { dirs, faces };
}

// ---------------------------------------------------------------------------------------
// The families. planes: how many cut the stone; k: how softly they meet (small, a sharp
// edge); cut: how far in they cut; base/lid: a flat bed and a flat top; shear: a face cut off
// at a slant; warp: the slow weathering of its faces.
export const FAMILIES = {
  // Broken along its joints: flat faces, sharp edges, lying on a flat bed.
  block: { planes: [9, 12], k: [0.035, 0.06], cut: [0.74, 0.98], base: [0.62, 0.78], warp: 0.05 },
  // Split along its bedding: a broad top and bottom.
  slab: { planes: [6, 9], k: [0.03, 0.05], cut: [0.6, 0.98], base: [0.42, 0.55], lid: [0.42, 0.55], tilt: 0.2, warp: 0.05 },
  // A face sheared off at a slant.
  wedge: { planes: [6, 8], k: [0.03, 0.05], cut: [0.74, 0.98], base: [0.62, 0.78], shear: [0.3, 0.55], warp: 0.05 },
  // Worn round by the water.
  boulder: { planes: [10, 13], k: [0.14, 0.24], cut: [0.74, 0.98], warp: 0.06 },
  cobble: { planes: [8, 10], k: [0.22, 0.34], cut: [0.74, 0.98], warp: 0.04 },
  // A lump of earth, soft all over.
  lump: { planes: [10, 13], k: [0.3, 0.4], cut: [0.74, 0.98], warp: 0.08 },
};

// A stone's shape as plain arrays, in the unit box.
//   freq: the sphere it starts from, as a geodesic frequency (12 for a big stone, 5 for a
//   small one, 3 for a cobble).
// Returns positions, normals, the cavity (1 open, less in a hollow), the faces, the height of
// its top over a 12 x 12 grid across x and z (NaN off the stone), and each vertex's neighbours.
export function rockShape(seed, { family = "block", freq = 8 } = {}) {
  const F = FAMILIES[family];
  const rnd = randomGenerator(Math.round(seed * 7919) + 1013);
  const R = (a, b) => a + (b - a) * rnd();
  const pick = ([a, b]) => R(a, b);
  const count = Math.round(pick(F.planes));
  const planes = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963 + seed * 3.1 + R(-0.4, 0.4);
    const y = Math.max(-1, Math.min(1, 1 - (2 * (i + 0.5)) / count + R(-0.15, 0.15)));
    const r = Math.sqrt(1 - y * y);
    planes.push([Math.cos(a) * r, y, Math.sin(a) * r, pick(F.cut)]);
  }
  // (A slab's top and bed are never quite parallel, nor quite level.)
  const tilted = (y) => {
    const t = F.tilt ?? 0;
    const x = R(-t, t),
      z = R(-t, t);
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  if (F.base) planes.push([...tilted(-1), pick(F.base)]);
  if (F.lid) planes.push([...tilted(1), pick(F.lid)]);
  if (F.shear) {
    const t = R(0, TAU),
      tilt = R(0.6, 1.05);
    planes.push([Math.cos(t) * Math.sin(tilt), Math.cos(tilt), Math.sin(t) * Math.sin(tilt), pick(F.shear)]);
  }
  let k = pick(F.k);
  const warp = F.warp;
  const s1 = seed * 17.3,
    s2 = seed * 5.1;
  const dots = new Float64Array(planes.length);
  const field = (x, y, z) => {
    let m = -Infinity;
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      const d = x * p[0] + y * p[1] + z * p[2] - p[3];
      dots[i] = d;
      if (d > m) m = d;
    }
    // (Planes far below the nearest add nothing to the smooth maximum: skipped.)
    let sum = 0;
    const cut = m - 7 * k;
    for (let i = 0; i < planes.length; i++) if (dots[i] > cut) sum += Math.exp((dots[i] - m) / k);
    const w1 = rockNoise(x * 1.7 + s1, y * 1.7, z * 1.7) - 0.5;
    const w2 = rockNoise(x * 4.6 + s2, y * 4.6 + 3, z * 4.6) - 0.5;
    return m + k * Math.log(sum) + w1 * warp * 2 + w2 * 0.022;
  };
  // (The smooth maximum grows where many planes are near alike, most of all at the middle:
  // softened too far, it would swallow the stone. Kept soft enough that the middle is well
  // inside.)
  for (let g = 0; g < 12 && field(0, 0, 0) > -0.2; g++) k *= 0.8;
  // Along a direction, the distance at which the field crosses zero: bracketed round the
  // sharp polytope's own distance, then closed in on (false position, Illinois).
  const project = (ux, uy, uz) => {
    let r0 = 2;
    for (const p of planes) {
      const c = ux * p[0] + uy * p[1] + uz * p[2];
      if (c > 1e-3) r0 = Math.min(r0, p[3] / c);
    }
    const reach = 0.3;
    let a = Math.max(0.12, r0 - reach),
      b = Math.min(2.4, r0 + reach);
    let fa = field(ux * a, uy * a, uz * a),
      fb = field(ux * b, uy * b, uz * b);
    for (let g = 0; fa > 0 && g < 8; g++) {
      b = a;
      fb = fa;
      a = Math.max(0.05, a - reach);
      fa = field(ux * a, uy * a, uz * a);
    }
    for (let g = 0; fb < 0 && g < 8; g++) {
      a = b;
      fa = fb;
      b += reach;
      fb = field(ux * b, uy * b, uz * b);
    }
    let side = 0,
      r = a;
    for (let it = 0; it < 8 && fb !== fa; it++) {
      r = (a * fb - b * fa) / (fb - fa);
      const fr = field(ux * r, uy * r, uz * r);
      if (Math.abs(fr) < 2e-4) break;
      if (fr * fb > 0) {
        b = r;
        fb = fr;
        if (side === -1) fa *= 0.5;
        side = -1;
      } else {
        a = r;
        fa = fr;
        if (side === 1) fb *= 0.5;
        side = 1;
      }
    }
    return r;
  };
  const { dirs, faces } = geodesic(freq);
  const n = dirs.length / 3;
  const raw = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = project(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    raw[i * 3] = dirs[i * 3] * r;
    raw[i * 3 + 1] = dirs[i * 3 + 1] * r;
    raw[i * 3 + 2] = dirs[i * 3 + 2] * r;
  }
  // The cavity, from the field itself: how far the ground rises round a point, a little way
  // out along its normal, at three reaches.
  const rawNormals = vertexNormals(raw, faces);
  const cavity = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = raw[i * 3],
      y = raw[i * 3 + 1],
      z = raw[i * 3 + 2];
    let occ = 0;
    for (const [h, w] of [
      [0.03, 1],
      [0.08, 0.6],
      [0.18, 0.3],
    ]) {
      const f = field(x + rawNormals[i * 3] * h, y + rawNormals[i * 3 + 1] * h, z + rawNormals[i * 3 + 2] * h);
      occ += (Math.max(0, h - f) / h) * w;
    }
    cavity[i] = Math.max(0.35, 1 - occ * 0.45);
  }
  // Fitted into the unit box.
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], raw[i * 3 + a]);
      hi[a] = Math.max(hi[a], raw[i * 3 + a]);
    }
  const position = new Float32Array(n * 3);
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) position[i * 3 + a] = ((raw[i * 3 + a] - lo[a]) / (hi[a] - lo[a])) * 2 - 1;
  // The normals from the field's own slope, not from the triangles round a vertex: flat on
  // a face, turning only where the faces meet, so a block's edges stay edges. (Then through
  // the fitting: a stretch along an axis tilts a normal the other way.)
  const normal = new Float32Array(n * 3);
  const e = 0.002;
  for (let i = 0; i < n; i++) {
    const x = raw[i * 3],
      y = raw[i * 3 + 1],
      z = raw[i * 3 + 2];
    let gx = (field(x + e, y, z) - field(x - e, y, z)) * (hi[0] - lo[0]),
      gy = (field(x, y + e, z) - field(x, y - e, z)) * (hi[1] - lo[1]),
      gz = (field(x, y, z + e) - field(x, y, z - e)) * (hi[2] - lo[2]);
    const l = Math.hypot(gx, gy, gz);
    if (!(l > 1e-9)) {
      gx = rawNormals[i * 3];
      gy = rawNormals[i * 3 + 1];
      gz = rawNormals[i * 3 + 2];
    }
    const m = Math.hypot(gx, gy, gz) || 1;
    normal[i * 3] = gx / m;
    normal[i * 3 + 1] = gy / m;
    normal[i * 3 + 2] = gz / m;
  }
  // Its top over the ground plan, for what grows on it.
  const top = new Float32Array(TOP * TOP).fill(NaN);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(TOP - 1, Math.floor(((position[i * 3] + 1) / 2) * TOP)),
      cz = Math.min(TOP - 1, Math.floor(((position[i * 3 + 2] + 1) / 2) * TOP));
    const y = position[i * 3 + 1];
    const c = cz * TOP + cx;
    if (!(top[c] >= y)) top[c] = y;
  }
  // Each vertex's neighbours (for the moss to drape over an edge).
  const degree = new Uint32Array(n + 1);
  const pairs = new Set();
  for (let f = 0; f < faces.length; f += 3)
    for (let e = 0; e < 3; e++) {
      const a = faces[f + e],
        b = faces[f + ((e + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      if (pairs.has(key)) continue;
      pairs.add(key);
      degree[a + 1]++;
      degree[b + 1]++;
    }
  for (let i = 0; i < n; i++) degree[i + 1] += degree[i];
  const neighbours = new Uint32Array(degree[n]);
  const fill = degree.slice(0, n);
  for (const key of pairs) {
    const a = Math.floor(key / n),
      b = key % n;
    neighbours[fill[a]++] = b;
    neighbours[fill[b]++] = a;
  }
  return { family, position, normal, cavity, index: n < 65536 ? Uint16Array.from(faces) : Uint32Array.from(faces), top, start: degree, neighbours };
}
const TOP = 12;

function vertexNormals(pos, faces) {
  const out = new Float64Array(pos.length);
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i] * 3,
      b = faces[i + 1] * 3,
      c = faces[i + 2] * 3;
    const ux = pos[b] - pos[a],
      uy = pos[b + 1] - pos[a + 1],
      uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a],
      vy = pos[c + 1] - pos[a + 1],
      vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v] += x;
      out[v + 1] += y;
      out[v + 2] += z;
    }
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l;
    out[i + 1] /= l;
    out[i + 2] /= l;
  }
  return out;
}

// The height of a shape's top at a point of its ground plan (x, z in -1..1), from the
// nearest part of the plan the stone covers; null if it covers none near.
export function topAt(shape, x, z) {
  const cx = Math.min(TOP - 1, Math.max(0, Math.floor(((x + 1) / 2) * TOP))),
    cz = Math.min(TOP - 1, Math.max(0, Math.floor(((z + 1) / 2) * TOP)));
  let best = null,
    bestD = Infinity;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const i = cx + dx,
        j = cz + dz;
      if (i < 0 || j < 0 || i >= TOP || j >= TOP) continue;
      const y = shape.top[j * TOP + i];
      if (Number.isNaN(y)) continue;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = { y, x: ((i + 0.5) / TOP) * 2 - 1, z: ((j + 0.5) / TOP) * 2 - 1 };
      }
    }
  return best;
}

// ---------------------------------------------------------------------------------------
// The catalog: one set of shapes for the whole river, made once.
//   large  8 (two blocks, two slabs, a wedge, three boulders): 2880 triangles each
//   small  8 (two of each): 500
//   cobble 4
//   lump   3 (earth)
let catalog = null;
export function rockSet() {
  if (catalog) return catalog;
  const make = (family, seed, freq) => Object.assign(rockShape(seed, { family, freq }), { family });
  const large = [make("block", 1.3, 12), make("block", 2.9, 12), make("slab", 4.1, 12), make("slab", 5.7, 12), make("wedge", 6.2, 12), make("boulder", 7.7, 12), make("boulder", 8.3, 12), make("boulder", 9.9, 12)];
  const small = [];
  for (const [i, family] of ["block", "slab", "wedge", "boulder"].entries()) small.push(make(family, 11.1 + i * 2.3, 5), make(family, 12.4 + i * 2.3, 5));
  const cobble = [make("cobble", 21.5, 3), make("cobble", 22.8, 3), make("cobble", 24.2, 3), make("cobble", 25.9, 3)];
  const lump = [make("lump", 31.3, 6), make("lump", 32.7, 6), make("lump", 34.1, 6)];
  catalog = { large, small, cobble, lump };
  return catalog;
}

// Which stone, from one draw u: the families weighted by the place and by the stone's drawn
// proportions, then a variant within the family.
//   weights: { block, slab, wedge, boulder }
export function chooseRock(list, u, weights) {
  const families = [...new Set(list.map((s) => s.family))];
  let total = 0;
  for (const f of families) total += Math.max(0, weights[f] ?? 0);
  if (total <= 0) return list[Math.min(list.length - 1, Math.floor(u * list.length))];
  let lo = 0;
  for (const f of families) {
    const w = Math.max(0, weights[f] ?? 0) / total;
    if (u < lo + w || f === families[families.length - 1]) {
      const members = list.filter((s) => s.family === f);
      const within = Math.min(0.999999, Math.max(0, (u - lo) / Math.max(w, 1e-9)));
      return members[Math.floor(within * members.length)];
    }
    lo += w;
  }
  return list[0];
}

// The families' weights at a place.
//   region: the section's region shares; rocky: the ground's share of rock; angular: the
//   bed's broken stone (rapids, riffles, the brook); flat: the stone's height for its width.
export function rockWeights(region, { rocky = 0, angular = 0, flat = 0.7 } = {}) {
  const upland = region.brook + region.upper,
    lowland = region.middle + region.lower + region.estuary,
    sea = region.sea;
  const w = {
    block: upland * 0.35 + lowland * 0.2 + sea * 0.3,
    slab: upland * 0.25 + lowland * 0.15 + sea * 0.2,
    wedge: upland * 0.15 + lowland * 0.05,
    boulder: upland * 0.25 + lowland * 0.6 + sea * 0.5,
  };
  w.block += rocky * 0.15 + angular * 0.1;
  w.slab += rocky * 0.1;
  w.wedge += angular * 0.12;
  w.boulder = Math.max(0.05, w.boulder - rocky * 0.15 - angular * 0.15);
  // Flat stones split along their bedding; tall ones are blocks or worn round.
  w.slab *= flat < 0.55 ? 2.2 : flat > 0.75 ? 0.35 : 1;
  w.wedge *= flat > 0.75 ? 1.3 : 1;
  return w;
}

// A shape as a geometry of its own (for instancing, or a single stone).
export function rockGeometry(shape) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(shape.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(shape.normal, 3));
  g.setIndex(new THREE.BufferAttribute(shape.index, 1));
  return g;
}

// ---------------------------------------------------------------------------------------
// Stones merged into one geometry, in typed arrays grown as needed. Each vertex carries
//   color.r   the stone's brightness times its cavity
//   color.g   its moss: how much the place grows, times where on the stone it would grow
//             (the tops and the sides turned to the light, not the undersides; draped over
//             the edges, thinner on the ridges)
//   rockData  x: its height over the stone's seat, y: its height over the water
export class RockBatch {
  constructor() {
    this.count = 0;
    this.indexCount = 0;
    this.position = new Float32Array(3 * 4096);
    this.normal = new Float32Array(3 * 4096);
    this.color = new Float32Array(3 * 4096);
    this.data = new Float32Array(2 * 4096);
    this.index = new Uint32Array(3 * 8192);
  }
  grow(vertices, indices) {
    const need = this.count + vertices;
    if (need * 3 > this.position.length) {
      const size = Math.ceil(need * 1.5);
      for (const [name, n] of [
        ["position", 3],
        ["normal", 3],
        ["color", 3],
        ["data", 2],
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
  // shape: from rockSet(); matrix: its place, turn and radii; bright: its shade; moss: how much
  // grows on it; seat: the height it stands in the ground at; water: the water's height there.
  add(shape, matrix, { bright = 1, moss = 0, seat = 0, water = Infinity } = {}) {
    const n = shape.position.length / 3;
    this.grow(n, shape.index.length);
    const e = matrix.elements;
    // (The normal matrix: the inverse transpose of the upper 3 x 3.)
    const nm = new THREE.Matrix3().getNormalMatrix(matrix).elements;
    const base = this.count;
    const P = this.position,
      N = this.normal,
      C = this.color,
      D = this.data;
    const up = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = shape.position[i * 3],
        y = shape.position[i * 3 + 1],
        z = shape.position[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12],
        wy = e[1] * x + e[5] * y + e[9] * z + e[13],
        wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = shape.normal[i * 3],
        b = shape.normal[i * 3 + 1],
        c = shape.normal[i * 3 + 2];
      let nx = nm[0] * a + nm[3] * b + nm[6] * c,
        ny = nm[1] * a + nm[4] * b + nm[7] * c,
        nz = nm[2] * a + nm[5] * b + nm[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const v = (base + i) * 3;
      P[v] = wx;
      P[v + 1] = wy;
      P[v + 2] = wz;
      N[v] = nx;
      N[v + 1] = ny;
      N[v + 2] = nz;
      // Where moss would take: facing up (in the world, as the stone lies), broken up by a
      // slow noise, less on the sharp ridges than in the shelter of the hollows.
      up[i] = smooth01(0.1, 0.7, ny + (rockNoise(wx * 0.9, wy * 0.9, wz * 0.9) - 0.5) * 0.7) * (0.45 + 0.55 * shape.cavity[i]);
      C[v] = bright * shape.cavity[i];
      C[v + 2] = 0;
      D[(base + i) * 2] = wy - seat;
      D[(base + i) * 2 + 1] = wy - water;
    }
    // Draped: each vertex's moss averaged once with its neighbours'.
    for (let i = 0; i < n; i++) {
      let sum = up[i] * 2,
        w = 2;
      for (let j = shape.start[i]; j < shape.start[i + 1]; j++) {
        sum += up[shape.neighbours[j]];
        w++;
      }
      C[(base + i) * 3 + 1] = moss * (sum / w);
    }
    for (let i = 0; i < shape.index.length; i++) this.index[this.indexCount + i] = base + shape.index[i];
    this.indexCount += shape.index.length;
    this.count += n;
  }
  get empty() {
    return this.count === 0;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.position.slice(0, this.count * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.normal.slice(0, this.count * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.color.slice(0, this.count * 3), 3));
    g.setAttribute("rockData", new THREE.BufferAttribute(this.data.slice(0, this.count * 2), 2));
    const index = this.count < 65536 ? new Uint16Array(this.index.subarray(0, this.indexCount)) : this.index.slice(0, this.indexCount);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }
}
