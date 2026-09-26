import * as THREE from "three";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  atan,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraFar,
  cameraNear,
  cameraViewMatrix,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  fract,
  frontFacing,
  fwidth,
  instancedBufferAttribute,
  length,
  max,
  min,
  mix,
  modelNormalMatrix,
  modelViewMatrix,
  modelWorldMatrix,
  normalGeometry,
  normalize,
  normalWorldGeometry,
  perspectiveDepthToViewZ,
  positionLocal,
  positionView,
  positionWorld,
  screenUV,
  pow,
  property,
  reflect,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  vertexColor,
  viewportDepthTexture,
  viewportSharedTexture,
} from "three/tsl";
import { RIPPLE_COUNT, RIPPLE_SPEED, SUN_DIRECTION, river, waterLit, waterTime } from "./render/water.js";
import { surfaceWaves } from "./render/caustics.js";
import { extinction, fogNodes, underwaterInscatter, waterBetween } from "./render/fog.js";
import { mirrorMap, mirrorOn, windowMap, windowOn } from "./render/mirror.js";
import { eddyAt } from "./flowfield.js";

// The materials the river is made of: its bed (gravel, sand, silt and rock, with the film
// of algae and moss that grows on anything the light reaches), the land along it, the
// water's surface seen from below and from above, the white water of a fall, and the sky.
// (Written in three.js's node shading language: the same code for WebGPU and WebGL 2.)

// Two small noises used all over: a hash of a 2D point, and smooth value noise over it.
const hash2 = (p, a = 127.1, b = 311.7, c = 43758.5453) => fract(sin(dot(p, vec2(a, b))).mul(c));
export const valueNoise = (hash) =>
  Fn(([p]) => {
    const i = floor(p),
      f = fract(p);
    const u = f.mul(f).mul(f.mul(-2).add(3));
    return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y);
  });
const skyHash = (p) => hash2(p, 41.3, 289.1, 45758.5453);
const skyNoise = valueNoise(skyHash);
export const noise2 = valueNoise((p) => hash2(p));

// Shared by everything that shows the sky: the dome, the surface's mirror from above and
// the window through it from below.
export const skyUniforms = {
  sunDirection: uniform(SUN_DIRECTION.clone()),
  // Brightness and colour of the sky and the sun, set each frame from the time of day.
  skyLevel: uniform(new THREE.Color(1, 1, 1)),
  sunColor: uniform(new THREE.Color(1, 0.95, 0.86)),
  sun: uniform(1),
  night: uniform(0),
  cloud: uniform(0.3),
  // The northern lights (0..1), and a lightning flash lighting the clouds from within.
  aurora: uniform(0),
  flash: uniform(0),
};

// A northern sky: pale at the horizon, a clear cold blue overhead, and high thin cloud
// drifting over it; the sun; at night deep blue with stars; now and then the northern
// lights.
export const skyColor = Fn(([d, time]) => {
  const { skyLevel, sunColor, sun, night, cloud, aurora, flash, sunDirection } = skyUniforms;
  const h = d.y.clamp(-0.2, 1);
  const sky = mix(vec3(0.86, 0.92, 0.98), vec3(0.3, 0.52, 0.92), pow(max(h, 0), 0.55)).mul(2.4).toVar();
  const q = d.xz.div(max(d.y.add(0.12), 0.05));
  const clouds = skyNoise(q.mul(0.9).add(time.mul(0.004)))
    .mul(0.55)
    .add(skyNoise(q.mul(2.3).sub(time.mul(0.006))).mul(0.3))
    .add(skyNoise(q.mul(5.1)).mul(0.15));
  const cover = smoothstep(cloud.mul(-0.45).add(0.62), cloud.mul(-0.3).add(0.95), clouds).mul(smoothstep(0, 0.18, h));
  sky.assign(mix(sky, vec3(2.3, 2.35, 2.4).mul(clouds.mul(0.25).add(0.75)), cover.mul(0.85)));
  sky.mulAssign(skyLevel);
  const starCell = floor(q.mul(60));
  const star = step(0.9975, skyHash(starCell)).mul(sin(time.mul(2).add(skyHash(starCell.add(3)).mul(30))).mul(0.4).add(0.6));
  sky.addAssign(vec3(0.8, 0.85, 1).mul(star.mul(night).mul(cover.oneMinus()).mul(smoothstep(0.05, 0.3, h)).mul(0.8)));
  const toward = max(dot(d, sunDirection), 0);
  sky.addAssign(sunColor.mul(pow(toward, 1400).mul(70).add(pow(toward, 12).mul(0.9).mul(cover.mul(-0.6).add(1)))).mul(sun));
  // The northern lights: curtains across the northern half of the sky, their lower hem
  // folding and drifting, green at the foot and fading to violet high up, streaked with
  // rays that shimmer.
  If(aurora.greaterThan(0.001), () => {
    const az = atan(d.z, d.x);
    const north = smoothstep(-0.35, 0.45, d.z.negate().div(max(length(d.xz), 1e-3)));
    const hem = sin(az.mul(3).add(time.mul(0.045)))
      .mul(0.07)
      .add(sin(az.mul(7).sub(time.mul(0.07))).mul(0.04))
      .add(skyNoise(vec2(az.mul(6), time.mul(0.05))).mul(0.02))
      .add(0.16);
    const above = h.sub(hem);
    const curtain = smoothstep(-0.015, 0.02, above).mul(exp(max(above, 0).mul(-5.5)));
    const rays = skyNoise(vec2(az.mul(60).add(time.mul(0.12)), time.mul(0.35))).mul(0.55).add(0.45);
    const folds = sin(az.mul(11).add(skyNoise(vec2(az.mul(3), time.mul(0.03))).mul(2)).add(time.mul(0.08))).mul(0.45).add(0.55);
    const hue = mix(vec3(0.15, 1, 0.45), vec3(0.55, 0.25, 0.95), smoothstep(0.04, 0.3, above));
    sky.addAssign(hue.mul(curtain.mul(rays).mul(folds).mul(north).mul(aurora).mul(night).mul(cover.mul(-0.8).add(1)).mul(1.6)));
  });
  // Lightning: the cloud lit from within, for an instant.
  sky.addAssign(vec3(0.75, 0.8, 1).mul(flash.mul(cover.mul(1.4).add(0.6)).mul(smoothstep(-0.05, 0.25, h)).mul(3)));
  // Below the horizon: the far side of the valley lost in the haze (the same colour as the
  // mist over the water, main.js, so the land fades into it).
  return mix(sky, vec3(0.62, 0.72, 0.8).mul(skyLevel), smoothstep(0, -0.08, d.y));
});

export function createSky(scene) {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const direction = varying(normalize(positionLocal));
  material.colorNode = skyColor(normalize(direction), waterTime);
  // On the far plane, whatever the camera's range.
  material.vertexNode = Fn(() => {
    const p = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1));
    return vec4(p.x, p.y, p.w.mul(0.99999), p.w);
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), material);
  mesh.frustumCulled = false;
  // After everything solid, so only the sky one sees is shaded, and before the surface,
  // which from above may look back at it (main.js).
  mesh.renderOrder = 0.5;
  mesh.name = "Sky";
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------------------
// The bed.
//
// Photographed ground (Poly Haven, CC0): rounded river pebbles, rough brook stones, sand,
// forest mud with its litter of leaves and twigs, and rock face -- blended by what the course
// says the bed is made of at each point, with the pebbles standing proud of the sand that
// fills between them. Rock is laid on from all three axes so cliffs and ledges do not smear.
// Over it grows what the light allows: a brown diatom film, green algae, and in the brook
// dark fontinalis moss on the stones. Above the waterline the same ground turns to a dark
// wet band and then the heath and needles of the forest floor.

// The photographed textures, each loaded (and sent to the graphics card) once, however
// many materials use it. A texture is handed out at once and its picture filled in when
// it has arrived, so the river is built while the pictures load; photosLoaded() waits.
const textures = new Map();
const arriving = [];
export const photoTextures = [];
export const photosLoaded = () => Promise.all(arriving);
async function fetchPicture(url, texture) {
  texture.image = await new THREE.ImageLoader().loadAsync(url);
  texture.needsUpdate = true;
}
export const photo = (name, srgb) => load(name, srgb);
function load(name, srgb) {
  if (!textures.has(name)) {
    // A grey pixel until the photograph comes (so shaders can be built before it does).
    const placeholder = document.createElement("canvas");
    placeholder.width = placeholder.height = 1;
    const texture = new THREE.Texture(placeholder);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    textures.set(name, texture);
    photoTextures.push(texture);
    arriving.push(fetchPicture(`./assets/${name}.jpg`, texture));
  }
  return textures.get(name);
}

