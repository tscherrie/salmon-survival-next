import * as THREE from "three";
import { Fn, abs, cos, dFdx, dFdy, float, min, positionGeometry, sin, uniform, varying, vec2, vec3, vec4 } from "three/tsl";
import { FLOW_DIRECTION, river, waterTime } from "./water.js";

// The caustic net, computed from the surface itself rather than painted on.
//
// A gently rippled surface acts as a sheet of weak lenses: every patch of it tilts the
// sunlight passing through by an angle proportional to its slope, so a bundle of rays that
// started parallel converges under a trough and spreads under a crest. At some depth below,
// the bundles cross, and the bright folded lines where they cross are the net seen dancing
// on a sandy bed. That construction is done here once a frame for one periodic tile of
// surface: a fine grid over the tile is moved to where its light lands at the focal depth,
// and each triangle's brightness is the area it had at the surface over the area it covers
// on the bed. Where the moved grid folds, triangles overlap and add; where it spreads, they
// dim. On average the light is conserved, so the map averages one.
//
// The surface is a sum of short wave trains whose wave numbers fit the tile a whole number
// of times, so the tile repeats seamlessly, and the whole pattern is carried downstream at
// the speed of the surface water: caustics in a river slide rather than simply shimmer.

// Wave numbers, in whole cycles across the tile. Small trains carry as much curvature as
// big ones, so fine detail survives into the net.
const TRAINS = [
  [2, 1], [1, -2], [3, 1], [-2, 3], [4, -1], [1, 4], [5, 2], [-3, -4],
  [6, -2], [2, 6], [7, 1], [-5, 4], [8, 3], [-3, 8],
];
export const TILE = 6;
const SURFACE_DRIFT = 0.8;
export const SURFACE_FLOW = new THREE.Vector2(FLOW_DIRECTION.x * SURFACE_DRIFT, FLOW_DIRECTION.z * SURFACE_DRIFT);
// How far the surface has slid downstream so far: carried along the river's own direction
// where the eye is, a step each frame (so a bend turns the drift without a jump).
export const surfaceDrift = uniform(new THREE.Vector2());
export function driftSurface(dt, flowX, flowZ) {
  const length = Math.hypot(flowX, flowZ) || 1;
  surfaceDrift.value.x += (flowX / length) * SURFACE_DRIFT * dt;
  surfaceDrift.value.y += (flowZ / length) * SURFACE_DRIFT * dt;
}

const WAVES = (() => {
  let seed = 0.37;
  const next = () => (seed = (seed * 9301 + 0.49297) % 1);
  return TRAINS.map(([n, m]) => {
    const kx = (2 * Math.PI * n) / TILE;
    const kz = (2 * Math.PI * m) / TILE;
    const k = Math.hypot(kx, kz);
    // Equal curvature per train: amplitude falls as the square of the wave number.
    const amplitude = 0.15 / (k * k);
    // Capillary-gravity waves, slowed from the free-surface value: the surface of a
    // sheltered run is glassy rather than wind-roughened.
    const omega = 1.15 * Math.sqrt(k) * (0.8 + 0.4 * next());
    return { kx, kz, amplitude, omega, phase: next() * Math.PI * 2 };
  });
})();

// The surface's gradient at q (x, y) and its height (z), shared by the caustic pass, the
// surface itself and the mirror in post.js, so the ripples one sees are the ones that make
// the light. (Unrolled: fourteen trains, each a few multiply-adds.)
export const surfaceWaves = Fn(([q, t, roughness]) => {
  const moved = q.sub(surfaceDrift);
  let slope = vec2(0);
  let height = float(0);
  for (const w of WAVES) {
    const phase = moved.x.mul(w.kx).add(moved.y.mul(w.kz)).sub(t.mul(w.omega)).add(w.phase);
    const a = roughness.mul(w.amplitude);
    slope = slope.add(vec2(w.kx, w.kz).mul(a.mul(cos(phase))));
    height = height.add(a.mul(sin(phase)));
  }
  return vec3(slope, height);
});

export function createCaustics(renderer, { size = 512, grid = 176 } = {}) {
  const target = new THREE.RenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
  });
  target.texture.name = "Caustic net";
  river.causticMap.value = target.texture;
  river.causticParams.value.x = TILE;

  // The grid spans the tile and a margin all round: light from just outside the tile can
  // land inside it, and the periodic surface makes that light the tile's own.
  const margin = 0.22;
  const positions = [];
  const indices = [];
  for (let j = 0; j <= grid; j++)
    for (let i = 0; i <= grid; i++) {
      positions.push((-margin + ((1 + 2 * margin) * i) / grid) * TILE, (-margin + ((1 + 2 * margin) * j) / grid) * TILE, 0);
      if (i < grid && j < grid) {
        const a = j * (grid + 1) + i;
        indices.push(a, a + 1, a + grid + 1, a + 1, a + grid + 2, a + grid + 1);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const roughness = uniform(1);

  const material = new THREE.MeshBasicNodeMaterial({
    blending: THREE.AdditiveBlending,
    // Where the moved grid folds over, its triangles face the other way; they carry light
    // all the same.
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  // Small-slope refraction: a ray through a patch tilted by the slope s leaves it bent by
  // (1 - 1/n) s, and carries that bend down to the focal depth.
  const q = positionGeometry.xy;
  const wave = surfaceWaves(q, waterTime, roughness);
  const landed = q.sub(wave.xy.mul((1 - 1 / 1.333) * 1).mul(river.causticParams.z));
  const before = varying(q);
  const after = varying(landed);
  material.vertexNode = vec4(landed.div(TILE).mul(2).sub(1), 0, 1);
  material.fragmentNode = Fn(() => {
    const areaBefore = abs(dFdx(before).x.mul(dFdy(before).y).sub(dFdx(before).y.mul(dFdy(before).x)));
    const areaAfter = abs(dFdx(after).x.mul(dFdy(after).y).sub(dFdx(after).y.mul(dFdy(after).x)));
    return vec4(min(areaBefore.div(areaAfter.max(1e-7)), 24), 0, 0, 1);
  })();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const clear = new THREE.Color();

  return {
    target,
    tile: TILE,
    uniforms: { roughness },
    render() {
      const previous = renderer.getRenderTarget();
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(clear, alpha);
    },
    dispose() {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
