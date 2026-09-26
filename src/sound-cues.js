// The cues: short sounds that tell the player something (a burst of speed, the jaws, no
// breath left, a hunter coming, a heart beating, a stage of life), made ahead like the rest
// (src/sound-make.js) and played by src/sound.js. Each is pitched and shaped so that a
// phone's small speaker still plays it: whatever is low in them has a part in 250-900 Hz.

import { RATE, biquad, fadeOut, half, hiss, mono, random, ring, tone, white } from "./sound-make.js";

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
// A fall cleared: three quick bell notes up, G5 C6 E6 -- small and bright, not the stage
// fanfare.
export function makeCleared() {
  const d = mono(0.8);
  const partials = [
    [1, 0.5],
    [2.01, 0.15],
    [3.02, 0.05],
  ];
  note(d, null, 0, 783.99, 0.9, partials);
  note(d, null, 0.06, 1046.5, 0.9, partials);
  note(d, null, 0.12, 1318.5, 1.5, partials);
  return [fadeOut(d, 0.1)];
}

// ---- Hunters coming, and the fish's heart.

// Noise in a band shaped by `envelope(t)` (0..1 over `seconds`), added at `at`.
function shaped(data, at, centre, q, seconds, amp, envelope) {
  const band = biquad("bandpass", centre, q);
  const start = Math.floor(at * RATE);
  const n = Math.min(data.length - start, Math.floor(seconds * RATE));
  for (let i = 0; i < n; i++) data[start + i] += amp * envelope(i / RATE / seconds) * band.run(white());
}
// Noticed: a soft swell of pressure, as of something large moving in the water, 220-700 Hz
// (a phone plays most of it), rising and falling over 0.6 s.
export function makeSwell() {
  const d = mono(0.65);
  shaped(d, 0, random(370, 420), 0.8, 0.6, 0.7, (u) => Math.pow(Math.sin(Math.PI * u), 2));
  return [fadeOut(d)];
}
// Hunted: a pulse of pressure (200-500 Hz and a low knock at 230 Hz), coming faster the
// closer the hunter is to striking.
export function makePulse() {
  const d = mono(0.22);
  shaped(d, 0, random(300, 340), 0.9, 0.18, 0.6, (u) => Math.min(1, u / 0.12) * Math.pow(1 - u, 2));
  ring(d, 0.01, random(220, 240), 0.03, 0.6);
  return [fadeOut(d)];
}
// About to strike (coiled): seven ticks, faster and higher (1.2 to 2.4 kHz) -- the cue to
// dodge.
export function makeCoil() {
  const d = mono(0.4);
  for (let k = 0; k < 7; k++) ring(d, 0.32 * (1 - Math.pow(1 - k / 6, 1.6)), 1200 * Math.pow(2, k / 6) * random(0.98, 1.02), 0.006, 0.6 + 0.06 * k);
  return [fadeOut(d, 0.02)];
}
// A heartbeat: lub (55 Hz) and dub (48 Hz) 0.14 s later, each with a click (180 Hz) and the
// valve's knock (560 and 470 Hz) -- without which a phone would hear nothing of it.
export function makeHeart() {
  const d = mono(0.55);
  ring(d, 0, random(53, 57), 0.07, 0.5);
  ring(d, 0.14, random(46, 50), 0.08, 0.4);
  ring(d, 0, 180, 0.012, 0.35);
  ring(d, 0.14, 180, 0.012, 0.25);
  ring(d, 0, random(540, 580), 0.02, 1, 0.8);
  ring(d, 0.14, random(455, 485), 0.02, 0.7, 0.8);
  return [fadeOut(d)];
}

// ---- The hunters' own voices, each after its kind (all brought to the same peak; how loud
// each is heard is set where it is played).