// A gravel photograph's normal map with the height of its stones in the alpha, taken from the
// height scan that comes with it: one texture for both, as the bed already binds fifteen of
// the sixteen a shader may. Packed once, on arrival; until then the texture is empty (and
// not sent to the graphics card, so it is made at its full size when the data comes).
// Raw bytes, not a canvas: a canvas would premultiply the alpha and spoil the normal where
// the stones are low.
//   levels(h, blurred): the scan's value (0..1) at a texel, and its slow swell there, to
// the height kept (0 the deepest hollow, 1 the top of a stone).
function shape(normalName, heightName, levels, swell = 0) {
  const key = `${normalName}+${heightName}`;
  if (!textures.has(key)) {
    const texture = new THREE.DataTexture(null, 1, 1);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    textures.set(key, texture);
    photoTextures.push(texture);
    arriving.push(packShape(texture, normalName, heightName, levels, swell));
  }
  return textures.get(key);
}
async function packShape(texture, normalName, heightName, levels, swell) {
  const loader = new THREE.ImageLoader();
  const [normal, height] = await Promise.all([loader.loadAsync(`./assets/${normalName}.jpg`), loader.loadAsync(`./assets/${heightName}.jpg`)]);
  const pixels = (image, size) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(image, 0, 0, size, size);
    return g.getImageData(0, 0, size, size).data;
  };
  const size = normal.width;
  const N = pixels(normal, size);
  // The height at the normal map's size, averaged down from the scan's finer grid in full
  // precision (the scans have few grey levels; the average gains some back).
  const scale = Math.max(1, Math.round(height.width / size));
  const H = pixels(height, size * scale);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) sum += H[((y * scale + j) * size * scale + x * scale + i) * 4];
      h[y * size + x] = sum / (scale * scale * 255);
    }
  // Its slow swell, a box blur that wraps round the tile (if asked for).
  const blurred = new Float32Array(size * size);
  if (swell > 0) {
    const line = new Float32Array(size * size);
    const k = 2 * swell + 1;
    for (let y = 0; y < size; y++) {
      let sum = 0;
      for (let i = -swell; i <= swell; i++) sum += h[y * size + ((i + size) % size)];
      for (let x = 0; x < size; x++) {
        line[y * size + x] = sum / k;
        sum += h[y * size + ((x + swell + 1) % size)] - h[y * size + ((x - swell + size) % size)];
      }
    }
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let j = -swell; j <= swell; j++) sum += line[((j + size) % size) * size + x];
      for (let y = 0; y < size; y++) {
        blurred[y * size + x] = sum / k;
        sum += line[((y + swell + 1) % size) * size + x] - line[((y - swell + size) % size) * size + x];
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  // (Rows turned over: a photograph is turned over on its way to the card, raw data is not.)
  for (let y = 0; y < size; y++) {
    const from = (size - 1 - y) * size;
    for (let x = 0; x < size; x++) {
      const a = (from + x) * 4,
        b = (y * size + x) * 4;
      data[b] = N[a];
      data[b + 1] = N[a + 1];
      data[b + 2] = N[a + 2];
      data[b + 3] = Math.round(Math.min(1, Math.max(0, levels(h[from + x], blurred[from + x]))) * 255);
    }
  }
  texture.image = { data, width: size, height: size };
  texture.needsUpdate = true;
}

// A tangent-space normal from a GL normal map, laid flat in the world's x-z plane.
const flatNormal = (map, p) => {
  const n = texture(map, p).xyz.mul(2).sub(1);
  return vec3(n.x, n.z, n.y);
};
// Two samples at different scales and angles, so the repeat of a tile never shows.
const twoScale = (map, p, scale) => {
  const a = p.mul(scale);
  const r = vec2(p.x.mul(0.8).add(p.y.mul(0.6)), p.x.mul(-0.6).add(p.y.mul(0.8)))
    .mul(scale * 0.37)
    .add(0.31);
  return mix(texture(map, a).rgb, texture(map, r).rgb, 0.35);
};
// Photographed rock laid on from all three axes, with its normal map turned to match.
const triplanar = (map, normalMap, P, N, s) => {
  const b = pow(abs(N), vec3(4));
  const w = b.div(dot(b, vec3(1)));
  const color = texture(map, P.zy.mul(s))
    .rgb.mul(w.x)
    .add(texture(map, P.xz.mul(s)).rgb.mul(w.y))
    .add(texture(map, P.xy.mul(s)).rgb.mul(w.z));
  let normal = null;
  if (normalMap) {
    const nx = texture(normalMap, P.zy.mul(s)).xyz.mul(2).sub(1);
    const ny = texture(normalMap, P.xz.mul(s)).xyz.mul(2).sub(1);
    const nz = texture(normalMap, P.xy.mul(s)).xyz.mul(2).sub(1);
    normal = normalize(
      vec3(nx.z.mul(sign(N.x)), nx.y, nx.x)
        .mul(w.x)
        .add(vec3(ny.x, ny.z.mul(sign(N.y)), ny.y).mul(w.y))
        .add(vec3(nz.x, nz.y, nz.z.mul(sign(N.z))).mul(w.z)),
    );
  }
  return { color, normal };
};
// A world-space normal as the view-space normal a node material wants.
export const toViewNormal = (n) => normalize(cameraViewMatrix.mul(vec4(n, 0)).xyz);

// A second look at a gravel photograph, against its repeat: turned (cos 0.8, sin 0.6), a
// little larger and shifted. Where the two looks meet, the taller stone of the two shows,
// so the seam runs round the stones and nothing is printed over anything.
const turned = (q) => vec2(q.x.mul(0.8).add(q.y.mul(0.6)), q.x.mul(-0.6).add(q.y.mul(0.8))).mul(0.89);
const turnedUV = (q) => turned(q).add(vec2(0.37, 0.61));
// A tangent-space normal of look A or B, laid in the flat frame (x, up, z).
const lookA = (n) => vec3(n.x, n.z, n.y);
const lookB = (n) => vec3(n.x.mul(0.8).sub(n.y.mul(0.6)), n.z, n.x.mul(0.6).add(n.y.mul(0.8)));
// How much of a gravel bed a fill (of sand or silt, to a height from 0 to 1) leaves covered,
// on average over the stones of each photograph (fitted to their height scans): what the
// bed shows far off, where its stones are too small to tell apart.
const coveredPebbles = (fill) => smoothstep(-0.14, 0.98, fill);
const coveredStones = (fill) => smoothstep(-0.02, 1.06, fill);

