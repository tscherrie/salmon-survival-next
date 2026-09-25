import { If, cos, float, max, normalize, pow, select, sin, vec2, vec3 } from "three/tsl";

// How a fish swims, in the vertex stage: its spine bends in a travelling wave that builds
// along the trunk and the peduncle, the head counter-moving only slightly, and the fins beat
// by their part (ids from the anatomy: 4 and 5 the pectorals, 1-3, 6 and 12 the others).
// The spine's tangent is integrated so the body keeps its length.
//
// swim: x the wave's phase, y its angle, z the turning curvature, w the pectoral brake.

export const PIVOT = 0.12;

export function spineAngle(s, swim) {
  const along = s.div(0.57).clamp(0, 1);
  return swim.z
    .mul(s)
    .mul(select(s.lessThan(0), float(0.18), float(1)))
    .sub(swim.y.mul(sin(swim.x)).mul(0.025))
    .add(swim.y.mul(pow(along, 1.35)).mul(sin(swim.x.sub(s.mul(7.5)))));
}

// The fins' own motion, before the spine carries them.
export function finMotion(p, { swim, finPhase, part, finProgress }) {
  const q = p.toVar();
  If(part.greaterThan(3.5).and(part.lessThan(5.5)), () => {
    const side = select(part.lessThan(4.5), float(1), float(-1));
    const beat = sin(finPhase.add(side.mul(0.9)));
    q.z.addAssign(side.mul(finProgress).mul(beat.mul(0.013).add(swim.w.mul(0.018))));
    q.x.addAssign(finProgress.mul(beat.mul(0.008).sub(swim.w.mul(0.033))));
    q.y.addAssign(finProgress.mul(0.008).mul(cos(finPhase.add(side.mul(0.9)))));
  })
    .ElseIf(part.greaterThan(0.5).and(part.lessThan(1.5)), () => {
      // The trailing membrane lags behind the peduncle instead of acting as a paddle.
      q.z.addAssign(swim.y.mul(0.045).mul(finProgress).mul(finProgress).mul(sin(swim.x.sub(float(PIVOT).sub(q.x).mul(7.5)).sub(0.65))));
    })
    .ElseIf(part.greaterThan(1.5).and(part.lessThan(6.5)).or(part.greaterThan(11.5)), () => {
      q.z.addAssign(sin(finPhase.sub(q.x.mul(10))).mul(finProgress).mul(0.004));
    });
  return q;
}

// The point p and its normal n carried by the bent spine: { position, normal }.
export function bendSpine(p, n, swim) {
  const s = float(PIVOT).sub(p.x).toVar();
  const theta = spineAngle(s, swim);
  const kappa = spineAngle(s.add(0.001), swim).sub(spineAngle(s.sub(0.001), swim)).div(0.002);
  const spine = vec2(PIVOT, 0).toVar();
  If(s.lessThan(0), () => {
    const mid = spineAngle(s.mul(0.5), swim);
    spine.addAssign(vec2(cos(mid).negate(), sin(mid)).mul(s));
  }).Else(() => {
    const ds = s.div(8);
    for (let i = 0; i < 8; i++) {
      const mid = spineAngle(ds.mul(i + 0.5), swim);
      spine.addAssign(vec2(cos(mid).negate(), sin(mid)).mul(ds));
    }
  });
  const c = cos(theta),
    sn = sin(theta);
  const local = vec3(n.x.div(max(0.3, p.z.mul(kappa).oneMinus())), n.y, n.z);
  const normal = normalize(vec3(local.x.mul(c).add(local.z.mul(sn)), local.y, local.x.negate().mul(sn).add(local.z.mul(c))));
  return { position: vec3(spine.x.add(p.z.mul(sn)), p.y, spine.y.add(p.z.mul(c))), normal };
}
