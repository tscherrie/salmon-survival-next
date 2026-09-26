import { Fn, If, Loop, clamp, cos, float, floor, fract, interleavedGradientNoise, ivec2, max, reference, renderGroup, screenCoordinate, sin, sqrt, texture, textureLoad, vec2 } from "three/tsl";

// Soft shadows that harden toward contact. Sunlight reaches the bed through a surface that
// is never flat, so each point on the sand sees the sun as a small, trembling patch of sky
// a few degrees across rather than a point: the shadow of a blade of grass is sharp where
// it leaves the sand and dissolves into a blur where the tip is six units up, and a log's
// shadow is crisp under it and soft at its edges. A fixed filter gives every shadow the
// same edge; this one measures, for each point, how far above it the shadow-caster is (by
// averaging the depths of the casters in the shadow map around it) and widens the filter
// by that much -- percentage-closer soft shadows (Fernando 2005). The samples are spread on
// a rotated spiral, and the rotation changes from pixel to pixel and frame to frame so the
// temporal resolve averages it into a smooth penumbra.
//
// Returned as a shadow filter for a light (light.shadow.filterNode).
export function softShadowFilter({
  // The spread of the sun as seen from under the waves, as the tangent of its half-angle.
  spread = 0.045,
  // The shadow camera: how many units across its square, and how deep its depth range.
  frustum = 50,
  depthRange = 62,
  blockerSamples = 12,
  filterSamples = 16,
} = {}) {
  const searchRadius = Math.min(0.012, (12 * spread) / frustum);
  return Fn(({ depthTexture, shadowCoord, shadow }, builder) => {
    const mapSize = reference("mapSize", "vec2", shadow).setGroup(renderGroup);
    // Where the fallback to WebGL 2 draws, the map cannot be read texel by texel alongside
    // its comparisons: an even soft edge instead, the same spiral at a fixed width.
    if (builder.renderer.backend.isWebGLBackend) {
      // (Worked out once, before the loop: an expression first met inside a loop is worked
      // out again on every pass.)
      const spinGL = float(0).toVar();
      spinGL.assign(interleavedGradientNoise(screenCoordinate.xy).mul(6.2831853));
      const width = float(1).div(mapSize.x).mul(2.5);
      const sumGL = float(0).toVar();
      Loop(filterSamples, ({ i }) => {
        const k = float(i);
        const r = sqrt(k.add(0.5).div(filterSamples));
        const a = k.mul(2.39996323).add(spinGL);
        sumGL.addAssign(texture(depthTexture, shadowCoord.xy.add(vec2(cos(a), sin(a)).mul(r.mul(width)))).compare(shadowCoord.z.sub(0.0004)));
      });
      return sumGL.div(filterSamples);
    }
    const radiusSetting = reference("radius", "float", shadow).setGroup(renderGroup);
    const texel = float(1).div(mapSize.x);
    const receiver = shadowCoord.z;
    // The light's shadow radius carries the frame number in its fraction (see shadowFrame
    // below), so the spiral turns from frame to frame as well as from pixel to pixel.
    const frameIndex = floor(fract(radiusSetting).mul(1000).add(0.5));
    const spin = float(0).toVar();
    spin.assign(interleavedGradientNoise(screenCoordinate.xy.add(frameIndex.mul(5.588238))).mul(6.2831853));
    // The plain comparison at the point itself, first: the map's one binding then takes the
    // comparing sampler that the filter below needs (the blocker search reads texels directly).
    const here = texture(depthTexture, shadowCoord.xy).compare(receiver.sub(0.0004)).toVar();
    const blockerDepth = float(0).toVar();
    const blockers = float(0).toVar();
    Loop(blockerSamples, ({ i }) => {
      const k = float(i);
      const r = sqrt(k.add(0.5).div(blockerSamples));
      const a = k.mul(2.39996323).add(spin);
      const offset = vec2(cos(a), sin(a)).mul(r.mul(searchRadius));
      // (Read texel by texel: the map's sampler is the comparing kind.)
      const d = textureLoad(depthTexture, ivec2(shadowCoord.xy.add(offset).clamp(0, 0.9999).mul(mapSize))).x;
      If(d.lessThan(receiver.sub(0.0008).sub(r.mul(searchRadius * 0.9))), () => {
        blockerDepth.addAssign(d);
        blockers.addAssign(1);
      });
    });
    const lit = here.toVar();
    If(blockers.greaterThan(0.5), () => {
      // How far the caster is above this point, in units, times the spread of the sun.
      const penumbra = receiver.sub(blockerDepth.div(blockers)).mul((depthRange * spread) / frustum);
      const radius = clamp(penumbra, texel.mul(max(floor(radiusSetting), 1)), searchRadius);
      const sum = float(0).toVar();
      Loop(filterSamples, ({ i }) => {
        const k = float(i);
        const r = sqrt(k.add(0.5).div(filterSamples));
        const a = k.mul(2.39996323).add(spin).add(1.3);
        const offset = vec2(cos(a), sin(a)).mul(r.mul(radius));
        // A sample further out lands on a part of a sloping or curling surface that may be
        // higher than this point, so it is allowed a proportionally wider tolerance:
        // otherwise a wide filter shades a leaf with itself.
        sum.addAssign(texture(depthTexture, shadowCoord.xy.add(offset)).compare(receiver.sub(0.0004).sub(r.mul(radius).mul(0.9))));
      });
      lit.assign(sum.div(filterSamples));
    });
    return lit;
  });
}

// The frame number rides in the thousandths of the light's shadow radius, which the
// filter already receives.
export function shadowFrame(light, baseRadius, frame) {
  light.shadow.radius = Math.floor(baseRadius) + (frame % 16) / 1000;
}