// relief: close by, the gravel in relief (Hoch and Ultra, which have the temporal resolve
// to smooth it): the view is carried through the stones' heights until it meets them.
export async function createBedMaterial({ relief = false } = {}) {
  const pebbleMap = load("ganges_river_pebbles_diff", true),
    stonesMap = load("river_small_rocks_diff", true),
    sandMap = load("damp_sand_diff", true),
    sandNormal = load("damp_sand_nor_gl", false),
    mudMap = load("mud_forest_diff", true),
    mudNormal = load("mud_forest_nor_gl", false),
    rockMap = load("rock_face_03_diff", true),
    rockNormal = load("rock_face_03_nor_gl", false),
    landMap = load("forest_ground_04_diff", true);
  // The two gravels' normals with their heights: the pebbles' scan as it is, remapped; the
  // broken stones' scan is mostly a slow swell with the stones on it, so only the stones
  // are kept (the difference from its blur, stretched to the same spread).
  const pebbleShape = shape("ganges_river_pebbles_nor_gl", "ganges_river_pebbles_disp", (h) => (h - 0.28) / 0.47);
  const stonesShape = shape("river_small_rocks_nor_gl", "river_small_rocks_disp", (h, swell) => ((h - swell + 0.016) / 0.031) * 0.9 + 0.05, 8);
  const tint = uniform(new THREE.Color(1, 1, 1));
  const material = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  // Worked out once, with the colour, and read by the normal, the roughness and the shade.
  const bedNormal = property("vec3", "bedNormal");
  const bedRough = property("float", "bedRough");
  const bedShade = property("float", "bedShade");
  const ground = attribute("ground", "vec4");
  const extra = attribute("bedExtra", "vec3");
  const geometryNormal = varying(modelNormalMatrix.mul(normalGeometry));
  material.colorNode = Fn(() => {
    const P = positionWorld;
    const shore = extra.x,
      mossy = extra.y,
      broken = float(0).toVar();
    broken.assign(extra.z.clamp(0, 1));
    // The ground's own place, and how it changes across the pixel (taken here, outside
    // every branch; the photographs are read with these slopes wherever the relief moves
    // the look, or at a stone's edge they would pick a blurred copy). Assigned, not just
    // declared: a variable only declared is worked out where it is first read, and in a
    // branch or a loop a slope is anybody's guess.
    const q0 = P.xz;
    const dqx = vec2(0).toVar(),
      dqy = vec2(0).toVar();
    dqx.assign(dFdx(q0));
    dqy.assign(dFdy(q0));
    const Nw = normalize(geometryNormal).toVar();
    // Where the drawn surface stands far steeper than its normal says (the skirts that hide
    // the seams between blocks, a cut bank), trust the surface; and a face this steep is
    // rock, whatever the course lays on it: gravel would only be smeared down it.
    const Ng = normalize(cross(dFdx(P), dFdy(P))).toVar();
    If(dot(Ng, cameraPosition.sub(P)).lessThan(0), () => {
      Ng.assign(Ng.negate());
    });
    const w = ground.div(max(dot(ground, vec4(1)), 1e-4)).toVar();
    If(dot(Ng, Nw).lessThan(0.6).and(abs(Ng.y).lessThan(0.6)), () => {
      Nw.assign(Ng);
      w.assign(mix(w, vec4(0, 0, 0, 1), smoothstep(0.6, 0.3, abs(Ng.y))));
    });
    w.assign(mix(w, vec4(0, 0, 0, 1), smoothstep(0.62, 0.42, Nw.y)));
    // The ground's own frame: the photographs' x, up and z laid on its facing.
    const reference = select(abs(Nw.x).lessThan(0.9), vec3(1, 0, 0), vec3(0, 0, 1));
    const tx = normalize(reference.sub(Nw.mul(dot(reference, Nw)))).toVar();
    const tz = normalize(cross(tx, Nw)).toVar();
    const q = q0.toVar();
    // A photograph read at uv (a look of it at tile, A or turned B) with the slopes of the
    // unmoved ground.
    const read = (map, uv, tile, turnedLook = false) => {
      if (!relief) return texture(map, uv);
      const gx = dqx.mul(tile),
        gy = dqy.mul(tile);
      return turnedLook ? texture(map, uv).grad(turned(gx), turned(gy)) : texture(map, uv).grad(gx, gy);
    };
    // How big a pixel is on the ground: far off the stones are too small to tell apart, the
    // heights in the photographs are filtered to their mean, and the bed is drawn from what
    // it holds on average instead.
    // (All of these from the unmoved ground, and worked out here, before the relief moves
    // the look: its slopes jump at every stone's edge.)
    const px = float(0).toVar(),
      far = float(0).toVar();
    px.assign(length(fwidth(q0)));
    far.assign(smoothstep(0.03, 0.25, px));

    // Where the course lays both, gravel and sand in patches: bars of clean stones, sandy
    // flats.
    const patch = noise2(q0.mul(0.06).add(1.7)).mul(0.65).add(noise2(q0.mul(0.17).add(4.1)).mul(0.35)).sub(0.5);
    const shift = patch.mul(0.5).mul(min(1, w.x.mul(w.y).mul(4)));
    w.x.assign(max(w.x.sub(shift), 0));
    w.y.assign(max(w.y.add(shift), 0));

    // Which look of each photograph shows where: a slow noise, sharpened.
    const pick = float(0).toVar();
    pick.assign(smoothstep(0.45, 0.55, noise2(q0.mul(0.045).add(5.3))));

    // The level sand and silt fill to between the stones: the more of them the course
    // lays, the higher, until only the tops of the tallest stones show. Ripples in the sand.
    const ripple = sin(P.x.mul(2.6).add(sin(P.z.mul(0.37)).mul(1.8)).add(sin(P.z.mul(1.1).add(P.x.mul(0.2))).mul(0.6)));
    const sandH = float(0.42).add(ripple.mul(0.04));
    const siltH = float(0.3);
    const fill = max(sandH.add(w.y.sub(w.x)), siltH.add(w.z.sub(w.x))).toVar();

    // Close by, the gravel in relief: the view is stepped down through the ground's height
    // (the stones as the colour below blends them, the fill of sand between) until it meets
    // it, then closed in on the meeting, and everything is read where it met. It enters half
    // the relief above the drawn surface, so the ground's mean stays where it is drawn and
    // what stands on it (plants, boulders, the small stones) still stands on it.
    const reliefFade = float(0).toVar(),
      wall = float(0).toVar();
    if (relief) {
      const eye = P.sub(cameraPosition);
      const dist = length(eye);
      const V = eye.div(max(dist, 1e-4));
      reliefFade.assign(
        smoothstep(13, 5, dist)
          .mul(smoothstep(0.05, 0.35, w.x))
          .mul(smoothstep(0.2, 0.5, dot(V, Nw).negate()))
          .mul(smoothstep(0.8, 0.9, Nw.y))
          .mul(smoothstep(0.97, 0.8, fill))
          .mul(step(shore, 0.25))
          .mul(far.oneMinus()),
      );
      If(reliefFade.greaterThan(0.01), () => {
        // The height of the stones at a point, blended exactly as the colour blends them.
        const lookHeight = (shapeMap, p, tile) => {
          const a = float(0.5).toVar(),
            b = float(0.5).toVar();
          If(pick.lessThan(0.999), () => {
            a.assign(read(shapeMap, p.mul(tile), tile).a);
          });
          If(pick.greaterThan(0.001), () => {
            b.assign(read(shapeMap, turnedUV(p.mul(tile)), tile, true).a);
          });
          const tA = a.add(pick.oneMinus().mul(1.5)),
            tB = b.add(pick.mul(1.5));
          const top = max(tA, tB).sub(0.05);
          return mix(a, b, max(tB.sub(top), 0).div(max(max(tA.sub(top), 0).add(max(tB.sub(top), 0)), 1e-4)));
        };
        const heightAt = (p, out) => {
          out.assign(lookHeight(pebbleShape, p, 1 / 21.6));
          If(broken.greaterThan(0.01), () => {
            const hS = lookHeight(stonesShape, p, 1 / 29);
            const tP = out.add(broken.oneMinus().mul(1.2)),
              tS = hS.add(broken.mul(1.2));
            const top = max(tP, tS).sub(0.05);
            out.assign(mix(out, hS, max(tS.sub(top), 0).div(max(max(tP.sub(top), 0).add(max(tS.sub(top), 0)), 1e-4))));
          });
          out.assign(max(out, fill));
        };
        // (Every point the march reads is a variable given its value where it is read: a
        // shared expression is worked out once, wherever it first comes up, and one that
        // first comes up in a branch not taken would be read as nothing.)
        const down = max(V.y.negate(), 0.35);
        const steps = 8;
        const layer = 1 / steps;
        const total = vec2(0).toVar(),
          start = vec2(0).toVar(),
          stepShift = vec2(0).toVar();
        total.assign(V.xz.div(down).mul(0.18).mul(reliefFade));
        start.assign(q0.sub(total.mul(0.5)));
        stepShift.assign(total.mul(layer));
        const ray = float(1).toVar(),
          off = vec2(0).toVar(),
          at = vec2(0).toVar(),
          here = float(0).toVar(),
          before = float(0).toVar(),
          rayBefore = float(1).toVar(),
          stepped = float(0).toVar();
        Loop(steps + 1, () => {
          at.assign(start.add(off));
          heightAt(at, here);
          If(here.greaterThanEqual(ray), () => {
            Break();
          });
          before.assign(here);
          rayBefore.assign(ray);
          ray.subAssign(layer);
          off.addAssign(stepShift);
          stepped.assign(1);
        });
        // Between the last step above the stones and the first below: halved twice, then
        // the crossing taken on the straight line between the two.
        If(stepped.greaterThan(0), () => {
          const loOff = vec2(0).toVar(),
            loRay = float(0).toVar(),
            loH = float(0).toVar(),
            hiOff = vec2(0).toVar(),
            hiRay = float(0).toVar(),
            hiH = float(0).toVar(),
            midOff = vec2(0).toVar(),
            midRay = float(0).toVar(),
            midH = float(0).toVar();
          loOff.assign(off.sub(stepShift));
          loRay.assign(rayBefore);
          loH.assign(before);
          hiOff.assign(off);
          hiRay.assign(ray);
          hiH.assign(here);
          for (let k = 0; k < 2; k++) {
            midOff.assign(loOff.add(hiOff).mul(0.5));
            midRay.assign(loRay.add(hiRay).mul(0.5));
            at.assign(start.add(midOff));
            heightAt(at, midH);
            If(midH.greaterThanEqual(midRay), () => {
              hiOff.assign(midOff);
              hiRay.assign(midRay);
              hiH.assign(midH);
            }).Else(() => {
              loOff.assign(midOff);
              loRay.assign(midRay);
              loH.assign(midH);
            });
          }
          const a = loRay.sub(loH),
            b = hiH.sub(hiRay);
          off.assign(mix(loOff, hiOff, a.div(max(a.add(b), 1e-4))));
          // (Met on a stone's flank: the ground rose far more than the view fell.)
          wall.assign(smoothstep(1.5, 6, hiH.sub(loH).div(max(loRay.sub(hiRay), 1e-4))));
        });
        q.assign(start.add(off));
      });
    }

    // Gravel: the two looks of each photograph, the taller stone winning where they meet;
    // then pebbles and broken stones side by side the same way.
    const gColor = vec3(0).toVar(),
      gNormal = vec3(0, 1, 0).toVar(),
      gH = float(0.43).toVar(),
      gLength = float(1).toVar();
    const gravelOf = (map, shapeMap, tile) => {
      const uvA = vec2(0).toVar(),
        uvB = vec2(0).toVar();
      uvA.assign(q.mul(tile));
      uvB.assign(turnedUV(q.mul(tile)));
      const a = vec4(0.5, 0.5, 1, 0.5).toVar(),
        b = vec4(0.5, 0.5, 1, 0.5).toVar();
      If(pick.lessThan(0.999), () => {
        a.assign(read(shapeMap, uvA, tile));
      });
      If(pick.greaterThan(0.001), () => {
        b.assign(read(shapeMap, uvB, tile, true));
      });
      const tA = a.w.add(pick.oneMinus().mul(1.5)),
        tB = b.w.add(pick.mul(1.5));
      const edge = mix(0.05, 0.4, far);
      const top = max(tA, tB).sub(edge);
      const toB = max(tB.sub(top), 0).div(max(max(tA.sub(top), 0).add(max(tB.sub(top), 0)), 1e-4));
      const color = vec3(0).toVar();
      If(toB.lessThan(0.999), () => {
        color.addAssign(read(map, uvA, tile).rgb.mul(toB.oneMinus()));
      });
      If(toB.greaterThan(0.001), () => {
        color.addAssign(read(map, uvB, tile, true).rgb.mul(toB));
      });
      // (The normals' length before they are made unit again: short where the finer mips
      // average stones of every slant, which is roughness the lighting must know about.)
      const nA = a.xyz.mul(2).sub(1),
        nB = b.xyz.mul(2).sub(1);
      const normal = lookA(nA).mul(toB.oneMinus()).add(lookB(nB).mul(toB));
      return { color, normal, height: mix(a.w, b.w, toB), length: mix(length(nA), length(nB), toB) };
    };
    If(w.x.greaterThan(0.01), () => {
      const pebbles = gravelOf(pebbleMap, pebbleShape, 1 / 21.6);
      gColor.assign(pebbles.color);
      gNormal.assign(pebbles.normal);
      gH.assign(pebbles.height);
      gLength.assign(pebbles.length);
      If(broken.greaterThan(0.01), () => {
        const stones = gravelOf(stonesMap, stonesShape, 1 / 29);
        const tP = gH.add(broken.oneMinus().mul(1.2)),
          tS = stones.height.add(broken.mul(1.2));
        const edge = mix(0.05, 0.4, far);
        const top = max(tP, tS).sub(edge);
        const toS = max(tS.sub(top), 0).div(max(max(tP.sub(top), 0).add(max(tS.sub(top), 0)), 1e-4));
        gColor.assign(mix(gColor, stones.color.mul(vec3(0.95, 0.97, 1)), toS));
        gNormal.assign(mix(gNormal, stones.normal, toS));
        gH.assign(mix(gH, stones.height, toS));
        gLength.assign(mix(gLength, stones.length, toS));
      });
      // The pebbles were photographed in a warmer river: white, pink and violet quartzite.
      // These are northern stones: granite, gneiss and schist, the pinks gone brown, and no
      // stone as pale as the palest of those (their brightness eased off at the top).
      const grey = dot(gColor, vec3(0.3, 0.55, 0.15));
      gColor.assign(mix(vec3(grey), gColor, 0.7).mul(vec3(1, 0.95, 0.84)));
      gColor.assign(gColor.div(gColor.mul(0.8).add(1)).mul(1.2));
    });

    // On a bank the photograph laid from above is drawn out down the slope: there the
    // pebbles are laid on from the side the bank faces as well, and the taller stone of the
    // two shows. (Steeper than this it is rock; above the water, the forest floor.)
    const side = smoothstep(0.8, 0.64, Nw.y).mul(smoothstep(0.62, 0.42, Nw.y).oneMinus()).mul(step(shore, 0.25));
    If(side.greaterThan(0.01).and(w.x.greaterThan(0.01)), () => {
      const alongX = abs(Nw.x).greaterThan(abs(Nw.z));
      const uv = select(alongX, vec2(P.z, P.y), vec2(P.x, P.y)).div(21.6).add(vec2(0.13, 0.71));
      const s = texture(pebbleShape, uv);
      const n = s.xyz.mul(2).sub(1);
      const world = select(alongX, vec3(n.z.mul(sign(Nw.x)), n.y, n.x), vec3(n.x, n.y, n.z.mul(sign(Nw.z))));
      const tTop = gH.add(side.oneMinus().mul(1.2)),
        tSide = s.w.add(side.mul(1.2));
      const top = max(tTop, tSide).sub(mix(0.05, 0.4, far));
      const toSide = max(tSide.sub(top), 0).div(max(max(tTop.sub(top), 0).add(max(tSide.sub(top), 0)), 1e-4));
      const sideColor = texture(pebbleMap, uv).rgb;
      const sideGrey = dot(sideColor, vec3(0.3, 0.55, 0.15));
      const graded = mix(vec3(sideGrey), sideColor, 0.7).mul(vec3(1, 0.95, 0.84));
      gColor.assign(mix(gColor, graded.div(graded.mul(0.8).add(1)).mul(1.2), toSide));
      gNormal.assign(mix(gNormal, vec3(dot(world, tx), dot(world, Nw), dot(world, tz)), toSide));
      gH.assign(mix(gH, s.w, toSide));
    });

    // The rock's height from its own shading (it has no scan of its relief).
    const rockColor = vec3(0).toVar(),
      rockWorld = Nw.toVar(),
      rockH = float(0.5).toVar();
    If(w.w.greaterThan(0.01), () => {
      const rock = triplanar(rockMap, rockNormal, P, Nw, 1 / 27);
      const lum = dot(rock.color, vec3(0.3, 0.55, 0.15));
      // A cooler, greyer rock than the photograph: northern granite and gneiss.
      rockColor.assign(mix(vec3(lum), rock.color, 0.45).mul(vec3(0.92, 0.95, 1)));
      rockWorld.assign(rock.normal);
      rockH.assign(lum.sub(0.25).mul(1.6).add(0.45).clamp(0, 1));
    });

    // The grounds by height: each lifted by its share, the tallest showing, the edges soft.
    const edge = mix(0.06, 0.4, far);
    const tG = select(w.x.greaterThan(0.005), gH.add(w.x), float(-1));
    const tS = select(w.y.greaterThan(0.005), sandH.add(w.y), float(-1));
    const tM = select(w.z.greaterThan(0.005), siltH.add(w.z), float(-1));
    const tR = select(w.w.greaterThan(0.005), rockH.add(w.w), float(-1));
    const top = max(max(tG, tS), max(tM, tR)).sub(edge);
    const b = vec4(max(tG.sub(top), 0), max(tS.sub(top), 0), max(tM.sub(top), 0), max(tR.sub(top), 0));
    const near = b.div(max(dot(b, vec4(1)), 1e-4));
    // ...and far off, what the fill leaves covered on average.
    const covered = select(w.x.greaterThan(0.005), mix(coveredPebbles(fill), coveredStones(fill), broken), float(1));
    const sandy = smoothstep(-0.05, 0.05, tS.sub(tM));
    const rocky = near.w;
    const average = vec4(covered.oneMinus(), covered.mul(sandy), covered.mul(sandy.oneMinus()), 0).mul(rocky.oneMinus()).add(vec4(0, 0, 0, rocky));
    const wb = mix(near, average, far).toVar();
    // What the eye sees as the ground's height here: stone tops, or the fill between them.
    const surface = mix(mix(max(gH, fill), fill, wb.y.add(wb.z)), max(fill, 0.46), far).toVar();

    const color = gColor.mul(wb.x).toVar();
    const tangentNormal = gNormal.mul(wb.x).toVar();
    // Gravel: polished, wet tops, gritty hollows -- and rougher where the filtered normals
    // are short, the stones' slants averaged in one pixel (Toksvig), so nothing far off
    // sparkles.
    const polish = mix(0.86, 0.5, smoothstep(0.35, 0.85, gH));
    const spread = gLength.clamp(0.2, 1);
    const rough = sqrt(polish.mul(polish).add(spread.oneMinus().div(spread).mul(0.5)).clamp(0, 1)).mul(wb.x).toVar();
    If(wb.y.greaterThan(0.01), () => {
      // Sand, with the same two looks against its repeat.
      const tile = 1 / 20.4;
      const uvA = vec2(0).toVar(),
        uvB = vec2(0).toVar();
      uvA.assign(q.mul(tile));
      uvB.assign(turnedUV(q.mul(tile)));
      const sand = vec3(0).toVar(),
        sn = vec3(0).toVar();
      If(pick.lessThan(0.999), () => {
        sand.addAssign(read(sandMap, uvA, tile).rgb.mul(pick.oneMinus()));
        sn.addAssign(lookA(read(sandNormal, uvA, tile).xyz.mul(2).sub(1)).mul(pick.oneMinus()));
      });
      If(pick.greaterThan(0.001), () => {
        sand.addAssign(read(sandMap, uvB, tile, true).rgb.mul(pick));
        sn.addAssign(lookB(read(sandNormal, uvB, tile, true).xyz.mul(2).sub(1)).mul(pick));
      });
      sn.x.addAssign(cos(P.x.mul(2.6).add(sin(P.z.mul(0.37)).mul(1.8))).mul(0.12));
      color.addAssign(sand.mul(vec3(0.78, 0.8, 0.82)).mul(wb.y).mul(smoothstep(0.3, 1, ripple.negate()).mul(-0.06).add(1)));
      tangentNormal.addAssign(normalize(sn).mul(wb.y));
      rough.addAssign(wb.y.mul(0.88));
    });
    If(wb.z.greaterThan(0.01), () => {
      // Silt. (A forest floor photographed dry: under water its seedlings are grey silt.)
      const mud = twoScale(mudMap, q, 1 / 23.5);
      color.addAssign(mix(vec3(dot(mud, vec3(0.3, 0.55, 0.15))), mud, 0.5).mul(0.85).mul(wb.z));
      tangentNormal.addAssign(flatNormal(mudNormal, q.div(23.5)).mul(wb.z));
      rough.addAssign(wb.z.mul(0.95));
    });
    color.addAssign(rockColor.mul(wb.w));
    rough.addAssign(wb.w.mul(0.78));

    // Close up, the grit of the sand and the silt: the sand at a scale twenty times finer,
    // so nothing a small fish looks at is ever a smear.
    const closeUp = smoothstep(0.004, 0.03, px).oneMinus();
    If(closeUp.greaterThan(0).and(shore.lessThan(0.2)), () => {
      const grit = dot(read(sandMap, q.mul(0.9).add(0.5), 0.9).rgb, vec3(0.3, 0.5, 0.2));
      color.mulAssign(mix(1, grit.mul(1.4).add(0.45), closeUp.mul(wb.y.mul(0.5).add(wb.z.mul(0.3)))));
    });
    color.mulAssign(tint);

    // Growth: a brown film of diatoms on everything the light reaches, thickest on what
    // stands up into it; green algae in patches on the tops; in the brook dark moss on the
    // biggest, steadiest stones. The hollows, where the sand keeps moving, stay clean.
    const light = smoothstep(-0.2, 0.9, Nw.y);
    const tops = smoothstep(mix(0.35, 0.1, far), mix(0.85, 1, far), surface);
    const onTop = tops.mul(wb.x.add(wb.w)).add(wb.y.mul(0.25)).add(wb.z.mul(0.4));
    const patchNoise = noise2(q.mul(0.35))
      .mul(0.6)
      .add(noise2(q.mul(1.7).add(3)).mul(0.4));
    const film = onTop.mul(0.6).add(0.4).mul(light).mul(patchNoise.mul(0.6).add(0.4));
    color.assign(mix(color, color.mul(vec3(0.8, 0.74, 0.5)), film.mul(0.5)));
    const algaePatch = smoothstep(0.5, 0.8, noise2(q.mul(0.8).add(7)).mul(0.7).add(patchNoise.mul(0.3)));
    const algae = mossy.mul(0.75).add(0.25).mul(light).mul(algaePatch).mul(onTop);
    color.assign(mix(color, color.mul(vec3(0.55, 0.85, 0.35)).add(vec3(0.015, 0.035, 0)), algae.mul(0.55)));
    const moss = mossy
      .mul(smoothstep(0.5, 0.75, patchNoise.add(Nw.y.mul(0.2))))
      .mul(wb.x.mul(0.8).add(wb.w))
      .mul(smoothstep(mix(0.6, 0.4, far), mix(0.85, 0.9, far), surface));
    const mossColor = mix(vec3(0.035, 0.07, 0.02), vec3(0.1, 0.15, 0.04), noise2(q.mul(9)));
    color.assign(mix(color, mossColor, moss.mul(0.8)));
    rough.assign(mix(rough, 0.95, max(moss, algae.mul(0.6))));

    // The hollows between the stones: less light gets down into them.
    const hollow = smoothstep(mix(0.62, 0.8, far), mix(0.1, -0.2, far), surface).mul(wb.x.add(wb.w.mul(0.5)));
    // (And in relief, a stone's steep flanks, which the view slides down when low: shaded.)
    const flank = max(smoothstep(0.8, 0.35, normalize(gNormal).y), wall).mul(wb.x).mul(reliefFade);
    color.mulAssign(hollow.mul(-0.28).add(1).mul(flank.mul(-0.45).add(1)));
    bedShade.assign(hollow.mul(-0.5).add(1).mul(flank.mul(-0.35).add(1)));

    // Above the water: a dark wet band, then the forest floor, rock where it is steep.
    If(shore.greaterThan(-0.05), () => {
      const wet = smoothstep(0, 0.9, shore).oneMinus();
      const steep = smoothstep(0.55, 0.8, Nw.y).oneMinus();
      const floorColor = twoScale(landMap, q, 1 / 31.5).toVar();
      const green = noise2(q.mul(0.07)).mul(0.6).add(noise2(q.mul(0.3)).mul(0.4));
      floorColor.assign(mix(floorColor, floorColor.mul(vec3(0.55, 0.85, 0.35)), smoothstep(0.35, 0.75, green).mul(0.8)));
      const cliff = triplanar(rockMap, null, P, Nw, 1 / 27).color;
      const cliffGrey = mix(vec3(dot(cliff, vec3(0.3, 0.55, 0.15))), cliff, 0.4);
      const dry = mix(floorColor, cliffGrey, steep);
      const land = mix(dry, color.mul(0.55), wet);
      color.assign(mix(color, land, smoothstep(-0.05, 0.25, shore)));
    });
    // The flat maps tilt the ground's own normal about their frame; rock brings its world
    // normal from the three projections.
    const tn = normalize(tangentNormal.add(vec3(0, 1e-3, 0)));
    const flatWorld = normalize(tx.mul(tn.x).add(Nw.mul(tn.y)).add(tz.mul(tn.z)));
    bedNormal.assign(normalize(mix(flatWorld, rockWorld, wb.w)));
    bedRough.assign(rough.clamp(0.4, 1));
    return vec4(color, 1);
  })();
  material.normalNode = toViewNormal(bedNormal);
  material.roughnessNode = bedRough;
  // (Only the light from all round: the sun and the caustics see the darkened colour.)
  material.aoNode = bedShade;
  waterLit(material);
  material.userData.tint = tint;
  return material;
}

