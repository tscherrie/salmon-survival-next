import * as THREE from "three";
import {
  Fn,
  If,
  PI,
  abs,
  attribute,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  faceDirection,
  float,
  floor,
  fract,
  fwidth,
  inverseSqrt,
  length,
  max,
  min,
  mix,
  mod,
  modelWorldMatrix,
  normalGeometry,
  normalView,
  normalize,
  positionGeometry,
  positionView,
  positionViewDirection,
  pow,
  property,
  reflect,
  select,
  sign,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  varying,
  varyingProperty,
  vec2,
  vec3,
  vec4,
  cameraViewMatrix,
} from "three/tsl";
import { bendSpine, finMotion } from "./render/swim.js";
import { waterLit } from "./render/water.js";
import { fogNodes, underwaterInscatter } from "./render/fog.js";
import { ownInstanceMatrix } from "./render/instancing.js";

// The fish of a northern river and its sea, from one body plan.
//
// Every fish here is built in the same frame as the aquarium's tetra -- snout at x = 0.35,
// tail fin reaching back to about x = -0.44, spine along y = 0 -- so the aquarium's
// swimming wave (fish.js) bends them all; they differ in their profile, their fins and
// their skin. The salmon itself changes through its life: a translucent alevin carrying
// its yolk, a fry, a parr with its thumbprint marks, a silver smolt, a steel-blue sea
// salmon, and at the last a spawner, red-bodied and green-headed with a hooked jaw and a
// hump. Everything that changes smoothly (colour, pattern, hump, jaw, yolk) is uniforms,
// so one material can grow from one stage into the next.
//
// Part ids (attribute aPart), as in the aquarium: 0 body, 1 caudal, 2 dorsal, 3 anal,
// 4 right pectoral, 5 left pectoral, 6 pelvic, 7 eye, 12 adipose, 13 yolk sac.

const TAU = Math.PI * 2;
export const SNOUT = 0.35;
export const MODEL_LENGTH = 0.79; // snout to the tip of the tail fin

