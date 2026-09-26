// The world's own small sounds, made ahead like the rest (src/sound-make.js): gravel ticking
// in a brook, rain pinging on the surface overhead, stones clattering along the bed in a
// flood, ice singing, a ship's screw far off at sea, fish grunting at night -- and above
// the water the mill wheel's paddles, bread dropping from the bridge, the fish counter.

import { RATE, biquad, fadeOut, half, hiss, mono, random, ring, white } from "./sound-make.js";

// A damped sine added fast (a two-pole resonator struck once), for the many tiny pings of
// rain and gravel where ring() would be too slow. Into a pair of channels at `pan` (-1..1).
export function ping(left, right, at, f, tau, amp, pan = 0) {
  const start = Math.floor(at * RATE);
  const n = Math.min(left.length - start, Math.ceil(tau * 5 * RATE));
  const w = (2 * Math.PI * Math.min(f, RATE * 0.45)) / RATE,
    r = Math.exp(-1 / (tau * RATE));
  const c = 2 * r * Math.cos(w),
    r2 = r * r;
  const x = ((pan + 1) / 4) * Math.PI;
  const gl = right ? Math.cos(x) : 1,
    gr = Math.sin(x);
  let y1 = amp * Math.sin(w),
    y2 = 0;
  for (let i = 0; i < n; i++) {
    left[start + i] += y1 * gl;
    if (right) right[start + i] += y1 * gr;
    const y = c * y1 - r2 * y2;
    y2 = y1;
    y1 = y;
  }
}
// A loop `seconds` long that repeats without a seam: `fill` makes a little more than that,
// and what runs over is faded into the start (play it from 0).
function looped(seconds, channels, fill, fade = 0.12) {
  const length = Math.floor(seconds * RATE),
    over = Math.floor(fade * RATE);
  const data = Array.from({ length: channels }, () => new Float32Array(length + over));
  fill(...data);
  return data.map((d) => {
    for (let i = 0; i < over; i++) {
      const t = i / over;
      d[i] = d[i] * t + d[length + i] * (1 - t);
    }
    return d.subarray(0, length).slice();
  });
}
const stereo = (seconds) => [mono(seconds), mono(seconds)];

// ---- Under the water.

