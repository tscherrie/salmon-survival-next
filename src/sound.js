// The sound of the water, made from noise and filters with the Web Audio API (nothing is
// recorded). Under water: a deep rush with a burbling flow over it, eddies gurgling, bubbles
// ringing; the roar of a fall or a rapid swelling as the fish comes near it; in the sea a
// slower, deeper wash. What happens above the water -- rain on the surface, a splash, a
// bird's call, thunder -- comes down through the surface muffled; out in the air in a leap
// it is bright and open, and the water's own sound drops away under it.
// Browsers allow sound only after a click, a tap or a key, so it starts then; T turns it
// off and on. Off, hidden, or paused for long, the sound device is let go (a phone's battery).
//
// Everything goes through one master (the volume, off, the hush of a pause), a compressor
// and a limiter that keeps the peaks under full scale, in five groups:
//   water    what sounds in the water: the beds (through their own `ambience` bus, which the
//            heartbeat ducks), bubbles, eddies, what the fish does, hunters coming
//   surface  what sounds at the surface: splashes, rain on it, the white water of a fall
//   air      what sounds in the air: the air itself, calls, thunder, the angler's reel
//   body     the fish's own body: its heart, its gills, its jaws
//   ui       the bells of a new stage of life or a badge
// All but the bells go through `world` first, which the white veil of spawning closes (a
// bell can still ring into the silence). How far under the ear is (`submerged`, 0..1,
// eased over about a tenth of a second) opens one and closes the others. The crossing
// itself (breaking out, going back in) is heard as it is, neither in the water nor out of it.
//
// The noise and the short sounds heard often (bubbles, splashes, knocks) are made ahead as
// plain samples, a slice at a time while the game loads, and played back as they are: a
// source and a level each, instead of a tangle of oscillators and filters every time.

import { RATE, random, pick, makeBurst, KNOCKS, makeBlup, makeSplash, makeSwallow, createWorkshop, makeAll, step, stepSize } from "./sound-make.js";

