// The sound of the water, made from noise and filters with the Web Audio API (nothing is
// recorded). Under water: a deep rush with a burbling flow over it, eddies gurgling, bubbles
// ringing; the roar of a fall or a rapid swelling as the fish comes near it; in the sea a
// slower, deeper wash. What happens above the water -- rain on the surface, a splash, a
// bird's call, thunder -- comes down through the surface muffled; out in the air in a leap
// it is bright and open, and the water's own sound drops away under it.
// Browsers allow sound only after a click, a tap or a key, so it starts then; T turns it
// off and on. Off, hidden, or paused for long, the sound device is let go (a phone's battery).
//
// Everything goes through one master (the volume, off, the hush of a pause) and a
// compressor, in four groups:
//   water    what sounds in the water: the beds, bubbles, eddies, what the fish does
//   surface  what sounds at the surface: splashes, rain on it, the white water of a fall
//   air      what sounds in the air: the air itself, calls, thunder, the angler's reel
//   ui       the bells of a new stage of life or a badge
// How far under the ear is (`submerged`, 0..1, eased over about a tenth of a second) opens
// one and closes the others. The crossing itself (breaking out, going back in) is heard
// as it is, neither in the water nor out of it.
//
// The noise and the short sounds heard often (bubbles, splashes, knocks) are made ahead as
// plain samples, a slice at a time while the game loads, and played back as they are: a
// source and a level each, instead of a tangle of oscillators and filters every time.

const STORAGE_KEY = "habitat-sound";
// Everything is made at this rate; where the device runs at another the browser converts.
const RATE = 48000;
// The master level, with sound on and nothing hushing it.
const LEVEL = 0.32;
// The ear crossing the surface (s): quick, but not a click.
const EASE = 0.12;
// The bed is steered this often (s): its values move slowly, and each change is a message
// to the audio thread.
const STEER = 0.05;
// Above this (Hz) the surface takes the edge off what comes through it.
const DIM = 800;
// How loud each part is, relative to the others (set by ear and by tools/sound-check.mjs).
const MIX = {
  rush: 0.37,
  rumble: 0.23,
  flow: 0.85,
  burble: 0.37,
  roar: 0.6,
  roarLow: 0.37,
  wash: 0.4,
  washMid: 0.6,
  gurgle: 0.8,
  rain: 0.4,
  rainUnder: 0.65,
  air: 0.5,
  whiteWater: 0.5,
  bubble: 0.6,
  burst: 0.1,
  duck: 0.45,
  ui: 5,
  swallow: 2.2,
  nip: 1.2,
  splash: 0.9,
  breach: 0.3,
  blup: 0.7,
  knock: 1.0,
  rise: 1.0,
  call: 0.32,
  otter: 0.38,
  thunder: 2.2,
};

// ---- Made ahead: samples in plain arrays (no audio context needed yet).

