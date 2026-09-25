import * as THREE from "three";
import { Fn, If, Loop, abs, cos, dot, exp, float, length, max, mix, positionWorld, select, sin, smoothstep, texture, uniform, uniformArray, varying, vec2, vec3 } from "three/tsl";

// One clock and one water model for everything the water touches: the current that bends
// the plants, and the light the moving surface focuses onto everything beneath it (in the
// node shading language of three.js, so the same code runs on WebGPU and on WebGL 2).

export const waterTime = uniform(0);

// The design flow, for the plants' sway and the caustic net's drift. (In a river it runs
// downstream wherever the fish is; the model keeps one direction and the patterns are
// small enough that it does not show.)
export const FLOW_DIRECTION = new THREE.Vector3(1, 0, 0.1).normalize();
export const CURRENT_SPEED = 0.38;

// The sun, high and a little behind: SUN_DIRECTION points at it in air; LIGHT_DIRECTION is
// the same light after refraction into the water, the direction every shadow, shaft and
// caustic below the surface actually follows.
export const SUN_DIRECTION = new THREE.Vector3(-0.34, 1, -0.52).normalize();
const WATER_IOR = 1.333;
export const LIGHT_DIRECTION = (() => {
  const zenith = Math.acos(SUN_DIRECTION.y);
  const refracted = Math.asin(Math.sin(zenith) / WATER_IOR);
  const flat = new THREE.Vector3(SUN_DIRECTION.x, 0, SUN_DIRECTION.z).normalize();
  return flat.multiplyScalar(Math.sin(refracted)).setY(Math.cos(refracted)).normalize();
})();

// The flow's strength, a multiple of the design flow: pressure waves travelling down the
// run and smaller eddies, so no two strands move in lockstep.
const GUSTS = [
  { amplitude: 0.2, rate: 0.061, kx: 0.045, kz: 0.0 },
  { amplitude: 0.11, rate: 0.17, kx: 0.21, kz: -0.09 },
  { amplitude: 0.05, rate: 0.47, kx: 0.8, kz: 0.45 },
  { amplitude: 0.035, rate: 0.83, kx: 1.3, kz: -0.7 },
];
export const currentStrength = Fn(([p, t]) => {
  let strength = float(1);
  for (const g of GUSTS) strength = strength.add(sin(t.mul(g.rate).sub(p.x.mul(g.kx)).add(p.z.mul(g.kz))).mul(g.amplitude));
  return strength;
});

// ---------------------------------------------------------------------------------------
// Light through the surface.
//
// The sun's shafts, its caustic net on the bed and the shimmer on every leaf are one
// field: the moving surface focuses the light, and wherever something sits beneath it,
// that thing is lit by the part of the surface straight up the light path from it. The
// focusing pattern is rendered each frame into the caustic map (caustics.js) for one tile
// of surface. Rings spreading from a pellet, a bubble or a leaping fish bend the pattern
// locally on the way down.
export const RIPPLE_COUNT = 10;
export const STRIDER_SLOTS = 8;
export const RIPPLE_SPEED = 2.2;
const ripples = Array.from({ length: RIPPLE_COUNT }, () => new THREE.Vector4(0, 0, 0, 0));
const striders = Array.from({ length: STRIDER_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0));
export const river = {
  // The caustic map (a texture, set by caustics.js before anything is drawn).
  causticMap: { value: null },
  // x: tile size in scene units, y: sun (1 in full sun, lower under cloud),
  // z: focal depth of the caustic map, w: overall caustic contrast.
  causticParams: uniform(new THREE.Vector4(7.5, 1, 9, 1)),
  // Rings on the surface: x, z of the centre, age, strength (0 for none).
  ripples: uniformArray(ripples, "vec4"),
  rippleSlots: ripples,
  // The gallery forest over the river: its crowns shade the water in broad moving patches.
  canopyMap: { value: canopyTexture() },
  // x, y: sway of the crowns; z, w: flutter of the leaves, in texture units.
  canopyShift: uniform(new THREE.Vector4()),
  // x: canopy tile in scene units, y: light that gets through the leaves, z: how much of
  // the sky the crowns fill, w: softness of their edges.
  canopyParams: uniform(new THREE.Vector4(26, 0.2, 0.43, 0.05)),
  // Water striders on the film: x, z, heading, size (0 for none).
  striders: uniformArray(striders, "vec4"),
  striderSlots: striders,
  // The surface near the viewer: x, z of a reference point, its height there.
  waterLevel: uniform(new THREE.Vector4(0, 0, 11, 0)),
  // x, y: how much the surface falls per unit of x and z; z: the drop of a step (a fall)
  // in it, 0 for none; w: half the width over which the step is eased.
  waterShape: uniform(new THREE.Vector4(0, 0, 0, 1)),
  // The step's line: a point on it (x, y as world x, z) and the downstream normal (z, w).
  waterStep: uniform(new THREE.Vector4(0, 0, 1, 0)),
  // Where the light comes from under water (refracted): a uniform, so the sun can move.
  lightDirection: uniform(LIGHT_DIRECTION.clone()),
};

