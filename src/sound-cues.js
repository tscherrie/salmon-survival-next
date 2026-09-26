// The cues: short sounds that tell the player something (a burst of speed, the jaws, no
// breath left, a hunter coming, a heart beating, a stage of life), made ahead like the rest
// (src/sound-make.js) and played by src/sound.js. Each is pitched and shaped so that a
// phone's small speaker still plays it: whatever is low in them has a part in 250-900 Hz.

import { RATE, fadeOut, hiss, mono, random, ring, tone } from "./sound-make.js";

// ---- What the fish does.

// A burst of speed: the water shoved aside, a soft "whump" gliding from 600 down to 200 Hz,
// with the rush of it in the same band.
export function makeWhump() {
  const d = mono(0.45);
  tone(d, 0, random(560, 640), random(190, 215), 0.03, 0.06, 0.8, 0.004);
  hiss(d, 0, "bandpass", random(320, 380), 0.9, 0.05, 0.55, 0.006);
  return [fadeOut(d)];
}
// The jaws snapping shut: a hard tick high up (2.4 kHz), the knock of the bone under it
// (420 Hz) and a spit of noise.
export function makeJaws() {
  const d = mono(0.12);
  ring(d, 0, random(2200, 2600), 0.004, 0.5);
  ring(d, 0, random(390, 450), 0.012, 0.8);
  hiss(d, 0, "bandpass", random(2300, 2700), 1, 0.003, 0.5);
  return [fadeOut(d, 0.01)];
}
// No breath left for a burst: a dull, short thud (led by 330 Hz, so a phone has it).
// `low` lowers it all for the heavier thud of a leap that fell short.
export function makeDenied(low = 1) {
  const d = mono(0.45 / low);
  ring(d, 0, random(105, 115) * low, 0.05 / low, 0.35);
  ring(d, 0, random(315, 345) * low, 0.025 / low, 0.8);
  hiss(d, 0, "bandpass", 480 * low, 0.75, 0.02 / low, 0.2);
  if (low < 1) ring(d, 0, 70, 0.12, 0.5);
  return [fadeOut(d)];
}
// Out of breath: a gasp drawn in (700-1800 Hz, swelling, then cut off).
export function makeGasp() {
  const d = mono(0.5);
  hiss(d, 0, "bandpass", random(1000, 1250), 1, 0.05, 0.6, random(0.2, 0.26));
  return [fadeOut(d)];
}
// The gills working hard, for as long as the fish is winded: breathy noise (500-1500 Hz)
// pulsing seven times a second. 2.25 s, looped from 0.25 s: its end is faded into its start,
// and the pulse falls the same at both (a whole number of pulses between).
export function makeGills() {
  const length = Math.floor(2.25 * RATE),
    fade = Math.floor(0.25 * RATE);
  const d = new Float32Array(length);
  hiss(d, 0, "bandpass", 866, 0.87, 100, 1, 0.001);
  for (let i = 0; i < length; i++) {
    const pulse = 0.5 - 0.5 * Math.cos((2 * Math.PI * 7 * i) / RATE);
    d[i] *= 0.2 + 0.8 * Math.pow(pulse, 1.5);
  }
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[length - fade + i] = d[length - fade + i] * (1 - t) + d[i] * t;
  }
  return [d];
}
// The tick of the leap's sweet spot: two small rings, 1.1 and 3.3 kHz.
export function makeTick() {
  const d = mono(0.06);
  ring(d, 0, random(1080, 1120), 0.006, 0.6);
  ring(d, 0, random(3250, 3350), 0.006, 0.3);
  return [fadeOut(d, 0.01)];
}
// A bell of a few partials (1, 2.01, 3.02 of `f`), added at `at`.
export function bell(data, at, f, tau, amp, partials = [1, 0.3, 0.1]) {
  const ratios = [1, 2.01, 3.02, 4.1];
  partials.forEach((a, i) => ring(data, at, f * ratios[i], tau / (1 + 0.6 * i), amp * a));
}
// A fall cleared: three quick bell notes up, G5 C6 E6 -- small and bright, not the stage
// fanfare.
export function makeCleared() {
  const d = mono(0.8);
  bell(d, 0, 783.99, 0.18, 0.5);
  bell(d, 0.06, 1046.5, 0.18, 0.5);
  bell(d, 0.12, 1318.5, 0.3, 0.55);
  return [fadeOut(d, 0.1)];
}

// All of them, a slice at a time (see createWorkshop in src/sound-make.js).
export function* makeCues(raw) {
  const many = (count, make) => Array.from({ length: count }, make);
  raw.whump = many(3, makeWhump);
  raw.jaws = many(4, makeJaws);
  yield;
  raw.denied = many(3, () => makeDenied());
  raw.thud = many(2, () => makeDenied(0.7));
  raw.gasp = many(2, makeGasp);
  yield;
  raw.gills = [makeGills()];
  yield;
  raw.tick = many(2, makeTick);
  raw.cleared = [makeCleared()];
  yield;
}