function normalize(data, peak = 0.8) {
  let top = 1e-9;
  for (let i = 0; i < data.length; i++) top = Math.max(top, Math.abs(data[i]));
  for (let i = 0; i < data.length; i++) data[i] *= peak / top;
  return data;
}
// The kingfisher: its thin, piercing whistle, two notes (or three), each rising 3.6 to 4.3 kHz.
export function makeKingfisher(notes = 2) {
  const d = mono(0.16 * notes + 0.05);
  for (let k = 0; k < notes; k++) {
    const start = Math.floor(k * 0.16 * RATE),
      f0 = random(3500, 3700),
      f1 = f0 * random(1.17, 1.21);
    let phase = 0;
    for (let i = 0; i < 0.13 * RATE; i++) {
      const t = i / RATE;
      phase += (2 * Math.PI * f0 * Math.pow(f1 / f0, Math.min(1, t / 0.09))) / RATE;
      d[start + i] += Math.min(1, t / 0.01) * Math.exp(-Math.max(0, t - 0.01) / 0.025) * Math.sin(phase);
    }
  }
  return [normalize(fadeOut(d, 0.01))];
}
// The heron: a harsh croak, "kraak" -- a buzzing tone gliding 300 down to 180 Hz with all its
// overtones, rasped sixty times a second, loudest in its throat's 600-1500 Hz.
export function makeHeron() {
  const length = random(0.38, 0.45);
  const d = mono(length + 0.05);
  const throat = biquad("bandpass", random(880, 1020), 0.9);
  let phase = 0;
  for (let i = 0; i < length * RATE; i++) {
    const t = i / RATE;
    phase += (300 * Math.pow(0.6, Math.min(1, t / 0.4))) / RATE;
    let v = HERON(phase);
    v *= 1 - 0.5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 60 * t)) + 0.08 * white();
    v *= Math.min(1, t / 0.02) * Math.min(1, (length - t) / 0.08);
    d[i] = 0.35 * v + throat.run(v);
  }
  return [normalize(d)];
}
// The goosander (merganser): a low, rattling "krrr", pulses at 28 a second, each a grain of
// noise at 700-900 Hz over a 450 Hz tone.
export function makeMerganser() {
  const length = random(0.3, 0.4);
  const d = mono(length + 0.05);
  const rate = random(26, 30);
  for (let t = 0; t < length; t += 1 / rate) {
    const e = Math.min(1, t / 0.06) * Math.min(1, (length - t) / 0.08);
    hiss(d, t, "bandpass", random(760, 840), 4, 0.006, 0.7 * e, 0.002);
    ring(d, t, random(440, 460), 0.008, 0.5 * e);
  }
  return [normalize(fadeOut(d, 0.01))];
}
// A seal giving chase: a whoosh of water pushed ahead of it, 150-600 Hz, swelling for most
// of a second and falling.
export function makeSealWhoosh() {
  const d = mono(1.2);
  shaped(d, 0, random(240, 270), 0.8, 1.1, 1, (u) => (u < 0.7 ? Math.pow(Math.sin((Math.PI / 2) * (u / 0.7)), 2) : Math.pow(Math.cos((Math.PI / 2) * ((u - 0.7) / 0.3)), 2)));
  return [normalize(fadeOut(d))];
}
// Now and then a seal's moan, heard far through the water: 220 falling to 140 Hz, wavering.
export function makeSealMoan() {
  const d = mono(1.3);
  let phase = 0;
  for (let i = 0; i < 1.25 * RATE; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * (220 - 80 * Math.min(1, t / 1.2)) * (1 + 0.03 * Math.sin(2 * Math.PI * 5 * t))) / RATE;
    d[i] = (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase)) * Math.min(1, t / 0.2) * Math.min(1, (1.25 - t) / 0.3);
  }
  return [normalize(d)];
}
// The bear: two huffs of breath and a short, rough growl (90-120 Hz, its overtones buzzing).
export function makeBear() {
  const d = mono(1);
  for (const at of [0, 0.24]) shaped(d, at, random(560, 640), 0.7, 0.15, 0.9, (u) => Math.min(1, u / 0.15) * Math.pow(1 - u, 1.5));
  const f = random(90, 120);
  let phase = 0;
  const start = Math.floor(0.5 * RATE);
  for (let i = 0; i < 0.32 * RATE; i++) {
    const t = i / RATE;
    phase += (f * (1 - 0.15 * t)) / RATE;
    const v = GROWL(phase);
    d[start + i] += 0.5 * v * (0.6 + 0.4 * Math.sin(2 * Math.PI * 25 * t)) * Math.min(1, t / 0.03) * Math.min(1, (0.32 - t) / 0.1);
  }
  return [normalize(fadeOut(d))];
}