// ---------------------------------------------------------------------------------------
// The water surface. From below: Snell's window and the mirror round it, with white water
// where the river breaks over rock. From above: the sky mirrored at a grazing angle, the
// dark body of the water looked into, and the sun's glint.
export const surfaceUniforms = {
  ...skyUniforms,
  waterTime,
  roughness: uniform(1),
  rain: uniform(0),
  body: uniform(new THREE.Color(0.02, 0.06, 0.06)),
  // Winter: how much of the river here is frozen over (the riffles stay open longest).
  ice: uniform(0),
  // The water's own colour and density, for looking into it from the air.
  waterColor: uniform(new THREE.Color(0.05, 0.14, 0.14)),
  waterDensity: uniform(0.02),
  // (Kept for main.js, which sets them each frame: the water's own fog now comes from the
  // scene's fog directly.)
  fogColor: { value: new THREE.Color() },
  fogDensity: { value: 0.02 },
};

// Rings spreading on the film: their slope (xy), and how much ring crest is here (z).
const rippleSlope = Fn(([q]) => {
  const slope = vec3(0).toVar();
  Loop(RIPPLE_COUNT, ({ i }) => {
    const r = river.ripples.element(i);
    If(r.w.greaterThan(0), () => {
      const d = q.sub(r.xy);
      const dist = length(d);
      const x = dist.sub(r.z.mul(RIPPLE_SPEED));
      const tail = select(x.lessThan(0), float(1), exp(x.mul(-4)));
      const envelope = r.w.mul(exp(x.mul(x).mul(-1.6))).mul(tail).div(dist.mul(0.45).add(1));
      const wave = cos(x.mul(9));
      slope.addAssign(vec3(d.div(max(dist, 1e-3)).mul(envelope.mul(wave).mul(0.45)), envelope.mul(max(wave, 0))));
    });
  });
  return slope;
});