// Profiles: x, top, bottom, half width. Fins: base line and tip line in (x, y). Eyes and
// mouths where the head needs them.
export const BODIES = {
  salmon: {
    // A small, pointed head: the brow slopes almost straight down to the snout.
    profile: [
      [0.35, 0.001, -0.006, 0.003],
      [0.342, 0.008, -0.015, 0.007],
      [0.328, 0.017, -0.026, 0.012],
      [0.3, 0.031, -0.041, 0.019],
      [0.26, 0.047, -0.054, 0.026],
      [0.21, 0.062, -0.065, 0.032],
      [0.13, 0.078, -0.074, 0.037],
      [0.06, 0.084, -0.078, 0.038],
      [-0.02, 0.08, -0.073, 0.035],
      [-0.1, 0.066, -0.059, 0.029],
      [-0.18, 0.046, -0.04, 0.02],
      [-0.24, 0.032, -0.028, 0.013],
      [-0.275, 0.025, -0.022, 0.009],
      [-0.3, 0.027, -0.025, 0.006],
    ],
    eye: { x: 0.285, y: 0.018, r: 0.0135 },
    mouth: { x: 0.285, y: -0.012 },
    dorsal: { base: [0.07, -0.05], tip: [[0.06, 0.15], [0.03, 0.155], [-0.01, 0.13], [-0.045, 0.1], [-0.055, 0.082]] },
    adipose: { base: [-0.185, -0.215], tip: [[-0.195, 0.05], [-0.21, 0.052], [-0.222, 0.042]] },
    anal: { base: [-0.13, -0.195], tip: [[-0.13, -0.12], [-0.145, -0.125], [-0.17, -0.11], [-0.19, -0.09], [-0.2, -0.072]] },
    caudal: { upper: [-0.43, 0.09], fork: [-0.395, 0.0], lower: [-0.43, -0.09], depth: 0.028 },
    pectoral: { x: 0.19, y: -0.046, length: 0.085, spread: 0.03 },
    pelvic: { x: -0.02, y: -0.068, length: 0.05 },
  },
  parr: {
    profile: [
      [0.35, 0.0, -0.005, 0.003],
      [0.34, 0.009, -0.015, 0.007],
      [0.32, 0.021, -0.029, 0.014],
      [0.29, 0.036, -0.043, 0.022],
      [0.25, 0.05, -0.055, 0.029],
      [0.2, 0.06, -0.062, 0.033],
      [0.13, 0.068, -0.066, 0.035],
      [0.06, 0.07, -0.066, 0.035],
      [-0.02, 0.066, -0.062, 0.032],
      [-0.1, 0.056, -0.051, 0.026],
      [-0.18, 0.043, -0.038, 0.019],
      [-0.24, 0.031, -0.027, 0.013],
      [-0.275, 0.026, -0.023, 0.009],
      [-0.3, 0.028, -0.026, 0.006],
    ],
    eye: { x: 0.283, y: 0.019, r: 0.0175 },
    mouth: { x: 0.29, y: -0.013 },
    dorsal: { base: [0.07, -0.045], tip: [[0.06, 0.15], [0.03, 0.158], [-0.005, 0.135], [-0.04, 0.1], [-0.05, 0.078]] },
    adipose: { base: [-0.185, -0.215], tip: [[-0.195, 0.052], [-0.21, 0.056], [-0.222, 0.044]] },
    anal: { base: [-0.13, -0.195], tip: [[-0.13, -0.12], [-0.145, -0.125], [-0.17, -0.11], [-0.19, -0.09], [-0.2, -0.07]] },
    caudal: { upper: [-0.43, 0.085], fork: [-0.405, 0.0], lower: [-0.43, -0.085], depth: 0.03 },
    pectoral: { x: 0.195, y: -0.045, length: 0.12, spread: 0.04 },
    pelvic: { x: -0.02, y: -0.064, length: 0.055 },
  },
  alevin: {
    profile: [
      [0.35, 0.0, -0.01, 0.004],
      [0.335, 0.02, -0.026, 0.017],
      [0.31, 0.037, -0.04, 0.028],
      [0.27, 0.045, -0.047, 0.033],
      [0.2, 0.045, -0.047, 0.03],
      [0.1, 0.042, -0.044, 0.027],
      [0.0, 0.038, -0.038, 0.024],
      [-0.1, 0.031, -0.03, 0.019],
      [-0.2, 0.022, -0.021, 0.012],
      [-0.26, 0.016, -0.016, 0.008],
      [-0.3, 0.013, -0.013, 0.005],
    ],
    eye: { x: 0.29, y: 0.012, r: 0.03 },
    mouth: { x: 0.32, y: -0.012 },
    // The larva's continuous fin fold, a low ridge round the back half.
    dorsal: { base: [0.08, -0.29], tip: [[0.08, 0.052], [0.0, 0.07], [-0.12, 0.068], [-0.22, 0.058], [-0.29, 0.045]] },
    adipose: null,
    anal: { base: [-0.07, -0.29], tip: [[-0.07, -0.05], [-0.14, -0.064], [-0.22, -0.058], [-0.29, -0.045]] },
    caudal: { upper: [-0.4, 0.05], fork: [-0.415, 0.0], lower: [-0.4, -0.05], depth: 0.014 },
    pectoral: { x: 0.2, y: -0.02, length: 0.07, spread: 0.035 },
    pelvic: null,
    yolk: { x: 0.12, y: -0.075, rx: 0.14, ry: 0.062, rz: 0.055 },
  },
  trout: {
    profile: [
      [0.35, 0.0, -0.008, 0.003],
      [0.335, 0.017, -0.024, 0.013],
      [0.31, 0.035, -0.042, 0.024],
      [0.27, 0.053, -0.06, 0.036],
      [0.21, 0.07, -0.074, 0.046],
      [0.13, 0.081, -0.081, 0.051],
      [0.05, 0.084, -0.081, 0.051],
      [-0.04, 0.078, -0.075, 0.046],
      [-0.12, 0.066, -0.061, 0.038],
      [-0.2, 0.05, -0.044, 0.027],
      [-0.25, 0.039, -0.035, 0.018],
      [-0.28, 0.036, -0.033, 0.012],
      [-0.3, 0.038, -0.036, 0.008],
    ],
    eye: { x: 0.285, y: 0.02, r: 0.014 },
    mouth: { x: 0.27, y: -0.016 },
    dorsal: { base: [0.07, -0.05], tip: [[0.06, 0.16], [0.03, 0.165], [-0.01, 0.145], [-0.045, 0.11], [-0.055, 0.09]] },
    adipose: { base: [-0.185, -0.215], tip: [[-0.195, 0.062], [-0.21, 0.066], [-0.222, 0.052]] },
    anal: { base: [-0.13, -0.195], tip: [[-0.13, -0.13], [-0.145, -0.135], [-0.17, -0.12], [-0.19, -0.1], [-0.2, -0.08]] },
    caudal: { upper: [-0.43, 0.095], fork: [-0.42, 0.0], lower: [-0.43, -0.095], depth: 0.036 },
    pectoral: { x: 0.19, y: -0.05, length: 0.09, spread: 0.035 },
    pelvic: { x: -0.02, y: -0.074, length: 0.055 },
  },
  pike: {
    profile: [
      [0.35, 0.0, -0.004, 0.012],
      [0.33, 0.008, -0.014, 0.02],
      [0.29, 0.02, -0.026, 0.026],
      [0.24, 0.036, -0.04, 0.032],
      [0.17, 0.048, -0.05, 0.036],
      [0.08, 0.054, -0.054, 0.037],
      [-0.02, 0.055, -0.055, 0.036],
      [-0.1, 0.052, -0.052, 0.032],
      [-0.18, 0.044, -0.042, 0.025],
      [-0.24, 0.035, -0.032, 0.016],
      [-0.28, 0.03, -0.028, 0.01],
      [-0.3, 0.031, -0.029, 0.007],
    ],
    eye: { x: 0.245, y: 0.028, r: 0.013 },
    mouth: { x: 0.2, y: -0.01 },
    dorsal: { base: [-0.15, -0.26], tip: [[-0.15, 0.085], [-0.18, 0.12], [-0.22, 0.11], [-0.25, 0.08], [-0.26, 0.055]] },
    adipose: null,
    anal: { base: [-0.16, -0.265], tip: [[-0.16, -0.08], [-0.19, -0.11], [-0.23, -0.1], [-0.255, -0.075], [-0.265, -0.05]] },
    caudal: { upper: [-0.43, 0.08], fork: [-0.41, 0.0], lower: [-0.43, -0.08], depth: 0.03 },
    pectoral: { x: 0.17, y: -0.04, length: 0.06, spread: 0.028 },
    pelvic: { x: -0.06, y: -0.05, length: 0.045 },
  },
  minnow: {
    profile: [
      [0.35, 0.0, -0.01, 0.004],
      [0.335, 0.018, -0.024, 0.015],
      [0.31, 0.034, -0.04, 0.024],
      [0.27, 0.048, -0.054, 0.032],
      [0.2, 0.06, -0.064, 0.037],
      [0.1, 0.066, -0.068, 0.038],
      [0.0, 0.064, -0.066, 0.036],
      [-0.1, 0.054, -0.054, 0.029],
      [-0.2, 0.038, -0.036, 0.018],
      [-0.26, 0.028, -0.026, 0.011],
      [-0.3, 0.028, -0.026, 0.007],
    ],
    eye: { x: 0.282, y: 0.014, r: 0.022 },
    mouth: { x: 0.33, y: -0.012 },
    dorsal: { base: [0.0, -0.07], tip: [[0.0, 0.14], [-0.02, 0.15], [-0.05, 0.13], [-0.07, 0.09]] },
    adipose: null,
    anal: { base: [-0.12, -0.18], tip: [[-0.12, -0.12], [-0.14, -0.125], [-0.17, -0.1], [-0.18, -0.075]] },
    caudal: { upper: [-0.43, 0.085], fork: [-0.39, 0.0], lower: [-0.43, -0.085], depth: 0.028 },
    pectoral: { x: 0.2, y: -0.048, length: 0.07, spread: 0.03 },
    pelvic: { x: 0.02, y: -0.064, length: 0.05 },
  },
  herring: {
    profile: [
      [0.35, 0.002, -0.004, 0.003],
      [0.335, 0.016, -0.024, 0.01],
      [0.31, 0.03, -0.042, 0.016],
      [0.27, 0.046, -0.058, 0.022],
      [0.2, 0.058, -0.068, 0.026],
      [0.1, 0.064, -0.072, 0.027],
      [0.0, 0.062, -0.068, 0.026],
      [-0.1, 0.052, -0.056, 0.022],
      [-0.2, 0.036, -0.036, 0.015],
      [-0.26, 0.025, -0.024, 0.009],
      [-0.3, 0.024, -0.023, 0.006],
    ],
    eye: { x: 0.285, y: 0.012, r: 0.022 },
    mouth: { x: 0.33, y: -0.004 },
    dorsal: { base: [0.03, -0.06], tip: [[0.03, 0.12], [0.005, 0.13], [-0.035, 0.1], [-0.06, 0.07]] },
    adipose: null,
    anal: { base: [-0.16, -0.23], tip: [[-0.16, -0.08], [-0.2, -0.075], [-0.23, -0.05]] },
    caudal: { upper: [-0.44, 0.1], fork: [-0.37, 0.0], lower: [-0.44, -0.1], depth: 0.024 },
    pectoral: { x: 0.21, y: -0.052, length: 0.06, spread: 0.022 },
    pelvic: { x: -0.02, y: -0.068, length: 0.04 },
  },
  sandeel: {
    profile: [
      [0.35, 0.0, -0.002, 0.002],
      [0.33, 0.01, -0.012, 0.008],
      [0.3, 0.02, -0.022, 0.014],
      [0.25, 0.028, -0.03, 0.017],
      [0.15, 0.033, -0.034, 0.018],
      [0.0, 0.033, -0.033, 0.017],
      [-0.15, 0.028, -0.027, 0.013],
      [-0.25, 0.02, -0.019, 0.008],
      [-0.3, 0.016, -0.015, 0.005],
    ],
    eye: { x: 0.3, y: 0.01, r: 0.009 },
    mouth: { x: 0.335, y: -0.002 },
    dorsal: { base: [0.05, -0.27], tip: [[0.05, 0.05], [-0.1, 0.055], [-0.2, 0.05], [-0.27, 0.035]] },
    adipose: null,
    anal: { base: [-0.08, -0.27], tip: [[-0.08, -0.05], [-0.18, -0.052], [-0.27, -0.035]] },
    caudal: { upper: [-0.41, 0.06], fork: [-0.36, 0.0], lower: [-0.41, -0.06], depth: 0.014 },
    pectoral: { x: 0.24, y: -0.02, length: 0.04, spread: 0.015 },
    pelvic: null,
  },
  // The bullhead: a broad flat head with the eyes on top, fan-like pectorals, two long low
  // dorsals, a rounded tail; it lies on the stones and waits.
  bullhead: {
    profile: [
      [0.35, 0.004, -0.012, 0.03],
      [0.33, 0.02, -0.03, 0.06],
      [0.29, 0.034, -0.038, 0.075],
      [0.23, 0.042, -0.04, 0.078],
      [0.16, 0.044, -0.038, 0.065],
      [0.08, 0.042, -0.034, 0.05],
      [0.0, 0.038, -0.03, 0.038],
      [-0.1, 0.03, -0.024, 0.026],
      [-0.2, 0.022, -0.018, 0.016],
      [-0.27, 0.018, -0.015, 0.01],
      [-0.3, 0.018, -0.015, 0.007],
    ],
    eye: { x: 0.275, y: 0.03, r: 0.013 },
    mouth: { x: 0.3, y: -0.012 },
    dorsal: { base: [0.12, -0.26], tip: [[0.12, 0.075], [0.06, 0.092], [0.0, 0.082], [-0.1, 0.078], [-0.2, 0.062], [-0.26, 0.04]] },
    adipose: null,
    anal: { base: [0.0, -0.26], tip: [[0.0, -0.06], [-0.1, -0.066], [-0.2, -0.056], [-0.26, -0.04]] },
    caudal: { upper: [-0.43, 0.055], fork: [-0.455, 0.0], lower: [-0.43, -0.055], depth: 0.02 },
    pectoral: { x: 0.2, y: -0.025, length: 0.13, spread: 0.07 },
    pelvic: { x: 0.15, y: -0.04, length: 0.05 },
  },
  // The perch: deep-bodied, humped behind the head, a tall spiny first dorsal and a softer
  // second one (in the adipose slot), dark bars down its sides.
  perch: {
    profile: [
      [0.35, 0.004, -0.01, 0.004],
      [0.335, 0.02, -0.03, 0.013],
      [0.3, 0.045, -0.055, 0.025],
      [0.24, 0.075, -0.075, 0.035],
      [0.16, 0.098, -0.088, 0.042],
      [0.06, 0.1, -0.09, 0.043],
      [-0.04, 0.088, -0.078, 0.038],
      [-0.13, 0.06, -0.054, 0.028],
      [-0.21, 0.036, -0.032, 0.016],
      [-0.27, 0.028, -0.025, 0.009],
      [-0.3, 0.03, -0.027, 0.006],
    ],
    eye: { x: 0.29, y: 0.022, r: 0.019 },
    mouth: { x: 0.3, y: -0.012 },
    dorsal: { base: [0.17, -0.02], tip: [[0.17, 0.2], [0.12, 0.22], [0.06, 0.19], [0.0, 0.15], [-0.02, 0.12]] },
    adipose: { base: [-0.04, -0.17], tip: [[-0.045, 0.14], [-0.1, 0.13], [-0.16, 0.08], [-0.17, 0.05]] },
    anal: { base: [-0.1, -0.19], tip: [[-0.1, -0.14], [-0.13, -0.14], [-0.17, -0.1], [-0.19, -0.07]] },
    caudal: { upper: [-0.44, 0.1], fork: [-0.39, 0.0], lower: [-0.44, -0.1], depth: 0.03 },
    pectoral: { x: 0.2, y: -0.03, length: 0.08, spread: 0.03 },
    pelvic: { x: 0.17, y: -0.085, length: 0.07 },
  },
  // The cod: heavy, big-mouthed, three dorsals (two shown), a square tail, a barbel on the
  // chin; it waits by the kelp and the stones of the sea floor.
  cod: {
    profile: [
      [0.35, 0.006, -0.012, 0.008],
      [0.33, 0.025, -0.035, 0.022],
      [0.29, 0.05, -0.06, 0.036],
      [0.22, 0.068, -0.075, 0.045],
      [0.13, 0.075, -0.078, 0.047],
      [0.03, 0.07, -0.07, 0.043],
      [-0.07, 0.058, -0.055, 0.034],
      [-0.16, 0.042, -0.038, 0.022],
      [-0.24, 0.03, -0.026, 0.012],
      [-0.3, 0.027, -0.024, 0.007],
    ],
    eye: { x: 0.28, y: 0.03, r: 0.017 },
    mouth: { x: 0.27, y: -0.014 },
    dorsal: { base: [0.14, 0.02], tip: [[0.14, 0.12], [0.1, 0.135], [0.05, 0.12], [0.02, 0.09]] },
    adipose: { base: [-0.01, -0.12], tip: [[-0.01, 0.1], [-0.05, 0.11], [-0.1, 0.09], [-0.12, 0.065]] },
    anal: { base: [0.0, -0.2], tip: [[0.0, -0.1], [-0.08, -0.11], [-0.15, -0.09], [-0.2, -0.065]] },
    caudal: { upper: [-0.43, 0.085], fork: [-0.425, 0.0], lower: [-0.43, -0.085], depth: 0.03 },
    pectoral: { x: 0.2, y: -0.02, length: 0.08, spread: 0.035 },
    pelvic: { x: 0.24, y: -0.07, length: 0.05 },
  },
  // The grayling: slim and silver-grey, a small underslung mouth, and the great sail of a
  // dorsal fin, purple and spotted, that it spreads in the current.
  grayling: {
    profile: [
      [0.35, 0.0, -0.006, 0.003],
      [0.335, 0.012, -0.018, 0.01],
      [0.31, 0.026, -0.034, 0.019],
      [0.27, 0.042, -0.05, 0.027],
      [0.2, 0.058, -0.064, 0.033],
      [0.12, 0.066, -0.07, 0.035],
      [0.04, 0.068, -0.07, 0.035],
      [-0.05, 0.062, -0.064, 0.032],
      [-0.13, 0.05, -0.05, 0.026],
      [-0.21, 0.036, -0.034, 0.018],
      [-0.26, 0.028, -0.026, 0.011],
      [-0.3, 0.029, -0.027, 0.007],
    ],
    eye: { x: 0.29, y: 0.016, r: 0.017 },
    mouth: { x: 0.318, y: -0.01 },
    dorsal: { base: [0.14, -0.1], tip: [[0.14, 0.13], [0.08, 0.2], [0.0, 0.225], [-0.07, 0.2], [-0.1, 0.13]] },
    adipose: { base: [-0.185, -0.215], tip: [[-0.195, 0.048], [-0.21, 0.05], [-0.222, 0.04]] },
    anal: { base: [-0.12, -0.19], tip: [[-0.12, -0.12], [-0.14, -0.125], [-0.17, -0.1], [-0.19, -0.07]] },
    caudal: { upper: [-0.44, 0.095], fork: [-0.39, 0.0], lower: [-0.44, -0.095], depth: 0.028 },
    pectoral: { x: 0.2, y: -0.05, length: 0.08, spread: 0.03 },
    pelvic: { x: -0.02, y: -0.066, length: 0.06 },
  },
  // The eel: long and round, snake-like, the dorsal and anal fins one low fold running
  // round the tail; it lies up under stones by day.
  eel: {
    profile: [
      [0.35, 0.002, -0.006, 0.006],
      [0.33, 0.012, -0.015, 0.012],
      [0.3, 0.018, -0.02, 0.016],
      [0.25, 0.022, -0.024, 0.019],
      [0.15, 0.024, -0.026, 0.02],
      [0.0, 0.024, -0.026, 0.019],
      [-0.15, 0.022, -0.022, 0.016],
      [-0.25, 0.018, -0.018, 0.012],
      [-0.3, 0.015, -0.015, 0.009],
    ],
    eye: { x: 0.315, y: 0.008, r: 0.008 },
    mouth: { x: 0.34, y: -0.004 },
    dorsal: { base: [0.08, -0.3], tip: [[0.08, 0.034], [-0.05, 0.045], [-0.2, 0.045], [-0.3, 0.035]] },
    adipose: null,
    anal: { base: [-0.02, -0.3], tip: [[-0.02, -0.036], [-0.12, -0.046], [-0.24, -0.045], [-0.3, -0.035]] },
    caudal: { upper: [-0.41, 0.035], fork: [-0.43, 0.0], lower: [-0.41, -0.035], depth: 0.015 },
    pectoral: { x: 0.27, y: -0.004, length: 0.035, spread: 0.018 },
    pelvic: null,
  },
  // The mackerel: a sleek spindle, wavy black bars over a blue-green back, two dorsals, a
  // deeply forked tail; it comes in fast shoals in summer.
  mackerel: {
    profile: [
      [0.35, 0.002, -0.004, 0.003],
      [0.335, 0.014, -0.02, 0.011],
      [0.3, 0.03, -0.04, 0.022],
      [0.25, 0.045, -0.055, 0.03],
      [0.17, 0.058, -0.066, 0.036],
      [0.07, 0.062, -0.068, 0.037],
      [-0.03, 0.056, -0.06, 0.033],
      [-0.13, 0.042, -0.044, 0.024],
      [-0.22, 0.024, -0.024, 0.013],
      [-0.27, 0.014, -0.014, 0.008],
      [-0.3, 0.014, -0.014, 0.006],
    ],
    eye: { x: 0.29, y: 0.012, r: 0.016 },
    mouth: { x: 0.315, y: -0.006 },
    dorsal: { base: [0.14, 0.02], tip: [[0.14, 0.1], [0.1, 0.11], [0.05, 0.09], [0.02, 0.07]] },
    adipose: { base: [-0.05, -0.12], tip: [[-0.05, 0.08], [-0.08, 0.085], [-0.12, 0.06]] },
    anal: { base: [-0.06, -0.13], tip: [[-0.06, -0.08], [-0.09, -0.085], [-0.13, -0.06]] },
    caudal: { upper: [-0.45, 0.1], fork: [-0.34, 0.0], lower: [-0.45, -0.1], depth: 0.012 },
    pectoral: { x: 0.2, y: -0.02, length: 0.06, spread: 0.02 },
    pelvic: { x: 0.18, y: -0.06, length: 0.035 },
  },
  // An otter, in the fish's frame so the same wave swims it: a flat broad head with small
  // round ears, a neck, a long supple body, short legs with webbed paws tucked back as it
  // swims, and the thick tapering tail it steers with.
  otter: {
    profile: [
      [0.35, 0.005, -0.011, 0.011],
      [0.335, 0.018, -0.024, 0.024],
      [0.31, 0.031, -0.035, 0.037],
      [0.28, 0.038, -0.04, 0.044],
      [0.25, 0.038, -0.042, 0.042],
      [0.2, 0.048, -0.054, 0.052],
      [0.12, 0.058, -0.066, 0.062],
      [0.03, 0.062, -0.07, 0.066],
      [-0.06, 0.058, -0.064, 0.062],
      [-0.13, 0.048, -0.052, 0.05],
      [-0.2, 0.034, -0.036, 0.036],
      [-0.28, 0.022, -0.024, 0.024],
      [-0.36, 0.013, -0.014, 0.014],
      [-0.43, 0.004, -0.005, 0.005],
    ],
    eye: { x: 0.305, y: 0.02, r: 0.008 },
    mouth: { x: 0.335, y: -0.012 },
    dorsal: null,
    adipose: null,
    anal: null,
    caudal: null,
    pectoral: null,
    pelvic: null,
    extras: [
      { type: "blob", paired: true, at: [0.262, 0.034, 0.032], r: [0.007, 0.008, 0.005], t: 0.1 },
      // The dark wet nose.
      { type: "blob", at: [0.349, 0.0, 0.0], r: [0.004, 0.005, 0.008], t: 0.0 },
      { type: "leg", paired: true, at: [0.16, -0.035, 0.042], dir: [-0.55, -0.7, 0.35], length: 0.07, r0: 0.016, r1: 0.011, t: 0.3,
        paw: { along: [-1, -0.25, 0.15], across: [0, 0, 1], length: 0.034, width: 0.03, thick: 0.005, digits: 5 } },
      { type: "leg", paired: true, at: [-0.1, -0.035, 0.042], dir: [-0.8, -0.45, 0.35], length: 0.08, r0: 0.02, r1: 0.012, t: 0.3,
        paw: { along: [-1, -0.15, 0.1], across: [0, 0, 1], length: 0.05, width: 0.042, thick: 0.005, digits: 5 } },
    ],
  },
  // A harbour seal, in the fish's frame so the same wave swims it: a round head on a thick
  // neck, a heavy spindle of a body, short fore flippers, and the two hind flippers held
  // together upright, swept from side to side as its tail.
  seal: {
    profile: [
      [0.35, 0.006, -0.014, 0.012],
      [0.335, 0.022, -0.03, 0.028],
      [0.31, 0.04, -0.048, 0.044],
      [0.27, 0.056, -0.062, 0.058],
      [0.23, 0.06, -0.066, 0.062],
      [0.19, 0.062, -0.07, 0.064],
      [0.12, 0.078, -0.088, 0.078],
      [0.03, 0.088, -0.098, 0.088],
      [-0.06, 0.084, -0.092, 0.082],
      [-0.15, 0.064, -0.07, 0.06],
      [-0.22, 0.042, -0.046, 0.036],
      [-0.27, 0.026, -0.028, 0.02],
      [-0.3, 0.018, -0.018, 0.014],
    ],
    eye: { x: 0.3, y: 0.032, r: 0.017 },
    mouth: { x: 0.33, y: -0.018 },
    dorsal: null,
    adipose: null,
    anal: null,
    caudal: null,
    pectoral: null,
    pelvic: null,
    extras: [
      { type: "blob", at: [0.349, 0.002, 0.0], r: [0.006, 0.008, 0.012], t: 0.0 },
      { type: "leg", paired: true, at: [0.14, -0.06, 0.06], dir: [-0.5, -0.5, 0.55], length: 0.03, r0: 0.02, r1: 0.016, t: 0.2,
        paw: { along: [-0.8, -0.35, 0.5], across: [0.5, 0, 0.8], length: 0.07, width: 0.036, thick: 0.008, digits: 5 } },
      { type: "paddle", at: [-0.29, 0.004, 0.0], along: [-1, 0.28, 0], across: [0, 1, 0], length: 0.13, width: 0.06, thick: 0.01, t: 0.15, digits: 5 },
      { type: "paddle", at: [-0.29, -0.004, 0.0], along: [-1, -0.28, 0], across: [0, 1, 0], length: 0.13, width: 0.06, thick: 0.01, t: 0.25, digits: 5 },
    ],
  },
};