// Gravel shifting in a brook's current: a few high ticks (2-6 kHz) on a small knock of
// stone (800-1500 Hz), 30 ms, somewhere left or right.
export function makeGravel() {
  const [l, r] = stereo(0.04);
  const pan = random(-0.9, 0.9);
  const n = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) ping(l, r, random(0, 0.012), random(2000, 6000), random(0.002, 0.004), random(0.3, 0.6), pan);
  ping(l, r, 0, random(800, 1500), 0.004, 0.5, pan);
  return [fadeOut(l, 0.005), fadeOut(r, 0.005)];
}
// Rain heard from under the water: each drop striking the surface rings a small bubble,
// a ping at 6.5-14 kHz (most at 9-12) gone in a few milliseconds, some 500 of them a second
// at full rain, over a faint hiss high up. 3 s, looped.
export function makeRainPings() {
  return looped(3, 2, (l, r) => {
    const count = Math.round(3.12 * 500);
    for (let k = 0; k < count; k++) {
      const u = Math.random();
      const f = u < 0.7 ? random(9000, 12000) : u < 0.85 ? random(6500, 9000) : random(12000, 14000);
      const a = Math.random();
      ping(l, r, Math.random() * 3.1, f, random(0.0015, 0.005), 0.5 * a * a, random(-0.9, 0.9));
    }
    const top = biquad("bandpass", 11300, 1.4),
      top2 = biquad("bandpass", 11300, 1.4);
    for (let i = 0; i < l.length; i++) {
      l[i] += 0.012 * top.run(white());
      r[i] += 0.012 * top2.run(white());
    }
  });
}
// Stones knocked along the bed by a flood: a burst (0.3-0.6 s) of 30-80 hard clicks at
// 2-6 kHz, bunched as the gravel rolls, all about.
export function makeClatter() {
  const length = random(0.3, 0.6);
  const [l, r] = stereo(length + 0.02);
  const n = Math.floor(random(30, 80));
  const pan = random(-0.6, 0.6);
  for (let k = 0; k < n; k++) {
    // (Bunched: most early, in little runs.)
    const t = length * Math.pow(Math.random(), 1.6);
    ping(l, r, t, random(2000, 6000), random(0.001, 0.0025), random(0.2, 0.7), Math.max(-1, Math.min(1, pan + random(-0.4, 0.4))));
    if (Math.random() < 0.3) ping(l, r, t, random(900, 1600), 0.003, 0.3, pan);
  }
  return [fadeOut(l, 0.01), fadeOut(r, 0.01)];
}
// Ice singing: a thin, falling "pew" as the sheet flexes, 3 kHz dropping to 200 Hz in a
// few hundredths of a second, with its echoes off the ice (30 and 70 ms later, fainter).
export function makeChirp() {
  const [l, r] = stereo(0.42);
  const pan = random(-0.8, 0.8);
  const x = ((pan + 1) / 4) * Math.PI;
  const top = random(2500, 3100);
  for (const [delay, gain] of [
    [0, 1],
    [0.03, 0.4],
    [0.07, 0.2],
  ]) {
    let phase = 0;
    const start = Math.floor(delay * RATE);
    for (let i = 0; i < 0.35 * RATE && start + i < l.length; i++) {
      const t = i / RATE;
      phase += (2 * Math.PI * (200 + top * Math.exp(-t / 0.07))) / RATE;
      const v = gain * Math.sqrt(t / 0.12) * Math.exp(-t / 0.12) * Math.sin(phase);
      l[start + i] += v * Math.cos(x);
      r[start + i] += v * Math.sin(x);
    }
  }
  return [fadeOut(l), fadeOut(r)];
}
// A ship far off at sea: its engine's drone (44 Hz and its overtones) throbbing with the
// screw's blades, 3.75 times a second, and the hiss of the water they tear (300-900 Hz,
// where a phone hears the throb). 4 s, looped: a whole number of both in it.
export function makeShip() {
  return looped(4, 1, (d) => {
    const band = biquad("bandpass", 520, 0.9);
    // (One turn of the drone, looked up by phase.)
    const turn = new Float32Array(2048);
    [1, 0.6, 0.4, 0.3, 0.2].forEach((a, n) => {
      for (let i = 0; i < turn.length; i++) turn[i] += a * Math.sin((2 * Math.PI * (n + 1) * i) / turn.length);
    });
    for (let i = 0; i < d.length; i++) {
      const t = i / RATE;
      const throb = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.75 * t);
      const v = turn[Math.floor(((44 * t) % 1) * turn.length)];
      d[i] = 0.25 * v * (0.8 + 0.2 * throb) + 0.35 * throb * throb * band.run(white());
    }
  }, 0);
}
// Fish grunting at night (cod and their kin): a short run of 4-9 knocks, 18-25 a second,
// each a low ring at 150-300 Hz.
export function makeGrunt() {
  const n = 4 + Math.floor(Math.random() * 6);
  const rate = random(18, 25),
    f = random(150, 300);
  const [l, r] = stereo(n / rate + 0.05);
  const pan = random(-0.8, 0.8);
  for (let k = 0; k < n; k++) ping(l, r, k / rate, f * random(0.95, 1.05), 0.008, 0.6 * Math.min(1, (k + 1) / 2), pan);
  return [fadeOut(l), fadeOut(r)];
}

// ---- Above the water (heard muffled under it).