// Tileable fractal value noise for the crowns, made once.
function canopyTexture(size = 256) {
  const data = new Uint8Array(size * size);
  const lattice = (n, seed) => {
    const values = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < values.length; i++) {
      s = (s * 16807) % 2147483647;
      values[i] = s / 2147483647;
    }
    return values;
  };
  const octaves = [
    { n: 5, w: 0.5, v: lattice(5, 1234) },
    { n: 11, w: 0.28, v: lattice(11, 777) },
    { n: 23, w: 0.15, v: lattice(23, 4242) },
    { n: 47, w: 0.07, v: lattice(47, 99) },
  ];
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (const { n, w, v } of octaves) {
        const fx = (x / size) * n,
          fy = (y / size) * n;
        const ix = Math.floor(fx),
          iy = Math.floor(fy);
        const tx = fade(fx - ix),
          ty = fade(fy - iy);
        const at = (i, j) => v[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
        const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
        const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
        sum += w * (top * (1 - ty) + bottom * ty);
      }
      data[y * size + x] = Math.round(Math.min(1, Math.max(0, sum)) * 255);
    }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// The crowns sway slowly and their leaves flutter; called once a frame.
export function swayCanopy(t) {
  river.canopyShift.value.set(0.004 * Math.sin(t * 0.23) + 0.002 * Math.sin(t * 0.61 + 1.3), 0.003 * Math.cos(t * 0.19 + 0.4), 0.006 * Math.sin(t * 0.9 + 2.1) + t * 0.0004, 0.005 * Math.cos(t * 1.1));
}

// Broad, slow changes in the light: smooth enough to work out at the vertices.
export const waterLightDrift = Fn(([p, t]) =>
  float(1)
    .add(sin(t.mul(0.145).add(p.x.mul(0.23)).add(p.z.mul(0.12))).mul(0.05))
    .add(sin(t.mul(0.073).sub(p.x.mul(0.16)).add(p.z.mul(0.21)).add(1.7)).mul(0.03)),
);

// The height of the water surface above p: sloping down the river, stepped at a fall.
export const surfaceLevelAt = Fn(([p]) => {
  const level = river.waterLevel,
    shape = river.waterShape,
    step = river.waterStep;
  const y = level.z.add(dot(shape.xy, p.xz.sub(level.xy))).toVar();
  If(shape.z.greaterThan(0), () => {
    y.subAssign(shape.z.mul(smoothstep(shape.w.negate(), shape.w, dot(p.xz.sub(step.xy), step.zw))));
  });
  return y;
});

// Where the light reaching p came through the surface.
export const surfacePoint = Fn(([p]) => {
  const L = river.lightDirection;
  return p.xz.add(L.xz.div(L.y).mul(max(surfaceLevelAt(p).sub(p.y), 0)));
});

// Rings on the surface: each a short wave train spreading from its centre and dying away.
// They bend the light (xy, an offset) and focus it in a travelling ring (z).
export const rippleField = Fn(([q]) => {
  const field = vec3(0).toVar();
  Loop(RIPPLE_COUNT, ({ i }) => {
    const r = river.ripples.element(i);
    If(r.w.greaterThan(0), () => {
      const d = q.sub(r.xy);
      const dist = length(d);
      const x = dist.sub(r.z.mul(RIPPLE_SPEED));
      const tail = select(x.lessThan(0), float(1), exp(x.mul(-4)));
      const envelope = r.w.mul(exp(x.mul(x).mul(-1.6))).mul(tail).div(dist.mul(0.45).add(1));
      field.addAssign(vec3(d.div(max(dist, 1e-3)).mul(envelope.mul(cos(x.mul(9))).mul(0.12)), envelope.mul(sin(x.mul(9)))));
    });
  });
  return field;
});