const foamNoise = (p) =>
  skyNoise(p)
    .mul(0.5)
    .add(skyNoise(p.mul(2.3).add(1.7)).mul(0.3))
    .add(skyNoise(p.mul(5.1).add(4.2)).mul(0.2));

// Rain on the film: rings from drops landing in a grid of cells, each cell's drop at its own
// time, only in as many cells as the rain is heavy.
const rainSlope = Fn(([q, t, rain]) => {
  const slope = vec2(0).toVar();
  const p = q.div(0.8);
  const cell = floor(p);
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const c = cell.add(vec2(i, j));
      const h = skyHash(c);
      const cycle = t.mul(h.mul(0.7).add(0.8)).add(h.mul(7.3));
      If(skyHash(c.add(floor(cycle).mul(1.37))).lessThanEqual(rain), () => {
        const age = fract(cycle);
        const d = p.sub(c).sub(vec2(skyHash(c.add(3.1)), skyHash(c.add(7.7))));
        const dist = length(d);
        const x = dist.sub(age.mul(1.1));
        slope.addAssign(d.div(max(dist, 1e-3)).mul(sin(x.mul(30)).mul(exp(x.mul(x).mul(-50))).mul(age.oneMinus().mul(age.oneMinus()))));
      });
    }
  return slope.mul(0.14);
});

