// The sound's samples, made ahead in plain arrays (no audio context needed yet): the noise
// the beds are made of and the short sounds heard often, each a few versions so that no two
// in a row are quite the same. src/sound.js turns them into buffers and plays them.

// Everything is made at this rate; where the device runs at another the browser converts.
export const RATE = 48000;

export const random = (a, b) => a + Math.random() * (b - a);
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

// A two-pole filter run over samples here (the same shapes as the Web Audio ones), and
// scaled so that white noise comes out of it at about the same strength whatever its band.
export function biquad(type, frequency, q = 0.7) {
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    a1 = 0,
    a2 = 0,
    x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0,
    norm = 1;
  const f = {
    set(frequency, q) {
      const w = (2 * Math.PI * Math.min(frequency, RATE * 0.45)) / RATE;
      const cos = Math.cos(w);
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      if (type === "bandpass") {
        b0 = alpha / a0;
        b1 = 0;
        b2 = -alpha / a0;
        norm = 1 / Math.sqrt(Math.min(1, frequency / q / (RATE / 2)));
      } else if (type === "lowpass") {
        b0 = b2 = (1 - cos) / 2 / a0;
        b1 = (1 - cos) / a0;
        norm = 1 / Math.sqrt(Math.min(1, frequency / (RATE / 2)));
      } else {
        b0 = b2 = (1 + cos) / 2 / a0;
        b1 = -(1 + cos) / a0;
        norm = 1;
      }
      a1 = (-2 * cos) / a0;
      a2 = (1 - alpha) / a0;
      return f;
    },
    run(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      return y * norm;
    },
  };
  return f.set(frequency, q);
}
// White noise of about unit strength.
export const white = () => (Math.random() * 2 - 1) * 1.7;

// Adds a ringing mode: a sine that dies away, its pitch sagging by `sag` as it goes.
export function ring(data, at, frequency, tau, amp, sag = 1) {
  const start = Math.floor(at * RATE);
  const n = Math.min(data.length - start, Math.ceil(tau * 7 * RATE));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = sag === 1 ? frequency : frequency * Math.pow(sag, Math.min(1, t / (tau * 3)));
    phase += (2 * Math.PI * f) / RATE;
    data[start + i] += amp * Math.min(1, t / 0.0015) * Math.exp(-t / tau) * Math.sin(phase);
  }
}
// Adds a tone that glides from `from` towards `to` (Hz, closing in with time constant
// `glide`), rising in `attack` and dying away with `tau`.
export function tone(data, at, from, to, glide, tau, amp, attack = 0.002) {
  const start = Math.floor(at * RATE);
  const n = Math.min(data.length - start, Math.ceil((attack + tau * 7) * RATE));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * (to + (from - to) * Math.exp(-t / glide))) / RATE;
    data[start + i] += amp * (t < attack ? t / attack : Math.exp(-(t - attack) / tau)) * Math.sin(phase);
  }
}
// A sound with nothing much above 6 kHz kept at half the rate (half the memory): each pair
// of samples, smoothed with its neighbours, becomes one. Its channels carry the new `rate`.
export function half(channels) {
  const out = channels.map((d) => {
    const h = new Float32Array(d.length >> 1);
    for (let i = 0; i < h.length; i++) h[i] = 0.25 * (d[2 * i - 1] ?? 0) + 0.5 * d[2 * i] + 0.25 * d[2 * i + 1];
    return h;
  });
  out.rate = RATE / 2;
  return out;
}
// The last `seconds` of a sound faded out, so that nothing stops on a click.
export function fadeOut(data, seconds = 0.03) {
  const n = Math.min(data.length, Math.floor(seconds * RATE));
  for (let i = 0; i < n; i++) data[data.length - n + i] *= 1 - i / n;
  return data;
}
// Adds noise in a band that rises in `attack` and dies away with `tau`; the band can sweep
// from `frequency` to `to` over `sweep` seconds.
export function hiss(data, at, type, frequency, q, tau, amp, attack = 0.001, to = frequency, sweep = 0) {
  const f = biquad(type, frequency, q);
  const start = Math.floor(at * RATE);
  const n = Math.min(data.length - start, Math.ceil((attack + tau * 7) * RATE));
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    if (sweep && (i & 31) === 0) f.set(frequency * Math.pow(to / frequency, Math.min(1, t / sweep)), q);
    const e = t < attack ? t / attack : Math.exp(-(t - attack) / tau);
    data[start + i] += amp * e * f.run(white());
  }
}
// Adds one bubble: a sine rising in pitch as the bubble rings (it shrinks towards the
// surface), gone in a tenth of a second. `pan` -1..1 into a pair of channels, or mono.
export function bubbleInto(left, right, at, pitch, amp, pan = 0) {
  const grow = random(1.3, 1.9);
  const decay = random(0.05, 0.11);
  const start = Math.floor(at * RATE);
  const n = Math.min(left.length - start, Math.ceil((decay + 0.01) * RATE));
  const k = Math.log(0.0005) / (decay - 0.004);
  const x = ((pan + 1) / 2) * (Math.PI / 2);
  const gl = right ? Math.cos(x) : 1,
    gr = Math.sin(x);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * pitch * Math.pow(grow, Math.min(1, t / 0.06))) / RATE;
    const v = amp * Math.sin(phase) * (t < 0.004 ? t / 0.004 : Math.exp(k * (t - 0.004)));
    left[start + i] += v * gl;
    if (right) right[start + i] += v * gr;
  }
}
// Drops of water falling back: tiny, high ticks scattered over a while.
export function drops(data, from, to, count, amp) {
  for (let i = 0; i < count; i++) ring(data, random(from, to), random(2200, 5200), random(0.002, 0.005), amp * random(0.4, 1));
}