// ---------------------------------------------------------------------------------------
// Geometry.

function spline(knots) {
  const xs = knots.map((k) => k[0]);
  const ys = knots.map((k) => k[1]);
  const last = xs.length - 1;
  const slopes = ys.map((_, i) => {
    if (i === 0) return (ys[1] - ys[0]) / (xs[1] - xs[0]);
    if (i === last) return (ys[last] - ys[last - 1]) / (xs[last] - xs[last - 1]);
    return (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]);
  });
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[last]) return ys[last];
    let lo = 0,
      hi = last;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x) lo = m;
      else hi = m;
    }
    const span = xs[lo + 1] - xs[lo];
    const u = (x - xs[lo]) / span;
    const u2 = u * u,
      u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[lo] + (u3 - 2 * u2 + u) * span * slopes[lo] + (-2 * u3 + 3 * u2) * ys[lo + 1] + (u3 - u2) * span * slopes[lo + 1];
  };
}

function builder() {
  const positions = [],
    normals = [],
    uvs = [],
    parts = [],
    progress = [],
    indices = [];
  return {
    positions,
    vertex(p, n, uv, part, t = 0) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uv[0], uv[1]);
      parts.push(part);
      progress.push(t);
      return positions.length / 3 - 1;
    },
    triangle(a, b, c) {
      indices.push(a, b, c);
    },
    finish(computeNormals = false) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      // The part id and how far out along its fin, together (a draw has eight buffers).
      const partProgress = new Float32Array(parts.length * 2);
      for (let k = 0; k < parts.length; k++) {
        partProgress[k * 2] = parts[k];
        partProgress[k * 2 + 1] = progress[k];
      }
      g.setAttribute("aPart", new THREE.Float32BufferAttribute(partProgress, 2));
      g.setIndex(indices);
      if (computeNormals) g.computeVertexNormals();
      return g;
    },
  };
}

