// See-through by leaving pixels out, for surfaces that cannot be blended (thousands of
// overlapping leaves no sort could order): a share of the pixels dropped, a different share
// each frame, which the temporal resolve averages into a soft transparency (there is no
// multisampling). Without the resolve (Niedrig) a pattern that changes would only flicker:
// a plain cut at half instead.
//
// (three.js's own alphaHash will not do: its pattern is fixed to the surface, the same
// every frame, so the resolve has nothing to average and it stays a grain of white noise.)
import { float, interleavedGradientNoise, mix, screenCoordinate, uniform } from "three/tsl";

export const dither = {
  // The frame number (main.js counts it while the resolve runs).
  frame: uniform(0),
  // 1 with the temporal resolve, 0 without.
  on: uniform(1),
};

// The alpha a pixel needs to be kept (for a material's alphaTestNode: dropped at or below it).
export function ditherThreshold() {
  return mix(float(0.5), interleavedGradientNoise(screenCoordinate.xy.add(dither.frame.mul(5.588238))), dither.on);
}