// clear: from above one sees into the water (the bed, the stones, the fish, as drawn before
// the surface: main.js orders it after them then, and before them from below, where it
// hides the banks and the forest over it). Without, the water from above is its own colour.
export function createSurfaceMaterial({ clear = true } = {}) {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
  const U = surfaceUniforms;
  const foamAttribute = attribute("foam", "float");
  const flowAttribute = attribute("flow", "vec2");
  material.colorNode = Fn(() => {
    const world = positionWorld;
    const q = world.xz;
    const vFoam = foamAttribute,
      vFlow = flowAttribute;
    const waves = surfaceWaves(q, waterTime, U.roughness);
    const swell = vec2(
      cos(q.x.mul(0.21).add(q.y.mul(0.07)).sub(waterTime.mul(0.6)))
        .mul(0.035)
        .add(cos(q.x.mul(0.37).sub(q.y.mul(0.19)).sub(waterTime.mul(0.9))).mul(0.02)),
      cos(q.x.mul(0.11).add(q.y.mul(0.29)).sub(waterTime.mul(0.5)))
        .mul(0.018)
        .sub(cos(q.x.mul(0.37).sub(q.y.mul(0.19)).sub(waterTime.mul(0.9))).mul(0.015)),
    );
    const rings = rippleSlope(q);
    // Round a stone that breaks the surface (or nearly): the water heaped up before it and
    // parting, a trail of broken, whirling water behind it.
    const eddy = eddyAt(q);
    const reach = smoothstep(0.25, 0.8, eddy.w).mul(smoothstep(0.3, 2, length(vFlow)));
    const stir = eddy.xy.mul(reach);
    const wake = reach.mul(length(eddy.xy).div(max(length(vFlow), 0.6)).add(abs(eddy.z).mul(0.08)).clamp(0, 1.5));
    // Fast water is broken water: the steeper and quicker, the rougher the skin.
    const chop = length(vFlow).mul(0.25).add(1).add(vFoam.mul(2)).add(wake.mul(1.2));
    const slope = waves.xy.mul(1.8).add(swell).mul(chop).add(rings.xy).add(stir.mul(0.035)).toVar();
    // Far off the fine ripples are finer than a pixel: calm them rather than let them alias.
    const footprint = length(fwidth(q));
    slope.divAssign(footprint.mul(6).add(1));
    If(U.rain.greaterThan(0.01), () => {
      slope.addAssign(rainSlope(q, waterTime, U.rain).mul(min(1, U.rain.mul(1.5))));
    });
    // Ice: a still sheet over the slow water, its edge ragged; the white water of the
    // riffles and the falls stays open.
    const iceRaw = U.ice.mul(smoothstep(0.3, 0.75, vFoam.add(length(vFlow).mul(0.02))).oneMinus());
    const iceHere = smoothstep(0.15, 0.4, iceRaw.add(foamNoise(q.mul(0.07)).sub(0.5).mul(0.5).mul(U.ice)));
    slope.mulAssign(iceHere.oneMinus());
    // White water: lace of foam carried with the flow, torn into strands along it, and
    // thickest where the river breaks. (What the eddies add is carried in two phases a
    // little apart and blended, so the lace follows the whirls without being dragged out.)
    const alongFlow = normalize(vFlow.add(stir).add(vec2(1e-3, 0)));
    const phase = fract(waterTime.div(1.6));
    let foamField = float(0);
    for (let k = 0; k < 2; k++) {
      const t = fract(phase.add(k * 0.5));
      const weight = abs(t.mul(2).sub(1)).oneMinus();
      const carried = q
        .sub(vFlow.mul(waterTime.mul(0.9)))
        .sub(stir.mul(t.mul(1.6 * 0.9)))
        .add(k * 7.3);
      const stretched = vec2(dot(carried, alongFlow).mul(0.45), dot(carried, vec2(alongFlow.y.negate(), alongFlow.x)));
      foamField = foamField.add(
        foamNoise(stretched.mul(2.2))
          .mul(0.55)
          .add(foamNoise(stretched.mul(6.3).add(3)).mul(0.3))
          .add(foamNoise(carried.mul(15)).mul(0.15))
          .mul(weight),
      );
    }
    const carried = q.sub(vFlow.mul(waterTime.mul(0.9)));
    const foamy = max(vFoam, wake.mul(0.55));
    const threshold = foamy.mul(-0.75).add(1.05);
    const foam = smoothstep(threshold, threshold.add(0.18), foamField)
      .mul(min(1, foamy.mul(2)))
      .mul(step(0.35, foamNoise(carried.mul(40))).mul(0.25).add(0.75));
    const incident = normalize(world.sub(cameraPosition));
    const daylit = max(U.skyLevel.r, max(U.skyLevel.g, U.skyLevel.b)).clamp(0.02, 1.2);
    const color = vec3(0).toVar();
    If(cameraPosition.y.lessThan(world.y), () => {
      // From below: Snell's window, the mirror round it.
      const normal = normalize(vec3(slope.x, -1, slope.y));
      const cosi = dot(incident, normal).negate().clamp(0, 1);
      const eta = 1.333;
      const k = float(1).sub(cosi.mul(cosi).oneMinus().mul(eta * eta));
      const fresnel = float(1).toVar();
      If(k.greaterThan(0), () => {
        const cost = sqrt(k);
        const rs = cosi.mul(eta).sub(cost).div(cosi.mul(eta).add(cost));
        const rp = cosi.sub(cost.mul(eta)).div(cosi.add(cost.mul(eta)));
        fresnel.assign(rs.mul(rs).add(rp.mul(rp)).mul(0.5));
        const transmitted = normalize(incident.mul(eta).add(normal.mul(cosi.mul(eta).sub(cost))));
        // The world above: the banks, the trees and the sky, from the window's cube
        // (mirror.js), or the sky alone. (Four looks close round the ray, a little
        // blurred: the leaves up there are dithered, and magnified in the window their
        // pattern would show as blocks.)
        const through = vec3().toVar();
        If(windowOn.greaterThan(0.5).and(clear), () => {
          const r = 0.012;
          through.assign(
            windowMap
              .sample(transmitted.add(vec3(r, r, r)))
              .rgb.add(windowMap.sample(transmitted.add(vec3(r, -r, -r))).rgb)
              .add(windowMap.sample(transmitted.add(vec3(-r, r, -r))).rgb)
              .add(windowMap.sample(transmitted.add(vec3(-r, -r, r))).rgb)
              .mul(0.25),
          );
        }).Else(() => {
          through.assign(skyColor(transmitted, waterTime));
        });
        color.addAssign(through.mul(fresnel.oneMinus()));
      });
      const mirrored = reflect(incident, normal);
      const bedSeen = smoothstep(-0.1, -0.45, mirrored.y);
      const riverColor = mix(underwaterInscatter(mirrored).mul(1.35), fogNodes().color.mul(vec3(1.6, 1.5, 1.1)).mul(U.sun.mul(0.6).add(0.55)).mul(daylit), bedSeen.mul(0.35));
      const edge = smoothstep(0.35, 0.72, cosi);
      color.addAssign(riverColor.mul(fresnel).mul(edge.mul(0.9).add(1)));
      color.addAssign(vec3(0.9, 1, 1).mul(rings.z.mul(U.sun.mul(0.8).add(0.6)).mul(daylit)));
      // Foam from below: milky and lit through, never a flat white.
      color.assign(mix(color, vec3(1.25, 1.35, 1.35).mul(daylit.mul(0.75).add(0.25)).mul(foamField.mul(0.25).add(0.75)), foam.mul(0.7)));
      // Under the ice: a grey-blue ceiling, the light coming through it milky, crazed with
      // cracks and dotted with trapped air.
      If(iceHere.greaterThan(0), () => {
        const crack = smoothstep(0, 0.012, abs(foamNoise(q.mul(0.09).add(3)).sub(0.5))).oneMinus();
        const air = step(0.86, foamNoise(q.mul(6).add(2))).mul(foamNoise(q.mul(19)).mul(0.6).add(0.4));
        const clouded = foamNoise(q.mul(0.13)).mul(0.6).add(foamNoise(q.mul(0.5).add(9)).mul(0.4));
        const under = vec3(0.42, 0.53, 0.6)
          .mul(daylit.mul(0.82).add(0.18))
          .mul(clouded.mul(0.3).add(0.78))
          .mul(crack.mul(-0.3).add(1))
          .add(vec3(0.22, 0.24, 0.25).mul(air.mul(daylit.mul(0.8).add(0.2))));
        color.assign(mix(color, under, iceHere));
      });
      const away = length(world.sub(cameraPosition));
      color.assign(mix(color, underwaterInscatter(incident), smoothstep(22, 90, away).mul(0.7)));
    }).Else(() => {
      // From above: into the water -- the bed, the stones and the fish, bent by the waves
      // and coloured by as much water as the light goes through to them and back -- and the
      // sky mirrored over it, more the flatter one looks.
      const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
      const mirrored = reflect(incident, normal).toVar();
      mirrored.y.assign(abs(mirrored.y));
      const cosi = dot(incident, normal).negate().clamp(0, 1);
      const fresnel = pow(cosi.oneMinus(), 5).mul(0.98).add(0.02);
      // What it mirrors: the world above the water, from the mirror drawn this frame
      // (mirror.js) where the reflected ray, bent by the waves, leads into it -- found by
      // taking the ray some way out, mirroring that point in the water and seeing where
      // it lies on the screen -- or else the sky.
      // (The waves' tilt only in part: a single distance for everything mirrored would
      // magnify it into rings where the waves turn.)
      const sky = vec3().toVar();
      const gentle = reflect(incident, normalize(vec3(slope.x.mul(-0.4), 1, slope.y.mul(-0.4))));
      const out = world.add(gentle.mul(24));
      const image = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(out.x, world.y.mul(2).sub(out.y), out.z, 1));
      // (Past the mirror's edge, its edge: what lies just beyond is much like it.)
      const at = image.xy.div(image.w).mul(vec2(-0.5, -0.5)).add(0.5).clamp(0.002, 0.998);
      If(mirrorOn.greaterThan(0.5).and(image.w.greaterThan(0)), () => {
        sky.assign(mirrorMap.sample(at).rgb);
      }).Else(() => {
        sky.assign(skyColor(mirrored, waterTime));
      });
      let into;
      if (clear) {
        // How much water lies behind this point along the view, from the depth of what
        // was drawn before the surface. (One copy of the depth a frame: every lookup
        // samples the same node.)
        const surfaceZ = positionView.z;
        const depth = viewportDepthTexture();
        const behindZ = (uvAt) => perspectiveDepthToViewZ(depth.sample(uvAt), cameraNear, cameraFar);
        const straight = max(surfaceZ.sub(behindZ(screenUV)), 0);
        // Bent by the waves, the more water the more (and never onto something in front).
        const bentUV = screenUV.add(slope.mul(vec2(0.06, -0.06)).mul(straight.mul(0.4).clamp(0, 1)));
        const lookUV = select(behindZ(bentUV).lessThan(surfaceZ), bentUV, screenUV);
        const path = max(surfaceZ.sub(behindZ(lookUV)), 0).mul(length(positionView).div(surfaceZ.negate().max(1e-3)));
        const transmit = exp(U.waterDensity.mul(path).mul(extinction).negate());
        const inscatter = U.waterColor.mul(daylit.mul(0.6).add(0.4));
        into = viewportSharedTexture(lookUV).rgb.mul(transmit).add(inscatter.mul(transmit.oneMinus()));
      } else {
        into = U.body.mul(daylit.mul(0.6).add(0.4)).mul(U.sun.mul(0.4).add(1));
      }
      color.assign(mix(into, sky, fresnel));
      color.assign(mix(color, vec3(2.2, 2.25, 2.25).mul(daylit.mul(0.8).add(0.2)), foam.mul(0.92)));
      // Snow on the ice.
      color.assign(mix(color, vec3(1.9, 1.95, 2.05).mul(daylit.mul(0.8).add(0.2)).mul(foamNoise(q.mul(0.4)).mul(0.15).add(0.85)), iceHere));
    });
    // The water (or the air) between the eye and this point.
    const ray = world.sub(cameraPosition);
    const distance = length(ray);
    return vec4(waterBetween(color, distance, ray.div(max(distance, 1e-4))), 1);
  })();
  return material;
}