// detail < 1 builds a lighter shell for fish that are only ever small on screen (shoals,
// small hunters): fewer rings along the body and round it, simpler eyes and fins.
export function makeFish(kind = "salmon", { detail = 1 } = {}) {
  const rows = Math.max(24, Math.round(72 * detail)),
    columns = Math.max(14, 2 * Math.round(20 * detail));
  const eyeRings = Math.max(4, Math.round(10 * detail)),
    eyeSegments = Math.max(10, Math.round(24 * detail));
  const finColumns = Math.max(8, Math.round(16 * detail)),
    finSteps = Math.max(4, Math.round(7 * detail));
  const plan = BODIES[kind];
  const knots = plan.profile.slice().reverse();
  const top = spline(knots.map((k) => [k[0], k[1]]));
  const bottom = spline(knots.map((k) => [k[0], k[2]]));
  const width = spline(knots.map((k) => [k[0], k[3]]));
  const hypural = plan.profile[plan.profile.length - 1][0];
  const SL = SNOUT - hypural;

  // Body shell.
  const body = builder();
  const xs = [];
  for (let i = 0; i <= rows; i++) {
    // Denser at the head and the peduncle.
    const t = i / rows;
    const w = 0.5 - 0.5 * Math.cos(Math.PI * t);
    xs.push(SNOUT - (0.55 * t + 0.45 * w) * SL);
  }
  const surface = (x, v, side) => {
    const t = top(x),
      b = bottom(x),
      c = (t + b) * 0.5;
    const y = v >= 0 ? c + v * (t - c) : c + v * (c - b);
    const fullness = v >= 0 ? 1.85 : 2.4;
    const waist = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v), 2.1)), 1 / fullness);
    return [x, y, side * Math.max(width(x) * waist, 0.0003)];
  };
  const grid = [];
  for (let i = 0; i <= rows; i++) {
    const row = [];
    for (let j = 0; j < columns; j++) {
      const s = (j / columns) * 2;
      const mirrored = s <= 1;
      const t = mirrored ? s : 2 - s;
      const v = Math.cos(t * Math.PI);
      const p = surface(xs[i], v, mirrored ? 1 : -1);
      row.push(body.vertex(p, [0, 1, 0], [(SNOUT - xs[i]) / SL, t], 0));
    }
    grid.push(row);
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < columns; j++) {
      const a = grid[i][j],
        b = grid[i][(j + 1) % columns],
        c = grid[i + 1][j],
        d = grid[i + 1][(j + 1) % columns];
      body.triangle(a, c, b);
      body.triangle(b, c, d);
    }
  // Close the snout and the tail.
  for (const [i, flip] of [
    [0, false],
    [rows, true],
  ]) {
    const x = xs[i];
    const hub = body.vertex([x, (top(x) + bottom(x)) / 2, 0], [flip ? -1 : 1, 0, 0], [(SNOUT - x) / SL, 0.5], 0);
    for (let j = 0; j < columns; j++) {
      const a = grid[i][j],
        b = grid[i][(j + 1) % columns];
      if (flip) body.triangle(hub, b, a);
      else body.triangle(hub, a, b);
    }
  }
  // The yolk sac of the alevin: a translucent orange bag under the belly.
  if (plan.yolk) {
    const { x, y, rx, ry, rz } = plan.yolk;
    const sphere = new THREE.SphereGeometry(1, 24, 16);
    const pos = sphere.attributes.position,
      nor = sphere.attributes.normal,
      uv = sphere.attributes.uv;
    const offset = body.positions.length / 3;
    for (let k = 0; k < pos.count; k++) {
      body.vertex([x + pos.getX(k) * rx, y + pos.getY(k) * ry, pos.getZ(k) * rz], [nor.getX(k), nor.getY(k), nor.getZ(k)], [uv.getX(k), uv.getY(k)], 13);
    }
    const index = sphere.index;
    for (let k = 0; k < index.count; k += 3) body.triangle(offset + index.getX(k), offset + index.getX(k + 1), offset + index.getX(k + 2));
  }
  // The two mammals that swim in the fish's frame (the otter, the seal) are more than a
  // shell: legs and webbed paws, flippers, ears -- solid and furred like the body (part 0,
  // so the swimming wave bends them with it; uv says which part of the coat they wear).
  if (plan.extras) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const coatUv = (x, t) => [Math.min(1, Math.max(0, (SNOUT - x) / SL)), t];
    // A tapering tube from a to b.
    const tube = (a, b, r0, r1, t, sides = 8) => {
      const axis = b.clone().sub(a).normalize();
      const s1 = V(0, 1, 0).cross(axis);
      if (s1.lengthSq() < 1e-6) s1.set(1, 0, 0);
      s1.normalize();
      const s2 = axis.clone().cross(s1).normalize();
      const start = body.positions.length / 3;
      for (let e = 0; e < 2; e++) {
        const c = e ? b : a,
          r = e ? r1 : r0;
        for (let k = 0; k < sides; k++) {
          const ang = (k / sides) * TAU;
          const p = c.clone().addScaledVector(s1, Math.cos(ang) * r).addScaledVector(s2, Math.sin(ang) * r);
          body.vertex([p.x, p.y, p.z], [0, 1, 0], coatUv(p.x, t), 0);
        }
      }
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        body.triangle(start + k, start + sides + k, start + k1);
        body.triangle(start + k1, start + sides + k, start + sides + k1);
      }
    };
    // A blob: a squashed sphere (an ear, a knuckle, the end of a limb).
    const blob = (c, rx, ry, rz, t) => {
      const sphere = new THREE.SphereGeometry(1, 10, 7);
      const pos = sphere.attributes.position;
      const start = body.positions.length / 3;
      for (let k = 0; k < pos.count; k++) {
        const p = V(c.x + pos.getX(k) * rx, c.y + pos.getY(k) * ry, c.z + pos.getZ(k) * rz);
        body.vertex([p.x, p.y, p.z], [0, 1, 0], coatUv(p.x, t), 0);
      }
      const index = sphere.index;
      for (let k = 0; k < index.count; k += 3) body.triangle(start + index.getX(k), start + index.getX(k + 1), start + index.getX(k + 2));
    };
    // A paddle: a flat, slightly thick fan from a root along `along`, `across` its width,
    // its far edge scalloped into `digits` toes (a webbed paw, a flipper).
    const paddle = (root, along, across, length, width, thick, t, digits = 5) => {
      along = along.clone().normalize();
      across = across.clone().sub(along.clone().multiplyScalar(across.dot(along))).normalize();
      const up = along.clone().cross(across).normalize();
      const n = 14;
      const rim = [];
      for (let k = 0; k <= n; k++) {
        const f = k / n; // across, 0..1
        const s = f * 2 - 1;
        // Narrow at the root, widest near the end; the toes stand out along the far edge.
        const toe = digits ? 0.12 * Math.pow(Math.abs(Math.cos(Math.PI * f * digits)), 3) : 0;
        const reach = length * (0.78 + 0.22 * Math.sqrt(1 - s * s) + toe);
        rim.push(root.clone().addScaledVector(along, reach).addScaledVector(across, s * width * 0.5));
      }
      const start = body.positions.length / 3;
      for (const face of [1, -1]) {
        const centre = root.clone().addScaledVector(up, face * thick * 0.5);
        body.vertex([centre.x, centre.y, centre.z], [0, 1, 0], coatUv(centre.x, t), 0);
        for (const p of rim) {
          const q = p.clone().addScaledVector(up, face * thick * 0.25);
          body.vertex([q.x, q.y, q.z], [0, 1, 0], coatUv(q.x, t), 0);
        }
      }
      const second = start + n + 2;
      for (let k = 0; k < n; k++) {
        body.triangle(start, start + 1 + k, start + 2 + k);
        body.triangle(second, second + 2 + k, second + 1 + k);
        // The rim between the two faces.
        body.triangle(start + 1 + k, second + 1 + k, start + 2 + k);
        body.triangle(start + 2 + k, second + 1 + k, second + 2 + k);
      }
    };
    for (const e of plan.extras) {
      for (const side of e.paired ? [-1, 1] : [1]) {
        const at = V(e.at[0], e.at[1], e.at[2] * side);
        if (e.type === "blob") blob(at, e.r[0], e.r[1], e.r[2], e.t ?? 0.3);
        if (e.type === "leg") {
          const dir = V(e.dir[0], e.dir[1], e.dir[2] * side).normalize();
          const end = at.clone().addScaledVector(dir, e.length);
          tube(at, end, e.r0, e.r1, e.t ?? 0.7);
          blob(end, e.r1 * 1.1, e.r1 * 1.1, e.r1 * 1.1, e.t ?? 0.7);
          if (e.paw) paddle(end, V(e.paw.along[0], e.paw.along[1], e.paw.along[2] * side), V(e.paw.across[0], e.paw.across[1], e.paw.across[2] * side), e.paw.length, e.paw.width, e.paw.thick, e.t ?? 0.7, e.paw.digits ?? 5);
        }
        if (e.type === "paddle") paddle(at, V(e.along[0], e.along[1], e.along[2] * side), V(e.across[0], e.across[1], e.across[2] * side), e.length, e.width, e.thick, e.t ?? 0.5, e.digits ?? 5);
      }
    }
  }
  const bodyGeometry = body.finish(true);

  // Eyes: domes set into the head.
  const eyes = builder();
  const { eye } = plan;
  for (const side of [-1, 1]) {
    // Set into the head, not on it: a shallow lens whose edge sinks under the skin.
    const z0 = surface(eye.x, 0.1, 1)[2] * 0.8;
    const rings = eyeRings,
      segments = eyeSegments;
    const start = eyes.positions.length / 3;
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI * 0.55;
      for (let k = 0; k <= segments; k++) {
        const theta = (k / segments) * TAU;
        const nx = Math.sin(phi) * Math.cos(theta),
          ny = Math.sin(phi) * Math.sin(theta),
          nz = Math.cos(phi);
        eyes.vertex([eye.x + nx * eye.r, eye.y + ny * eye.r, side * (z0 + nz * eye.r * 0.48 - eye.r * 0.1)], [nx * 0.8, ny * 0.8, side * nz], [k / segments, r / rings], 7);
        if (r < rings && k < segments) {
          const a = start + r * (segments + 1) + k;
          if (side > 0) {
            eyes.triangle(a, a + segments + 1, a + 1);
            eyes.triangle(a + 1, a + segments + 1, a + segments + 2);
          } else {
            eyes.triangle(a, a + 1, a + segments + 1);
            eyes.triangle(a + 1, a + segments + 2, a + segments + 1);
          }
        }
      }
    }
  }
  const eyeGeometry = eyes.finish(false);

  // Fins.
  const fins = builder();
  const fan = (part, base, tip, { sway = 0, roll = 0 } = {}) => {
    const baseCurve = new THREE.CatmullRomCurve3(base.map((p) => new THREE.Vector3(...p)));
    const tipCurve = new THREE.CatmullRomCurve3(tip.map((p) => new THREE.Vector3(...p)));
    const columns = finColumns,
      steps = finSteps;
    const start = fins.positions.length / 3;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      p = new THREE.Vector3();
    for (let c = 0; c <= columns; c++) {
      const along = c / columns;
      baseCurve.getPoint(along, a);
      tipCurve.getPoint(along, b);
      // The scalloped rim between the rays needs the full count of columns to show.
      const scallop = 1 - (finColumns >= 16 ? 0.05 : 0) * Math.pow(0.5 - 0.5 * Math.cos(TAU * along * 6), 1.4);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        p.lerpVectors(a, b, t * scallop);
        const bow = Math.sin(t * Math.PI * 0.85);
        p.z += sway * bow + roll * bow * Math.sin((along - 0.5) * Math.PI);
        fins.vertex([p.x, p.y, p.z], [0, 0, 1], [along, t], part, t);
        if (c < columns && k < steps) {
          const q = start + c * (steps + 1) + k;
          fins.triangle(q, q + 1, q + steps + 1);
          fins.triangle(q + 1, q + steps + 2, q + steps + 1);
        }
      }
    }
  };
  const median = (from, to, dorsal, n = 5) => {
    const line = [];
    for (let i = 0; i <= n; i++) {
      const x = from + ((to - from) * i) / n;
      line.push([x, dorsal ? top(x) - 0.004 : bottom(x) + 0.004, 0]);
    }
    return line;
  };
  const tipLine = (points) => points.map(([x, y]) => [x, y, 0]);
  // Caudal: from the hypural plate out to two lobes and the fork between.
  if (plan.caudal) {
    const d = plan.caudal.depth;
    const base = [
      [hypural + 0.012, d, 0],
      [hypural, d * 0.5, 0],
      [hypural - 0.004, 0, 0],
      [hypural, -d * 0.5, 0],
      [hypural + 0.012, -d, 0],
    ];
    const [ux, uy] = plan.caudal.upper,
      [fx, fy] = plan.caudal.fork,
      [lx, ly] = plan.caudal.lower;
    const tip = [
      [hypural - 0.02, uy * 0.55, 0],
      [ux + 0.03, uy * 0.95, 0],
      [ux, uy, 0],
      [(ux + fx) / 2 + 0.005, (uy + fy) / 2 - 0.01, 0],
      [fx, fy, 0],
      [(lx + fx) / 2 + 0.005, (ly + fy) / 2 + 0.01, 0],
      [lx, ly, 0],
      [lx + 0.03, ly * 0.95, 0],
      [hypural - 0.02, ly * 0.55, 0],
    ];
    fan(1, base, tip);
  }
  if (plan.dorsal) fan(2, median(plan.dorsal.base[0], plan.dorsal.base[1], true), tipLine(plan.dorsal.tip));
  if (plan.anal) fan(3, median(plan.anal.base[0], plan.anal.base[1], false), tipLine(plan.anal.tip));
  if (plan.adipose) fan(12, median(plan.adipose.base[0], plan.adipose.base[1], true, 3), tipLine(plan.adipose.tip));
  for (const side of plan.pectoral ? [-1, 1] : []) {
    const { x, y, length, spread } = plan.pectoral;
    const z = (px, py) => side * surface(px, (py - (top(px) + bottom(px)) / 2) / ((top(px) - bottom(px)) / 2), 1)[2];
    const base = [
      [x, y + spread * 0.4, z(x, y + spread * 0.4)],
      [x - 0.006, y, z(x - 0.006, y)],
      [x - 0.012, y - spread * 0.4, z(x - 0.012, y - spread * 0.4)],
    ];
    const tip = [
      [x - length * 0.55, y + spread * 0.1, side * (length * 0.55)],
      [x - length * 0.95, y - spread * 0.2, side * (length * 0.62)],
      [x - length * 0.9, y - spread * 0.7, side * (length * 0.5)],
      [x - length * 0.45, y - spread * 0.9, side * (length * 0.32)],
    ];
    fan(side > 0 ? 4 : 5, base, tip, { sway: side * 0.002 });
    if (plan.pelvic) {
      const p = plan.pelvic;
      const pb = [
        [p.x + 0.012, p.y + 0.004, side * 0.012],
        [p.x, p.y, side * 0.012],
        [p.x - 0.01, p.y + 0.002, side * 0.01],
      ];
      const pt = [
        [p.x - p.length * 0.4, p.y - p.length * 0.35, side * p.length * 0.45],
        [p.x - p.length, p.y - p.length * 0.45, side * p.length * 0.4],
        [p.x - p.length * 0.7, p.y - p.length * 0.15, side * p.length * 0.25],
      ];
      fan(6, pb, pt);
    }
  }
  const finGeometry = fins.finish(true);

  // Eyes go with the opaque body.
  const merged = mergeParts([bodyGeometry, eyeGeometry]);
  return { body: merged, fins: finGeometry, plan };
}