// ---- The stingers: the stages of a life.

// A bell's note into a pair of channels at `pan`: partials [ratio, level], rising in 12 ms
// and dying away over `hold` seconds (to about a five-hundredth).
// (Each partial a damped sine made by a two-pole resonator: no sine or exponential per
// sample, which kept a fanfare's making at a tenth.)
function note(left, right, at, f, hold, partials, pan = 0) {
  const x = ((pan + 1) / 4) * Math.PI;
  const gl = right ? Math.cos(x) : 1,
    gr = Math.sin(x);
  const start = Math.floor(at * RATE);
  const n = Math.min(left.length - start, Math.ceil((hold + 0.05) * RATE));
  const rise = Math.floor(0.012 * RATE);
  for (const [ratio, level] of partials) {
    const w = (2 * Math.PI * f * ratio) / RATE,
      r = Math.exp(-6.3 / (hold * RATE));
    const c = 2 * r * Math.cos(w),
      r2 = r * r;
    let y1 = level * Math.sin(w),
      y2 = 0;
    for (let i = 0; i < n; i++) {
      const v = i < rise ? (y1 * i) / rise : y1;
      left[start + i] += v * gl;
      if (right) right[start + i] += v * gr;
      const y = c * y1 - r2 * y2;
      y2 = y1;
      y1 = y;
    }
  }
}
// One turn of a tone made of overtones (`parts[n]` the level of the n+1-th), looked up by
// phase: far quicker than adding the sines each sample.
function wave(parts, size = 4096) {
  const table = new Float32Array(size + 1);
  for (let i = 0; i <= size; i++) for (let n = 0; n < parts.length; n++) table[i] += parts[n] * Math.sin((2 * Math.PI * (n + 1) * i) / size);
  return (phase) => table[Math.floor((phase - Math.floor(phase)) * size)];
}
const HERON = wave(Array.from({ length: 12 }, (_, n) => 1 / (n + 1)));
const GROWL = wave(Array.from({ length: 10 }, (_, n) => 1 / (n + 1)));
const BRASS = wave(Array.from({ length: 6 }, (_, n) => 1 / (n + 1)));
// A new stage of life: a soft swell of noise sweeping up under a rising run of bell tones,
// C E G C E, the last held, spread from left to right.
export function makeFanfare() {
  const l = mono(3),
    r = mono(3);
  const band = biquad("bandpass", 300, 0.7),
    band2 = biquad("bandpass", 300, 0.7);
  for (let i = 0; i < 2.8 * RATE; i++) {
    const t = i / RATE;
    if ((i & 31) === 0) {
      const f = 300 * Math.pow(6, Math.min(1, t / 1.6));
      band.set(f, 0.7);
      band2.set(f, 0.7);
    }
    const e = 0.12 * (t < 0.5 ? t / 0.5 : Math.exp(-(t - 0.5) / 0.28));
    l[i] += 0.5 * e * band.run(white());
    r[i] += 0.5 * e * band2.run(white());
  }
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  notes.forEach((f, i) =>
    note(l, r, 0.12 + i * 0.13, f, i === notes.length - 1 ? 2.2 : 0.9, [
      [1, 0.16],
      [2.01, 0.05],
      [3.02, 0.018],
    ], (i / (notes.length - 1)) * 0.8 - 0.4),
  );
  return [fadeOut(l, 0.1), fadeOut(r, 0.1)];
}
// A badge: two or three quick bell tones up, three and brighter for a gold one.
export function makeChime(tier) {
  const notes = tier === "gold" ? [783.99, 1046.5, 1567.98] : tier === "silver" ? [659.25, 987.77] : [587.33, 880];
  const d = mono(0.09 * notes.length + 1.2);
  notes.forEach((f, i) =>
    note(d, null, i * 0.09, f, i === notes.length - 1 ? 1.1 : 0.45, [
      [1, 0.12],
      [2.01, 0.035],
    ]),
  );
  return [fadeOut(d, 0.05)];
}
// A hunter beaten: a low drum and a rising fifth in a brassy tone (all its overtones), with
// a bright tick -- a win, not a new stage of life.
export function makeVictory() {
  const d = mono(1.4);
  ring(d, 0, 100, 0.2, 0.7, 0.8);
  hiss(d, 0, "lowpass", 400, 0.7, 0.05, 0.5, 0.003);
  ring(d, 0, random(2300, 2500), 0.006, 0.3);
  for (const [at, f, hold] of [
    [0.08, 329.63, 0.35],
    [0.34, 440, 0.9],
  ]) {
    const start = Math.floor(at * RATE);
    for (let i = 0; i < (hold + 0.1) * RATE && start + i < d.length; i++) {
      const t = i / RATE;
      const e = Math.min(1, t / 0.03) * (t < hold ? 1 - 0.3 * (t / hold) : 0.7 * Math.exp(-(t - hold) / 0.05));
      d[start + i] += 0.12 * e * BRASS((f * i) / RATE);
    }
  }
  return [fadeOut(d, 0.08)];
}
// Grown a quarter of the way through a stage: two soft bell notes up, E5 and A5.
export function makeGrowth() {
  const d = mono(0.8);
  note(d, null, 0, 659.25, 0.4, [
    [1, 0.12],
    [2.01, 0.03],
  ]);
  note(d, null, 0.14, 880, 0.6, [
    [1, 0.12],
    [2.01, 0.03],
  ]);
  return [fadeOut(d, 0.05)];
}
// A new generation hatched: one clear bell, C6, its partials as a real bell's (1, 2.76,
// 5.4, 8.9), ringing long.
export function makeHatch() {
  const d = mono(3);
  note(d, null, 0, 1046.5, 2.9, [
    [1, 0.2],
    [2.76, 0.08],
    [5.4, 0.04],
    [8.9, 0.02],
  ]);
  return [fadeOut(d, 0.2)];
}