const STORAGE_KEY = "habitat-sound";
// The master level, with sound on and nothing hushing it.
const LEVEL = 0.32;
// The ear crossing the surface (s): quick, but not a click.
const EASE = 0.12;
// The bed is steered this often (s): its values move slowly, and each change is a message
// to the audio thread.
const STEER = 0.05;
// Above this (Hz) the surface takes the edge off what comes through it.
const DIM = 800;
// At most this many one-shots at once; the river's own small sounds (bubbles, ticks) stop
// coming at the lower number, so that a cue is never the one left out.
const VOICES = 64;
const AMBIENT_VOICES = 32;
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
    // The voices sounding now (one-shots of any kind), the most at once, the nodes made
    // since the start and the bytes of sample memory held (for stats and the checks).
    live = 0,
    peakLive = 0,
    made = 0,
    bytes = 0;
  // What keeps it quiet (a pause, the logbook, death, a hidden page): each its own reason,
  // so that one ending does not end the others.
  const hushes = new Set();
  // The world round the fish as update() was last told it (one object, kept).
  const here = { brook: 0, upper: 0, middle: 1, lower: 0, estuary: 0, sea: 0, flow: 1, depthRel: 0.5, ice: 0, flood: 0, energy: 1, breath: 1, winded: false, danger: 0, home: 0, mill: 0 };
  const raw = {};
  const banks = {};
  const sized = new Map();
  const workshop = createWorkshop();
  workshop.add(makeAll(raw));

  // (`rate` lower for the deep sounds, which need no more: half the memory at 24 kHz.)
  const toBuffer = (channels, rate = RATE) => {
    const buffer = context.createBuffer(channels.length, channels[0].length, rate);
    channels.forEach((data, c) => buffer.getChannelData(c).set(data));
    bytes += channels.length * channels[0].length * 4;
    return buffer;
  };
  const bank = (name) => (banks[name] ??= raw[name].map((channels) => toBuffer(channels)));
  // A sound that depends on a size, made the first few times it is asked for and then
  // reused (a few versions of each, so no two in a row are quite the same).
  function variant(key, make, count = 3) {
    let list = sized.get(key);
    if (!list) sized.set(key, (list = []));
    if (list.length < count) list.push(toBuffer(make()));
    return pick(list);
  }

  // When each cue last sounded (by the audio clock): one that comes again within its own
  // few seconds is let pass. Keys are short fixed strings, so asking allocates nothing.
  const cooled = new Map();
  function coolOk(key, seconds) {
    const now = context.currentTime;
    if (now - (cooled.get(key) ?? -1e9) < seconds) return false;
    cooled.set(key, now);
    return true;
  }

  function loop(buffer) {
    const source = context.createBufferSource();
    made++;
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0.25;
    source.loopEnd = buffer.duration;
    source.start(0, Math.random() * buffer.duration * 0.8);
    return source;
  }
  const filter = (type, frequency, q = 0.7) => {
    made++;
    const f = context.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const amp = (value) => {
    made++;
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
    made += 2;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.ratio.value = 3;
    // The limiter: hard and fast over the last few decibels, so that nothing clips however
    // much comes at once. (A browser's compressor adds back what it takes at full scale --
    // about 2.3 dB for this one -- so the trim before it takes that off again first, and
    // everything under its threshold passes as it was.)
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    master.connect(compressor).connect(amp(0.77)).connect(limiter).connect(context.destination);
    // Everything but the bells: closed by the white veil of spawning.
    const world = amp(1);
    world.connect(master);
    const [brown] = bank("brown");
    const [pink] = bank("pink");

    // The groups. Water: clear under water; from above only a dull, low murmur of it. What
    // must keep its brightness (rain pinging on the surface overhead) joins after its top.
    const water = amp(1);
    const waterTone = filter("lowpass", 7000, -3);
    const waterBright = amp(1);
    const waterDuck = amp(1);
    water.connect(waterTone).connect(waterBright).connect(waterDuck).connect(world);
    // The beds and the river's small sounds, on a bus of their own (the heartbeat ducks it).
    const ambience = amp(1);
    ambience.connect(water);
    // Surface and air: bright in the air; under water through the surface's muffle.
    const surface = amp(1);
    const air = amp(1);
    const through = amp(1);
    surface.connect(through);
    air.connect(through);
    const dry = amp(0);
    through.connect(dry).connect(world);
    const [dim, dimTop] = muffle();
    const wet = amp(1);
    through.connect(dim);
    dimTop.connect(wet).connect(world);
    // The fish's own body: the same in the water and out of it.
    const body = amp(1);
    body.connect(world);
    const ui = amp(MIX.ui);
    ui.connect(master);

    // The rush: the river's deep, broad voice, felt as much as heard.
    const rushFilter = filter("lowpass", 420, 0.6);
    const rushGain = amp(0);
    loop(brown).connect(rushFilter).connect(rushGain).connect(ambience);
    const rumbleGain = amp(0);
    loop(brown).connect(filter("lowpass", 90, 0.9)).connect(rumbleGain).connect(ambience);
    // The flow over it: the water moving past stones, a band in the low middle (where a
    // phone's small speaker still plays), and a burble above that, both slowly swelling.
    const flowBand = filter("bandpass", 480, 0.9);
    const flowGain = amp(0);
    loop(pink).connect(flowBand).connect(flowGain).connect(ambience);
    const burbleBand = filter("bandpass", 820, 1.6);
    const burbleGain = amp(0);
    loop(pink).connect(burbleBand).connect(burbleGain).connect(ambience);
    // The roar of falling and breaking water under it: broad, mid-low, churning.
    const roarGain = amp(0);
    loop(pink).connect(filter("bandpass", 420, 0.6)).connect(roarGain).connect(ambience);
    const roarLowGain = amp(0);
    loop(brown).connect(filter("lowpass", 160, 0.8)).connect(roarLowGain).connect(ambience);
    // The same white water at the surface: bright and hissing in the air.
    const whiteWaterGain = amp(0);
    loop(pink).connect(filter("bandpass", 1300, 0.5)).connect(whiteWaterGain).connect(surface);
    // The sea's slow wash, and its middle.
    const washFilter = filter("lowpass", 300, 0.5);
    const washGain = amp(0);
    const washSource = loop(pink);
    washSource.connect(washFilter).connect(washGain).connect(ambience);
    const washMid = filter("bandpass", 380, 0.8);
    const washMidGain = amp(0);
    washSource.connect(washMid).connect(washMidGain).connect(ambience);
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
      if (pan) made++;
      if (pan) pan.pan.value = (i / 4) * 1.4 - 0.7;
      source.connect(band).connect(level);
      if (pan) level.connect(pan).connect(ambience);
      else level.connect(ambience);
      gurgles.push({ band, level, base: 220 + i * 140 });
    }
    // Rain on the surface; and under it, the patter of the drops come down through the
    // water, a fine hiss of its own.
    const rainGain = amp(0);
    loop(pink).connect(filter("highpass", 700, 0.5)).connect(filter("lowpass", 3200, 0.5)).connect(rainGain).connect(surface);
    const rainUnderGain = amp(0);
    loop(pink).connect(filter("bandpass", 1500, 0.8)).connect(rainUnderGain).connect(ambience);
    nodes = {
      world,
      water,
      waterBright,
      ambience,
      surface,
      air,
      body,
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

  // A sound played once, kept count of while it sounds; when it ends its last node (the
  // one on the bus) is let go, and the rest with it.
  function voice(source, last) {
    live++;
    if (live > peakLive) peakLive = live;
    source.onended = () => {
      live--;
      last.disconnect();
    };
    return source;
  }
  // Too many at once: the river's small sounds give way first, then everything new.
  const crowded = (ambient = false) => live >= (ambient ? AMBIENT_VOICES : VOICES);
  const oscillator = (type = "sine") => {
    made++;
    const o = context.createOscillator();
    o.type = type;
    return o;
  };
  const bufferSource = (buffer) => {
    made++;
    const b = context.createBufferSource();
    b.buffer = buffer;
    return b;
  };
  // Left (-1) to right (1); where a browser has no panner, in the middle.
  const panner = (value) => {
    if (!context.createStereoPanner) return null;
    made++;
    const p = context.createStereoPanner();
    p.pan.value = value;
    return p;
  };
  // A made sound played once: its source and its level, two nodes (three placed left or
  // right), nothing to schedule. `ambient` for the river's own small sounds, which give way
  // first when too much is sounding.
  function play(buffer, bus, loudness, at = context.currentTime + 0.01, rate = 1, pan = 0, ambient = false) {
    if (crowded(ambient)) return null;
    const source = bufferSource(buffer);
    source.playbackRate.value = rate;
    const gain = amp(loudness);
    source.connect(gain);
    const p = pan ? panner(pan) : null;
    const last = p ? gain.connect(p) : gain;
    last.connect(bus);
    source.start(at);
    return voice(source, last);
  }
  const bubbles = (count, spread, low, loudness, at) => {
    const n = Math.max(2, Math.round(count / 3) * 3);
    const buffer = variant(`burst:${n}:${spread}:${Math.round(low * 10)}`, () => makeBurst(n, spread, Math.round(low * 10) / 10));
    play(buffer, nodes.water, loudness * MIX.burst, at, random(0.94, 1.06));
  };
  // A click: a few milliseconds of noise in a band, as of jaws or a bill closing (for the
  // sounds too rare to be worth making ahead).
  function click(at, loudness, frequency, length, bus) {
    if (crowded()) return;
    const source = bufferSource(bank("white")[0]);
    const band = filter("bandpass", frequency, 1.4);
    const env = amp(0);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(loudness, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0005, at + length);
    source.connect(band).connect(env).connect(bus);
    source.start(at, Math.random() * 2);
    source.stop(at + length + 0.02);
    voice(source, env);
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
      return { state: context?.state ?? "none", time: context?.currentTime ?? 0, live, peakLive, nodes: made, bytes, asleep, level, hushes: [...hushes], sleepIn: (sleepAt - performance.now()) / 1000 };
    },
    // For extensions (src/mods.js): the context and the groups to play into, while the
    // sound is on and running, else null. What plays into a group goes through the master,
    // so mute, pause and the ear crossing the surface apply to it as to everything else.
    buses() {
      return ready() ? { context, water: nodes.water, surface: nodes.surface, air: nodes.air, ui: nodes.ui } : null;
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
        const source = bufferSource(bank("white")[0]);
        const low = filter("lowpass", 520, 0.7);
        const env = amp(0);
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(0.7, at + 0.12);
        env.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);
        source.connect(low).connect(env).connect(nodes.water);
        source.start(at, Math.random() * 2);
        source.stop(at + 0.55);
        voice(source, env);
        const osc = oscillator();
        const gulp = amp(0);
        osc.frequency.setValueAtTime(170, at + 0.2);
        osc.frequency.exponentialRampToValueAtTime(46, at + 0.7);
        gulp.gain.setValueAtTime(0, at + 0.2);
        gulp.gain.linearRampToValueAtTime(1.0, at + 0.24);
        gulp.gain.exponentialRampToValueAtTime(0.0005, at + 0.85);
        osc.connect(gulp).connect(nodes.water);
        osc.start(at + 0.19);
        osc.stop(at + 0.9);
        voice(osc, gulp);
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
      play(pick(bank("breach")), nodes.world, MIX.breach * (0.7 + 0.1 * Math.min(size, 5)), undefined, random(0.92, 1.08) / (1 + 0.04 * size));
    },
    // Back in: the water closing over the fish.
    dive(size = 1) {
      if (!ready()) return;
      const k = step(size);
      play(variant(`blup:${k}`, () => makeBlup(stepSize(k)), 2), nodes.world, MIX.blup, undefined, random(0.92, 1.08));
    },
    // A call from above the water: the kingfisher's thin, piercing whistle.
    call(kind = "kingfisher") {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      // (Under water it comes through the surface dulled, and it is a warning: played louder
      // by about what the surface takes from it at its pitch, it is still heard.)
      const loud = MIX.call * (1 + 7.5 * submerged);
      for (let k = 0; k < 2; k++) {
        const osc = oscillator();
        const env = amp(0);
        const t0 = at + k * 0.16;
        osc.frequency.setValueAtTime(3600, t0);
        osc.frequency.exponentialRampToValueAtTime(4300, t0 + 0.09);
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(loud, t0 + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.12);
        osc.connect(env).connect(nodes.air);
        osc.start(t0);
        osc.stop(t0 + 0.14);
        voice(osc, env);
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
      const swell = bufferSource(bank("white")[0]);
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
      voice(swell, swellGain);
      // The bells: a major arpeggio up an octave and a half, the last held.
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => {
        const t0 = at + 0.12 + i * 0.13;
        const hold = i === notes.length - 1 ? 2.2 : 0.9;
        let out = bus;
        const p = panner((i / (notes.length - 1)) * 0.8 - 0.4);
        if (p) {
          p.connect(bus);
          out = p;
        }
        for (const [ratio, level] of [
          [1, 0.16],
          [2.01, 0.05],
          [3.02, 0.018],
        ]) {
          const osc = oscillator();
          const env = amp(0);
          osc.frequency.value = f * ratio;
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(level, t0 + 0.012);
          env.gain.exponentialRampToValueAtTime(0.0003, t0 + hold);
          osc.connect(env).connect(out);
          osc.start(t0);
          osc.stop(t0 + hold + 0.05);
          voice(osc, env);
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
          const osc = oscillator();
          const env = amp(0);
          osc.frequency.value = f * ratio;
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(level, t0 + 0.01);
          env.gain.exponentialRampToValueAtTime(0.0003, t0 + hold);
          osc.connect(env).connect(bus);
          osc.start(t0);
          osc.stop(t0 + hold + 0.05);
          voice(osc, env);
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
      const source = bufferSource(bank("brown")[0]);
      const low = filter("lowpass", 200 + 500 * near, 0.6);
      const env = amp(0);
      const length = 2.6 + 2.6 * (1 - near);
      const peak = MIX.thunder * (0.35 + 0.65 * near);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + 0.06 + 0.35 * (1 - near));
      for (let k = 1; k < 5; k++) env.gain.linearRampToValueAtTime(peak * (0.45 + 0.4 * Math.random()) * (1 - k / 6), at + (k * length) / 6);
      env.gain.exponentialRampToValueAtTime(0.0005, at + length);
      source.connect(low).connect(env).connect(nodes.air);
      source.start(at, Math.random() * 3);
      source.stop(at + length + 0.1);
      voice(source, env);
    },
    // Otters at play: quick, high chirps and squeaks.
    otter() {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const osc = oscillator();
        const env = amp(0);
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
        voice(osc, env);
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
      const osc = oscillator();
      const env = amp(0);
      osc.frequency.setValueAtTime(900, at);
      osc.frequency.exponentialRampToValueAtTime(260, at + 0.25);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.8, at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0005, at + 0.3);
      osc.connect(env).connect(nodes.surface);
      osc.start(at);
      osc.stop(at + 0.32);
      voice(osc, env);
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
    // world has them: `regions` the weights of brook .. sea (without them, river or sea by
    // `sea`), `flow` the current's speed, `depthRel` 0 at the surface .. 1 on the bed, `ice`
    // the cover over it, `flood` a spate; the fish's `energy`, `breath` and `winded`; `danger`
    // a strike about to come, `home` the scent of the home brook, `mill` how near the wheel.
    update(dt, { rain = 0, daylight = 1, stir = 0, roar = 0, sea = 0, above = false, submerged: under = above ? 0 : 1, depth = 1, regions = null, flow = 1, depthRel = 0.5, ice = 0, flood = 0, energy = 1, breath = 1, winded = false, danger = 0, home = 0, mill = 0 } = {}) {
      if (!context || !nodes) return;
      here.brook = regions ? (regions.brook ?? 0) : 0;
      here.upper = regions ? (regions.upper ?? 0) : 0;
      here.middle = regions ? (regions.middle ?? 0) : 1 - sea;
      here.lower = regions ? (regions.lower ?? 0) : 0;
      here.estuary = regions ? (regions.estuary ?? 0) : 0;
      here.sea = regions ? (regions.sea ?? sea) : sea;
      here.flow = flow;
      here.depthRel = depthRel;
      here.ice = ice;
      here.flood = flood;
      here.energy = energy;
      here.breath = breath;
      here.winded = winded;
      here.danger = danger;
      here.home = home;
      here.mill = mill;
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
        if (submerged > 0.5 && wanted()) play(pick(bank("bubble")), nodes.ambience, (0.05 + Math.random() * 0.08) * MIX.bubble, now + 0.02, random(0.9, 1.15), 0, true);
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