function mergeParts(list) {
  let vertices = 0,
    count = 0;
  for (const g of list) {
    vertices += g.attributes.position.count;
    count += g.index.count;
  }
  const names = ["position", "normal", "uv", "aPart"];
  const arrays = {};
  for (const name of names) arrays[name] = new Float32Array(vertices * list[0].attributes[name].itemSize);
  const index = new Uint32Array(count);
  let v = 0,
    i = 0;
  for (const g of list) {
    for (const name of names) arrays[name].set(g.attributes[name].array, v * g.attributes[name].itemSize);
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k++) index[i + k] = idx[k] + v;
    v += g.attributes.position.count;
    i += idx.length;
  }
  const merged = new THREE.BufferGeometry();
  for (const name of names) merged.setAttribute(name, new THREE.BufferAttribute(arrays[name], list[0].attributes[name].itemSize));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------------------
// Skins. One shader, many coats: every species and every stage of the salmon is a set of
// colours and pattern weights.
export const COATS = {
  alevin: {
    back: [0.3, 0.22, 0.17], flank: [0.46, 0.34, 0.28], belly: [0.55, 0.42, 0.36],
    silver: 0.05, parr: 0, redSpots: 0, blackSpots: 0.25, spotSize: 0.45, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 1, fin: [0.3, 0.26, 0.22], finDark: 0, adipose: [0.3, 0.26, 0.22], iris: [0.3, 0.3, 0.26], yolk: 1,
  },
  fry: {
    back: [0.05, 0.05, 0.028], flank: [0.2, 0.17, 0.1], belly: [0.5, 0.46, 0.38],
    silver: 0.12, parr: 0.85, redSpots: 0.35, blackSpots: 0.25, spotSize: 0.6, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0.5, fin: [0.2, 0.18, 0.13], finDark: 0, adipose: [0.45, 0.22, 0.1], iris: [0.5, 0.42, 0.22], yolk: 0,
  },
  parr: {
    back: [0.035, 0.038, 0.018], flank: [0.24, 0.19, 0.08], belly: [0.62, 0.58, 0.47],
    silver: 0.2, parr: 1, redSpots: 1, blackSpots: 0.6, spotSize: 0.8, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0.15, fin: [0.2, 0.16, 0.09], finDark: 0, adipose: [0.6, 0.22, 0.07], iris: [0.62, 0.48, 0.2], yolk: 0,
  },
  smolt: {
    back: [0.018, 0.035, 0.045], flank: [0.58, 0.6, 0.62], belly: [0.82, 0.82, 0.8],
    silver: 0.9, parr: 0.12, redSpots: 0, blackSpots: 0.3, spotSize: 0.6, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0.05, fin: [0.14, 0.15, 0.16], finDark: 0.85, adipose: [0.12, 0.13, 0.14], iris: [0.7, 0.7, 0.66], yolk: 0,
  },
  sea: {
    back: [0.012, 0.03, 0.055], flank: [0.62, 0.64, 0.68], belly: [0.9, 0.9, 0.88],
    silver: 1, parr: 0, redSpots: 0, blackSpots: 0.75, spotSize: 1.5, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.1, 0.11, 0.13], finDark: 0.7, adipose: [0.08, 0.09, 0.1], iris: [0.75, 0.75, 0.7], yolk: 0,
  },
  spawner: {
    back: [0.05, 0.015, 0.012], flank: [0.4, 0.05, 0.03], belly: [0.34, 0.3, 0.25],
    silver: 0.08, parr: 0, redSpots: 0, blackSpots: 0.45, spotSize: 0.9, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 1, translucent: 0, fin: [0.06, 0.05, 0.04], finDark: 0.3, adipose: [0.2, 0.05, 0.03], iris: [0.7, 0.55, 0.25], yolk: 0,
  },
  trout: {
    back: [0.035, 0.03, 0.012], flank: [0.3, 0.2, 0.06], belly: [0.6, 0.48, 0.22],
    silver: 0.12, parr: 0.12, redSpots: 1, blackSpots: 1, spotSize: 1.55, halo: 0.35, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.22, 0.16, 0.08], finDark: 0, adipose: [0.7, 0.22, 0.06], iris: [0.75, 0.6, 0.2], yolk: 0,
  },
  pike: {
    back: [0.025, 0.04, 0.012], flank: [0.1, 0.14, 0.04], belly: [0.72, 0.7, 0.55],
    silver: 0.05, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 0.3, pikeSpots: 1,
    spawn: 0, translucent: 0, fin: [0.4, 0.18, 0.06], finDark: 0.4, adipose: [0.4, 0.2, 0.06], iris: [0.8, 0.7, 0.2], yolk: 0,
  },
  minnow: {
    back: [0.04, 0.045, 0.022], flank: [0.36, 0.34, 0.22], belly: [0.76, 0.7, 0.55],
    silver: 0.45, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 0.85, pikeSpots: 0,
    spawn: 0, translucent: 0.1, fin: [0.22, 0.2, 0.14], finDark: 0, adipose: [0.3, 0.3, 0.2], iris: [0.8, 0.75, 0.55], yolk: 0,
  },
  herring: {
    back: [0.01, 0.045, 0.07], flank: [0.66, 0.7, 0.74], belly: [0.9, 0.9, 0.9],
    silver: 1, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.2, 0.24, 0.26], finDark: 0.2, adipose: [0.3, 0.3, 0.3], iris: [0.8, 0.8, 0.78], yolk: 0,
  },
  seal: {
    back: [0.06, 0.055, 0.05], flank: [0.16, 0.155, 0.14], belly: [0.34, 0.32, 0.28],
    silver: 0, parr: 0, redSpots: 0, blackSpots: 1, spotSize: 1.6, halo: 0.4, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.05, 0.045, 0.04], finDark: 0, adipose: [0.1, 0.1, 0.1], iris: [0.02, 0.02, 0.02], yolk: 0, fish: 0,
  },
  bullhead: {
    back: [0.06, 0.05, 0.035], flank: [0.17, 0.14, 0.09], belly: [0.42, 0.4, 0.33],
    silver: 0, parr: 0, redSpots: 0, blackSpots: 0.9, spotSize: 1.8, halo: 0, bars: 0.6, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.2, 0.17, 0.12], finDark: 0.2, adipose: [0.2, 0.17, 0.12], iris: [0.6, 0.5, 0.3], yolk: 0,
  },
  perch: {
    back: [0.04, 0.07, 0.03], flank: [0.32, 0.36, 0.11], belly: [0.68, 0.66, 0.52],
    silver: 0.2, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 1, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.45, 0.2, 0.07], finDark: 0.1, adipose: [0.22, 0.24, 0.16], iris: [0.8, 0.62, 0.2], yolk: 0,
  },
  cod: {
    back: [0.11, 0.09, 0.045], flank: [0.28, 0.24, 0.13], belly: [0.68, 0.66, 0.58],
    silver: 0.1, parr: 0, redSpots: 0, blackSpots: 0.7, spotSize: 0.6, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.2, 0.17, 0.1], finDark: 0.2, adipose: [0.2, 0.17, 0.1], iris: [0.7, 0.62, 0.35], yolk: 0,
  },
  otter: {
    back: [0.09, 0.05, 0.02], flank: [0.17, 0.095, 0.04], belly: [0.36, 0.26, 0.15],
    silver: 0, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.07, 0.04, 0.02], finDark: 0, adipose: [0.07, 0.04, 0.02], iris: [0.02, 0.02, 0.02], yolk: 0, fish: 0,
  },
  grayling: {
    back: [0.05, 0.06, 0.07], flank: [0.46, 0.48, 0.5], belly: [0.8, 0.79, 0.74],
    silver: 0.6, parr: 0, redSpots: 0, blackSpots: 0.45, spotSize: 0.7, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.34, 0.12, 0.24], finDark: 0, adipose: [0.3, 0.3, 0.32], iris: [0.75, 0.7, 0.5], yolk: 0,
  },
  eel: {
    back: [0.035, 0.04, 0.018], flank: [0.16, 0.15, 0.07], belly: [0.55, 0.5, 0.3],
    silver: 0.12, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0, fin: [0.1, 0.1, 0.06], finDark: 0, adipose: [0.1, 0.1, 0.06], iris: [0.7, 0.62, 0.3], yolk: 0,
  },
  mackerel: {
    back: [0.02, 0.13, 0.11], flank: [0.62, 0.68, 0.7], belly: [0.93, 0.93, 0.9],
    silver: 0.9, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 0, pikeSpots: 0, waves: 1,
    spawn: 0, translucent: 0, fin: [0.2, 0.25, 0.26], finDark: 0.2, adipose: [0.2, 0.25, 0.26], iris: [0.8, 0.8, 0.75], yolk: 0,
  },
  sandeel: {
    back: [0.04, 0.07, 0.05], flank: [0.62, 0.66, 0.64], belly: [0.88, 0.88, 0.86],
    silver: 0.95, parr: 0, redSpots: 0, blackSpots: 0, spotSize: 1, halo: 0, bars: 0, pikeSpots: 0,
    spawn: 0, translucent: 0.05, fin: [0.3, 0.34, 0.3], finDark: 0, adipose: [0.3, 0.3, 0.3], iris: [0.7, 0.7, 0.66], yolk: 0,
  },
};

for (const coat of Object.values(COATS)) {
  coat.fish ??= 1;
  coat.waves ??= 0;
}
const COAT_KEYS = Object.keys(COATS.parr);
export function coatUniforms(coat) {
  const u = {};
  for (const key of COAT_KEYS) {
    const v = coat[key];
    u[`coat_${key}`] = uniform(Array.isArray(v) ? new THREE.Color(...v) : v);
  }
  u.coat_hump = uniform(0);
  u.coat_kype = uniform(0);
  return u;
}
// Blend two coats into a set of uniforms (for a stage turning into the next).
export function blendCoat(uniforms, a, b, t) {
  for (const key of COAT_KEYS) {
    const u = uniforms[`coat_${key}`];
    const va = a[key],
      vb = b[key];
    if (Array.isArray(va)) u.value.setRGB(va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t);
    else u.value = va + (vb - va) * t;
  }
}