// Noise for the beds: `seconds` long, two channels, its end faded into its start so it
// loops without a seam. Yields now and then so the work can be spread out.
export function* noise(kind, seconds, out) {
  const length = Math.floor(RATE * seconds);
  for (let channel = 0; channel < 2; channel++) {
    const data = new Float32Array(length);
    let brown = 0,
      running = 0;
    const rows = new Float32Array(8);
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "brown") {
        brown = (brown + 0.02 * w) / 1.02;
        data[i] = brown * 3.5;
      } else if (kind === "white") data[i] = w * 0.5;
      else {
        const k = i === 0 ? 0 : Math.min(7, Math.log2(i & -i) | 0);
        running -= rows[k];
        rows[k] = Math.random() * 2 - 1;
        running += rows[k];
        data[i] = (running + w) / 9;
      }
      if ((i & 16383) === 16383) yield;
    }
    const fade = Math.floor(RATE * 0.25);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
    }
    out.push(data);
  }
}

// ---- The short sounds.

export const mono = (seconds) => new Float32Array(Math.ceil(seconds * RATE));
// A bubble on its own, somewhere left or right.
export function makeBubble() {
  const left = mono(0.13),
    right = mono(0.13);
  bubbleInto(left, right, 0, random(350, 1250), 1, random(-0.8, 0.8));
  return [left, right];
}
// A cloud of bubbles: `count` of them over `spread` seconds, `low` lowering them all.
export function makeBurst(count, spread, low) {
  const left = mono(spread + 0.16),
    right = mono(spread + 0.16);
  for (let i = 0; i < count; i++) bubbleInto(left, right, Math.random() * spread, random(350, 1250) * low, random(0.5, 1), random(-0.8, 0.8));
  return [left, right];
}
export const KNOCKS = ["body", "rock", "wood", "net", "hook", "ice"];
// Knocks, each a few modes ringing and a click: a blow to the body (a dull knock, 200-300
// Hz, that a phone can still play), stone, wood (the mill's paddles, a branch), the net's
// mesh rasping over the scales, a hook's tick.
export function makeKnock(kind) {
  const d = mono(kind === "ice" ? 0.8 : 0.45);
  if (kind === "ice") {
    // Ice: a hollow "tonk", the floe ringing over the water under it, and a click.
    const f = random(90, 100);
    ring(d, 0, f, 0.12, 0.6);
    ring(d, 0, f * 2, 0.08, 0.5);
    ring(d, 0, random(400, 420), 0.05, 0.6);
    ring(d, 0, random(800, 840), 0.02, 0.35);
    hiss(d, 0, "bandpass", 3000, 1.5, 0.002, 0.4);
    return [fadeOut(d, 0.1)];
  }
  if (kind === "rock") {
    ring(d, 0, random(560, 700), 0.018, 0.7);
    ring(d, 0, random(1300, 1600), 0.01, 0.45);
    ring(d, 0, random(2600, 3200), 0.006, 0.25);
    ring(d, 0, random(110, 140), 0.035, 0.6);
    hiss(d, 0, "bandpass", 3400, 1, 0.003, 0.35);
  } else if (kind === "wood") {
    ring(d, 0, random(170, 190), 0.07, 0.75);
    ring(d, 0, random(405, 435), 0.04, 0.55);
    ring(d, 0, random(900, 1000), 0.012, 0.18);
    hiss(d, 0, "bandpass", 1600, 1, 0.005, 0.3);
  } else if (kind === "net") {
    // The strands catch and slip in quick grains: noise chopped at 30-45 a second.
    const high = biquad("bandpass", random(2000, 2600), 1.4),
      mid = biquad("bandpass", 750, 1);
    const rate = random(30, 45);
    let phase = 0;
    for (let i = 0; i < 0.34 * RATE; i++) {
      const t = i / RATE;
      phase += (2 * Math.PI * rate * random(0.7, 1.3)) / RATE;
      const grain = Math.pow(0.5 + 0.5 * Math.sin(phase), 6);
      const e = Math.min(1, t / 0.02) * Math.min(1, (0.34 - t) / 0.12);
      d[i] += e * grain * (0.3 * high.run(white()) + 0.2 * mid.run(white()));
    }
    ring(d, 0, random(190, 230), 0.04, 0.55);
  } else if (kind === "hook") {
    hiss(d, 0, "bandpass", 4200, 2, 0.002, 0.45);
    ring(d, 0, random(2700, 3000), 0.035, 0.14);
    ring(d, 0, random(4400, 4900), 0.02, 0.08);
    ring(d, 0.004, random(240, 280), 0.035, 0.8);
  } else {
    const f = random(210, 290);
    ring(d, 0, f, 0.05, 0.8, 0.85);
    ring(d, 0, f * random(2.2, 2.5), 0.02, 0.3);
    ring(d, 0, random(80, 100), 0.07, 0.45, 0.6);
    hiss(d, 0, "bandpass", random(2200, 3000), 1.2, 0.004, 0.25);
  }
  return [d];
}
// A nip: a small, sharp tick in the middle of the ear's range (1.2-2.5 kHz, where a phone
// plays it), and a bubble.
export function makeNip() {
  const d = mono(0.2);
  hiss(d, 0, "bandpass", random(1600, 2100), 1.8, 0.006, 0.55);
  ring(d, 0, random(1300, 1500), 0.012, 0.35, 0.85);
  bubbleInto(d, null, 0.03, random(420, 1500), 0.2);
  return [d];
}
// Breaking out: the water tearing open, a rising "shhp" (0.8 to 6 kHz in about 120 ms),
// and drops falling off after.
export function makeBreach() {
  const d = mono(0.4);
  hiss(d, 0, "bandpass", random(750, 850), 1.1, 0.06, 0.6, 0.025, random(5500, 6500), 0.12);
  drops(d, 0.06, 0.32, 6, 0.12);
  return [d];
}
// Going back in, heard as the water closes: a short "blup" (a sine falling) and a cloud of
// bubbles; lower for a bigger fish.
export function makeBlup(size) {
  const f = 700 / (1 + 0.3 * size);
  const burst = makeBurst(8 + Math.round(2 * Math.min(size, 5)), 0.35, 0.85 / (1 + 0.12 * size));
  // (The bubbles quieter than the blup itself.)
  const n = burst[0].length;
  const d = new Float32Array(n);
  ring(d, 0, f, 0.045, 0.8, 0.35);
  hiss(d, 0, "lowpass", 420, 0.7, 0.04, 0.25, 0.004);
  for (let i = 0; i < n; i++) {
    burst[0][i] = 0.3 * burst[0][i] + d[i];
    burst[1][i] = 0.3 * burst[1][i] + d[i];
  }
  return burst;
}
// A splash, the size of what hits the water (`size` in the game's lengths): a crack, then
// the fizz of the spray in a band that is lower the bigger it is (about 1400/(1 + 0.35 L)
// Hz) and longer (0.25 + 0.1 L s); a big body goes in with a plunge (a falling thud, 120
// to 60 Hz) under it; then drops falling back.
export function makeSplash(size) {
  const centre = 1400 / (1 + 0.35 * size);
  const length = 0.25 + 0.1 * size;
  const left = mono(length + 0.25),
    right = mono(length + 0.25);
  hiss(left, 0, "bandpass", Math.min(5200, centre * 2.8), 1.2, 0.005, 0.35);
  right.set(left);
  hiss(left, 0.003, "bandpass", centre, 0.9, length / 5, 0.5, 0.012);
  hiss(right, 0.003, "bandpass", centre * 1.07, 0.9, length / 5, 0.5, 0.012);
  const plunge = Math.min(1, Math.max(0, (size - 0.8) / 3));
  if (plunge > 0) {
    const body = mono(0.5);
    ring(body, 0.01, 120, 0.09, 0.9 * plunge, 0.5);
    hiss(body, 0.005, "lowpass", 320, 0.7, 0.06, 0.4 * plunge, 0.008);
    for (let i = 0; i < body.length && i < left.length; i++) {
      left[i] += body[i];
      right[i] += body[i];
    }
  }
  drops(left, length * 0.3, length * 1.1, 3 + Math.round(size), 0.08);
  drops(right, length * 0.3, length * 1.1, 3 + Math.round(size), 0.08);
  return [left, right];
}
// Something swallowed: the tick of the jaws closing and a soft, hollow gulp dropping in
// pitch; a big mouthful lets a bubble out of the gills.
export function makeSwallow(size) {
  const d = mono(0.3 + 0.12 * size);
  hiss(d, 0, "bandpass", 1000 - 400 * size, 1.4, 0.004, (0.05 + 0.1 * size) * 0.3);
  const f0 = 480 - 260 * size;
  const glide = 0.08 + 0.1 * size;
  const decay = 0.13 + 0.12 * size;
  const k = Math.log(0.0005) / (decay - 0.015);
  let phase = 0;
  const start = Math.floor(0.01 * RATE);
  for (let i = 0; start + i < d.length; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * f0 * Math.pow(0.4, Math.min(1, t / glide))) / RATE;
    const e = t < 0.015 ? t / 0.015 : Math.exp(k * (t - 0.015));
    d[start + i] += (0.16 + 0.14 * size) * e * (Math.sin(phase) + 0.35 * Math.sin(2 * phase));
  }
  if (size > 0.4) bubbleInto(d, null, 0.18, random(300, 1100) * 0.9, 0.04);
  return [d];
}
// Another fish taking a fly off the surface: a soft sip and a low bubble.
export function makeRise() {
  const d = mono(0.3);
  hiss(d, 0, "bandpass", random(620, 780), 0.8, 0.04, 0.5, 0.01);
  bubbleInto(d, null, 0.04, random(350, 1250) * 0.55, 0.4);
  return [d];
}
// The reel's ratchet: four quick ticks, come down the line into the water.
export function makeReel() {
  const d = mono(0.18);
  for (let k = 0; k < 4; k++) {
    hiss(d, k * 0.035, "bandpass", random(2400, 3000), 1.4, 0.003, 0.5);
    ring(d, k * 0.035, random(1150, 1300), 0.01, 0.6);
  }
  return [d];
}

