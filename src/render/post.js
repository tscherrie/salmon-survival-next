import * as THREE from "three";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  acesFilmicToneMapping,
  clamp,
  cos,
  exp,
  float,
  floor,
  fract,
  getScreenPosition,
  getViewPosition,
  interleavedGradientNoise,
  perspectiveDepthToViewZ,
  length,
  lightShadowMatrix,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  screenCoordinate,
  sin,
  smoothstep,
  sqrt,
  step,
  sRGBTransferOETF,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { extinction } from "./fog.js";
import { surfaceWaves } from "./caustics.js";
import { canopyOpen, river, surfaceLevelAt, surfacePoint, waterTime } from "./water.js";

// Everything that happens after the scene is drawn: the sun's shafts through the water,
// the mirror of the river in the underside of the surface, bloom, and the final grade.
//
// The shafts are the sunlight scattered toward the eye by the water itself, integrated
// along each view ray through the same shadow map the scene uses and the same caustic net
// the bed shows. So the log, the grass, a fish and a floating leaf each cut a shaft of
// shadow through the water, and the shafts ripple exactly as the net does -- they are the
// net, seen edge on. They are marched at half resolution with a per-pixel jitter and
// joined back to the full-resolution image on depth, so a shaft never bleeds across the
// edge of something in front of it.
//
// Then the frames are joined in time. Each frame is drawn from a camera shifted by a
// different fraction of a pixel (a Halton sequence), and blended into the history of the
// frames before it, reprojected through the depth buffer so it stays put as the viewer
// drifts. That is sixteen samples per pixel for the price of one: ribbon grass a pixel wide
// stops crawling, edges settle, and the noise in the shafts and the see-through leaves
// averages away. Anything that moved and does not match the pixels around it any more is
// clamped back to them, which is what keeps a darting fish from leaving a ghost. The result
// is sharpened a touch, since blending in time softens, then tone-mapped for the screen.

const target = (options = {}) =>
  new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    ...options,
  });

const pass = (fragmentNode) => {
  const material = new THREE.NodeMaterial();
  material.fragmentNode = fragmentNode;
  material.depthTest = false;
  material.depthWrite = false;
  return material;
};