const skinHash = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const skinNoise = (p) => {
  const i = floor(p),
    f = fract(p);
  const w = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(skinHash(i), skinHash(i.add(vec2(1, 0))), w.x), mix(skinHash(i.add(vec2(0, 1))), skinHash(i.add(vec2(1, 1))), w.x), w.y);
};
// Round spots scattered on a jittered grid: (spot, halo).
const spots = (p, density, size, seed) => {
  const cell = floor(p);
  const best = vec2(0).toVar();
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const c = cell.add(vec2(i, j));
      If(skinHash(c.add(seed)).lessThanEqual(density), () => {
        const centre = c.add(0.2).add(vec2(skinHash(c.mul(1.3).add(seed + 1)), skinHash(c.mul(1.7).add(seed + 2))).mul(0.6));
        const r = float(size).mul(skinHash(c.add(seed + 3)).mul(0.45).add(0.55));
        const d = p.sub(centre).length().div(r);
        best.x.assign(max(best.x, smoothstep(0.75, 1, d).oneMinus()));
        best.y.assign(max(best.y, smoothstep(1.2, 1.9, d).oneMinus()));
      });
    }
  return best;
};
const gauss = (x, width) => exp(pow(x.div(width), 2).negate());

// Materials for a coat: the skin, the fins, with the swimming built in. `coat` may be shared
// uniforms (for a fish whose coat changes); otherwise a fresh set is made. `mesh` is the
// body mesh (whose instances the shader places itself, after bending them).
export function createFishMaterials(coat, plan, { uniforms = null } = {}) {
  const u = uniforms ?? coatUniforms(coat);
  u.uMouth = uniform(new THREE.Vector2(plan.mouth.x, plan.mouth.y));
  u.uGill = uniform(plan.gill ?? plan.eye.x - 0.085);
  u.uEye = uniform(new THREE.Vector3(plan.eye.x, plan.eye.y, plan.eye.r));
  const skin = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    metalness: 0.4,
    roughness: 0.32,
    clearcoat: 0.08,
    clearcoatRoughness: 0.25,
    iridescence: 0.45,
    iridescenceIOR: 1.38,
    iridescenceThicknessRange: [200, 420],
  });
  // The fins' see-through membrane is dithered (a share of the pixels left out, differently
  // each frame, for the temporal resolve to average), not blended: the fins of a whole
  // school are one draw, and blended they could not be sorted -- a far fin showed over a
  // near one. Dithered they sit in depth like anything solid, and cast their shadows.
  const fins = new THREE.MeshStandardNodeMaterial({
    color: 0xffffff,
    metalness: 0.05,
    roughness: 0.45,
    alphaHash: true,
    side: THREE.DoubleSide,
  });
  return { skin, fins, uniforms: u, plan };
}