// A strider's six feet, each pressing a dimple into the film: a small diverging lens, so
// under it on the bed is a round shadow ringed with the light it turned aside.
const FEET = [
  [0.18, 0.08],
  [0.18, -0.08],
  [-0.1, 0.42],
  [-0.1, -0.42],
  [-0.36, 0.26],
  [-0.36, -0.26],
];
export const striderShade = Fn(([q, depth]) => {
  const shade = float(1).toVar();
  const radius = depth.mul(0.005).add(0.055);
  Loop(STRIDER_SLOTS, ({ i }) => {
    const s = river.striders.element(i);
    const d = q.sub(s.xy);
    If(s.w.greaterThan(0).and(dot(d, d).lessThanEqual(s.w.mul(s.w).mul(0.36).add(0.1))), () => {
      const c = cos(s.z),
        sn = sin(s.z);
      const local = vec2(d.x.mul(c).add(d.y.mul(sn)), d.x.negate().mul(sn).add(d.y.mul(c))).div(s.w);
      for (const [fx, fy] of FEET) {
        const r = length(local.sub(vec2(fx, fy))).mul(s.w).div(radius);
        const rim = exp(r.sub(1.08).div(0.1).pow(2).negate()).mul(0.9);
        shade.mulAssign(mix(0.12, 1, smoothstep(0.75, 1, r)).add(rim));
      }
    });
  });
  return shade;
});

// Focusing factor at p: 1 on average, bright along the caustic net, softer where p is far
// from the depth the net comes into focus, and flat under cloud.
export const causticLight = Fn(([p]) => {
  const params = river.causticParams;
  const depth = max(surfaceLevelAt(p).sub(p.y), 0);
  const q = surfacePoint(p);
  const ring = rippleField(q);
  const uv = q.add(ring.xy).div(params.x);
  const blur = abs(depth.sub(params.z)).mul(0.22).add(0.4);
  const net = texture(river.causticMap.value, uv).level(blur).r;
  const formed = smoothstep(0.3, 4.5, depth).mul(params.y).mul(params.w);
  const dimples = striderShade(q, depth);
  return max(0, mix(1, net, formed).mul(ring.z.mul(1.5).mul(formed).add(1))).mul(mix(1, dimples, params.y));
});

// How open the forest canopy is above the surface point q: 1 in a gap, 0 under a crown,
// its edge softer the deeper p is, as a penumbra is.
export const canopyOpen = Fn(([q, depth]) => {
  const params = river.canopyParams,
    shift = river.canopyShift;
  const uv = q.div(params.x);
  const blur = depth.mul(0.1).add(0.6);
  const map = river.canopyMap.value;
  const crowns = texture(map, uv.add(shift.xy)).level(blur).r.mul(0.72).add(texture(map, uv.mul(2.7).add(shift.zw)).level(blur.add(0.8)).r.mul(0.28));
  return smoothstep(params.z.sub(params.w), params.z.add(params.w), crowns).oneMinus();
});

// What reaches p of the sun: through the canopy, focused by the surface, and with its red
// taken out on the way down. Under a crown the light is the leaves' diffuse glow.
export const waterLight = Fn(([p]) => {
  const depth = max(surfaceLevelAt(p).sub(p.y), 0);
  const open = canopyOpen(surfacePoint(p), depth);
  const absorption = exp(vec3(0.03, 0.0085, 0.013).mul(depth.div(river.lightDirection.y)).negate());
  const light = mix(river.canopyParams.y, 1, open).mul(mix(1, causticLight(p), open));
  return absorption.mul(light);
});

// Every direct light a lit node material receives arrives through the water model: the
// caustic net, the canopy's shade and the water's colour. `perLight` may add more with each
// light ({ lightDirection, lightColor, reflectedLight }, the light already through the water);
// `beforeIndirect` and `afterIndirect` see the lighting context ({ radiance, irradiance,
// iblIrradiance, reflectedLight }) around the ambient and mirrored light.
export function waterLit(material, { perLight = null, beforeIndirect = null, afterIndirect = null } = {}) {
  const base = material.setupLightingModel.bind(material);
  material.setupLightingModel = (builder) => {
    const model = base(builder);
    const direct = model.direct.bind(model);
    model.direct = (data, builder) => {
      const through = waterLight(positionWorld).mul(varying(waterLightDrift(positionWorld, waterTime)));
      const lit = { ...data, lightColor: data.lightColor.mul(through) };
      direct(lit, builder);
      if (perLight) perLight(lit, builder);
    };
    if (beforeIndirect || afterIndirect) {
      const indirect = model.indirect.bind(model);
      model.indirect = (builder) => {
        if (beforeIndirect) beforeIndirect(builder.context, builder);
        indirect(builder);
        if (afterIndirect) afterIndirect(builder.context, builder);
      };
    }
    return model;
  };
  return material;
}