// ---------------------------------------------------------------------------------------
// A fall's curtain: a sheet of white water streaming off the lip, torn into ropes and spray,
// lit by the day. Seen from the pool below through the water, from above in a leap.
const h1 = (p) => hash2(p);
const n1 = valueNoise(h1);
export function createCurtainMaterial({ under = false, light = uniform(1), from = -1e3, to = 1e3 } = {}) {
  const uFrom = uniform(from),
    uTo = uniform(to);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const t = waterTime;
  const vUv = uv();
  if (!under) {
    // The sheet is not flat: lumps and ropes of water bulge out of it and fall with it, more
    // the further it has fallen.
    const flowDir = attribute("flowDir", "vec2");
    const lump = n1(vec2(vUv.x.mul(0.7), vUv.y.mul(3.2).sub(t.mul(2.4))))
      .mul(0.65)
      .add(n1(vec2(vUv.x.mul(1.9).add(4), vUv.y.mul(6).sub(t.mul(3.1)))).mul(0.35));
    const push = flowDir.mul(lump.sub(0.45).mul(vUv.y.mul(0.9).add(0.12)));
    // (The curtain's geometry is in world space; the push is along the ground.)
    material.positionNode = positionLocal.add(vec3(push.x, 0, push.y));
  }
  const shade = Fn(() => {
    if (under) {
      // Under the surface the falling water goes on down as a column of air beaten into the
      // pool: dense and white where it enters, torn into streaks and billows below, fading
      // as the bubbles slow and turn back up. uv.y from 0 at the surface to 1 at the bottom.
      const pu = vec2(vUv.x.mul(0.8), vUv.y.mul(3).sub(t.mul(1.9)));
      const jets = n1(vec2(vUv.x.mul(0.9), t.mul(0.07)))
        .mul(0.55)
        .add(n1(vec2(vUv.x.mul(2.7), t.mul(0.11).add(3))).mul(0.45));
      const streaks = n1(pu.mul(vec2(4, 0.7)))
        .mul(0.5)
        .add(n1(pu.mul(vec2(11, 1.8)).add(5)).mul(0.3))
        .add(n1(pu.mul(vec2(27, 5)).add(9)).mul(0.2));
      const billow = n1(vec2(vUv.x.mul(1.3), vUv.y.mul(2.2).sub(t.mul(0.6))).add(11));
      const mass = smoothstep(0.3, 0.8, jets.mul(0.55).add(streaks.mul(0.45)).add(billow.mul(0.3)).sub(vUv.y.mul(0.25)));
      const fadeDown = smoothstep(0.15, 1, vUv.y.add(billow.sub(0.5).mul(0.35))).oneMinus();
      const edgeU = min(vUv.x.sub(uFrom), uTo.sub(vUv.x));
      const a = mass
        .mul(fadeDown)
        .mul(smoothstep(0, 1.5, edgeU.add(n1(vec2(vUv.y.mul(5).sub(t), vUv.x)).sub(0.5).mul(1.2))))
        .mul(0.8);
      // Brightest right under the surface where the light comes in; a bluish glow deeper.
      const c = mix(vec3(0.62, 0.8, 0.84), vec3(1.35, 1.45, 1.45), smoothstep(0, 0.7, vUv.y).oneMinus().mul(streaks.mul(0.5).add(0.5)));
      return vec4(c.mul(light), a);
    }
    // uv.x across the lip in units, uv.y down the fall from 0 at the lip to 1. The water
    // gathers speed as it falls: the pattern is laid out along the square root of the
    // height fallen, so its streaks are short and slow at the lip and long and quick below.
    const fallen = sqrt(vUv.y);
    const p = vec2(vUv.x.mul(0.7), fallen.mul(6).sub(t.mul(2.6)));
    // The ropes wander a little across the sheet on the way down, merge and part.
    const across = vUv.x.add(n1(vec2(fallen.mul(1.6), vUv.x.mul(0.25).add(t.mul(0.03)))).sub(0.5).mul(1.4));
    const ropes = n1(vec2(across.mul(1.6), fallen.mul(0.7)).add(vec2(0, t.mul(0.05))))
      .mul(0.6)
      .add(n1(vec2(across.mul(4.3), fallen.mul(1.5).add(1))).mul(0.4));
    const streak = n1(p.mul(vec2(3, 0.6)))
      .mul(0.55)
      .add(n1(p.mul(vec2(9, 1.6)).add(3)).mul(0.3))
      .add(n1(p.mul(vec2(23, 4)).add(7)).mul(0.15));
    const body = smoothstep(0.25, 0.75, ropes.mul(0.6).add(streak.mul(0.7)));
    // It thickens and whitens as it falls; between the ropes it is thin enough to see the
    // rock through.
    const alpha = mix(0.35, 0.85, smoothstep(0, 0.6, vUv.y)).mul(mix(0.2, 1, body)).toVar();
    // Toward the foot the sheet tears into billows of spray falling with it, and it does
    // not meet the pool in a line: it goes into the white of the boil.
    const billow = n1(vec2(vUv.x.mul(0.45), fallen.mul(2.2).sub(t.mul(1.1))).add(13))
      .mul(0.6)
      .add(n1(vec2(vUv.x.mul(1.3), fallen.mul(5).sub(t.mul(2))).add(29)).mul(0.4));
    const torn = smoothstep(0.45, 1, vUv.y);
    alpha.mulAssign(mix(1, smoothstep(0.2, 0.65, billow).mul(0.8).add(0.35), torn));
    alpha.mulAssign(smoothstep(1, billow.mul(0.1).add(0.86), vUv.y));
    // Ragged at the sides, thin where it leaves the lip.
    const edge = min(vUv.x.sub(uFrom), uTo.sub(vUv.x));
    alpha.mulAssign(smoothstep(0, 1.2, edge.add(n1(vec2(vUv.y.mul(6).sub(t.mul(2)), vUv.x)).sub(0.5).mul(0.8))));
    alpha.mulAssign(smoothstep(0, 0.12, vUv.y.add(0.02)));
    const color = mix(vec3(0.5, 0.66, 0.66), vec3(1.5, 1.6, 1.6), smoothstep(0, 0.45, vUv.y).mul(body.mul(0.55).add(0.45)).max(torn.mul(0.9))).toVar();
    // Where it leaves the lip: a glassy tongue, dark and clear, drawn into bright strands,
    // with a sheen where it curls over the edge -- before it breaks up white.
    const tongue = smoothstep(0.03, ropes.mul(0.12).add(0.2), vUv.y).oneMinus();
    const strands = pow(n1(vec2(vUv.x.mul(5), vUv.y.mul(1.2).sub(t.mul(1.4)))), 3);
    const sheen = exp(pow(vUv.y.sub(0.03).div(0.025), 2).negate()).mul(n1(vec2(vUv.x.mul(2.5), t.mul(0.4))).mul(0.45).add(0.55));
    color.assign(mix(color, vec3(0.2, 0.33, 0.3).add(vec3(0.9, 1, 1).mul(strands)), tongue.mul(0.75)));
    color.addAssign(vec3(1.3, 1.35, 1.3).mul(sheen));
    alpha.assign(max(alpha, strands.mul(0.3).add(0.5).mul(tongue).mul(smoothstep(0, 1.2, edge))).add(sheen.mul(0.4)));
    return vec4(color.mul(light), alpha.clamp(0, 0.95));
  })();
  material.colorNode = shade.rgb;
  material.opacityNode = shade.a;
  material.uniforms = { light, uFrom, uTo };
  return material;
}

// The foam on the pool below a fall: a white boil where the curtain comes down, torn into
// lace and streaks that the current carries off downstream and that thin out as they go.
// uv.x across (units), uv.y downstream from where the water comes down (units).
export function createFoamMatMaterial({ light = uniform(1), from = 0, to = 1, length: reach = 10, speed = 1, strength = 1 } = {}) {
  const uFrom = uniform(from),
    uTo = uniform(to),
    uLen = uniform(reach),
    uSpeed = uniform(speed),
    uStrength = uniform(strength);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const shade = Fn(() => {
    const vUv = uv();
    const t = waterTime;
    const d = vUv.y;
    // Carried off downstream, spreading as it goes.
    const q = vec2(vUv.x.mul(0.8), d.sub(t.mul(uSpeed)).mul(0.5));
    const n = n1(q)
      .mul(0.5)
      .add(n1(q.mul(2.3).add(7)).mul(0.3))
      .add(n1(q.mul(5.9).add(3)).mul(0.2));
    const lace = smoothstep(0.5, 0.88, abs(n.sub(0.5)).mul(2).oneMinus());
    const patches = smoothstep(0.35, 0.7, n1(vec2(vUv.x.mul(0.35), d.sub(t.mul(uSpeed).mul(0.8)).mul(0.25)).add(11)));
    const boil = exp(max(d.sub(0.5), 0).div(uLen.mul(0.34)).negate()).mul(n1(vec2(vUv.x.mul(1.3), d.mul(1.3).sub(t.mul(2)))).mul(0.25).add(0.75));
    const far = smoothstep(uLen.mul(0.55), uLen, d.add(n.sub(0.5).mul(uLen).mul(0.3))).oneMinus();
    const a = max(boil.mul(lace.mul(0.2).add(0.8)), lace.mul(patches.mul(0.4).add(0.6)).mul(far)).add(patches.mul(far).mul(0.25)).toVar();
    const spread = d.mul(0.22).add(1.5);
    const edge = min(vUv.x.sub(uFrom.sub(spread)), uTo.add(spread).sub(vUv.x));
    a.mulAssign(smoothstep(0, 2, edge.add(n1(vec2(d.mul(0.7).sub(t.mul(uSpeed).mul(0.35)), vUv.x)).sub(0.5).mul(2.5))));
    a.mulAssign(smoothstep(-1.2, 0.2, d).mul(uStrength));
    const c = mix(vec3(1, 1.08, 1.1), vec3(1.6, 1.66, 1.66), n.mul(0.5).add(boil.mul(0.7)).clamp(0, 1)).mul(light);
    return vec4(c, a.clamp(0, 0.95));
  })();
  material.colorNode = shade.rgb;
  material.opacityNode = shade.a;
  material.alphaTest = 0.01;
  material.uniforms = { light, uFrom, uTo, uLen, uSpeed, uStrength };
  return material;
}

// ---------------------------------------------------------------------------------------
// Specks, bubbles and puffs: sprites, one per point of a cloud. (WebGPU draws points a pixel
// wide, so each point is a small quad facing the eye.) The cloud's positions and its other
// per-point values stay in an ordinary geometry that the game updates as before; the sprite
// reads them per instance. `size` is each point's width in scene units.
export class PointCloud extends THREE.Sprite {
  constructor(geometry, material) {
    super(material);
    this.cloud = geometry;
    this.frustumCulled = false;
  }
  get count() {
    const range = this.cloud?.drawRange;
    const n = this.cloud?.attributes.position?.count ?? 0;
    return range && Number.isFinite(range.count) ? Math.min(n, range.count) : n;
  }
  set count(_) {}
}
// The per-point value `name` of a cloud's geometry, as a node. The attribute is marked as
// one value per instance in place (it stays the object the game already holds and updates).
export const perPoint = (geometry, name) => {
  const attribute = geometry.attributes[name];
  if (!attribute.isInstancedBufferAttribute) {
    attribute.isInstancedBufferAttribute = true;
    attribute.meshPerAttribute = 1;
  }
  return instancedBufferAttribute(attribute);
};