// The shading of a fish, wired to its mesh once the mesh exists (the instances are placed
// by the shader itself, after the fish is reshaped and bent).
function shadeFish(materials, body, membranes) {
  const u = materials.uniforms;
  const instanceMatrix = ownInstanceMatrix(body);
  ownInstanceMatrix(membranes);
  const swim = attribute("aSwim", "vec4");
  const finPhase = attribute("aFinMouth", "vec2").x;
  const partProgress = attribute("aPart", "vec2");
  const part = partProgress.x;
  const finProgress = partProgress.y;
  const finMouth = attribute("aFinMouth", "vec2");
  const mouthOpen = finMouth.y;
  // Handed from the vertex stage to the fragment stage.
  const vSkinPoint = varyingProperty("vec3", "vSkinPoint");
  const vJaw = varyingProperty("vec2", "vJaw");
  const vMouthOpen = varyingProperty("float", "vMouthOpen");
  const vFishScale = varyingProperty("float", "vFishScale");
  const vNormal = varyingProperty("vec3", "vFishNormal");

  // The spawner's hump and hooked jaw, the alevin's shrinking yolk, and the mouth, as changes
  // to the rest shape before the swimming wave bends it; then the bend; then the instance.
  const position = Fn(() => {
    const p = positionGeometry.toVar();
    const n = normalGeometry.toVar();
    vJaw.assign(vec2(0));
    vMouthOpen.assign(0);
    If(part.greaterThan(12.5), () => {
      const centre = vec3(0.12, -0.075, 0);
      const k = mix(0.25, 1, u.coat_yolk);
      p.assign(centre.add(p.sub(centre).mul(k)));
      p.y.addAssign(k.oneMinus().mul(0.05));
    }).Else(() => {
      If(part.lessThan(0.5), () => {
        // The lower jaw swings down about its hinge below the eye; the gill covers flare as
        // the mouth opens, drawing the water (and whatever is in it) in.
        const open = mouthOpen.add(sin(finPhase.mul(0.6)).mul(0.5).add(0.5).mul(0.05)).clamp(0, 1);
        const tipY = u.uMouth.y.mul(0.3);
        const lineY = mix(u.uMouth.y, tipY, p.x.sub(u.uMouth.x).div(max(float(0.35).sub(u.uMouth.x), 0.01)).clamp(0, 1));
        const hinge = vec2(u.uMouth.x.sub(0.01), u.uMouth.y.add(0.002));
        const below = smoothstep(lineY.add(0.003), lineY.sub(0.003), p.y);
        const along = smoothstep(hinge.x.sub(0.004), hinge.x.add(0.012), p.x);
        const angle = open.mul(0.55).mul(below).mul(along);
        const d = p.xy.sub(hinge);
        const c = cos(angle),
          s = sin(angle);
        p.xy.assign(hinge.add(vec2(d.x.mul(c).add(d.y.mul(s)), d.x.negate().mul(s).add(d.y.mul(c)))));
        // The lower jaw's normals turn with it.
        n.xy.assign(vec2(n.x.mul(c).add(n.y.mul(s)), n.x.negate().mul(s).add(n.y.mul(c))));
        const cover = smoothstep(u.uGill.sub(0.02), u.uGill.add(0.005), p.x).mul(smoothstep(u.uGill.add(0.04), u.uGill.add(0.07), p.x).oneMinus());
        p.z.mulAssign(open.mul(cover).mul(0.22).add(1));
        vJaw.assign(vec2(below, along));
        vMouthOpen.assign(open);
      });
      If(u.coat_hump.greaterThan(0).and(p.y.greaterThan(0)), () => {
        p.y.mulAssign(u.coat_hump.mul(0.42).mul(gauss(p.x.sub(0.12), 0.14)).add(1));
      });
      If(u.coat_kype.greaterThan(0), () => {
        const snout = smoothstep(0.24, 0.35, p.x);
        p.x.addAssign(u.coat_kype.mul(0.035).mul(snout));
        // The lower jaw's tip curls up into a hook.
        const hook = smoothstep(0.3, 0.38, p.x);
        p.y.addAssign(select(p.y.lessThan(0), u.coat_kype.mul(0.03).mul(hook), u.coat_kype.mul(-0.012).mul(hook)));
      });
    });
    vSkinPoint.assign(p);
    const bent = bendSpine(finMotion(p, { swim, finPhase, part, finProgress }), n, swim);
    const placed = instanceMatrix.mul(vec4(bent.position, 1));
    const world = modelWorldMatrix.mul(instanceMatrix);
    vFishScale.assign(world.mul(vec4(1, 0, 0, 0)).xyz.length());
    vNormal.assign(cameraViewMatrix.mul(world.mul(vec4(bent.normal, 0))).xyz);
    return placed.xyz;
  })();

  // What the colour pass works out and the lighting reads.
  const gThrough = property("vec3", "fishThrough");
  const gSilver = property("float", "fishSilver");
  const gRelief = property("float", "fishRelief");
  const gScaleRough = property("float", "fishScaleRough");
  const gTilt = property("vec2", "fishTilt");
  const gAlpha = property("float", "fishAlpha");
  const gEnv = property("float", "fishEnv");
  const fishUV = uv();

  const color = Fn(() => {
    gThrough.assign(vec3(0));
    gSilver.assign(0);
    gRelief.assign(0);
    gScaleRough.assign(0);
    gTilt.assign(vec2(0));
    gAlpha.assign(1);
    gEnv.assign(1);
    const x = vSkinPoint.x,
      y = vSkinPoint.y;
    const band = fishUV.y.clamp(0, 1);
    const along = fishUV.x;
    const head = smoothstep(0.17, 0.21, x);
    const skin = vec3(0).toVar();
    If(part.lessThan(0.5), () => {
      // Countershading. The arc runs round the section, so the back's share of it looks
      // small from the side: the dark reaches a third of the way down the flank.
      const backLine = sin(x.mul(40)).mul(0.03).mul(head.oneMinus()).add(0.36);
      skin.assign(mix(u.coat_back, u.coat_flank, smoothstep(backLine.sub(0.1), backLine.add(0.08), band)));
      skin.assign(mix(skin, u.coat_belly, smoothstep(0.62, 0.8, band)));
      // Nothing alive is one flat colour: a faint mottling, darker freckles over the back.
      const mottle = skinNoise(vec2(along.mul(26), band.mul(8))).mul(0.6).add(skinNoise(vec2(along.mul(70), band.mul(20))).mul(0.4));
      skin.mulAssign(mix(1, mottle.mul(0.28).add(0.86), u.coat_fish));
      // The lateral line: a dotted row of pores down the flank.
      const lateral = gauss(band.sub(mix(0.47, 0.42, smoothstep(-0.25, 0.2, x))), 0.012)
        .mul(head.oneMinus())
        .mul(smoothstep(0.2, 0.5, abs(fract(along.mul(120)).sub(0.5))).mul(0.45).add(0.55));
      skin.mulAssign(lateral.mul(0.2).mul(u.coat_fish).oneMinus());
      // Scales: small, overlapping, each a slightly different mirror. Their rounded free
      // edges catch the light one by one, which is most of what makes a fish look wet.
      const gy = band.mul(36).add(sin(along.mul(120 * 0.4)).mul(0.15));
      const gx = along.mul(120).add(mod(floor(gy), 2).mul(0.5)).add(gy.mul(0.18));
      const grid = vec2(gx, gy);
      const fade = smoothstep(0.35, 1, max(fwidth(grid.x), fwidth(grid.y))).oneMinus();
      const cell = fract(grid).sub(0.5);
      const scaleMask = fade.mul(head.oneMinus()).mul(u.coat_fish).mul(smoothstep(-0.29, -0.25, x));
      // Each scale shows only its rounded free edge, overlapping the one behind it: arcs
      // convex toward the tail, a dark line under each edge, the exposed field paler.
      const arc = vec2(cell.x.add(0.3), cell.y.mul(1.3)).length();
      const edgeLine = gauss(arc.sub(0.72), 0.05);
      const exposed = step(arc, 0.72);
      const scaleId = floor(grid).add(vec2(exposed.oneMinus(), 0));
      skin.mulAssign(edgeLine.mul(0.2).mul(scaleMask).oneMinus());
      skin.mulAssign(scaleMask.mul(smoothstep(0.2, 0.7, arc)).mul(exposed).mul(0.07).add(1));
      gRelief.assign(smoothstep(0, 0.7, arc).mul(exposed).mul(scaleMask));
      gScaleRough.assign(skinHash(scaleId).mul(scaleMask));
      gTilt.assign(vec2(skinHash(scaleId.add(11)), skinHash(scaleId.add(23))).sub(0.5).mul(vec2(0.3, 0.2)).mul(scaleMask));
      // Fine dark freckles over the back, fading out down the flank.
      const fg = vec2(along.mul(150), band.mul(44));
      const freckle = step(0.9, skinHash(floor(fg)))
        .mul(smoothstep(0.2, 0.42, band).oneMinus())
        .mul(smoothstep(0.35, 1, max(fwidth(fg.x), fwidth(fg.y))).oneMinus());
      skin.mulAssign(freckle.mul(0.45).mul(u.coat_fish).oneMinus());
      // Parr marks: a row of dusky thumbprints along the flank.
      If(u.coat_parr.greaterThan(0.01), () => {
        const k = float(0.2).sub(x).div(0.052);
        const index = floor(k.add(0.5));
        const dx = k.sub(index).mul(0.052);
        const mark = exp(pow(dx.div(0.014), 2).negate().sub(pow(band.sub(0.46).div(0.13), 2)))
          .mul(step(0, index))
          .mul(step(index, 9))
          .mul(head.oneMinus());
        skin.assign(mix(skin, vec3(0.1, 0.11, 0.13), mark.mul(u.coat_parr).mul(0.75)));
      });
      // Vertical bars (minnows, pike).
      If(u.coat_bars.greaterThan(0.01), () => {
        const b = sin(x.mul(110).add(skinNoise(vec2(x.mul(30), band.mul(4))).mul(2.5)));
        const bar = smoothstep(0.4, 0.9, b).mul(smoothstep(0.1, 0.3, band)).mul(smoothstep(0.6, 0.75, band).oneMinus()).mul(head.oneMinus());
        skin.assign(mix(skin, skin.mul(0.35), bar.mul(u.coat_bars)));
      });
      // Mackerel: wavy black bars over the back, down to the lateral line.
      If(u.coat_waves.greaterThan(0.01), () => {
        const w = sin(x.mul(150).add(sin(band.mul(16).add(x.mul(24))).mul(1.8)));
        const stripe = smoothstep(0.35, 0.85, w).mul(smoothstep(0.26, 0.4, band).oneMinus()).mul(head.oneMinus());
        skin.assign(mix(skin, vec3(0.01, 0.02, 0.02), stripe.mul(u.coat_waves)));
      });
      // Pike: rows of pale bean-shaped spots on green.
      If(u.coat_pikeSpots.greaterThan(0.01), () => {
        const sp = spots(vec2(along.mul(55), band.mul(14)), 0.85, 0.42, 7);
        skin.assign(mix(skin, vec3(0.62, 0.6, 0.32), sp.x.mul(u.coat_pikeSpots).mul(smoothstep(0.1, 0.3, band)).mul(smoothstep(0.7, 0.8, band).oneMinus())));
      });
      // Black spots above the lateral line and on the gill cover; red spots along it.
      If(u.coat_blackSpots.greaterThan(0.01), () => {
        const sp = spots(vec2(along.mul(46), band.mul(13)), u.coat_blackSpots.mul(0.42).add(0.1), u.coat_spotSize.mul(0.22), 1);
        const where = mix(smoothstep(0.6, 0.9, band).mul(-0.6).add(1), smoothstep(0.38, 0.55, band).oneMinus().mul(smoothstep(-0.26, -0.12, x)), u.coat_fish);
        skin.assign(mix(skin, mix(skin, vec3(0.7, 0.66, 0.55), 0.3), sp.y.mul(u.coat_halo).mul(where)));
        skin.assign(mix(skin, vec3(0.03, 0.028, 0.03), sp.x.mul(where).mul(min(1, u.coat_blackSpots.mul(1.3)))));
      });
      If(u.coat_redSpots.greaterThan(0.01), () => {
        const sp = spots(vec2(along.mul(40), band.mul(11)), 0.5, u.coat_spotSize.mul(0.2), 5);
        const where = gauss(band.sub(0.5), 0.12).mul(head.oneMinus()).mul(smoothstep(-0.27, -0.15, x));
        skin.assign(mix(skin, mix(skin, vec3(0.7, 0.64, 0.55), 0.3), sp.y.mul(u.coat_halo).mul(where)));
        skin.assign(mix(skin, vec3(0.62, 0.08, 0.04), sp.x.mul(where).mul(u.coat_redSpots)));
      });
      // The spawning dress: a crimson body, the head turned olive-green, the jaw pale.
      If(u.coat_spawn.greaterThan(0.01), () => {
        const blotch = skinNoise(vec2(along.mul(9), band.mul(3))).mul(0.6).add(skinNoise(vec2(along.mul(26), band.mul(7))).mul(0.4));
        const mottle = blotch.mul(0.5).add(0.72);
        const red = mix(vec3(0.07, 0.03, 0.018), vec3(0.4, 0.06, 0.035), smoothstep(0.2, 0.5, band)).mul(mottle).toVar();
        red.assign(mix(red, vec3(0.26, 0.12, 0.05), smoothstep(0.62, 0.8, blotch).mul(0.5).mul(smoothstep(0.25, 0.5, band))));
        red.assign(mix(red, vec3(0.3, 0.26, 0.22), smoothstep(0.7, 0.92, band)));
        const green = mix(vec3(0.02, 0.032, 0.014), vec3(0.075, 0.1, 0.045), smoothstep(0.2, 0.7, band)).mul(blotch.mul(0.3).add(0.85));
        const ragged = skinNoise(vec2(band.mul(14), 3)).sub(0.5).mul(0.03);
        const dress = mix(red, green, smoothstep(u.uGill.sub(0.03).add(ragged), u.uGill.add(0.03).add(ragged), x)).toVar();
        dress.assign(mix(dress, vec3(0.5, 0.48, 0.4), smoothstep(0.3, 0.34, x).mul(smoothstep(0.55, 0.75, band))));
        skin.assign(mix(skin, dress, u.coat_spawn));
        // Its dark spots and freckles show through the dress.
        const sp = spots(vec2(along.mul(46), band.mul(13)), 0.35, 0.2, 9);
        skin.assign(mix(skin, skin.mul(0.25), sp.x.mul(u.coat_spawn).mul(smoothstep(0.45, 0.6, band).oneMinus())));
      });
      // Head: the gill cover's edge and the mouth. The gill cover: a bony plate whose free
      // edge bows back at mid-height, a shade darker in the groove behind it.
      const bow = pow(band.mul(2).sub(1), 2).oneMinus();
      const opercle = u.uGill.add(bow.mul(0.028)).sub(0.01);
      const gillEdge = gauss(x.sub(opercle), 0.0035).mul(smoothstep(0.18, 0.3, band)).mul(smoothstep(0.86, 0.96, band).oneMinus());
      const plate = smoothstep(opercle.sub(0.004), opercle.add(0.004), x)
        .mul(smoothstep(opercle.add(0.05), opercle.add(0.07), x).oneMinus())
        .mul(smoothstep(0.25, 0.4, band))
        .mul(smoothstep(0.8, 0.9, band).oneMinus());
      skin.mulAssign(gillEdge.mul(0.28).mul(u.coat_fish).oneMinus());
      skin.assign(mix(skin, skin.mul(1.12).add(0.02), plate.mul(0.4).mul(u.coat_fish)));
      const mouthLine = gauss(y.sub(u.uMouth.y).add(u.uMouth.x.sub(x).mul(0.05)), 0.003).mul(smoothstep(u.uMouth.x.sub(0.01), u.uMouth.x.add(0.01), x));
      skin.assign(mix(skin, vec3(0.04, 0.03, 0.03), mouthLine.mul(0.8)));
      // The eye sits in a socket: a ring of darker skin round it, so it reads as set in.
      const socket = vec2(x.sub(u.uEye.x), y.sub(u.uEye.y).mul(1.1)).length().div(u.uEye.z);
      skin.mulAssign(mix(1, 0.6, gauss(socket.sub(1.2), 0.3).mul(u.coat_fish).mul(step(0.12, band)).mul(step(band, 0.88))));
      // The upper jawbone, the maxilla, running back from the snout to below the eye; and the
      // curved groove of the preopercle in front of the gill cover.
      const jawEnd = u.uEye.x.sub(u.uEye.z.mul(0.4));
      const jawT = float(0.35).sub(x).div(max(float(0.35).sub(jawEnd), 0.01)).clamp(0, 1);
      const jawY = mix(u.uMouth.y.add(0.003), u.uEye.y.sub(u.uEye.z.mul(1.65)), jawT);
      const sides = smoothstep(0.18, 0.3, band).mul(smoothstep(0.78, 0.9, band).oneMinus());
      const maxilla = gauss(y.sub(jawY), 0.0024).mul(step(jawEnd, x)).mul(sides);
      const maxillaPlate = smoothstep(jawY.sub(0.012), jawY.sub(0.002), y)
        .mul(smoothstep(jawY.sub(0.001), jawY.add(0.001), y).oneMinus())
        .mul(step(jawEnd, x))
        .mul(sides);
      skin.mulAssign(maxilla.mul(0.4).mul(u.coat_fish).oneMinus());
      skin.assign(mix(skin, skin.mul(1.1).add(0.01), maxillaPlate.mul(0.35).mul(u.coat_fish)));
      const preopercle = gauss(x.sub(u.uGill.add(0.045).add(bow.mul(0.018))), 0.0028).mul(smoothstep(0.35, 0.5, band)).mul(smoothstep(0.82, 0.92, band).oneMinus());
      skin.mulAssign(preopercle.mul(0.18).mul(u.coat_fish).oneMinus());
      // Inside the open mouth: the seam of the lips pulled apart shows the dark red throat.
      const inside = smoothstep(0.02, 0.09, vJaw.x)
        .mul(smoothstep(0.91, 0.98, vJaw.x).oneMinus())
        .mul(smoothstep(0.1, 0.6, vJaw.y))
        .mul(smoothstep(0.06, 0.25, vMouthOpen));
      const throat = smoothstep(0.1, 0.45, vJaw.x).mul(smoothstep(0.55, 0.9, vJaw.x).oneMinus());
      skin.assign(mix(skin, mix(vec3(0.075, 0.022, 0.022), vec3(0.012, 0.005, 0.006), throat), inside));
      // How silver: the guanine flank, patchy where the scales lie at different angles, with
      // a faint violet-pink sheen along the lateral line.
      const silverPatch = skinNoise(vec2(along.mul(18), band.mul(5))).mul(0.4).add(0.8);
      gSilver.assign(u.coat_silver.mul(smoothstep(0.3, 0.46, band)).mul(smoothstep(0.88, 1, band).oneMinus()).mul(min(1, silverPatch)).mul(inside.oneMinus()));
      // Fur (an otter, a seal) mirrors little of the water round it.
      gEnv.assign(inside.mul(-0.9).add(1).mul(mix(0.2, 1, u.coat_fish)));
      skin.assign(mix(skin, skin.mul(0.55).add(vec3(0.32, 0.34, 0.36).mul(silverPatch)), gSilver.mul(0.4)));
      skin.addAssign(vec3(0.05, 0.01, 0.06).mul(gauss(band.sub(0.46), 0.06)).mul(u.coat_silver).mul(head.oneMinus()).mul(u.coat_fish));
      // The top of the head dark, like the back.
      skin.assign(mix(skin, u.coat_back.mul(1.2), head.mul(smoothstep(0.12, 0.3, band).oneMinus()).mul(u.coat_fish).mul(u.coat_spawn.oneMinus())));
      // Young fish pass light: warm through the thin tail and fins, pink round the gills. The
      // path through the body in millimetres: a small fish passes light, a big one hardly.
      const thin = max(abs(vSkinPoint.z).mul(2), 0.006).mul(vFishScale).mul(100);
      // (What comes through has passed the pigment on its way: a dark back and the parr
      // marks let little by, the pale belly much.)
      const pigment = skin.mul(2.4).clamp(0, 1);
      gThrough.assign(
        exp(vec3(0.55, 1.35, 1.75).mul(thin).negate())
          .mul(exp(thin.mul(-2.6)).oneMinus())
          .mul(u.coat_translucent.mul(1.4).add(0.35))
          .mul(pigment)
          .add(vec3(0.25, 0.06, 0.04).mul(gauss(x.sub(0.2), 0.03)).mul(u.coat_translucent)),
      );
      skin.assign(mix(skin, skin.mul(0.6).add(vec3(0.2, 0.14, 0.11)), u.coat_translucent.mul(0.4)));
    })
      .ElseIf(part.greaterThan(12.5), () => {
        // The yolk: orange, oil droplets in it, glowing where the light comes through.
        const drop = step(0.8, skinNoise(fishUV.mul(vec2(12, 8))));
        skin.assign(mix(vec3(0.85, 0.32, 0.08), vec3(1, 0.62, 0.2), drop));
        gThrough.assign(vec3(0.9, 0.35, 0.08).mul(0.9));
      })
      .ElseIf(part.greaterThan(6.5).and(part.lessThan(7.5)), () => {
        // The eye: a big black pupil, a narrow iris of gold or silver threads that darkens
        // outward, a dark rim where it meets the skin; the cornea over it wet and glinting.
        const r = fishUV.y;
        const fibre = sin(fishUV.x.mul(96).add(skinNoise(fishUV.mul(vec2(40, 7))).mul(3))).mul(0.28).add(0.72);
        const iris = u.coat_iris.mul(0.32).mul(fibre).mul(mix(1.2, 0.45, smoothstep(0.52, 0.86, r))).add(vec3(0.06, 0.045, 0.012).mul(gauss(r.sub(0.55), 0.03)));
        const rim = mix(vec3(0.02, 0.02, 0.018), u.coat_back.mul(0.6), smoothstep(0.86, 1, r));
        skin.assign(select(r.lessThan(0.52), vec3(0.002, 0.003, 0.004), select(r.lessThan(0.86), iris, rim)));
        gEnv.assign(0.9);
      })
      .Else(() => {
        // Fins: a clear membrane stretched on darker rays, clearer toward the edge.
        const span = fishUV.y.clamp(0, 1);
        const rays = 16;
        const rayWidth = max(fwidth(fishUV.x.mul(rays)), 0);
        const ray = max(
          pow(cos(fishUV.x.mul(Math.PI * 2 * rays)).mul(0.5).add(0.5), 10).mul(smoothstep(0.3, 1, rayWidth).oneMinus()),
          // The rays branch toward the tips, so there are twice as many out there.
          pow(cos(fishUV.x.mul(Math.PI * 2 * rays * 2).add(3.14159)).mul(0.5).add(0.5), 14)
            .mul(smoothstep(0.55, 0.8, span))
            .mul(smoothstep(0.3, 1, rayWidth.mul(2)).oneMinus())
            .mul(0.8),
        );
        const membrane = u.coat_fin.mul(1.15).add(0.02);
        const rayColor = u.coat_fin.mul(0.55);
        skin.assign(mix(membrane, rayColor, ray).mul(span.mul(0.3).add(0.85)));
        gAlpha.assign(mix(0.68, 0.97, ray).mul(mix(1, 0.86, span)));
        gEnv.assign(0.35);
        If(part.greaterThan(11.5), () => {
          skin.assign(u.coat_adipose);
          gAlpha.assign(1);
        });
        // Dark margins: the smolt's and the sea salmon's black-edged tail.
        const margin = smoothstep(0.7, 0.95, span).mul(u.coat_finDark).mul(select(part.lessThan(1.5), float(1), float(0.5)));
        skin.assign(mix(skin, vec3(0.03, 0.03, 0.035), margin));
        // Pike fins: dark blotches on red.
        If(u.coat_pikeSpots.greaterThan(0.01), () => {
          skin.assign(mix(skin, vec3(0.08, 0.06, 0.04), step(0.72, skinNoise(fishUV.mul(vec2(20, 8)))).mul(u.coat_pikeSpots).mul(0.7)));
        });
        // A fin membrane passes light almost unchanged, a little warm; darker fins pass less.
        gThrough.assign(
          exp(vec3(1, 1.25, 1.5).mul(dot(u.coat_fin, vec3(0.33)).oneMinus().mul(2).add(0.6)).negate())
            .mul(0.35)
            .mul(margin.oneMinus()),
        );
        gAlpha.assign(mix(gAlpha, 0.95, margin));
      });
    return vec4(skin, gAlpha);
  })();

  // The shading normal: the bent normal, then (on the body) the scales' relief from the
  // change of their height across the pixel, and each scale tilted a little its own way.
  const normal = Fn(() => {
    const N = normalize(vNormal).mul(faceDirection).toVar();
    If(part.lessThan(0.5), () => {
      const relief = gRelief.mul(0.0005).mul(vFishScale).mul(gSilver.add(0.6));
      const dx = dFdx(positionView),
        dy = dFdy(positionView);
      const rx = cross(dy, N),
        ry = cross(N, dx);
      const determinant = dot(dx, rx);
      const gradient = sign(determinant).mul(dFdx(relief)).mul(rx).add(sign(determinant).mul(dFdy(relief)).mul(ry));
      const perturbed = abs(determinant).mul(N).sub(gradient);
      If(dot(perturbed, perturbed).greaterThan(1e-20), () => {
      N.assign(normalize(perturbed));
    });
      const duv1 = dFdx(fishUV),
        duv2 = dFdy(fishUV);
      const dp2perp = cross(dy, N),
        dp1perp = cross(N, dx);
      const skinT = dp2perp.mul(duv1.x).add(dp1perp.mul(duv2.x));
      const skinB = dp2perp.mul(duv1.y).add(dp1perp.mul(duv2.y));
      const frameScale = inverseSqrt(max(max(dot(skinT, skinT), dot(skinB, skinB)), 1e-30));
      N.assign(normalize(N.add(skinT.mul(gTilt.x).add(skinB.mul(gTilt.y)).mul(frameScale))));
    });
    return N;
  })();

  const metalness = select(part.lessThan(0.5), gSilver.mul(gScaleRough.mul(0.3).add(0.85)).mul(0.62).add(0.04).clamp(0, 0.75), select(part.greaterThan(6.5).and(part.lessThan(7.5)), float(0.3), float(0.03)));
  const roughness = select(
    part.lessThan(0.5),
    mix(0.6, mix(0.36, 0.16, gSilver).add(gScaleRough.sub(0.5).mul(0.14)), u.coat_fish),
    select(part.greaterThan(6.5).and(part.lessThan(7.5)), float(0.05), float(0.4)),
  );

  // Light through the skin: a young fish and a fin pass the light that falls on their far
  // side, and the sky's light from all round shows through them.
  const lighting = {
    // (The fish mirror the water in their own way, below.)
    mirror: 0,
    perLight: ({ lightDirection, lightColor, reflectedLight }) => {
      const enter = max(0, dot(normalView, lightDirection).negate());
      const through = normalize(lightDirection.add(normalView.mul(0.22)));
      const lobe = pow(max(dot(positionViewDirection, through.negate()), 0), 2).add(0.35);
      reflectedLight.directDiffuse.addAssign(lightColor.mul(gThrough).mul(enter).mul(lobe).mul(2 / Math.PI));
    },
    // Under water a fish mirrors the water round it: bright toward the lit surface and the
    // window of sky straight up, dim and blue-green toward the bed. This is what makes a
    // silver flank look silver rather than grey.
    beforeIndirect: ({ radiance }) => {
      const reflectView = reflect(positionViewDirection.negate(), normalView);
      const reflectWorld = normalize(cameraViewMatrix.transpose().mul(vec4(reflectView, 0)).xyz);
      const surroundings = underwaterInscatter(reflectWorld).mul(1.25).add(fogNodes().color.mul(3.5).mul(smoothstep(0.6, 0.97, reflectWorld.y)));
      radiance.addAssign(surroundings.mul(gEnv));
    },
    afterIndirect: ({ irradiance, iblIrradiance, reflectedLight }) => {
      reflectedLight.indirectDiffuse.addAssign(irradiance.add(iblIrradiance).mul(gThrough).mul(0.55 / Math.PI));
    },
  };

  for (const material of [materials.skin, materials.fins]) {
    material.positionNode = position;
    material.colorNode = color.rgb;
    material.opacityNode = color.a;
    material.normalNode = normal;
    material.metalnessNode = metalness;
    material.roughnessNode = roughness;
    waterLit(material, lighting);
  }
  // Thin-film colour and the slime's gloss only on the silvered flank.
  materials.skin.iridescenceNode = gSilver.mul(0.45);
  materials.skin.clearcoatNode = gSilver.mul(0.7).add(0.3).mul(u.coat_fish).mul(0.08);
}