const random = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// A two-pole filter run over samples here (the same shapes as the Web Audio ones), and
// scaled so that white noise comes out of it at about the same strength whatever its band.
function biquad(type, frequency, q = 0.7) {
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
const white = () => (Math.random() * 2 - 1) * 1.7;

// Adds a ringing mode: a sine that dies away, its pitch sagging by `sag` as it goes.
function ring(data, at, frequency, tau, amp, sag = 1) {
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
// Adds noise in a band that rises in `attack` and dies away with `tau`; the band can sweep
// from `frequency` to `to` over `sweep` seconds.
function hiss(data, at, type, frequency, q, tau, amp, attack = 0.001, to = frequency, sweep = 0) {
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
function bubbleInto(left, right, at, pitch, amp, pan = 0) {
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
function drops(data, from, to, count, amp) {
  for (let i = 0; i < count; i++) ring(data, random(from, to), random(2200, 5200), random(0.002, 0.005), amp * random(0.4, 1));
}

// Noise for the beds: `seconds` long, two channels, its end faded into its start so it
// loops without a seam. Yields now and then so the work can be spread out.
function* noise(kind, seconds, out) {
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

const mono = (seconds) => new Float32Array(Math.ceil(seconds * RATE));
// A bubble on its own, somewhere left or right.
function makeBubble() {
  const left = mono(0.13),
    right = mono(0.13);
  bubbleInto(left, right, 0, random(350, 1250), 1, random(-0.8, 0.8));
  return [left, right];
}
// A cloud of bubbles: `count` of them over `spread` seconds, `low` lowering them all.
function makeBurst(count, spread, low) {
  const left = mono(spread + 0.16),
    right = mono(spread + 0.16);
  for (let i = 0; i < count; i++) bubbleInto(left, right, Math.random() * spread, random(350, 1250) * low, random(0.5, 1), random(-0.8, 0.8));
  return [left, right];
}
const KNOCKS = ["body", "rock", "wood", "net", "hook"];
// Knocks, each a few modes ringing and a click: a blow to the body (a dull knock, 200-300
// Hz, that a phone can still play), stone, wood (the mill's paddles, a branch), the net's
// mesh rasping over the scales, a hook's tick.
function makeKnock(kind) {
  const d = mono(0.45);
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
function makeNip() {
  const d = mono(0.2);
  hiss(d, 0, "bandpass", random(1600, 2100), 1.8, 0.006, 0.55);
  ring(d, 0, random(1300, 1500), 0.012, 0.35, 0.85);
  bubbleInto(d, null, 0.03, random(420, 1500), 0.2);
  return [d];
}
// Breaking out: the water tearing open, a rising "shhp" (0.8 to 6 kHz in about 120 ms),
// and drops falling off after.
function makeBreach() {
  const d = mono(0.4);
  hiss(d, 0, "bandpass", random(750, 850), 1.1, 0.06, 0.6, 0.025, random(5500, 6500), 0.12);
  drops(d, 0.06, 0.32, 6, 0.12);
  return [d];
}
// Going back in, heard as the water closes: a short "blup" (a sine falling) and a cloud of
// bubbles; lower for a bigger fish.
function makeBlup(size) {
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
function makeSplash(size) {
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
function makeSwallow(size) {
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
function makeRise() {
  const d = mono(0.3);
  hiss(d, 0, "bandpass", random(620, 780), 0.8, 0.04, 0.5, 0.01);
  bubbleInto(d, null, 0.04, random(350, 1250) * 0.55, 0.4);
  return [d];
}
// The reel's ratchet: four quick ticks, come down the line into the water.
function makeReel() {
  const d = mono(0.18);
  for (let k = 0; k < 4; k++) {
    hiss(d, k * 0.035, "bandpass", random(2400, 3000), 1.4, 0.003, 0.5);
    ring(d, k * 0.035, random(1150, 1300), 0.01, 0.6);
  }
  return [d];
}

// Work done ahead, a slice at a time, so that neither the loading nor the first click
// stalls on it; whatever is left when the sound is wanted is finished then and there.
function createWorkshop() {
  const jobs = [];
  let timer = null;
  function slice() {
    timer = null;
    const until = performance.now() + 4;
    while (jobs.length && performance.now() < until) if (jobs[0].next().done) jobs.shift();
    if (jobs.length) timer = setTimeout(slice, 0);
  }
  return {
    add(job) {
      jobs.push(job);
      if (!timer) timer = setTimeout(slice, 0);
    },
    finish() {
      while (jobs.length) if (jobs[0].next().done) jobs.shift();
    },
  };
}
function* makeAll(raw) {
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
const step = (size) => Math.max(0, Math.round(Math.log(Math.max(size, 0.2) / 0.2) / Math.log(1.18)));
const stepSize = (k) => 0.2 * Math.pow(1.18, k);

export function createSound() {
  let enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {}
  let context = null,
    master = null,
    nodes = null,
    level = 0,
    asleep = false,
    sleepTimer = 0,
    sleepAt = Infinity,
    clock = 0,
    nextGurgle = 0,
    nextBubble = 0,
    nextSteer = 0,
    lastSwallow = 0,
    submerged = 1,
    crossing = NaN,
    clearTone = 7000,
    live = 0;
  // What keeps it quiet (a pause, the logbook, death, a hidden page): each its own reason,
  // so that one ending does not end the others.
  const hushes = new Set();
  const raw = {};
  const banks = {};
  const sized = new Map();
  const workshop = createWorkshop();
  workshop.add(makeAll(raw));

  const toBuffer = (channels) => {
    const buffer = context.createBuffer(channels.length, channels[0].length, RATE);
    channels.forEach((data, c) => buffer.getChannelData(c).set(data));
    return buffer;
  };
  const bank = (name) => (banks[name] ??= raw[name].map(toBuffer));
  // A sound that depends on a size, made the first few times it is asked for and then
  // reused (a few versions of each, so no two in a row are quite the same).
  function variant(key, make, count = 3) {
    let list = sized.get(key);
    if (!list) sized.set(key, (list = []));
    if (list.length < count) list.push(toBuffer(make()));
    return pick(list);
  }

  function loop(buffer) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0.25;
    source.loopEnd = buffer.duration;
    source.start(0, Math.random() * buffer.duration * 0.8);
    return source;
  }
  const filter = (type, frequency, q = 0.7) => {
    const f = context.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const amp = (value) => {
    const g = context.createGain();
    g.gain.value = value;
    return g;
  };
  // The surface's muffle: a gentle one-pole lowpass, so that what comes through is dull
  // but still there (a kingfisher's call must not vanish), and a second, steeper one far
  // above it for the hiss.
  function muffle() {
    const top = filter("lowpass", 5000, -3);
    if (!context.createIIRFilter) {
      const f = filter("lowpass", DIM * 1.2, -3);
      f.connect(top);
      return [f, top];
    }
    const k = Math.tan((Math.PI * DIM) / context.sampleRate);
    const f = context.createIIRFilter([k / (1 + k), k / (1 + k)], [1, (k - 1) / (k + 1)]);
    f.connect(top);
    return [f, top];
  }
  // A value the bed steers, written only when it has moved enough to be heard.
  const knob = (param, tolerance = 0.02, floor = 0.002) => ({ param, last: NaN, tolerance, floor });
  function steer(k, value, tau, now) {
    if (Math.abs(value - k.last) <= Math.max(k.floor, Math.abs(k.last) * k.tolerance)) return;
    k.last = value;
    k.param.setTargetAtTime(value, now, tau);
  }

  function build() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    try {
      context = new Context({ latencyHint: "interactive" });
    } catch {
      context = new Context();
    }
    workshop.finish();
    // Taken back up if the system stopped it (a phone call on iOS, another app's sound).
    context.onstatechange = () => {
      if (!asleep && enabled && !hushes.size && !document.hidden && context.state !== "running" && context.state !== "closed") context.resume().catch(() => {});
    };
    master = amp(0);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.ratio.value = 3;
    master.connect(compressor).connect(context.destination);
    const [brown] = bank("brown");
    const [pink] = bank("pink");

    // The groups. Water: clear under water; from above only a dull, low murmur of it.
    const water = amp(1);
    const waterTone = filter("lowpass", 7000, -3);
    const waterDuck = amp(1);
    water.connect(waterTone).connect(waterDuck).connect(master);
    // Surface and air: bright in the air; under water through the surface's muffle.
    const surface = amp(1);
    const air = amp(1);
    const through = amp(1);
    surface.connect(through);
    air.connect(through);
    const dry = amp(0);
    through.connect(dry).connect(master);
    const [dim, dimTop] = muffle();
    const wet = amp(1);
    through.connect(dim);
    dimTop.connect(wet).connect(master);
    const ui = amp(MIX.ui);
    ui.connect(master);

    // The rush: the river's deep, broad voice, felt as much as heard.
    const rushFilter = filter("lowpass", 420, 0.6);
    const rushGain = amp(0);
    loop(brown).connect(rushFilter).connect(rushGain).connect(water);
    const rumbleGain = amp(0);
    loop(brown).connect(filter("lowpass", 90, 0.9)).connect(rumbleGain).connect(water);
    // The flow over it: the water moving past stones, a band in the low middle (where a
    // phone's small speaker still plays), and a burble above that, both slowly swelling.
    const flowBand = filter("bandpass", 480, 0.9);
    const flowGain = amp(0);
    loop(pink).connect(flowBand).connect(flowGain).connect(water);
    const burbleBand = filter("bandpass", 820, 1.6);
    const burbleGain = amp(0);
    loop(pink).connect(burbleBand).connect(burbleGain).connect(water);
    // The roar of falling and breaking water under it: broad, mid-low, churning.
    const roarGain = amp(0);
    loop(pink).connect(filter("bandpass", 420, 0.6)).connect(roarGain).connect(water);
    const roarLowGain = amp(0);
    loop(brown).connect(filter("lowpass", 160, 0.8)).connect(roarLowGain).connect(water);
    // The same white water at the surface: bright and hissing in the air.
    const whiteWaterGain = amp(0);
    loop(pink).connect(filter("bandpass", 1300, 0.5)).connect(whiteWaterGain).connect(surface);
    // The sea's slow wash, and its middle.
    const washFilter = filter("lowpass", 300, 0.5);
    const washGain = amp(0);
    const washSource = loop(pink);
    washSource.connect(washFilter).connect(washGain).connect(water);
    const washMid = filter("bandpass", 380, 0.8);
    const washMidGain = amp(0);
    washSource.connect(washMid).connect(washMidGain).connect(water);
    // The air, for leaps: the river as it sounds from above it, babbling and splashing over
    // the stones, and the open hiss of the world above the water.
    const airGain = amp(0);
    const airOpen = amp(0);
    airGain.connect(airOpen).connect(air);
    loop(pink).connect(filter("bandpass", 650, 0.7)).connect(airGain);
    loop(pink).connect(filter("bandpass", 2600, 0.5)).connect(amp(0.8)).connect(airGain);
    const gurgles = [];
    for (let i = 0; i < 5; i++) {
      const source = loop(pink);
      const band = filter("bandpass", 220 + i * 140, 6 + i);
      const level = amp(0);
      const pan = context.createStereoPanner ? context.createStereoPanner() : null;
      if (pan) pan.pan.value = (i / 4) * 1.4 - 0.7;
      source.connect(band).connect(level);
      if (pan) level.connect(pan).connect(water);
      else level.connect(water);
      gurgles.push({ band, level, base: 220 + i * 140 });
    }
    // Rain on the surface; and under it, the patter of the drops come down through the
    // water, a fine hiss of its own.
    const rainGain = amp(0);
    loop(pink).connect(filter("highpass", 700, 0.5)).connect(filter("lowpass", 3200, 0.5)).connect(rainGain).connect(surface);
    const rainUnderGain = amp(0);
    loop(pink).connect(filter("bandpass", 1500, 0.8)).connect(rainUnderGain).connect(water);
    nodes = {
      water,
      surface,
      air,
      ui,
      gurgles,
      knobs: {
        rush: knob(rushGain.gain),
        rushTone: knob(rushFilter.frequency, 0.015, 1),
        rumble: knob(rumbleGain.gain),
        flow: knob(flowGain.gain),
        flowTone: knob(flowBand.frequency, 0.015, 1),
        burble: knob(burbleGain.gain),
        burbleTone: knob(burbleBand.frequency, 0.015, 1),
        roar: knob(roarGain.gain),
        roarLow: knob(roarLowGain.gain),
        whiteWater: knob(whiteWaterGain.gain),
        wash: knob(washGain.gain),
        washTone: knob(washFilter.frequency, 0.015, 1),
        washMid: knob(washMidGain.gain),
        air: knob(airGain.gain),
        rain: knob(rainGain.gain),
        rainUnder: knob(rainUnderGain.gain),
        waterTone: knob(waterTone.frequency, 0.015, 1),
      },
      // Moved only when the ear crosses the surface, at the pace of the crossing.
      crossing: { waterDuck: waterDuck.gain, dry: dry.gain, wet: wet.gain, airOpen: airOpen.gain, surface: surface.gain, air: air.gain },
    };
    for (const name of ["bubble", ...KNOCKS, "nip", "breach", "rise", "reel"]) bank(name);
    bank("white");
    bank("brown");
    return true;
  }

  // A made sound played once: its source and its level, two nodes, nothing to schedule.
  function play(buffer, bus, loudness, at = context.currentTime + 0.01, rate = 1) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = amp(loudness);
    source.connect(gain).connect(bus);
    source.start(at);
    live++;
    source.onended = () => {
      live--;
      gain.disconnect();
    };
    return source;
  }
  const bubbles = (count, spread, low, loudness, at) => {
    const n = Math.max(2, Math.round(count / 3) * 3);
    const buffer = variant(`burst:${n}:${spread}:${Math.round(low * 10)}`, () => makeBurst(n, spread, Math.round(low * 10) / 10));
    play(buffer, nodes.water, loudness * MIX.burst, at, random(0.94, 1.06));
  };
  // A click: a few milliseconds of noise in a band, as of jaws or a bill closing (for the
  // sounds too rare to be worth making ahead).
  function click(at, loudness, frequency, length, bus) {
    const source = context.createBufferSource();
    source.buffer = bank("white")[0];
    const band = filter("bandpass", frequency, 1.4);
    const env = context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(loudness, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0005, at + length);
    source.connect(band).connect(env).connect(bus);
    source.start(at, Math.random() * 2);
    source.stop(at + length + 0.02);
  }

  // On, off and hushed: the master level follows, and the device is let go when nothing is
  // to be heard -- at once when hidden or turned off, after a while when paused.
  const wanted = () => enabled && !hushes.size;
  const ready = () => context && nodes && context.state === "running" && wanted();
  // (By what was last asked, not by the context's state: a resume or suspend takes a
  // moment, and the browser carries them out in the order they were asked for.)
  function wake() {
    const was = asleep;
    asleep = false;
    if ((was || context.state !== "running") && context.state !== "closed") context.resume().catch(() => {});
  }
  function sleep() {
    sleepAt = Infinity;
    if (wanted() || !context || asleep || context.state === "closed") return;
    asleep = true;
    context.suspend().catch(() => {});
  }
  function apply(seconds) {
    if (!context) return;
    const on = wanted();
    if (on) wake();
    const value = on ? LEVEL : 0;
    if (value !== level) {
      level = value;
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(value, now + seconds);
    }
    if (on) {
      clearTimeout(sleepTimer);
      sleepAt = Infinity;
      return;
    }
    // Counted from when it went quiet (a key pressed during a pause does not put it off),
    // and looked for each frame as well as by a timer: a busy page can hold its timers
    // back, and a hidden one draws no frames.
    const delay = (seconds + (enabled && !hushes.has("hidden") ? 12 : 0.2)) * 1000;
    if (asleep || performance.now() + delay >= sleepAt) return;
    clearTimeout(sleepTimer);
    sleepAt = performance.now() + delay;
    sleepTimer = setTimeout(sleep, delay);
  }

  // The ear crossing the surface: the groups open and close together, at its pace.
  function cross(value, now) {
    crossing = value;
    const c = nodes.crossing;
    c.waterDuck.setTargetAtTime(MIX.duck + (1 - MIX.duck) * value, now, EASE);
    c.dry.setTargetAtTime(1 - value, now, EASE);
    c.wet.setTargetAtTime(value, now, EASE);
    c.airOpen.setTargetAtTime(1 - value, now, EASE);
    // Through the surface a little quieter as well as duller; the air's sounds more so.
    c.surface.setTargetAtTime(1 - 0.2 * value, now, EASE);
    c.air.setTargetAtTime(1 - 0.3 * value, now, EASE);
    steer(nodes.knobs.waterTone, waterTone(), now, EASE);
  }
  // The water group's top: under water clear (a little duller at night and in the deep),
  // from above only its low murmur.
  const waterTone = () => Math.exp(Math.log(700) + (Math.log(clearTone) - Math.log(700)) * crossing);

  return {
    get enabled() {
      return enabled;
    },
    // What it is doing (for the diagnostics): the device's state and the sounds playing.
    get stats() {
      return { state: context?.state ?? "none", time: context?.currentTime ?? 0, live, asleep, level, hushes: [...hushes], sleepIn: (sleepAt - performance.now()) / 1000 };
    },
    start() {
      if (!enabled) return;
      if (!context && !build()) return;
      apply(3);
    },
    toggle() {
      enabled = !enabled;
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
      } catch {}
      if (enabled) this.start();
      else apply(0.6);
      return enabled;
    },
    // Quiet for a reason ("pause", "dead", "hidden"), or no longer.
    hush(value, reason = "pause") {
      value = !!value;
      if (value === hushes.has(reason)) return;
      if (value) hushes.add(reason);
      else hushes.delete(reason);
      apply(value ? (reason === "hidden" ? 0.25 : 0.5) : 1.5);
    },
    // Something swallowed: the faint tick of the jaws closing and a soft, hollow gulp
    // dropping in pitch -- quiet, because it comes every few seconds while the fish feeds,
    // a little different each time, and never twice at once. `size` 0..1: a midge larva
    // is barely a tick, a herring a proper gulp with a bubble out of the gills.
    swallow(size = 0.2) {
      if (!ready()) return;
      const at = context.currentTime + 0.01;
      if (at - lastSwallow < 0.15) return;
      lastSwallow = at;
      const k = Math.min(4, Math.round(size * 4));
      const buffer = variant(`swallow:${k}`, () => makeSwallow(k / 4), 2);
      // (The pitch varies by an eighth each way; the step's own pitch is moved to the size.)
      const exact = (480 - 260 * size) / (480 - 65 * k);
      play(buffer, nodes.water, MIX.swallow, at, exact * random(0.88, 1.12));
    },
    // Caught. In a fish's jaws: the water rushing in, a deep gulp, the jaws shutting on it.
    // In a bill or under a claw: a hard clack, and the splash out of the water.
    eaten(kind) {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      if (kind === "fish") {
        const source = context.createBufferSource();
        source.buffer = bank("white")[0];
        const low = filter("lowpass", 520, 0.7);
        const env = context.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(0.7, at + 0.12);
        env.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);
        source.connect(low).connect(env).connect(nodes.water);
        source.start(at, Math.random() * 2);
        source.stop(at + 0.55);
        const osc = context.createOscillator();
        const gulp = context.createGain();
        osc.frequency.setValueAtTime(170, at + 0.2);
        osc.frequency.exponentialRampToValueAtTime(46, at + 0.7);
        gulp.gain.setValueAtTime(0, at + 0.2);
        gulp.gain.linearRampToValueAtTime(1.0, at + 0.24);
        gulp.gain.exponentialRampToValueAtTime(0.0005, at + 0.85);
        osc.connect(gulp).connect(nodes.water);
        osc.start(at + 0.19);
        osc.stop(at + 0.9);
        for (let k = 0; k < 3; k++) click(at + 0.62 + k * 0.09, 0.5 - k * 0.12, 800, 0.05, nodes.water);
        bubbles(8, 0.6, 0.6, 0.7, at + 0.3);
      } else {
        click(at, 0.55, 2600, 0.025, nodes.surface);
        play(variant(`splash:${step(3)}`, () => makeSplash(stepSize(step(3)))), nodes.surface, MIX.splash * 0.9, at);
        bubbles(10, 0.4, 0.8, 0.8, at + 0.05);
      }
    },
    // A knock of some kind: "body" (a blow in a fight, a hunter's bite), "rock", "wood" (the
    // mill wheel, a branch), "net", "hook". `strength` 0..1.5.
    thump(kind = "body", strength = 1) {
      if (!ready()) return;
      play(pick(bank(KNOCKS.includes(kind) ? kind : "body")), nodes.water, MIX.knock * Math.min(1.5, strength), undefined, random(0.93, 1.07));
    },
    // A splash of something `size` long (in the game's lengths) hitting the water, `strength`
    // 0..1.6: the spray at the surface, and its bubbles under it.
    splash(strength = 1, size = 1) {
      if (!ready()) return;
      const k = step(size);
      const exact = (1 + 0.35 * stepSize(k)) / (1 + 0.35 * size);
      const at = context.currentTime + 0.01;
      play(variant(`splash:${k}`, () => makeSplash(stepSize(k))), nodes.surface, MIX.splash * Math.min(1.5, strength), at, exact * random(0.92, 1.08));
      // (A bigger body drags bigger bubbles down with it, and they ring lower.)
      bubbles(6 + strength * 8, 0.5, 1.1 / (1 + 0.35 * size), 0.8, at + 0.04);
    },
    // Breaking out of the water in a leap (or thrown out over a fall).
    leap(size = 1) {
      if (!ready()) return;
      play(pick(bank("breach")), master, MIX.breach * (0.7 + 0.1 * Math.min(size, 5)), undefined, random(0.92, 1.08) / (1 + 0.04 * size));
    },
    // Back in: the water closing over the fish.
    dive(size = 1) {
      if (!ready()) return;
      const k = step(size);
      play(variant(`blup:${k}`, () => makeBlup(stepSize(k)), 2), master, MIX.blup, undefined, random(0.92, 1.08));
    },
    // A call from above the water: the kingfisher's thin, piercing whistle.
    call(kind = "kingfisher") {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      // (Under water it comes through the surface dulled, and it is a warning: played louder
      // by about what the surface takes from it at its pitch, it is still heard.)
      const loud = MIX.call * (1 + 7.5 * submerged);
      for (let k = 0; k < 2; k++) {
        const osc = context.createOscillator();
        const env = context.createGain();
        const t0 = at + k * 0.16;
        osc.frequency.setValueAtTime(3600, t0);
        osc.frequency.exponentialRampToValueAtTime(4300, t0 + 0.09);
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(loud, t0 + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.12);
        osc.connect(env).connect(nodes.air);
        osc.start(t0);
        osc.stop(t0 + 0.14);
      }
      void kind;
    },
    // A new stage of life: a soft swell and a rising run of bell tones, bright and clear,
    // with a flurry of bubbles.
    fanfare() {
      if (!ready()) return;
      const at = context.currentTime + 0.05;
      const bus = amp(0.55);
      bus.connect(nodes.ui);
      // The swell under it.
      const swell = context.createBufferSource();
      swell.buffer = bank("white")[0];
      const band = filter("bandpass", 600, 0.7);
      const swellGain = amp(0);
      swellGain.gain.setValueAtTime(0, at);
      swellGain.gain.linearRampToValueAtTime(0.12, at + 0.5);
      swellGain.gain.exponentialRampToValueAtTime(0.0005, at + 2.6);
      band.frequency.setValueAtTime(300, at);
      band.frequency.exponentialRampToValueAtTime(1800, at + 1.6);
      swell.connect(band).connect(swellGain).connect(bus);
      swell.start(at, Math.random() * 2);
      swell.stop(at + 2.8);
      // The bells: a major arpeggio up an octave and a half, the last held.
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => {
        const t0 = at + 0.12 + i * 0.13;
        const hold = i === notes.length - 1 ? 2.2 : 0.9;
        let out = bus;
        if (context.createStereoPanner) {
          out = context.createStereoPanner();
          out.pan.value = (i / (notes.length - 1)) * 0.8 - 0.4;
          out.connect(bus);
        }
        for (const [ratio, level] of [
          [1, 0.16],
          [2.01, 0.05],
          [3.02, 0.018],
        ]) {
          const osc = context.createOscillator();
          const env = context.createGain();
          osc.frequency.value = f * ratio;
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(level, t0 + 0.012);
          env.gain.exponentialRampToValueAtTime(0.0003, t0 + hold);
          osc.connect(env).connect(out);
          osc.start(t0);
          osc.stop(t0 + hold + 0.05);
        }
      });
      bubbles(14, 1.4, 1.2, 0.8, at + 0.2);
    },
    // A badge: two or three quick bell tones up (three and brighter for a gold one), and a
    // few bubbles.
    chime(tier = "bronze") {
      if (!ready()) return;
      const at = context.currentTime + 0.03;
      const bus = amp(0.4);
      bus.connect(nodes.ui);
      const notes = tier === "gold" ? [783.99, 1046.5, 1567.98] : tier === "silver" ? [659.25, 987.77] : [587.33, 880];
      notes.forEach((f, i) => {
        const t0 = at + i * 0.09;
        const hold = i === notes.length - 1 ? 1.1 : 0.45;
        for (const [ratio, level] of [
          [1, 0.12],
          [2.01, 0.035],
        ]) {
          const osc = context.createOscillator();
          const env = context.createGain();
          osc.frequency.value = f * ratio;
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(level, t0 + 0.01);
          env.gain.exponentialRampToValueAtTime(0.0003, t0 + hold);
          osc.connect(env).connect(bus);
          osc.start(t0);
          osc.stop(t0 + hold + 0.05);
        }
      });
      bubbles(5, 0.5, 1.1, 0.6, at + 0.1);
    },
    // Thunder: when it is close a crack first, then the rumble rolling away in a few
    // swells. Under water the crack is dulled and the rumble comes through. `near` 0..1.
    thunder(near = 0.5) {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      if (near > 0.6) click(at, 1.2 * near, 2400, 0.06, nodes.air);
      const source = context.createBufferSource();
      source.buffer = bank("brown")[0];
      const low = filter("lowpass", 200 + 500 * near, 0.6);
      const env = context.createGain();
      const length = 2.6 + 2.6 * (1 - near);
      const peak = MIX.thunder * (0.35 + 0.65 * near);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + 0.06 + 0.35 * (1 - near));
      for (let k = 1; k < 5; k++) env.gain.linearRampToValueAtTime(peak * (0.45 + 0.4 * Math.random()) * (1 - k / 6), at + (k * length) / 6);
      env.gain.exponentialRampToValueAtTime(0.0005, at + length);
      source.connect(low).connect(env).connect(nodes.air);
      source.start(at, Math.random() * 3);
      source.stop(at + length + 0.1);
    },
    // Otters at play: quick, high chirps and squeaks.
    otter() {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const osc = context.createOscillator();
        const env = context.createGain();
        const t0 = at + k * (0.09 + Math.random() * 0.08);
        const f = 1800 + Math.random() * 1400;
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, t0);
        osc.frequency.exponentialRampToValueAtTime(f * (0.55 + Math.random() * 0.3), t0 + 0.07);
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(MIX.otter * (1 + 4 * submerged), t0 + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.09);
        osc.connect(env).connect(nodes.air);
        osc.start(t0);
        osc.stop(t0 + 0.11);
      }
    },
    // A fishing line: the reel's ratchet ticking as it is pulled in, or the line snapping.
    reel() {
      if (!ready()) return;
      play(pick(bank("reel")), nodes.surface, 2.2, undefined, random(0.95, 1.05));
    },
    snap() {
      if (!ready()) return;
      const at = context.currentTime + 0.01;
      click(at, 1.2, 2600, 0.03, nodes.surface);
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.frequency.setValueAtTime(900, at);
      osc.frequency.exponentialRampToValueAtTime(260, at + 0.25);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.8, at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0005, at + 0.3);
      osc.connect(env).connect(nodes.surface);
      osc.start(at);
      osc.stop(at + 0.32);
    },
    // A nip from another young fish: a small sharp tick and a bubble.
    nip() {
      if (!ready()) return;
      play(pick(bank("nip")), nodes.water, MIX.nip, undefined, random(0.92, 1.08));
    },
    // Another fish taking a fly off the surface somewhere near: a soft sip and a bubble,
    // fainter the further off.
    rise(distance = 5) {
      if (!ready()) return;
      const loud = Math.max(0, 1 - distance / 30);
      if (loud <= 0.02) return;
      play(pick(bank("rise")), nodes.surface, MIX.rise * loud, undefined, random(0.9, 1.1));
    },
    // Each frame: the river round the fish. `submerged` 0..1 (or `above`), the rest as the
    // world has them.
    update(dt, { rain = 0, daylight = 1, stir = 0, roar = 0, sea = 0, above = false, submerged: under = above ? 0 : 1, depth = 1 } = {}) {
      if (!context || !nodes) return;
      if (performance.now() >= sleepAt) sleep();
      submerged += (under - submerged) * (1 - Math.exp(-dt / EASE));
      if (context.state !== "running") return;
      const now = context.currentTime;
      if (!(Math.abs(under - crossing) < 0.02)) cross(under, now);
      clock += dt;
      const stirred = Math.min(1, stir);
      const river = 1 - sea;
      const night = 1 - daylight;
      if (clock > nextBubble) {
        const rate = 1.2 + 5 * stirred + 4 * rain + 14 * roar;
        nextBubble = clock + -Math.log(1 - Math.random()) / rate;
        if (submerged > 0.5 && wanted()) play(pick(bank("bubble")), nodes.water, (0.05 + Math.random() * 0.08) * MIX.bubble, now + 0.02, random(0.9, 1.15));
      }
      if (clock > nextGurgle) {
        nextGurgle = clock + 0.35 + Math.random() * 0.9;
        const g = pick(nodes.gurgles);
        g.band.frequency.setTargetAtTime(g.base * (0.7 + Math.random() * 0.8), now, 0.25);
        g.level.gain.setTargetAtTime(MIX.gurgle * (0.25 + Math.random() * 0.55) * (1 + stirred + roar) * (1 - 0.3 * night) * river, now, 0.2);
        g.level.gain.setTargetAtTime(MIX.gurgle * 0.05 * river, now + 0.5 + Math.random() * 0.6, 0.4);
      }
      if (clock < nextSteer) return;
      nextSteer = clock + STEER;
      const k = nodes.knobs;
      const swell = 0.8 + 0.2 * Math.sin(clock * 0.21) + 0.08 * Math.sin(clock * 0.53 + 1.3);
      const burble = 0.75 + 0.25 * Math.sin(clock * 0.37 + 2) * Math.sin(clock * 0.11);
      steer(k.rush, MIX.rush * (0.5 + 0.25 * stirred) * swell * (1 - 0.25 * night) * (0.45 + 0.55 * river), now, 0.4);
      steer(k.rushTone, 380 + 240 * stirred - 90 * night - 120 * sea, now, 0.3);
      steer(k.rumble, MIX.rumble * (0.9 + 0.1 * swell), now, 1);
      steer(k.flow, MIX.flow * swell * (1 + 0.5 * stirred) * (1 - 0.3 * night) * (0.35 + 0.65 * river), now, 0.4);
      steer(k.flowTone, 480 + 160 * stirred - 60 * night - 100 * sea, now, 0.4);
      steer(k.burble, MIX.burble * burble * (1 + 0.8 * stirred + roar) * (1 - 0.35 * night) * river, now, 0.5);
      steer(k.burbleTone, 820 + 200 * stirred - 80 * night, now, 0.5);
      steer(k.roar, MIX.roar * roar, now, 0.5);
      steer(k.roarLow, MIX.roarLow * roar, now, 0.5);
      steer(k.whiteWater, MIX.whiteWater * roar, now, 0.5);
      const wash = 0.55 + 0.45 * Math.sin(clock * 0.13) * Math.sin(clock * 0.047 + 1);
      steer(k.wash, MIX.wash * sea * wash, now, 1.2);
      steer(k.washTone, 200 + 260 * wash, now, 1);
      steer(k.washMid, MIX.washMid * sea * (0.4 + 0.6 * wash), now, 1.2);
      steer(k.air, MIX.air * (0.8 + 0.2 * swell) * (1 + 0.6 * roar + 0.8 * rain), now, 0.4);
      steer(k.rain, MIX.rain * rain, now, 1.2);
      steer(k.rainUnder, MIX.rainUnder * rain, now, 1.2);
      clearTone = 7000 * (1 - 0.3 * night) * (1 - 0.45 * Math.min(1, depth / 40));
      steer(k.waterTone, waterTone(), now, 0.4);
    },
  };
}