// A plain cloud of points (what a PointsMaterial drew): a colour or the points' own colours,
// round or with a picture, a size in scene units (PointsMaterial's size times the tangent of
// half the field of view, 0.6 at the game's 62 degrees, is the same size on the screen).
export function pointCloud(geometry, { color = 0xffffff, size = 0.1, opacity = 1, map = null, vertexColors = false, transparent = true, depthWrite = false, blending = THREE.NormalBlending, round = true } = {}) {
  const material = new THREE.SpriteNodeMaterial({ color, opacity, transparent, depthWrite, blending, sizeAttenuation: true });
  material.positionNode = perPoint(geometry, "position");
  material.scaleNode = geometry.attributes.size ? perPoint(geometry, "size") : float(size);
  const opacityNode = uniform(opacity);
  const shade = Fn(() => {
    let rgb = uniform(new THREE.Color(color));
    let a = opacityNode;
    if (vertexColors) rgb = rgb.mul(perPoint(geometry, "color"));
    if (map) {
      const picture = texture(map, uv());
      rgb = rgb.mul(picture.rgb);
      a = a.mul(picture.a);
    } else if (round) a = a.mul(step(length(uv().sub(0.5)), 0.5));
    return vec4(rgb, a);
  })();
  material.colorNode = shade.rgb;
  material.opacityNode = shade.a;
  material.alphaTest = 0.003;
  // (Callers that fade the whole cloud set material.opacity: it is read each frame.)
  Object.defineProperty(material, "opacity", {
    get: () => opacityNode.value,
    set: (v) => {
      opacityNode.value = v;
    },
  });
  return new PointCloud(geometry, material);
}

// Bubbles and spray: soft round points, bright where they catch the light.
export function createBubbleMaterial(geometry, { light = uniform(1) } = {}) {
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, sizeAttenuation: true });
  material.positionNode = perPoint(geometry, "position");
  material.scaleNode = perPoint(geometry, "size");
  const shade = Fn(() => {
    const q = uv().sub(0.5);
    const r = length(q);
    // A bubble is a silvery bead: a thin bright rim, a milky body, a highlight up and to one
    // side.
    const rim = smoothstep(0.38, 0.47, r).mul(smoothstep(0.47, 0.5, r).oneMinus());
    const body = smoothstep(0.2, 0.5, r).oneMinus();
    const glint = smoothstep(0.14, 0, length(q.sub(vec2(-0.12, 0.14))));
    const near = smoothstep(0.1, 0.6, length(positionWorld.sub(cameraPosition)));
    const a = rim.mul(0.45).add(body.mul(0.35)).add(glint.mul(0.9)).mul(perPoint(geometry, "alpha")).mul(near).mul(step(r, 0.5));
    return vec4(vec3(1.6, 1.75, 1.8).mul(light), a);
  })();
  material.colorNode = shade.rgb;
  material.opacityNode = shade.a;
  material.uniforms = { light, scale: { value: 1 } };
  return material;
}

// A puff of aerated water: a soft, lumpy, milky blot, lit from above.
export function createFoamCloudMaterial(geometry, { light = uniform(1) } = {}) {
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, sizeAttenuation: true });
  material.positionNode = perPoint(geometry, "position");
  material.scaleNode = perPoint(geometry, "size");
  const shade = Fn(() => {
    const q = uv().sub(0.5).mul(vec2(1, -1));
    const r = length(q).mul(2);
    const seed = perPoint(geometry, "seed");
    // The lumps churn: the noise turns slowly round the puff's middle, each puff its own
    // way, so the cloud rolls rather than slides.
    const turn = waterTime.mul(seed.mul(0.5).add(0.35)).mul(select(seed.greaterThan(0.5), float(1), float(-1)));
    const c = cos(turn),
      s = sin(turn);
    const w = vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)));
    const lumps = n1(w.mul(4).add(seed.mul(17)))
      .mul(0.5)
      .add(n1(w.mul(9).sub(seed.mul(9)).add(waterTime.mul(0.2))).mul(0.3))
      .add(n1(q.mul(22).add(seed.mul(5))).mul(0.2));
    const size = perPoint(geometry, "size");
    // Thin out puffs right at the lens.
    const near = smoothstep(size.mul(0.3), size.mul(1.2), length(positionWorld.sub(cameraPosition)));
    const a = smoothstep(1, 0.25, r.add(lumps.sub(0.5).mul(0.9))).mul(perPoint(geometry, "alpha")).mul(near);
    // Specks of bigger bubbles glinting inside.
    const specks = step(0.93, n1(q.mul(36).add(seed.mul(31)).add(vec2(0, waterTime.mul(0.8)))));
    // Brighter on top, where it catches the light coming down; grey-blue underneath.
    const lit = q.y.negate().add(0.5).add(lumps.sub(0.5).mul(0.6)).clamp(0, 1);
    const color = mix(vec3(0.42, 0.56, 0.6), vec3(1.3, 1.38, 1.38), lit).mul(light).add(vec3(0.6).mul(specks).mul(light));
    return vec4(color, a);
  })();
  material.colorNode = shade.rgb;
  material.opacityNode = shade.a;
  material.alphaTest = 0.003;
  material.uniforms = { light, scale: { value: 1 }, waterTime };
  return material;
}

// ---------------------------------------------------------------------------------------
// Stones and wood. Boulders are laid over with photographed rock from all three axes in
// world space, so a boulder merged into a stretch of river needs no unwrapping, and carry a
// cap of moss and algae on the side that faces the light; how much depends on the river
// (thick in the shaded brook, a thin film in the big river, kelp-browns in the sea).
const noise3 = Fn(([p]) => {
  const h = (v) => fract(sin(dot(v, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
  const i = floor(p),
    f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const at = (x, y, z) => h(i.add(vec3(x, y, z)));
  return mix(mix(mix(at(0, 0, 0), at(1, 0, 0), u.x), mix(at(0, 1, 0), at(1, 1, 0), u.x), u.y), mix(mix(at(0, 0, 1), at(1, 0, 1), u.x), mix(at(0, 1, 1), at(1, 1, 1), u.x), u.y), u.z);
});
export { noise3 };

export async function createRockMaterials() {
  const [mossy, mossyNormal, face, faceNormal, sea, seaNormal, bark, barkNormal] = await Promise.all([
    load("mossy_rock_diff", true),
    load("mossy_rock_nor_gl", false),
    load("rock_face_03_diff", true),
    load("rock_face_03_nor_gl", false),
    load("seaside_rock_diff", true),
    load("seaside_rock_nor_gl", false),
    load("pine_bark_diff", true),
    load("pine_bark_nor_gl", false),
  ]);
  // cobbles: the small stones strewn over the gravel, one instanced mesh a block, each with
  // its own brightness and share of moss in an attribute of its own (cobbleTone) -- not the
  // instance colour, which the renderer would also lay over the stone's colour.
  const make = (map, normalMap, { scale, grey, moss, cobbles = false }) => {
    // (The vertex colours are read by the colour node itself: not multiplied in again.)
    const material = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.85 });
    const rockNormal = property("vec3", "rockNormal");
    material.colorNode = Fn(() => {
      const P = positionWorld;
      // (The normal as the geometry has it, each instance turned and squashed its own way.)
      const Nw = normalWorldGeometry;
      const rock = triplanar(map, normalMap, P, Nw, 1 / scale);
      const c = mix(vec3(dot(rock.color, vec3(0.3, 0.55, 0.15))), rock.color, 1 - grey);
      rockNormal.assign(normalize(mix(Nw, rock.normal, 0.8)));
      // Moss and algae on the side facing the light.
      const n = noise3(P.mul(1.3)).mul(0.6).add(noise3(P.mul(4.1)).mul(0.4));
      const vColor = cobbles ? vertexColor().mul(vec4(attribute("cobbleTone", "vec3"), 1)) : vertexColor();
      const cap = smoothstep(0.1, 0.75, Nw.y.add(n.sub(0.5).mul(0.7))).mul(moss).mul(vColor.g);
      const growth = mix(vec3(0.05, 0.085, 0.025), vec3(0.14, 0.17, 0.06), noise3(P.mul(11)));
      return vec4(mix(c.mul(vColor.r), growth, cap.mul(0.9)), 1);
    })();
    material.normalNode = toViewNormal(rockNormal);
    waterLit(material);
    return material;
  };
  // (Each photograph laid on at about the size of the surface it shows, a few metres
  // across: larger, its lichen turns to camouflage blotches and its cracks to painted lines.)
  const kinds = {
    // Brook and upper river: lichen-grey stone under a coat of moss.
    brook: [mossy, mossyNormal, { scale: 5, grey: 0.25, moss: 0.9 }],
    // The big river and the falls: bare grey gneiss with a film.
    river: [face, faceNormal, { scale: 6, grey: 0.6, moss: 0.35 }],
    // The sea: dark, barnacled, with red and brown algae.
    sea: [sea, seaNormal, { scale: 4.5, grey: 0.2, moss: 0.25 }],
  };
  const set = {
    // Drowned trunks and roots.
    wood: make(bark, barkNormal, { scale: 9, grey: 0.1, moss: 0.5 }),
    cobbles: {},
  };
  for (const [kind, [map, normalMap, options]] of Object.entries(kinds)) {
    set[kind] = make(map, normalMap, options);
    set.cobbles[kind] = make(map, normalMap, { ...options, cobbles: true });
  }
  return set;
}

export { frontFacing };
