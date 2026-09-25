// Geometry helpers shared by the river's builders: seeded randomness and value noise, the
// batch that plant geometry is gathered into, and the boulder shape every stone starts from.
import * as THREE from "three";

import { randomGenerator } from "../../shared/random.js";
export { randomGenerator };

export const random = randomGenerator(34191);
export const range = (a, b) => a + (b - a) * random();
export const vec = (x, y, z) => new THREE.Vector3(x, y, z);

function hash(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function noise(x, y, z) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  fz *= fz * (3 - 2 * fz);
  const mix = THREE.MathUtils.lerp;
  return mix(
    mix(
      mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx),
      fy,
    ),
    mix(
      mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx),
      fy,
    ),
    fz,
  );
}

export const smoothstep = (edge0, edge1, x) => {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Foliage vertices carry how they answer the current: `direction` is the way the strand
// can bend (a blade bends across its face, a stem across its axis), `tangent` runs along
// the strand, `distance` is how far along it the vertex sits, and `compliance` is how
// readily the strand yields. `thin` is how much light the tissue lets through.
export class GeometryBatch {
  constructor() {
    this.positions = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
    this.anchors = [];
    this.bend = [];
    this.along = [];
    this.thin = [];
  }
  vertex(p, uv, color, anchor, strand, thin = 0) {
    const i = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z);
    this.uvs.push(...uv);
    this.colors.push(color.r, color.g, color.b);
    this.anchors.push(anchor.x, anchor.y, anchor.z);
    const { direction, tangent, distance, compliance } = strand;
    this.bend.push(direction.x, direction.y, direction.z, compliance);
    this.along.push(tangent.x, tangent.y, tangent.z, distance);
    this.thin.push(thin);
    return i;
  }
  quad(a, b, c, d) {
    this.indices.push(a, c, b, b, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute("anchor", new THREE.Float32BufferAttribute(this.anchors, 3));
    g.setAttribute("bend", new THREE.Float32BufferAttribute(this.bend, 4));
    g.setAttribute("along", new THREE.Float32BufferAttribute(this.along, 4));
    g.setAttribute("thin", new THREE.Float32BufferAttribute(this.thin, 1));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}

// Rounded limestone: a sphere cut back by soft planes, weathered by noise, with shallow
// solution pits and faint bedding. `round` pulls the cut planes out so the stone is
// water-worn rather than angular.
export function rockGeometry(seed, detail = 96, round = 1) {
  const geometry = new THREE.SphereGeometry(1, detail, Math.floor(detail * 0.7));
  const positions = geometry.attributes.position;
  const color = new THREE.Color();
  const colors = [];
  const planes = [];
  const sample = randomGenerator(Math.round(seed * 1000) + 27461);
  const pits = [];
  if (detail > 20)
    for (let i = 0; i < 60; i++) {
      const y = sample() * 2 - 1,
        a = sample() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      const radius = 0.03 + sample() ** 2 * 0.14;
      pits.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        radius,
        depth: radius * (0.15 + sample() * 0.4),
      });
    }
  for (let i = 0; i < 11; i++) {
    const a = i * 2.399963 + seed,
      y = 1 - (2 * (i + 0.5)) / 11,
      r = Math.sqrt(1 - y * y);
    planes.push({
      normal: vec(Math.cos(a) * r, y, Math.sin(a) * r),
      distance: 0.8 + 0.12 * round + noise(i, seed, 4) * 0.28,
    });
  }
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const a = noise(x * 2.1 + seed, y * 2.1, z * 2.1);
    const b = noise(x * 6 + seed, y * 6, z * 6);
    const c = noise(x * 19 + seed, y * 19, z * 19);
    const strata = Math.pow(Math.abs(Math.sin(x * 2.2 + y * 11 + z * 1.7 + a * 4)), 24);
    // Soft minimum over the cut planes, so edges are rounded by the water.
    let inverse = 0;
    for (const plane of planes) {
      const dot = x * plane.normal.x + y * plane.normal.y + z * plane.normal.z;
      if (dot > 0) inverse += Math.pow(dot / plane.distance, 6 + 4 * (1 - round));
    }
    let radius = Math.min(1.3, Math.pow(1 + inverse, -1 / (6 + 4 * (1 - round))) * 1.15);
    radius +=
      (a - 0.5) * 0.12 + (b - 0.5) * 0.04 + (c - 0.5) * 0.012 - strata * 0.012;
    let depression = 0;
    for (const pit of pits) {
      const d =
        Math.sqrt((x - pit.x) ** 2 + ((y - pit.y) * 1.1) ** 2 + (z - pit.z) ** 2) /
        pit.radius;
      if (d < 1) depression += pit.depth * (1 - d * d) ** 0.8;
    }
    radius -= Math.min(0.12, depression);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    color
      .setRGB(1, 0.985, 0.955)
      .multiplyScalar((0.82 + 0.2 * a) * (1 - Math.min(0.4, depression * 2.6)) * (1 - strata * 0.08));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

