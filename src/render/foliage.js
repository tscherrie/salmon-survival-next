import * as THREE from "three";
import {
  BRDF_Lambert,
  Fn,
  If,
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  cos,
  cross,
  dFdx,
  dFdy,
  diffuseColor,
  dot,
  exp,
  faceDirection,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  modelNormalMatrix,
  modelWorldMatrix,
  normalGeometry,
  normalView,
  normalize,
  positionGeometry,
  positionView,
  positionWorld,
  pow,
  reference,
  renderGroup,
  select,
  sign,
  sin,
  smoothstep,
  uv,
  varying,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { range, smoothstep as smoothJS, vec } from "./geometry.js";
import { FLOW_DIRECTION, currentStrength, surfaceLevelAt, waterLit, waterTime } from "./water.js";
import { flowAt } from "../flowfield.js";

// Shared foliage construction: the current model in the vertex stage, the submerged leaf
// material, and the blade and stem generators every plant species is built from.

export const TAU = Math.PI * 2;

// The sky's light, for the glow through the back of a leaf (set once from main.js).
let skyLight = null;
export function foliageSky(hemisphereLight) {
  skyLight = hemisphereLight;
}

// Displacement of a strand along its bending direction, and its slope along the strand, at
// distance s from the root. Drag bends the strand downstream with a deflection that grows
// with the square of the distance and saturates as it streams out; the shear layer over its
// surface raises a wave that travels from root to tip and grows toward the tip. The slope
// rotates the shading normal so light travels down the blade with the wave.
function strandMotion(root, direction, s, compliance, stir) {
  const strength = currentStrength(root, waterTime);
  const seed = fract(sin(root.x.mul(12.9898).add(root.z.mul(78.233))).mul(43758.5453));
  const phase = seed.mul(6.2832).add(root.x.mul(0.9));
  // The steady part of the river's push is already in the shape the plant grew into; what
  // moves it is the gusting about that mean.
  const drag = compliance.mul(dot(vec3(FLOW_DIRECTION.x, FLOW_DIRECTION.y, FLOW_DIRECTION.z), direction)).mul(strength.sub(0.92));
  const saturation = s.mul(s).mul(0.06).add(1);
  const bendAmount = drag.mul(0.16).mul(s).mul(s).div(saturation);
  const bendSlope = drag.mul(0.32).mul(s).div(saturation.mul(saturation));
  // Flutter grows with the flow, and more where something has just stirred the water. Only
  // its size answers the stir, never its rate: the phase runs on the clock itself.
  const gain = compliance.mul(strength.mul(0.024).add(0.014).add(min(stir, 1.5).mul(0.025)));
  const safeS = max(s, 1e-4);
  const sPower = pow(safeS, 0.3);
  const envelope = gain.mul(safeS).mul(sPower);
  const envelopeSlope = gain.mul(1.3).mul(sPower);
  const theta = waterTime.mul(1.05).sub(s.mul(1.1)).add(phase);
  const ripple = waterTime.mul(1.75).sub(s.mul(1.8)).add(phase.mul(2.3));
  const shape = sin(theta).add(sin(ripple).mul(0.3));
  const wave = envelope.mul(shape);
  const waveSlope = envelopeSlope.mul(shape).sub(envelope.mul(cos(theta).mul(1.1).add(cos(ripple).mul(0.54))));
  return vec2(bendAmount.add(wave), bendSlope.add(waveSlope));
}

// The strand's place this frame: the river's own sway along its bending direction, then
// whatever a fish has done to the water here: the foliage is pushed along the local
// displacement, more toward the free end, and never along its own length. Also hands the
// bent normal (view space) and the strand's thinness to the fragment stage.
const vLeafNormal = varyingProperty("vec3", "vLeafNormal");
function strandPosition() {
  const anchor = attribute("anchor", "vec3");
  const bend = attribute("bend", "vec4");
  const along = attribute("along", "vec4");
  return Fn(() => {
    const position = positionGeometry;
    const stir = flowAt(position);
    const motion = strandMotion(anchor, bend.xyz, along.w, bend.w, stir.a);
    const n = normalize(normalGeometry.sub(along.xyz.mul(motion.y.mul(dot(bend.xyz, normalGeometry)))));
    vLeafNormal.assign(cameraViewMatrix.mul(vec4(modelNormalMatrix.mul(n), 0)).xyz);
    const pushed = stir.rgb.mul(bend.w.mul(0.17).mul(along.w).mul(along.w).div(along.w.mul(along.w).mul(0.07).add(1))).toVar();
    pushed.subAssign(along.xyz.mul(dot(pushed, along.xyz)));
    // A blade can be pushed aside, not torn off: the displacement saturates.
    pushed.mulAssign(float(1.6).div(max(1.6, length(pushed))));
    const moved = position.add(bend.xyz.mul(motion.x)).add(pushed).toVar();
    // What grows under the water stays under it: a long ribbon lying out under the surface
    // flaps with the current, and would flap up through it into the air.
    const rest = modelWorldMatrix.mul(vec4(position, 1)).xyz;
    const ceiling = surfaceLevelAt(rest).sub(0.04);
    If(rest.y.lessThan(ceiling), () => {
      moved.y.assign(min(moved.y, ceiling.sub(rest.y).add(position.y)));
    });
    return moved;
  })();
}

// Submerged leaves show almost no specular reflection: leaf tissue and water have nearly the
// same refractive index, so what reaches the eye is diffuse reflection and light
// transmitted through the thin blade.
export function foliageMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0,
    specularIntensity: 0.07,
    side: THREE.DoubleSide,
  });
  // See-through tissue: a share of the pixels left out, differently each frame, for the
  // temporal resolve to average into a soft transparency (there is no multisampling).
  material.alphaHash = true;
  material.positionNode = strandPosition();
  const thin = attribute("thin", "float");
  const leafUv = uv();
  material.colorNode = Fn(() => {
    const base = attribute("color", "vec3").toVar();
    // The midrib highlight fades once a leaf is only a few pixels wide, so needle leaves do
    // not clip to white specks.
    const midrib = smoothstep(0.008, 0.035, abs(leafUv.x.sub(0.5))).oneMinus().mul(smoothstep(0.02, 0.06, fwidth(leafUv.x)).oneMinus());
    const veins = pow(cos(leafUv.y.sub(abs(leafUv.x.sub(0.5)).mul(0.32)).mul(155)).mul(0.5).add(0.5), 22);
    const edge = pow(abs(leafUv.x.sub(0.5)).mul(2), 5);
    const mottling = sin(leafUv.y.mul(64).add(sin(leafUv.x.mul(25)))).mul(0.035).add(0.965);
    base.mulAssign(mottling.mul(edge.mul(-0.09).add(1).add(veins.mul(0.12))));
    base.assign(mix(base, base.mul(1.22).add(vec3(0.008, 0.012, 0)), midrib.mul(0.6)));
    // Leaf undersides are paler and warmer than the upper surface.
    base.mulAssign(select(faceDirection.lessThan(0), vec3(0.82, 0.76, 0.66), vec3(1)));
    // Thin tissue lets part of the scene behind show through: ribbon leaves pass a quarter
    // of the light, their thinner edges half.
    const alpha = select(thin.lessThan(0.7), float(1), select(edge.greaterThan(0.45), float(0.5), float(0.75))).toVar();
    // A leaf right in front of the lens thins away rather than filling the picture -- but not
    // a leaf lying flat on the bed (marked by a thinness of exactly 0.12), which would only
    // show as a pale, see-through patch on the ground.
    If(abs(thin.sub(0.12)).greaterThan(0.005), () => {
      alpha.mulAssign(smoothstep(0.35, 1.5, length(positionWorld.sub(cameraPosition))));
    });
    return vec4(base, alpha);
  })();
  // The rib and veins in relief, from their height's change across the pixel.
  material.normalNode = Fn(() => {
    const normal = normalize(vLeafNormal).mul(faceDirection).toVar();
    const rib = exp(pow(leafUv.x.sub(0.5).mul(60), 2).negate()).mul(0.0015);
    const veinHeight = pow(cos(leafUv.y.sub(abs(leafUv.x.sub(0.5)).mul(0.32)).mul(155)).mul(0.5).add(0.5), 16).mul(0.00025);
    const detailFade = smoothstep(0.003, 0.012, max(fwidth(leafUv.x), fwidth(leafUv.y))).oneMinus();
    const micro = sin(leafUv.x.mul(230)).mul(sin(leafUv.y.mul(310))).mul(0.00003).mul(detailFade);
    const height = rib.add(veinHeight).add(micro);
    const dp1 = dFdx(positionView),
      dp2 = dFdy(positionView);
    const r1 = cross(dp2, normal),
      r2 = cross(normal, dp1);
    const det = dot(dp1, r1);
    // A sliver of a blade tip can cover a pixel with no screen-space extent at all; the
    // perturbation then vanishes and must not be normalised into NaN.
    const perturbed = abs(det).mul(normal).sub(sign(det).mul(dFdx(height).mul(r1).add(dFdy(height).mul(r2))));
    If(dot(perturbed, perturbed).greaterThan(1e-20), () => {
      normal.assign(normalize(perturbed));
    });
    return normal;
  })();
  waterLit(material, {
    // Light reaching the far side of a thin leaf is scattered through the tissue, which
    // passes green far more readily than red or blue.
    perLight: ({ lightDirection, lightColor, reflectedLight }) => {
      const backLight = dot(normalView.negate(), lightDirection).clamp(0, 1);
      reflectedLight.directDiffuse.addAssign(lightColor.mul(backLight).mul(1 / Math.PI).mul(diffuseColor.rgb).mul(vec3(0.55, 0.85, 0.3)).mul(thin.mul(0.9)));
    },
    afterIndirect: ({ reflectedLight }) => {
      // A blade seen edge-on can present a shading normal turned away from the eye, and the
      // energy-conserving split of indirect light then goes negative: light is never less
      // than none.
      reflectedLight.indirectDiffuse.assign(max(reflectedLight.indirectDiffuse, vec3(0)));
      reflectedLight.indirectSpecular.assign(max(reflectedLight.indirectSpecular, vec3(0)));
      reflectedLight.directSpecular.assign(max(reflectedLight.directSpecular, vec3(0)));
      // The bright water all round lights a leaf from behind as well as in front: the sky's
      // light reaching its far face comes through the tissue, green. Without it the underside
      // of a blade in shade reads as a hole in the picture.
      if (skyLight) {
        const sky = reference("color", "color", skyLight).setGroup(renderGroup);
        const ground = reference("groundColor", "color", skyLight).setGroup(renderGroup);
        const intensity = reference("intensity", "float", skyLight).setGroup(renderGroup);
        const behindWorld = cameraViewMatrix.transpose().mul(vec4(normalView.negate(), 0)).xyz;
        const behind = mix(ground, sky, behindWorld.y.mul(0.5).add(0.5)).mul(intensity);
        reflectedLight.indirectDiffuse.addAssign(behind.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })).mul(vec3(0.75, 1, 0.55)).mul(thin.mul(0.7).add(0.3)));
      }
    },
  });
  return material;
}