// All of them, a slice at a time (see createWorkshop in src/sound-make.js).
export function* makeCues(raw) {
  // (Everything but the highest at half the rate: see half() in src/sound-make.js.)
  const many = (count, make, low = true) => Array.from({ length: count }, () => (low ? half(make()) : make()));
  raw.whump = many(2, makeWhump);
  raw.jaws = many(4, makeJaws);
  yield;
  raw.denied = many(2, () => makeDenied());
  raw.thud = many(2, () => makeDenied(0.7));
  raw.gasp = many(2, makeGasp);
  yield;
  raw.gills = many(1, makeGills);
  yield;
  raw.tick = many(2, makeTick);
  raw.cleared = many(1, makeCleared);
  yield;
  raw.swell = many(2, makeSwell);
  raw.pulse = many(2, makePulse);
  raw.coil = many(2, makeCoil);
  yield;
  raw.heart = many(2, makeHeart);
  yield;
  raw.kingfisher = [half(makeKingfisher(2)), half(makeKingfisher(2)), half(makeKingfisher(3))];
  raw.heron = many(2, makeHeron);
  yield;
  raw.merganser = many(2, makeMerganser);
  raw.sealWhoosh = many(2, makeSealWhoosh);
  yield;
  raw.sealMoan = many(1, makeSealMoan);
  raw.bear = many(2, makeBear);
  yield;
  raw.fanfare = many(1, makeFanfare);
  yield;
  for (const tier of ["bronze", "silver", "gold"]) raw[`chime-${tier}`] = many(1, () => makeChime(tier));
  raw.victory = many(1, makeVictory);
  raw.growth = many(1, makeGrowth);
  yield;
  raw.hatch = many(1, makeHatch, false);
  yield;
}