// Work done ahead, a slice at a time, so that neither the loading nor the first click
// stalls on it; whatever is left when the sound is wanted is finished then and there.
export function createWorkshop() {
  const jobs = [];
  let timer = null;
  // (How long it has worked in all, for the checks.)
  let spent = 0;
  function slice() {
    timer = null;
    const from = performance.now(),
      until = from + 4;
    while (jobs.length && performance.now() < until) if (jobs[0].next().done) jobs.shift();
    spent += performance.now() - from;
    if (jobs.length) timer = setTimeout(slice, 0);
  }
  return {
    add(job) {
      jobs.push(job);
      if (!timer) timer = setTimeout(slice, 0);
    },
    finish() {
      const from = performance.now();
      while (jobs.length) if (jobs[0].next().done) jobs.shift();
      spent += performance.now() - from;
    },
    get left() {
      return jobs.length;
    },
    get spent() {
      return spent;
    },
  };
}
export function* makeAll(raw) {
  for (const [kind, seconds] of [
    ["brown", 9],
    ["pink", 9],
    ["white", 4],
  ]) {
    const channels = [];
    yield* noise(kind, seconds, channels);
    raw[kind] = [channels];
  }
  const many = (count, make) => Array.from({ length: count }, make);
  raw.bubble = many(24, makeBubble);
  yield;
  for (const kind of KNOCKS) {
    raw[kind] = many(3, () => makeKnock(kind));
    yield;
  }
  raw.nip = many(4, makeNip);
  raw.breach = many(3, makeBreach);
  raw.rise = many(3, makeRise);
  raw.reel = many(2, makeReel);
}

// Sizes come in steps, each a sixth larger than the last; a step's sound is played a
// little faster or slower to land exactly on the size asked for.
export const step = (size) => Math.max(0, Math.round(Math.log(Math.max(size, 0.2) / 0.2) / Math.log(1.18)));
export const stepSize = (k) => 0.2 * Math.pow(1.18, k);