// How a stem or petiole answers the current at parameter t: it bends across its axis,
// toward wherever the flow pushes it.
export function stemStrand(curve, t, length, compliance) {
  const tangent = curve.getTangent(t);
  const direction = FLOW_DIRECTION.clone().addScaledVector(
    tangent,
    -FLOW_DIRECTION.dot(tangent),
  );
  if (direction.lengthSq() < 1e-4) direction.crossVectors(tangent, vec(0, 1, 0));
  return {
    direction: direction.normalize(),
    tangent,
    distance: t * length,
    compliance,
  };
}

// Each blade is a curved, cupped surface. It bends across its face unless it rides on a
// parent strand, in which case it inherits the parent's motion at the attachment.
export function blade(
  batch,
  points,
  width,
  color,
  root,
  compliance,
  {
    rows = 12,
    cols = 4,
    twist = 0,
    ribbon = false,
    thin = 0.3,
    attached = null,
    browning = 0,
    emit = true,
    random = null,
  } = {},
) {
  // Even an omitted background blade consumes its original two random values. This
  // preserves all subsequent procedural geometry rather than regenerating the scene.
  // (A plant grown from a stream of its own passes it, and leaves the shared one alone.)
  const draw = random ? (a, b) => a + (b - a) * random() : range;
  const phase = draw(0, TAU);
  const turn = ribbon ? draw(-0.7, 0.7) : draw(-0.12, 0.12);
  if (!emit) return;
  const curve =
    points.length === 3
      ? new THREE.QuadraticBezierCurve3(...points)
      : ribbon && points.length === 4
        ? new THREE.CubicBezierCurve3(...points)
        : new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const start = batch.positions.length / 3;
  const brown = new THREE.Color("#6b5a2a");
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const theta = twist + turn * t;
    const side = vec(Math.cos(theta), 0, Math.sin(theta));
    side.addScaledVector(tangent, -side.dot(tangent)).normalize();
    const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const envelope = ribbon
      ? Math.pow(Math.sin(Math.PI * Math.pow(t, 0.58)), 0.34)
      : Math.pow(Math.sin(Math.PI * Math.pow(t, 0.73)), 0.76);
    const halfWidth = width * Math.max(0.005, envelope);
    const strand = attached || {
      direction: normal,
      tangent,
      distance: t * length,
      compliance,
    };
    const tint = color
      .clone()
      .multiplyScalar(0.86 + 0.14 * Math.sin(Math.PI * t * 0.9));
    if (browning) tint.lerp(brown, smoothJS(1 - browning, 1, t) * 0.8);
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1;
      const wave = 1 + 0.016 * Math.sin(t * 25 + phase) * u * u;
      const p = center.clone().addScaledVector(side, u * halfWidth * wave);
      p.addScaledVector(
        normal,
        halfWidth *
          (0.19 * u * u + 0.045 * Math.sin(t * 15 + phase) * Math.abs(u)),
      );
      batch.vertex(p, [j / cols, t], tint, root, strand, thin);
      if (i < rows && j < cols) {
        const a = start + i * (cols + 1) + j;
        batch.quad(a, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
}

// taper: how much of its radius a stem has lost at its tip; rows: rings along it (more
// for a long thin stem, so it bends without corners).
export function stem(batch, points, radius, color, root, compliance, attached = null, { taper = 0.65, rows: ringCount = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = ringCount || Math.max(4, points.length * 3),
    cols = 5;
  const start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPoint(t),
      tangent = curve.getTangent(t);
    const a = new THREE.Vector3()
      .crossVectors(tangent, vec(0.2, 0.01, 1))
      .normalize();
    const b = new THREE.Vector3().crossVectors(tangent, a).normalize();
    const strand = attached || stemStrand(curve, t, length, compliance);
    for (let j = 0; j <= cols; j++) {
      const angle = (j / cols) * TAU;
      const v = p
        .clone()
        .addScaledVector(a, Math.cos(angle) * radius * (1 - taper * t))
        .addScaledVector(b, Math.sin(angle) * radius * (1 - taper * t));
      batch.vertex(v, [j / cols, t], color, root, strand, 0);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  return { curve, length };
}