const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(p3.dot(p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

export function createPost(renderer, camera, settings) {
  const quad = new THREE.QuadMesh();
  const run = (material, output) => {
    quad.material = material;
    renderer.setRenderTarget(output);
    quad.render(renderer);
  };

  // The scene itself: HDR colour and a depth texture. (No multisampling: the temporal
  // resolve smooths the edges, and the see-through leaves are dithered for it to average.)
  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.type = THREE.FloatType;
  const main = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture });
  const shafts = target();
  const shaftsSpare = target();
  const bloomLevels = Array.from({ length: 5 }, () => target());
  const hdr = target();
  const history = [target(), target()];

  const u = {
    projectionInverse: uniform(new THREE.Matrix4()),
    projection: uniform(new THREE.Matrix4()),
    view: uniform(new THREE.Matrix4()),
    cameraWorld: uniform(new THREE.Matrix4()),
    cameraPos: uniform(new THREE.Vector3()),
    near: uniform(0.1),
    far: uniform(100),
    size: uniform(new THREE.Vector2(1, 1)),
    shaftSize: uniform(new THREE.Vector2(1, 1)),
  };
  const depthAt = (p) => texture(main.depthTexture, p).x;
  // The distance from the eye to what is seen at p, along the view ray.
  const viewAt = (p) => getViewPosition(p, depthAt(p), u.projectionInverse);
  const linearDistance = (p) => perspectiveDepthToViewZ(depthAt(p), u.near, u.far).negate();

  // ---------------------------------------------------------------------------------
  // The shafts (built once the sun's shadow map exists).
  const shaft = {
    material: null,
    sunLight: uniform(new THREE.Vector3(1, 1, 1)),
    density: uniform(0.02),
    scattering: uniform(0.034),
    frame: uniform(0),
  };
  function shaftMaterial(light) {
    const shadowDepth = light.shadow.map.depthTexture;
    const lightDirection = river.lightDirection;
    const params = river.causticParams;
    const caustic = river.causticMap.value;
    const steps = settings.shaftSteps;
    const henyeyGreenstein = (cosTheta, g) => float((1 - g * g) * 0.0795775).div(pow(float(1 + g * g).sub(cosTheta.mul(2 * g)), 1.5));
    return pass(
      Fn(() => {
        const p0 = uv();
        const view = viewAt(p0);
        const dirView = normalize(view);
        // Shafts are traced through the nearer water only; further off they have merged into
        // the even haze the fog already carries.
        const distance = min(length(view), 48);
        const dir = normalize(u.cameraWorld.mul(vec4(dirView, 0)).xyz);
        const jitter = fract(interleavedGradientNoise(screenCoordinate.xy).add(shaft.frame.mul(0.618034)));
        const stepLength = distance.div(steps);
        const sum = vec3(0).toVar();
        Loop(steps, ({ i }) => {
          const t = float(i).add(jitter).mul(stepLength);
          const p = u.cameraPos.add(dir.mul(t));
          const below = surfaceLevelAt(p).sub(p.y).toVar();
          If(below.lessThan(0), () => {
            Break();
          });
          // In the sun or in the shadow of something above.
          const s = lightShadowMatrix(light).mul(vec4(p, 1));
          const sc = s.xyz.div(s.w);
          const coord = vec3(sc.x, sc.y.oneMinus(), sc.z);
          const inside = coord.x.greaterThan(0).and(coord.x.lessThan(1)).and(coord.y.greaterThan(0)).and(coord.y.lessThan(1)).and(coord.z.lessThan(1));
          const lit = float(1).toVar();
          If(inside, () => {
            lit.assign(texture(shadowDepth, coord.xy).compare(coord.z.sub(0.003)));
          });
          // Sun through the gaps in the crowns, and within each shaft the net seen from
          // inside: finer where it has formed, soft near the surface.
          const q = surfacePoint(p);
          const open = canopyOpen(q, below.mul(0.6));
          const net = texture(caustic, q.div(params.x)).level(abs(below.sub(params.z)).mul(0.1).add(2.2)).r;
          const beam = open.mul(mix(1, net, smoothstep(0.2, 3.5, below).mul(0.6).mul(params.y))).toVar();
          // Broad bands where the surface happens to be focusing more light overall.
          beam.mulAssign(texture(caustic, q.div(params.x).mul(0.21).add(vec2(waterTime.mul(0.004), 0))).level(6).r.mul(0.6).add(0.7));
          const down = exp(river.absorb.mul(below.div(lightDirection.y)).negate());
          const back = exp(extinction.mul(shaft.density.mul(1.8).mul(t)).negate());
          sum.addAssign(down.mul(back).mul(beam).mul(lit));
        });
        const phase = henyeyGreenstein(dir.dot(lightDirection), 0.62).add(0.02);
        return vec4(sum.mul(stepLength).mul(shaft.sunLight).mul(phase).mul(shaft.scattering), distance);
      })(),
    );
  }

  // The march is jittered per pixel, so it is smoothed before use: a short Gaussian along
  // each axis that only mixes samples at a similar distance.
  const blurTexel = uniform(new THREE.Vector2());
  const blurNode = (source) =>
    pass(
      Fn(() => {
        const p = uv();
        const centre = texture(source, p);
        let sum = centre.rgb.mul(0.3);
        let weight = float(0.3);
        for (const [i, w] of [
          [1, 0.22],
          [2, 0.1],
          [3, 0.04],
        ])
          for (const s of [-1, 1]) {
            const tap = texture(source, p.add(blurTexel.mul(i * s)));
            const similar = float(w).div(abs(tap.a.sub(centre.a)).mul(2).add(1));
            sum = sum.add(tap.rgb.mul(similar));
            weight = weight.add(similar);
          }
        return vec4(sum.div(weight), centre.a);
      })(),
    );
  const blurFromShafts = blurNode(shafts.texture);
  const blurFromSpare = blurNode(shaftsSpare.texture);

  // Bloom: a soft threshold at half resolution, then a chain of blurred halvings added back
  // up. Kept low -- under water only the sun, the window and the glints bloom.
  const brightTexel = uniform(new THREE.Vector2());
  const bright = pass(
    Fn(() => {
      const p = uv();
      const c = texture(main.texture, p.add(brightTexel.mul(vec2(-1, -1))))
        .rgb.add(texture(main.texture, p.add(brightTexel.mul(vec2(1, -1)))).rgb)
        .add(texture(main.texture, p.add(brightTexel.mul(vec2(-1, 1)))).rgb)
        .add(texture(main.texture, p.add(brightTexel.mul(vec2(1, 1)))).rgb)
        .mul(0.25)
        .toVar();
      // A stray non-number would be blurred across the whole bloom chain.
      If(c.x.notEqual(c.x).or(c.y.notEqual(c.y)).or(c.z.notEqual(c.z)), () => {
        c.assign(vec3(0));
      });
      const luma = c.dot(vec3(0.2126, 0.7152, 0.0722));
      return vec4(min(c.mul(smoothstep(0.95, 2.8, luma)), vec3(24)), 1);
    })(),
  );
  const downPass = bloomLevels.slice(0, -1).map((level) => {
    const texel = uniform(new THREE.Vector2());
    const material = pass(
      Fn(() => {
        const p = uv();
        const s = (o) => texture(level.texture, p.add(texel.mul(o))).rgb;
        return vec4(
          texture(level.texture, p)
            .rgb.mul(0.25)
            .add(s(vec2(-1, -1)).add(s(vec2(1, -1))).add(s(vec2(-1, 1))).add(s(vec2(1, 1))).mul(0.1875)),
          1,
        );
      })(),
    );
    return { material, texel };
  });
  const upPass = bloomLevels.slice(1).map((level) => {
    const texel = uniform(new THREE.Vector2());
    const material = pass(
      Fn(() => {
        const p = uv();
        const s = (o) => texture(level.texture, p.add(texel.mul(o))).rgb;
        return vec4(s(vec2(-1, 0)).add(s(vec2(1, 0))).add(s(vec2(0, -1))).add(s(vec2(0, 1))).mul(0.25), 1);
      })(),
    );
    material.blending = THREE.AdditiveBlending;
    return { material, texel };
  });

  // ---------------------------------------------------------------------------------
  // The composite: contact shading, the mirror under the surface, the shafts, bloom, grade.
  const composite = {
    reflectionStrength: uniform(0.75),
    bloomStrength: uniform(0.16),
    // The reach's own grade: a lift into the shadows, a gain over the lights, saturation.
    lift: uniform(new THREE.Vector3(0.94, 1.02, 1.04)),
    gain: uniform(new THREE.Vector3(1, 1, 1)),
    saturation: uniform(1.08),
    shaftStrength: uniform(1),
    aoRadiusScale: uniform(1),
  };
  const aoSamples = settings.aoSamples;
  const aoStep = 14.85 / (aoSamples - 1);
  const aoGain = (0.02 * 12) / aoSamples;
  const compositeMaterial = pass(
    Fn(() => {
      const p = uv();
      const color = texture(main.texture, p).rgb.toVar();
      const center = linearDistance(p);
      // Contact shading from depth: creases and the feet of things.
      let occlusion = float(0);
      for (let i = 0; i < aoSamples; i++) {
        const a = i * 2.399963;
        const radius = 2.5 + i * aoStep;
        const offset = vec2(Math.cos(a), Math.sin(a)).mul(composite.aoRadiusScale.mul(radius)).div(u.size);
        const difference = center.sub(linearDistance(p.add(offset)));
        occlusion = occlusion.add(smoothstep(0.012, 0.13, difference).mul(smoothstep(0.2, 0.8, difference).oneMinus()));
      }
      color.mulAssign(occlusion.mul(aoGain).oneMinus());

      if (settings.reflections) {
        // The underside of the surface mirrors the river. Where this pixel is the surface,
        // march the reflected ray back down through the depth buffer and borrow whatever it
        // meets: a fish swimming just under the film is seen twice.
        const view = viewAt(p);
        const dirView = normalize(view);
        const dir = normalize(u.cameraWorld.mul(vec4(dirView, 0)).xyz);
        const at = u.cameraPos.add(dir.mul(length(view)));
        If(abs(at.y.sub(surfaceLevelAt(at))).lessThan(0.05).and(u.cameraPos.y.lessThan(surfaceLevelAt(u.cameraPos))), () => {
          const waves = surfaceWaves(at.xz, waterTime, float(1));
          const normal = normalize(vec3(waves.x.mul(1.8), -1, waves.y.mul(1.8)));
          const r = reflect(dir, normal);
          const travel = float(0.6).toVar();
          const hit = vec3(0).toVar();
          const found = float(0).toVar();
          Loop(20, () => {
            const q = at.add(r.mul(travel));
            const qView = u.view.mul(vec4(q, 1)).xyz;
            const qUv = getScreenPosition(qView, u.projection);
            If(qUv.x.lessThan(0).or(qUv.x.greaterThan(1)).or(qUv.y.lessThan(0)).or(qUv.y.greaterThan(1)), () => {
              Break();
            });
            const gap = qView.z.negate().sub(linearDistance(qUv));
            If(gap.greaterThan(0).and(gap.lessThan(travel.mul(0.18).add(0.6))), () => {
              // The extra path from the surface down to what it shows is water too.
              hit.assign(mix(color, texture(main.texture, qUv).rgb, exp(travel.mul(-0.035))));
              const edge = min(min(qUv.x, qUv.x.oneMinus()), min(qUv.y, qUv.y.oneMinus()));
              found.assign(smoothstep(0, 0.08, edge).mul(smoothstep(10, 40, travel).oneMinus()));
              Break();
            });
            travel.mulAssign(1.28);
          });
          color.assign(mix(color, hit, found.mul(composite.reflectionStrength)));
        });
      }

      // The shafts, joined to this pixel on depth.
      const base = p.mul(u.shaftSize).sub(0.5);
      const f = fract(base);
      const cell = floor(base).add(0.5).div(u.shaftSize);
      const step2 = vec2(1).div(u.shaftSize);
      const s00 = texture(shafts.texture, cell);
      const s10 = texture(shafts.texture, cell.add(vec2(step2.x, 0)));
      const s01 = texture(shafts.texture, cell.add(vec2(0, step2.y)));
      const s11 = texture(shafts.texture, cell.add(step2));
      const rayLength = min(length(viewAt(p)), 48);
      const w00 = f.x.oneMinus().mul(f.y.oneMinus()).div(abs(s00.a.sub(rayLength)).add(0.02));
      const w10 = f.x.mul(f.y.oneMinus()).div(abs(s10.a.sub(rayLength)).add(0.02));
      const w01 = f.x.oneMinus().mul(f.y).div(abs(s01.a.sub(rayLength)).add(0.02));
      const w11 = f.x.mul(f.y).div(abs(s11.a.sub(rayLength)).add(0.02));
      const shaftLight = s00.rgb.mul(w00).add(s10.rgb.mul(w10)).add(s01.rgb.mul(w01)).add(s11.rgb.mul(w11)).div(max(w00.add(w10).add(w01).add(w11), 1e-5));
      color.addAssign(shaftLight.mul(composite.shaftStrength));
      color.addAssign(texture(bloomLevels[0].texture, p).rgb.mul(composite.bloomStrength));

      // Grade: the reach's own tint lifted into the shadows and laid over the lights, its
      // saturation, and a slight vignette as a mask's glass gives.
      const luma = color.dot(vec3(0.2126, 0.7152, 0.0722));
      color.assign(mix(color, color.mul(composite.lift), smoothstep(0.02, 0.4, luma).oneMinus()));
      color.assign(mix(color, color.mul(composite.gain), smoothstep(0.15, 1.2, luma)));
      color.assign(mix(vec3(luma), color, composite.saturation));
      const v = p.sub(0.5).mul(vec2(1, 0.8));
      color.mulAssign(v.dot(v).mul(0.35).oneMinus());
      return vec4(max(color, vec3(0)), 1);
    })(),
  );

  // ---------------------------------------------------------------------------------
  // Temporal resolve. Colours are blended in a compressed range, c / (1 + max(c)), so one
  // blazing glint cannot dominate sixteen frames of average; the history is kept in that
  // range and only expanded again for the final picture.
  let historyIndex = 0,
    historyValid = false,
    jitterIndex = 0;
  const halton = (index, base) => {
    let f = 1,
      r = 0;
    for (let i = index; i > 0; i = Math.floor(i / base)) {
      f /= base;
      r += f * (i % base);
    }
    return r;
  };
  const JITTER = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
  const unjittered = new THREE.Matrix4();
  // The history is kept at the size of the screen, the scene drawn smaller (the pixel
  // budget): each frame's samples fall at a different fraction of a pixel, and over sixteen
  // frames they fill in the finer grid -- a still picture comes out as sharp as the screen.
  const taa = {
    texel: uniform(new THREE.Vector2()),
    renderTexel: uniform(new THREE.Vector2()),
    jitter: uniform(new THREE.Vector2()),
    historyValid: uniform(0),
    feedback: uniform(0.1),
    previousView: uniform(new THREE.Matrix4()),
    previousProjection: uniform(new THREE.Matrix4()),
  };
  const compress = (c) => c.div(max(c.x, max(c.y, c.z)).add(1));
  const toYCoCg = (c) => vec3(c.dot(vec3(0.25, 0.5, 0.25)), c.dot(vec3(0.5, 0, -0.5)), c.dot(vec3(-0.25, 0.5, -0.25)));
  const fromYCoCg = (c) => vec3(c.x.add(c.y).sub(c.z), c.x.add(c.z), c.x.sub(c.y).sub(c.z));
  const resolveMaterials = history.map((from) => {
    // A five-tap Catmull-Rom history fetch: bilinear would blur the picture a little more
    // every frame it is carried forward.
    const sampleHistory = (q) => {
      const size = vec2(1).div(taa.texel);
      const position = q.mul(size);
      const centre = floor(position.sub(0.5)).add(0.5);
      const f = position.sub(centre);
      const w0 = f.mul(f.mul(f.mul(-0.5).add(1)).sub(0.5));
      const w1 = f.mul(f).mul(f.mul(1.5).sub(2.5)).add(1);
      const w2 = f.mul(f.mul(f.mul(-1.5).add(2)).add(0.5));
      const w3 = f.mul(f).mul(f.mul(0.5).sub(0.5));
      const w12 = w1.add(w2);
      const tc12 = centre.add(w2.div(w12)).mul(taa.texel);
      const tc0 = centre.sub(1).mul(taa.texel);
      const tc3 = centre.add(2).mul(taa.texel);
      const h = (x, y) => texture(from.texture, vec2(x, y)).rgb;
      const result = h(tc12.x, tc0.y)
        .mul(w12.x.mul(w0.y))
        .add(h(tc0.x, tc12.y).mul(w0.x.mul(w12.y)))
        .add(h(tc12.x, tc12.y).mul(w12.x.mul(w12.y)))
        .add(h(tc3.x, tc12.y).mul(w3.x.mul(w12.y)))
        .add(h(tc12.x, tc3.y).mul(w12.x.mul(w3.y)));
      const weight = w12.x.mul(w0.y).add(w0.x.mul(w12.y)).add(w12.x.mul(w12.y)).add(w3.x.mul(w12.y)).add(w12.x.mul(w3.y));
      return max(result.div(weight), vec3(0));
    };
    return pass(
      Fn(() => {
        const p = uv();
        // Where this screen pixel's point is in this frame's (shifted, smaller) picture, and
        // the one sample of this frame nearest to it: its colour as drawn, unblurred, and how
        // near (in screen pixels) -- a sample right on the pixel counts fully, one half a
        // scene pixel off hardly, so over the frames each pixel gathers what fell on it.
        const t = p.add(taa.jitter);
        const texelPosition = t.div(taa.renderTexel).sub(0.5);
        const nearestTexel = floor(texelPosition.add(0.5));
        const sampleUv = nearestTexel.add(0.5).mul(taa.renderTexel);
        const offset = sampleUv.sub(taa.jitter).sub(p).div(taa.texel);
        const closeness = exp(offset.dot(offset).mul(-2.2));
        const centre = toYCoCg(compress(texture(hdr.texture, sampleUv).rgb)).toVar();
        const m1 = centre.toVar(),
          m2 = centre.mul(centre).toVar(),
          low = centre.toVar(),
          high = centre.toVar();
        // The nearest surface in the neighbourhood decides where this pixel came from, so the
        // edge of a fish carries its own motion rather than the background's.
        const nearest = depthAt(t).toVar();
        const nearestUv = t.toVar();
        for (let y = -1; y <= 1; y++)
          for (let x = -1; x <= 1; x++) {
            if (x === 0 && y === 0) continue;
            const q = t.add(vec2(x, y).mul(taa.renderTexel));
            const s = toYCoCg(compress(texture(hdr.texture, q).rgb));
            m1.addAssign(s);
            m2.addAssign(s.mul(s));
            low.assign(min(low, s));
            high.assign(max(high, s));
            const d = depthAt(q);
            If(d.lessThan(nearest), () => {
              nearest.assign(d);
              nearestUv.assign(q);
            });
          }
        const mean = m1.div(9);
        const sigma = sqrt(max(m2.div(9).sub(mean.mul(mean)), vec3(0)));
        const boxLow = max(low, mean.sub(sigma.mul(1.25)));
        const boxHigh = min(high, mean.add(sigma.mul(1.25)));
        const world = u.cameraWorld.mul(vec4(getViewPosition(nearestUv, nearest, u.projectionInverse), 1));
        const previousUv = getScreenPosition(taa.previousView.mul(world).xyz, taa.previousProjection).add(t.sub(nearestUv));
        const inside = previousUv.x.greaterThan(0).and(previousUv.x.lessThan(1)).and(previousUv.y.greaterThan(0)).and(previousUv.y.lessThan(1));
        const result = centre.toVar();
        If(taa.historyValid.greaterThan(0.5).and(inside), () => {
          const past = toYCoCg(sampleHistory(previousUv)).toVar();
          // Clip the history toward the neighbourhood's mean until it lies in the box.
          const toPast = past.sub(mean);
          const extentHigh = max(boxHigh.sub(mean), vec3(1e-4));
          const extentLow = max(mean.sub(boxLow), vec3(1e-4));
          const scaled = abs(toPast).div(mix(extentLow, extentHigh, step(vec3(0), toPast)));
          const outside = max(scaled.x, max(scaled.y, scaled.z));
          If(outside.greaterThan(1), () => {
            past.assign(mean.add(toPast.div(outside)));
          });
          // Faster motion trusts the history less.
          const motion = length(p.sub(previousUv).div(taa.renderTexel));
          const blend = mix(taa.feedback.mul(closeness).mul(1.6), 0.35, clamp(motion.div(12), 0, 1));
          result.assign(mix(past, centre, blend));
        });
        const resolved = max(fromYCoCg(result), vec3(0)).toVar();
        // One bad pixel must never be carried forward for ever.
        If(resolved.x.notEqual(resolved.x).or(resolved.y.notEqual(resolved.y)).or(resolved.z.notEqual(resolved.z)).or(resolved.x.greaterThan(1e4)), () => {
          resolved.assign(vec3(0));
        });
        return vec4(resolved, 1);
      })(),
    );
  });

  // The picture for the screen: sharpened a touch, expanded back from the blended range,
  // tone-mapped, in sRGB, with a whisper of grain against banding in the dark water.
  const present = {
    exposure: uniform(1),
    sharpen: uniform(0.16),
    fringe: uniform(0.006),
    grain: uniform(1.5 / 255),
  };
  const expand = (c) => c.div(max(max(c.x, max(c.y, c.z)).oneMinus(), 1e-3));
  const presentMaterial = (source, temporal) =>
    pass(
      Fn(() => {
        const p = uv();
        let color;
        if (temporal) {
          // As through the flat port of an underwater housing: the colours part a little
          // toward the edges of the picture.
          const fromCentre = p.sub(0.5);
          const part = fromCentre.mul(fromCentre.dot(fromCentre).mul(present.fringe));
          const c = vec3(texture(source, p.add(part)).r, texture(source, p).g, texture(source, p.sub(part)).b);
          const n = texture(source, p.add(vec2(0, taa.texel.y))).rgb;
          const s = texture(source, p.sub(vec2(0, taa.texel.y))).rgb;
          const e = texture(source, p.add(vec2(taa.texel.x, 0))).rgb;
          const w = texture(source, p.sub(vec2(taa.texel.x, 0))).rgb;
          const sharp = c.add(c.mul(4).sub(n).sub(s).sub(e).sub(w).mul(present.sharpen));
          color = expand(max(clamp(sharp, min(c, min(min(n, s), min(e, w))), max(c, max(max(n, s), max(e, w)))), vec3(0)));
        } else color = texture(source, p).rgb;
        const mapped = sRGBTransferOETF(acesFilmicToneMapping(color, present.exposure));
        const grain = hash12(screenCoordinate.xy.add(fract(waterTime).mul(91))).sub(0.5).mul(present.grain);
        return vec4(mapped.add(grain), 1);
      })(),
    );
  const presentFromHistory = history.map((h) => presentMaterial(h.texture, true));
  const presentDirect = presentMaterial(hdr.texture, false);

  // Shift the camera by this frame's fraction of a pixel. Undone again after the frame (see
  // render), so picking with the pointer always uses the true camera.
  let jittered = false;
  function jitter() {
    if (!settings.taa || !main.width) return;
    jittered = true;
    unjittered.copy(camera.projectionMatrix);
    const [jx, jy] = JITTER[jitterIndex];
    jitterIndex = (jitterIndex + 1) % JITTER.length;
    camera.projectionMatrix.elements[8] += (2 * jx) / main.width;
    camera.projectionMatrix.elements[9] += (2 * jy) / main.height;
    // (The same shift in the picture's own coordinates, y down. The matrix's third column is
    // divided by the negative depth, so the picture moves the other way.)
    taa.jitter.value.set(-jx / main.width, jy / main.height);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  // Forget the history: after a resize or a jump of the camera.
  function resetHistory() {
    historyValid = false;
  }

  // The scene at width x height; the screen (and the history) at outputWidth x outputHeight.
  function setSize(width, height, scale, outputWidth = width, outputHeight = height) {
    main.setSize(width, height);
    const hw = Math.max(1, Math.round(width / 2)),
      hh = Math.max(1, Math.round(height / 2));
    shafts.setSize(hw, hh);
    shaftsSpare.setSize(hw, hh);
    let w = hw,
      h = hh;
    for (const level of bloomLevels) {
      level.setSize(Math.max(1, w), Math.max(1, h));
      w = Math.round(w / 2);
      h = Math.round(h / 2);
    }
    hdr.setSize(width, height);
    for (const h of history) h.setSize(outputWidth, outputHeight);
    historyValid = false;
    taa.texel.value.set(1 / outputWidth, 1 / outputHeight);
    taa.renderTexel.value.set(1 / width, 1 / height);
    u.size.value.set(width, height);
    u.shaftSize.value.set(hw, hh);
    composite.aoRadiusScale.value = scale / settings.referenceResolution;
  }

  function render({ light, sunLight, density }) {
    camera.updateMatrixWorld();
    u.projectionInverse.value.copy(camera.projectionMatrixInverse);
    u.projection.value.copy(camera.projectionMatrix);
    u.view.value.copy(camera.matrixWorldInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    u.cameraPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.near.value = camera.near;
    u.far.value = camera.far;
    present.exposure.value = renderer.toneMappingExposure;

    if (!shaft.material && light.shadow.map?.depthTexture) shaft.material = shaftMaterial(light);
    shaft.sunLight.value.copy(sunLight);
    shaft.density.value = density;
    shaft.frame.value = (shaft.frame.value + 1) % 64;
    if (shaft.material) {
      run(shaft.material, shafts);
      blurTexel.value.set(1 / shafts.width, 0);
      run(blurFromShafts, shaftsSpare);
      blurTexel.value.set(0, 1 / shafts.height);
      run(blurFromSpare, shafts);
    }

    brightTexel.value.set(1 / main.width, 1 / main.height);
    run(bright, bloomLevels[0]);
    for (let i = 1; i < bloomLevels.length; i++) {
      downPass[i - 1].texel.value.set(1 / bloomLevels[i - 1].width, 1 / bloomLevels[i - 1].height);
      run(downPass[i - 1].material, bloomLevels[i]);
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    for (let i = bloomLevels.length - 1; i > 0; i--) {
      upPass[i - 1].texel.value.set(1 / bloomLevels[i].width, 1 / bloomLevels[i].height);
      run(upPass[i - 1].material, bloomLevels[i - 1]);
    }
    renderer.autoClear = autoClear;

    run(compositeMaterial, hdr);
    if (!settings.taa) {
      run(presentDirect, null);
      return;
    }
    taa.historyValid.value = historyValid ? 1 : 0;
    const output = 1 - historyIndex;
    run(resolveMaterials[historyIndex], history[output]);
    run(presentFromHistory[output], null);
    historyIndex = output;
    historyValid = true;
    // Put the true camera back and remember it for the next frame.
    if (jittered) {
      camera.projectionMatrix.copy(unjittered);
      camera.projectionMatrixInverse.copy(unjittered).invert();
      jittered = false;
    }
    taa.previousView.value.copy(camera.matrixWorldInverse);
    taa.previousProjection.value.copy(camera.projectionMatrix);
  }

  // Development: each pass on its own, for timing (src/dev/shots.js).
  function debugPasses() {
    const list = [];
    if (shaft.material) {
      list.push(["shafts", () => run(shaft.material, shafts)]);
      list.push(["shaft blur", () => {
        blurTexel.value.set(1 / shafts.width, 0);
        run(blurFromShafts, shaftsSpare);
        blurTexel.value.set(0, 1 / shafts.height);
        run(blurFromSpare, shafts);
      }]);
    }
    list.push(["bloom", () => {
      run(bright, bloomLevels[0]);
      for (let i = 1; i < bloomLevels.length; i++) run(downPass[i - 1].material, bloomLevels[i]);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      for (let i = bloomLevels.length - 1; i > 0; i--) run(upPass[i - 1].material, bloomLevels[i - 1]);
      renderer.autoClear = autoClear;
    }]);
    list.push(["composite", () => run(compositeMaterial, hdr)]);
    list.push(["resolve", () => run(resolveMaterials[0], history[1])]);
    list.push(["present", () => run(presentFromHistory[1], null)]);
    return list;
  }

  return { main, setSize, render, composite, shaft, jitter, resetHistory, debugPasses };
}
