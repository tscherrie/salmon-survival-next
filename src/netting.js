import * as THREE from "three";
import { waterLit, waterTime } from "./render/water.js";
import { Fn, abs, dot, exp, float, floor, fract, fwidth, length, max, min, mix, modelWorldMatrix, normalLocal, positionLocal, screenCoordinate, sin, smoothstep, uniform, uv, vec2, vec3, vec4 } from "three/tsl";

// Netting: twine knotted into meshes, drawn in the shader rather than in a texture, so it
// stays crisp close up and melts into a faint veil far off instead of shimmering. The
// mesh's uv is in world units: u along the net, v down from its top edge.
//
// Each thread is filtered to the pixel: where a thread is thinner than a pixel it is drawn
// half a pixel wide but only as opaque as its share of the pixel, and the whole is laid in
// with a dither that changes every frame, which the temporal filter smooths into a
// see-through gauze. Weed and drift catch in the mesh here and there; the deeper twine
// is fouled a little brown and green; the net sways in the current, most at its foot, and
// bellies round whatever is caught in it (`netPull`: where, and how hard).

export const netPull = uniform(new THREE.Vector4(0, -1e5, 0, 0));

const netHash = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const netNoise = (p) => {
  const i = floor(p),
    f = fract(p);
  const w = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(netHash(i), netHash(i.add(vec2(1, 0))), w.x), mix(netHash(i.add(vec2(0, 1))), netHash(i.add(vec2(1, 1))), w.x), w.y);
};
// How much of this pixel a family of threads (along integer values of a) covers.
const netThreads = (a, w, fw) => {
  const d = abs(fract(a.add(0.5)).sub(0.5));
  const we = max(w, fw.mul(0.5));
  return smoothstep(we.sub(fw.mul(0.5)), we.add(fw.mul(0.5)), d).oneMinus().mul(w.div(we));
};

export function nettingMaterial({ color = new THREE.Color(0.3, 0.37, 0.33), mesh = 1.2, hang = 1.25, twine = 0.045, knot = 1.8, square = false, opacity = 0.85, fouling = 0.35, weed = 0.18, sway = 0.5 } = {}) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  const W = mesh,
    H = square ? mesh : mesh * hang;
  // A thread's half-width in the units of the mesh's own coordinates.
  const wa = square ? (twine * 0.5) / mesh : twine * 0.5 * Math.hypot(1 / W, 1 / H);
  const netUv = uv();
  material.positionNode = Fn(() => {
    // Swaying in the current, the more the further down from the top edge.
    const down = netUv.y.div(12).clamp(0, 1);
    const t = waterTime;
    const moved = positionLocal
      .add(normalLocal.mul(down.mul(sway).mul(sin(t.mul(0.55).add(netUv.x.mul(0.11)).add(netUv.y.mul(0.07))).add(sin(t.mul(1.3).sub(netUv.x.mul(0.31))).mul(0.4)))))
      .toVar();
    // Pulled round a fish caught in it.
    const world = modelWorldMatrix.mul(vec4(moved, 1)).xyz;
    const toward = netPull.xyz.sub(world);
    const grip = netPull.w.mul(exp(dot(toward, toward).div(9).negate()));
    moved.addAssign(modelWorldMatrix.transpose().mul(vec4(toward.mul(grip.clamp(0, 0.85)), 0)).xyz);
    return moved;
  })();
  const shade = Fn(() => {
    const q = netUv;
    const a = square ? q.x.div(W) : q.x.div(W).add(q.y.div(H));
    const b = square ? q.y.div(H) : q.x.div(W).sub(q.y.div(H));
    const fa = fwidth(a),
      fb = fwidth(b);
    // Drift caught in the mesh: weed and leaves wrapped round the twine in rags.
    const patches = netNoise(q.mul(vec2(0.09, 0.14))).mul(0.7).add(netNoise(q.mul(0.43)).mul(0.3));
    const rag = smoothstep(0.76, 0.9, patches).mul(weed * 4).mul(netNoise(q.mul(1.7).add(5)).mul(0.6).add(0.4));
    const thick = float(wa).mul(rag.clamp(0, 1).mul(5).add(1));
    const ca = netThreads(a, thick, fa),
      cb = netThreads(b, thick, fb);
    // The knots where the threads cross.
    const k = abs(fract(vec2(a, b).add(0.5)).sub(0.5));
    const kr = float(wa * knot);
    const fk = max(fa, fb);
    const knotEdge = max(kr, fk.mul(0.5));
    const knotCover = smoothstep(knotEdge.sub(fk.mul(0.5)), knotEdge.add(fk.mul(0.5)), length(k)).oneMinus().mul(min(1, kr.div(knotEdge)));
    const cover = max(ca.oneMinus().mul(cb.oneMinus()).oneMinus(), knotCover).toVar();
    // Far off, where a mesh is smaller than a pixel or two: the even gauze it averages to.
    const mean = 1 - (1 - 2 * wa) * (1 - 2 * wa);
    cover.assign(mix(cover, mean, smoothstep(0.3, 0.7, max(fa, fb))));
    // A fouled film on the twine, more of it deeper down.
    const down = q.y.div(14).clamp(0, 1);
    const foul = down.mul(0.65).add(0.35).mul(fouling).mul(smoothstep(0.35, 0.8, patches));
    const twineColor = uniform(new THREE.Color(color)).mul(netHash(floor(vec2(a, b))).mul(0.3).add(0.85)).toVar();
    twineColor.assign(mix(twineColor, vec3(0.2, 0.19, 0.1), foul.mul(0.6)));
    twineColor.assign(mix(twineColor, twineColor.mul(vec3(0.7, 0.9, 0.55)), foul.mul(0.5)));
    twineColor.assign(mix(twineColor, vec3(0.16, 0.13, 0.05).add(vec3(netNoise(q.mul(5)), netNoise(q.mul(5).add(3)), 0).mul(0.08)), rag.mul(1.5).clamp(0, 1)));
    const alpha = cover.mul(mix(opacity, 1, rag.clamp(0, 1)));
    return vec4(mix(twineColor.mul(0.8), twineColor, knotCover.mul(-0.4).add(1)), alpha);
  })();
  material.colorNode = shade.rgb;
  // Laid in with a dither that moves every frame; the temporal filter evens it out.
  const pix = screenCoordinate.xy.add(vec2(47, 17).mul(floor(fract(waterTime.mul(3.7)).mul(64))));
  const threshold = fract(fract(dot(pix, vec2(0.06711056, 0.00583715))).mul(52.9829189));
  material.maskNode = shade.a.greaterThanEqual(max(threshold, 0.02));
  return waterLit(material);
}