// Lightning striking near: a hard crack, the air tearing in quick grains (1-6 kHz), then a
// sizzle (1-3 kHz) dying away.
export function makeCrack() {
  const [l, r] = stereo(0.3);
  hiss(l, 0, "highpass", 600, 0.7, 0.01, 1.2);
  r.set(l);
  for (let t = 0.004; t < 0.12; t += random(0.004, 0.012)) {
    const f = random(1000, 6000);
    hiss(l, t, "bandpass", f, 2, 0.004, random(0.3, 0.8) * (1 - t / 0.14));
    hiss(r, t + random(0, 0.003), "bandpass", f * random(0.9, 1.1), 2, 0.004, random(0.3, 0.8) * (1 - t / 0.14));
  }
  hiss(l, 0.02, "bandpass", random(1500, 2200), 0.8, 0.08, 0.35, 0.01);
  hiss(r, 0.02, "bandpass", random(1500, 2200), 0.8, 0.08, 0.35, 0.01);
  return [fadeOut(l), fadeOut(r)];
}
// The mill wheel: a paddle slapping into the race (600-2000 Hz, and the thud of the wood).
export function makeSlap() {
  const d = mono(0.3);
  hiss(d, 0, "bandpass", random(1000, 1300), 0.8, 0.03, 0.8, 0.004);
  ring(d, 0, random(140, 160), 0.05, 0.5);
  return [fadeOut(d)];
}
// ... and its axle creaking now and then: wood on wood, stick and slip, 25-40 times a second.
export function makeCreak() {
  const d = mono(0.65);
  const rate = random(25, 40),
    f = random(180, 260);
  for (let t = 0; t < 0.6; t += (1 / rate) * random(0.8, 1.2)) ping(d, null, t, f * random(0.97, 1.03), 0.012, 0.5 * Math.sin((Math.PI * t) / 0.6));
  hiss(d, 0.05, "bandpass", 900, 2, 0.15, 0.08, 0.2);
  return [fadeOut(d)];
}
// Bread dropping from the bridge: a small plop, a ring falling in pitch, and a bubble.
export function makePlop() {
  const d = mono(0.2);
  ring(d, 0, random(1000, 2500), 0.015, 0.7, 0.7);
  ring(d, 0.02, random(500, 800), 0.02, 0.2, 1.4);
  return [fadeOut(d)];
}
// The fish counter at the weir: a relay clicking over, then the camera's motor whirring up
// and down.
export function makeCounter() {
  const d = mono(1.25);
  ring(d, 0, random(2400, 2600), 0.005, 0.8);
  ring(d, 0, 800, 0.008, 0.5);
  const band = biquad("bandpass", 900, 2.5);
  let phase = 0;
  const start = Math.floor(0.2 * RATE);
  for (let i = 0; i < 0.9 * RATE; i++) {
    const u = i / (0.9 * RATE);
    phase += (2 * Math.PI * 120 * (0.7 + 0.5 * Math.sin(Math.PI * u))) / RATE;
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(phase), 8);
    d[start + i] += 0.5 * Math.sin(Math.PI * u) * band.run(pulse - 0.1);
  }
  return [fadeOut(d)];
}

// All of them, a slice at a time (see createWorkshop in src/sound-make.js).
export function* makeWorld(raw) {
  // (Rain's pings and the crack of lightning keep the full rate; the rest have nothing
  // much above 6 kHz and keep half: see half() in src/sound-make.js.)
  const many = (count, make, low = true) => Array.from({ length: count }, () => (low ? half(make()) : make()));
  raw.gravel = many(12, makeGravel);
  raw.clatter = many(4, makeClatter);
  yield;
  raw.pings = many(1, makeRainPings, false);
  yield;
  raw.chirp = many(4, makeChirp);
  raw.grunt = many(6, makeGrunt);
  yield;
  raw.ship = many(1, makeShip);
  yield;
  raw.crack = many(3, makeCrack, false);
  raw.slap = many(3, makeSlap);
  raw.creak = many(2, makeCreak);
  raw.plop = many(4, makePlop);
  raw.counter = many(1, makeCounter);
  yield;
}