// A fish mesh (instanced) of a kind in a coat, with the swimming attributes wired up.
//
// For a crowd (a shoal, a kind of hunter) the slots are fixed, one per animal, but only the
// animals about are drawn: begin() blanks every slot, each animal writes its own, and
// finish() packs the written ones to the front and draws just those -- a sea shoal far off
// in the brook costs nothing.
export function createFishMesh(scene, kind, coat, count, { name = kind, castShadow = true, uniforms = null, cacheKey = kind, detail = 1 } = {}) {
  const geometry = makeFish(kind, { detail });
  const swim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  swim.setUsage(THREE.DynamicDrawUsage);
  // Each fish's fin beat and how far its mouth is open, in one buffer (fin.setX, mouth.setX).
  const finMouth = new THREE.InstancedInterleavedBuffer(new Float32Array(count * 2), 2, 1);
  finMouth.setUsage(THREE.DynamicDrawUsage);
  const fin = new THREE.InterleavedBufferAttribute(finMouth, 1, 0);
  const mouth = new THREE.InterleavedBufferAttribute(finMouth, 1, 1);
  for (const part of [geometry.body, geometry.fins]) {
    part.setAttribute("aSwim", swim);
    part.setAttribute("aFinMouth", new THREE.InterleavedBufferAttribute(finMouth, 2, 0));
  }
  const materials = createFishMaterials(COATS[coat] ?? coat, geometry.plan, { uniforms });
  const body = new THREE.InstancedMesh(geometry.body, materials.skin, count);
  const membranes = new THREE.InstancedMesh(geometry.fins, materials.fins, count);
  // Body and fins always move together: one set of matrices for both.
  membranes.instanceMatrix = body.instanceMatrix;
  shadeFish(materials, body, membranes);
  body.name = name;
  membranes.name = `${name} fins`;
  body.castShadow = membranes.castShadow = castShadow;
  body.receiveShadow = true;
  for (const mesh of [body, membranes]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  }
  const matrices = body.instanceMatrix.array;
  return {
    body,
    membranes,
    swim,
    fin,
    mouth,
    materials,
    geometry,
    count,
    begin() {
      matrices.fill(0);
    },
    finish() {
      let w = 0;
      for (let i = 0; i < count; i++) {
        const o = i * 16;
        if (matrices[o] === 0 && matrices[o + 1] === 0 && matrices[o + 2] === 0) continue;
        if (w !== i) {
          matrices.copyWithin(w * 16, o, o + 16);
          swim.array.copyWithin(w * 4, i * 4, i * 4 + 4);
          finMouth.array.copyWithin(w * 2, i * 2, i * 2 + 2);
        }
        w++;
      }
      body.count = membranes.count = w;
      body.visible = membranes.visible = w > 0;
      for (const [attribute, size] of [
        [body.instanceMatrix, 16],
        [swim, 4],
        [finMouth, 2],
      ]) {
        attribute.clearUpdateRanges();
        if (w > 0) attribute.addUpdateRange(0, w * size);
        attribute.needsUpdate = true;
      }
    },
  };
}
