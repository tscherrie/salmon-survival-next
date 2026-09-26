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
import { makeCues } from "./sound-cues.js";
import { makeWorld } from "./sound-world.js";

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
  flow: 1.0,
  burble: 0.42,
  roar: 0.6,
  roarLow: 0.37,
  wash: 0.5,
  washMid: 1.15,
  gurgle: 0.8,
  gravel: 0.15,
  rain: 0.4,
  rainUnder: 0.6,
  pings: 0.28,
  clatter: 0.6,
  chirp: 0.25,
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
  whump: 0.4,
  trail: 0.7,
  jaws: 0.75,
  denied: 0.55,
  thud: 0.6,
  gasp: 0.25,
  gills: 0.09,
  charge: 1.0,
  tick: 0.6,
  cleared: 0.1,
  swell: 0.5,
  pulse: 0.3,
  coil: 0.4,
  snap: 0.8,
  moan: 0.25,
  heart: 0.5,
  fanfare: 0.55,
  chime: 0.55,
  victory: 0.2,
  growth: 0.6,
  hatch: 0.35,
  pad: 0.05,
  ending: 0.6,
  storm: 0.5,
  home: 0.5,
  slap: 0.5,
  creak: 0.25,
  plops: 0.6,
  counter: 0.6,
  crack: 0.7,
};
// The leap's sweet spot (main.js: a leap released above this on the swing clears the fall).
const SWEET = 0.82;
// The hunters' voices: the sample, the group it sounds in, how loud, and how much louder
// under water -- by about what the surface takes from it at its pitch, so that a warning is
// still heard (a kingfisher's whistle loses most, a bear's huff hardly anything). Fish and
// the otter under water have none: the swell of pressure is their voice.
const CALLS = {
  kingfisher: { bank: "kingfisher", bus: "air", loud: 0.4, under: 7.5 },
  heron: { bank: "heron", bus: "air", loud: 0.55, under: 2.5 },
  merganser: { bank: "merganser", bus: "air", loud: 0.8, under: 2 },
  drive: { bank: "merganser", bus: "air", loud: 0.8, under: 2 },
  seal: { bank: "sealWhoosh", bus: "water", loud: 0.8, under: 0 },
  bear: { bank: "bear", bus: "air", loud: 0.8, under: 1 },
};
const BIRDS = ["kingfisher", "heron", "merganser", "drive"];

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
    nextGravel = 0,
    nextClatter = 0,
    nextChirp = 0,
    nextSlap = 0,
    nextCreak = 0,
    nextSteer = 0,
    lastSwallow = 0,
    submerged = 1,
    crossing = NaN,
    clearTone = 7000,
    // The heart: beating until then (by the frame clock), how fast, when the next beat is.
    heartUntil = -1,
    // Spawning: when the heart began to calm (by the frame clock).
    calmFrom = -1e9,
    bpm = 64,
    nextBeat = 0,
    beating = false,
    // A strike about to come, as the warnings last had it; the warnings' round (see warn()).
    warnDanger = false,
    warnRound = 0,
    // The leap's charge: its tone while the meter swings, and where the swing last was.
    chargeTone = null,
    chargeLevel = null,
    chargeAt = 0,
    chargeWritten = -1,
    // The voices sounding now (one-shots of any kind), the most at once, the nodes made
    // since the start and the bytes of sample memory held (for stats and the checks).
    live = 0,
    peakLive = 0,
    made = 0,
    bytes = 0;
  // What keeps it quiet (a pause, the logbook, death, a hidden page): each its own reason,
  // so that one ending does not end the others.
  const hushes = new Set();
  // What the ear knows of each hunter (by the game's own object for it), and the ones heard
  // in the last round of warnings.
  const heard = new WeakMap();
  const tracked = [];
  const raw = {};
  const banks = {};
  const sized = new Map();
  const workshop = createWorkshop();
  workshop.add(makeAll(raw));
  workshop.add(makeCues(raw));
  workshop.add(makeWorld(raw));

  // (At half the rate for what has nothing much high in it: see half() in sound-make.js.)
  const toBuffer = (channels, rate = channels.rate ?? RATE) => {
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

  // A sample looping for good (`from` where its loop starts: the beds' noise is faded
  // into its first quarter second, the newer loops need no such start).
  function loop(buffer, from = 0.25) {
    const source = context.createBufferSource();
    made++;
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = from;
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
  // A value the bed steers, written only when it has moved enough to be heard, easing
  // there with time constant `tau` (s).
  const knob = (param, tolerance = 0.02, floor = 0.002) => ({ param, last: NaN, tolerance, floor });
  function steer(k, value, now, tau) {
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
    // The fish's own body: the same in the water and out of it; its gills while it is winded.
    const body = amp(1);
    body.connect(world);
    const gillsGain = amp(0);
    loop(bank("gills")[0]).connect(gillsGain).connect(body);
    // The scent of home, for a spawner on its way back (see update(): `home`).
    const homeGain = amp(0);
    loop(bank("home")[0], 0).connect(homeGain).connect(water);
    const ui = amp(MIX.ui);
    ui.connect(master);

    // The rush: the river's deep, broad voice, felt as much as heard.
    const rushFilter = filter("lowpass", 420, 0.6);
    const rushGain = amp(0);
    loop(brown).connect(rushFilter).connect(rushGain).connect(ambience);
    const rumbleGain = amp(0);
    const rumbleFilter = filter("lowpass", 90, 0.9);
    loop(brown).connect(rumbleFilter).connect(rumbleGain).connect(ambience);
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
    const washMid = filter("bandpass", 330, 1.3);
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
    // Heard from below, each drop pings on the surface overhead: too high for the water's
    // top (it would take them), so they join after it -- and only while the ear is under.
    const pingsGain = amp(0);
    const pingsUnder = amp(1);
    loop(bank("pings")[0], 0).connect(pingsGain).connect(pingsUnder).connect(waterBright);
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
        rumbleTone: knob(rumbleFilter.frequency, 0.015, 1),
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
        pings: knob(pingsGain.gain),
        waterTone: knob(waterTone.frequency, 0.015, 1),
        gills: knob(gillsGain.gain),
        home: knob(homeGain.gain),
        ambience: knob(ambience.gain),
      },
      // Moved only when the ear crosses the surface, at the pace of the crossing.
      crossing: { pingsUnder: pingsUnder.gain, waterDuck: waterDuck.gain, dry: dry.gain, wet: wet.gain, airOpen: airOpen.gain, surface: surface.gain, air: air.gain },
    };
    for (const name of ["gravel", "clatter", "chirp", "bubble", ...KNOCKS, "nip", "breach", "rise", "reel", "whump", "jaws", "denied", "thud", "gasp", "tick", "cleared", "swell", "pulse", "coil", "heart", "kingfisher", "heron", "merganser", "sealWhoosh", "sealMoan", "bear", "fanfare", "chime-bronze", "chime-silver", "chime-gold", "victory", "growth", "hatch", "crack", "slap", "creak", "plops", "counter"]) bank(name);
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
    c.pingsUnder.setTargetAtTime(value, now, EASE);
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

  function sayCall(kind, pan) {
    const c = CALLS[kind];
    if (!c) return;
    play(pick(bank(c.bank)), nodes[c.bus], c.loud * (1 + c.under * submerged), undefined, random(0.95, 1.05), pan);
    // A seal now and then moans as well, far off through the water.
    if (kind === "seal" && Math.random() < 0.35 && coolOk("moan", 40)) play(bank("sealMoan")[0], nodes.water, MIX.moan, context.currentTime + random(0.8, 1.6), random(0.9, 1.1), -0.5 * pan);
  }
  // A strike that missed: the jaws (a bill, a paw) shutting on nothing, where the hunter is.
  function missed(h) {
    const bird = BIRDS.includes(h.kind);
    if (h.kind === "bear") play(pick(bank("body")), nodes.surface, MIX.knock * 0.8, undefined, random(0.8, 0.9), h.pan);
    else play(pick(bank("jaws")), nodes.water, MIX.snap, undefined, bird ? random(1.1, 1.2) : random(0.55, 0.65), h.pan);
    // (And a heron croaks at it.)
    if (h.kind === "heron" && coolOk("heron", 5)) sayCall("heron", h.pan);
  }

  return {
    // For the sound check: what is rare, now.
    debug: {
      chirp: () => ready() && play(pick(bank("chirp")), nodes.ambience, MIX.chirp, undefined, 1, 0, true),
    },
    get enabled() {
      return enabled;
    },
    // What it is doing (for the diagnostics): the device's state and the sounds playing.
    get stats() {
      return { state: context?.state ?? "none", time: context?.currentTime ?? 0, live, peakLive, nodes: made, bytes, making: workshop.left, madeMs: workshop.spent, world: nodes?.world.gain.value ?? 1, asleep, level, hushes: [...hushes], sleepIn: (sleepAt - performance.now()) / 1000 };
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
        // (Its jaws shutting on it: heard on a phone too.)
        play(pick(bank("jaws")), nodes.water, MIX.snap * 1.2, at + 0.62, random(0.55, 0.62));
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
      // (Pressed up under a floe, the knock would come every frame.)
      if (kind === "ice" && !coolOk("floe", 0.7)) return;
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
    // A hunter's call: "kingfisher" (its thin, piercing whistle), "heron" (a harsh croak),
    // "merganser" (a rattling krrr), "seal" (a whoosh through the water, now and then a moan),
    // "bear" (huffs and a growl); `pan` where it is, left (-1) to right (1).
    call(kind = "kingfisher", pan = 0) {
      if (!ready()) return;
      sayCall(kind, pan);
    },
    // A new stage of life: a soft swell and a rising run of bell tones, bright and clear,
    // with a flurry of bubbles.
    fanfare() {
      if (!ready()) return;
      const at = context.currentTime + 0.05;
      play(pick(bank("fanfare")), nodes.ui, MIX.fanfare, at);
      bubbles(14, 1.4, 1.2, 0.8, at + 0.2);
    },
    // A badge: two or three quick bell tones up (three and brighter for a gold one), and a
    // few bubbles.
    chime(tier = "bronze") {
      if (!ready()) return;
      const at = context.currentTime + 0.03;
      play(bank(`chime-${tier === "gold" || tier === "silver" ? tier : "bronze"}`)[0], nodes.ui, MIX.chime, at, random(0.995, 1.005));
      bubbles(5, 0.5, 1.1, 0.6, at + 0.1);
    },
    // A hunter beaten: a drum and a rising fifth, and bubbles -- its own, not the fanfare.
    victory() {
      if (!ready()) return;
      const at = context.currentTime + 0.03;
      play(bank("victory")[0], nodes.ui, MIX.victory, at);
      bubbles(8, 0.6, 1, 0.7, at + 0.05);
    },
    // Grown a good step within a stage: two soft notes up (not more often than every 20 s).
    growth() {
      if (!ready() || !coolOk("growth", 20)) return;
      play(bank("growth")[0], nodes.ui, MIX.growth);
    },
    // Spawning: a warm chord swelling (A major, each voice a little out of tune with the
    // others), and the heart slowing from 90 to 40 over four seconds.
    spawn() {
      if (!ready()) return;
      const at = context.currentTime + 0.05;
      const tone = filter("lowpass", 1200, 0.5);
      const level = amp(0);
      tone.connect(level).connect(nodes.body);
      level.gain.setValueAtTime(0, at);
      level.gain.linearRampToValueAtTime(MIX.pad, at + 1.5);
      level.gain.setTargetAtTime(0, at + 5.5, 1);
      [220, 277.18, 329.63, 440].forEach((f, i) => {
        const o = oscillator(i % 2 ? "sine" : "triangle");
        o.frequency.value = f;
        o.detune.value = random(-3, 3);
        o.connect(tone);
        o.start(at);
        o.stop(at + 10);
        voice(o, i === 3 ? level : o);
      });
      calmFrom = clock;
    },
    // The white veil of spawning: everything but the bells goes quiet under it (on), and
    // comes back after (off). Every new life takes it off.
    veil(on) {
      if (!context || !nodes) return;
      const now = context.currentTime;
      nodes.world.gain.cancelScheduledValues(now);
      nodes.world.gain.setTargetAtTime(on ? 0 : 1, now, on ? 0.35 : 0.8);
      if (!on) calmFrom = -1e9;
    },
    // A new generation hatched in the gravel: one clear bell.
    hatch() {
      if (!ready()) return;
      play(bank("hatch")[0], nodes.ui, MIX.hatch, context.currentTime + 0.3);
    },
    // A death with no captor to be heard (worn out, starved, the angler's, the net's): a low
    // swell closing over it, rising for a second and dying away over two.
    ending() {
      if (!ready() || !coolOk("ending", 5)) return;
      const at = context.currentTime + 0.05;
      const source = bufferSource(bank("brown")[0]);
      const low = filter("lowpass", 300, 0.7);
      const swell = amp(0);
      low.frequency.setValueAtTime(300, at);
      low.frequency.exponentialRampToValueAtTime(80, at + 3);
      swell.gain.setValueAtTime(0, at);
      swell.gain.linearRampToValueAtTime(MIX.ending, at + 1);
      swell.gain.exponentialRampToValueAtTime(0.001, at + 3);
      source.connect(low).connect(swell).connect(nodes.body);
      source.start(at, Math.random() * 4);
      source.stop(at + 3.1);
      voice(source, swell);
      const o = oscillator();
      const hum = amp(0);
      o.frequency.setValueAtTime(70, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 3);
      hum.gain.setValueAtTime(0, at);
      hum.gain.linearRampToValueAtTime(MIX.ending * 0.6, at + 1);
      hum.gain.exponentialRampToValueAtTime(0.001, at + 3);
      o.connect(hum).connect(nodes.body);
      o.start(at);
      o.stop(at + 3.1);
      voice(o, hum);
    },
    // Thunder: the rumble rolling away in a few swells (the crack comes with the flash, see
    // lightning()). Under water it comes through dulled. `near` 0..1; `delay` s from now.
    thunder(near = 0.5, delay = 0) {
      if (!ready()) return;
      const at = context.currentTime + 0.02 + delay;
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
    // A storm coming up: the wind and the rain on the way swelling for five seconds, rushing
    // brighter, and the first thunder far off.
    storm() {
      if (!ready() || !coolOk("storm", 30)) return;
      const at = context.currentTime + 0.05;
      const source = bufferSource(bank("white")[0]);
      source.loop = true;
      const tone = filter("lowpass", 150, 0.6);
      const swell = amp(0);
      tone.frequency.setValueAtTime(150, at);
      tone.frequency.exponentialRampToValueAtTime(700, at + 5);
      swell.gain.setValueAtTime(0, at);
      swell.gain.linearRampToValueAtTime(MIX.storm, at + 5);
      swell.gain.linearRampToValueAtTime(0, at + 7);
      source.connect(tone).connect(swell).connect(nodes.air);
      source.start(at, Math.random() * 3);
      source.stop(at + 7.1);
      voice(source, swell);
      this.thunder(0.15, 4);
    },
    // The flash: when it strikes near (`near` 0..1), a hard crack at once, the air tearing.
    lightning(near = 0.5) {
      if (!ready() || near <= 0.5) return;
      // (Under water dulled, and played louder by about what the surface takes from it.)
      play(pick(bank("crack")), nodes.air, MIX.crack * near * (1 + 5 * submerged), undefined, random(0.9, 1.1));
    },
    // Bread thrown from the bridge, landing `distance` away: a few small plops.
    plops(distance = 10) {
      if (!ready() || distance > 45) return;
      play(pick(bank("plops")), nodes.surface, MIX.plops * (1 + 2 * submerged) * (1 - distance / 45), undefined, random(0.9, 1.1));
    },
    // The fish counter at the weir taking the fish's picture: a relay's click, a whirr.
    counter() {
      if (!ready()) return;
      play(bank("counter")[0], nodes.surface, MIX.counter, undefined, random(0.97, 1.03));
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
    // The hunters after the fish, as the warning arrows have them (main.js warnings()): each
    // { level, coiled, kind, key, pan, near } -- level 0.4 it has noticed the fish, 0.6 it
    // stalks it, 0.8 it chases it, 1 it strikes (coiled: about to); `key` the hunter itself,
    // `pan` where it is, left to right, `near` 0..1. Noticed: a swell of pressure from where it
    // is (and a bird's, a seal's or the bear's call). The one nearest to striking pulses,
    // faster the nearer; coiled, it ticks, faster and higher -- the cue to dodge. A strike
    // that ends without a catch snaps shut on nothing. `alive` false while the fish is caught.
    warn(list, alive = true) {
      if (!context || !nodes) return;
      warnRound++;
      const on = ready();
      const now = context.currentTime;
      let danger = false;
      for (let i = 0; i < list.length; i++) {
        const th = list[i];
        if (!th.key) continue;
        let h = heard.get(th.key);
        if (!h) heard.set(th.key, (h = { level: 0, coiled: false, round: 0, swellAt: -1e9, pulseAt: 0, callAt: -1e9, kind: "", pan: 0, tracked: false }));
        // (Not in the last round: it went off, and has come back.)
        const was = h.round === warnRound - 1 ? h.level : 0;
        h.round = warnRound;
        if (!h.tracked) {
          h.tracked = true;
          tracked.push(h);
        }
        h.kind = th.kind;
        h.pan = i < 4 ? Math.max(-0.9, Math.min(0.9, th.pan ?? 0)) : 0;
        const near = th.near ?? 0.5;
        if (th.coiled || th.level >= 1) danger = true;
        if (on) {
          if (was < 0.4 && th.level >= 0.4) {
            if (now - h.swellAt > 6 && coolOk("swell", 0.8)) {
              h.swellAt = now;
              play(pick(bank("swell")), nodes.water, MIX.swell * (0.25 + 0.35 * near), now + 0.01, random(0.92, 1.08), h.pan);
            }
            if (CALLS[th.kind] && th.kind !== "kingfisher" && now - h.callAt > 20) {
              h.callAt = now;
              sayCall(th.kind, h.pan);
            }
          }
          if (th.coiled && !h.coiled) play(pick(bank("coil")), nodes.water, MIX.coil, now + 0.005, random(0.97, 1.03), h.pan);
          if (i === 0 && th.level >= 0.6 && now >= h.pulseAt) {
            const hunting = th.level >= 0.8;
            h.pulseAt = now + (hunting ? 0.55 : 1.1) * (1 - 0.35 * near);
            play(pick(bank("pulse")), nodes.water, MIX.pulse * (hunting ? 1 : 0.55) * (0.6 + 0.4 * near), now + 0.01, random(0.95, 1.05), h.pan);
          }
          if (was >= 1 && th.level < 1 && alive) missed(h);
        }
        h.level = th.level;
        h.coiled = !!th.coiled;
      }
      // Gone from the list: off to recover after a strike that missed, or away.
      for (let j = tracked.length - 1; j >= 0; j--) {
        const h = tracked[j];
        if (h.round === warnRound) continue;
        if (h.level >= 1 && alive && on) missed(h);
        h.level = 0;
        h.coiled = h.tracked = false;
        tracked[j] = tracked[tracked.length - 1];
        tracked.pop();
      }
      warnDanger = danger;
    },
    // A burst of speed (Space): the water shoved aside, a soft whump gliding down, and a trail
    // of bubbles behind (`trail` false when the burst is a leap: the breach says it).
    dash(size = 1, trail = true) {
      if (!ready() || !coolOk("dash", 0.25)) return;
      const at = context.currentTime + 0.01;
      play(pick(bank("whump")), nodes.water, MIX.whump, at, random(0.93, 1.07) / (1 + 0.12 * size));
      if (trail) bubbles(6, 0.35, 1 / (1 + 0.2 * size), MIX.trail, at + 0.03);
    },
    // The fish's jaws snapping shut on something (or on nothing): `k` 1 for a strike with
    // Space, less for the small dart it makes by itself.
    jaws(size = 1, k = 1) {
      if (!ready() || !coolOk("jaws", 0.12)) return;
      play(pick(bank("jaws")), nodes.body, MIX.jaws * k, undefined, random(0.93, 1.07) / (1 + 0.1 * size));
    },
    // Space with no breath left: a dull thud, the burst refused.
    denied() {
      if (!ready() || !coolOk("denied", 0.5)) return;
      play(pick(bank("denied")), nodes.body, MIX.denied, undefined, random(0.95, 1.05));
    },
    // Out of breath: a gasp (the gills keep working while it lasts, see update()).
    winded() {
      if (!ready() || !coolOk("gasp", 3)) return;
      play(pick(bank("gasp")), nodes.body, MIX.gasp, undefined, random(0.9, 1.1));
    },
    // The leap's charge at the Lachsfall: a tone rising with the meter's swing `v` (0..1),
    // a tick as it passes the sweet spot. charge(-1) stops it; charge(v, true) lets the
    // leap go, with a louder tick if it went at the sweet spot.
    charge(v, release = false) {
      if (!context || !nodes) return;
      const now = context.currentTime;
      if (v < 0 || release) {
        if (release && v > SWEET && ready()) play(pick(bank("tick")), nodes.body, MIX.tick * 1.8);
        if (chargeTone) {
          chargeLevel.gain.cancelScheduledValues(now);
          chargeLevel.gain.setTargetAtTime(0, now, 0.02);
          chargeTone.stop(now + 0.12);
          chargeTone = chargeLevel = null;
        }
        chargeAt = 0;
        chargeWritten = -1;
        return;
      }
      if (!ready()) return;
      if (!chargeTone) {
        chargeTone = oscillator("triangle");
        chargeLevel = amp(0);
        chargeTone.connect(chargeLevel).connect(nodes.body);
        chargeTone.frequency.value = 260 + 640 * v;
        chargeTone.start(now);
        voice(chargeTone, chargeLevel);
      }
      // (Written only when it has moved: the swing takes 1.2 s, so about 20 times a second.)
      if (Math.abs(v - chargeWritten) > 0.03) {
        chargeWritten = v;
        chargeTone.frequency.setTargetAtTime(260 + 640 * v, now, 0.02);
        chargeLevel.gain.setTargetAtTime(MIX.charge * (0.08 + 0.08 * v), now, 0.03);
      }
      if (v > SWEET && chargeAt <= SWEET) play(pick(bank("tick")), nodes.body, MIX.tick);
      chargeAt = v;
    },
    // How a leap at a fall ended: "cleared" (three quick bells up) or "failed" (a heavy thud
    // back into the pool).
    leapResult(kind) {
      if (!ready()) return;
      if (kind === "cleared") play(bank("cleared")[0], nodes.ui, MIX.cleared, undefined, random(0.99, 1.01));
      else play(pick(bank("thud")), nodes.body, MIX.thud, undefined, random(0.95, 1.05));
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
      if (performance.now() >= sleepAt) sleep();
      submerged += (under - submerged) * (1 - Math.exp(-dt / EASE));
      if (context.state !== "running") return;
      const now = context.currentTime;
      if (!(Math.abs(under - crossing) < 0.02)) cross(under, now);
      clock += dt;
      const stirred = Math.min(1, stir);
      const night = 1 - daylight;
      // Where the fish is (without the regions, the river or the sea by `sea`): a brook's
      // bright, quick water; a big river's slow, deep weight; the sea's swell.
      const seaW = regions ? (regions.sea ?? sea) + 0.5 * (regions.estuary ?? 0) : sea;
      const brookish = regions ? (regions.brook ?? 0) + 0.5 * (regions.upper ?? 0) : 0;
      const big = regions ? (regions.middle ?? 0) + (regions.lower ?? 0) + 0.5 * (regions.upper ?? 0) + 0.5 * (regions.estuary ?? 0) : 1 - sea;
      // (The lower river and the estuary: wide, slow and silty, darker still.)
      const low = regions ? (regions.lower ?? 0) + 0.25 * (regions.estuary ?? 0) : 0;
      const river = 1 - seaW;
      const flowK = Math.min(1.5, Math.max(0, flow / 5));
      // A spate roars like white water, and rain and the air are shut out under ice.
      roar = Math.max(roar, 0.55 * flood);
      const open = 1 - Math.min(1, ice);
      if (clock > nextBubble) {
        // (Sparser at sea, and lower: bigger bubbles, from further off.)
        const rate = (1.2 + 5 * stirred + 4 * rain + 14 * roar) * (1 - 0.7 * seaW);
        nextBubble = clock + -Math.log(1 - Math.random()) / rate;
        if (submerged > 0.5 && wanted()) play(pick(bank("bubble")), nodes.ambience, (0.05 + Math.random() * 0.08) * MIX.bubble, now + 0.02, random(0.9, 1.15) * (1 - 0.3 * seaW), 0, true);
      }
      // Eddies gurgling: in a brook higher, narrower and quicker, with the current.
      if (clock > nextGurgle) {
        nextGurgle = clock + (0.35 + Math.random() * 0.9) * (1 - 0.62 * brookish);
        const i = Math.floor(Math.random() * nodes.gurgles.length);
        const g = nodes.gurgles[i];
        const base = 220 + 140 * i + (230 + 120 * i) * brookish;
        const loud = MIX.gurgle * (0.6 + 0.8 * brookish) * (0.5 + 0.5 * flowK) * (1 + stirred + roar) * (1 - 0.3 * night) * river;
        g.band.Q.setValueAtTime(6 + i + 4 * brookish, now);
        g.band.frequency.setTargetAtTime(base * (0.7 + Math.random() * 0.8), now, 0.25 * (1 - 0.6 * brookish));
        g.level.gain.setTargetAtTime(loud * (0.25 + Math.random() * 0.55), now, 0.2 * (1 - 0.5 * brookish));
        g.level.gain.setTargetAtTime(loud * 0.06, now + (0.5 + Math.random() * 0.6) * (1 - 0.6 * brookish), 0.4 * (1 - 0.5 * brookish));
      }
      // A flood knocks stones along the bed: bursts of clatter, now and then.
      if (clock > nextClatter) {
        nextClatter = clock + (flood > 0.05 ? -Math.log(1 - Math.random()) / (1.5 * flood) : 1);
        if (flood > 0.05 && submerged > 0.5 && wanted()) play(pick(bank("clatter")), nodes.ambience, MIX.clatter * flood * random(0.4, 1), now + 0.02, random(0.9, 1.1), 0, true);
      }
      // Under ice it sings now and then: a thin, falling chirp as the sheet flexes.
      if (clock > nextChirp) {
        nextChirp = clock + random(6, 15);
        if (ice > 0.5 && submerged > 0.5 && wanted()) play(pick(bank("chirp")), nodes.ambience, MIX.chirp * random(0.6, 1), now + 0.02, random(0.85, 1.15), 0, true);
      }
      // The mill wheel near by: its paddles slapping into the race a little under once a
      // second, its axle creaking now and then (from above the water, muffled under it).
      if (mill > 0.01 && clock > nextSlap) {
        nextSlap = clock + (1 / 0.86) * random(0.9, 1.1);
        if (wanted()) play(pick(bank("slap")), nodes.surface, MIX.slap * mill * mill, now + 0.02, random(0.93, 1.07), 0, true);
        if (clock > nextCreak) {
          nextCreak = clock + random(5, 12);
          if (wanted()) play(pick(bank("creak")), nodes.surface, MIX.creak * mill * mill, now + random(0.1, 0.5), random(0.9, 1.1), 0, true);
        }
      }
      // Gravel ticking along the bed of a brook, the more the harder it runs and the nearer
      // the bed the fish is.
      if (clock > nextGravel) {
        const rate = Math.min(10, (1.5 + 6 * flowK) * brookish * (0.3 + 0.7 * depthRel));
        nextGravel = clock + (rate > 0.05 ? -Math.log(1 - Math.random()) / rate : 1);
        if (rate > 0.05 && submerged > 0.5 && wanted()) play(pick(bank("gravel")), nodes.ambience, MIX.gravel * random(0.3, 1), now + 0.02, random(0.9, 1.1), 0, true);
      }
      // The heart: when strength runs low, or a strike is about to come; on for ten seconds
      // after, fading over the last four and slowing. It ducks the river under it a little.
      const threat = danger > 0 || warnDanger;
      const triggered = (energy < 0.25 || threat) && wanted();
      if (triggered) heartUntil = clock + 10;
      // (Spawning: calm, slowing from 90 to 40 over four seconds, until the veil.)
      const calm = clock - calmFrom < 6;
      if (calm) heartUntil = Math.max(heartUntil, clock + 4);
      beating = clock < heartUntil;
      if (beating) {
        const target = calm ? 90 - 50 * Math.min(1, (clock - calmFrom) / 4) : !triggered ? 60 : threat ? 110 : 72;
        bpm += (target - bpm) * (1 - Math.exp(-dt / (calm ? 0.3 : threat ? 0.6 : 2)));
        if (clock >= nextBeat) {
          nextBeat = clock + 60 / bpm;
          if (wanted()) play(pick(bank("heart")), nodes.body, MIX.heart * Math.min(1, (heartUntil - clock) / 4) * random(0.9, 1), now + 0.02, random(0.98, 1.02));
        }
      } else {
        bpm = 64;
        nextBeat = clock;
      }
      if (clock < nextSteer) return;
      nextSteer = clock + STEER;
      const k = nodes.knobs;
      steer(k.ambience, beating ? 0.71 : 1, now, 0.5);
      const swell = 0.8 + 0.2 * Math.sin(clock * 0.21) + 0.08 * Math.sin(clock * 0.53 + 1.3);
      const burble = 0.75 + 0.25 * Math.sin(clock * 0.37 + 2) * Math.sin(clock * 0.11);
      // A big river's weight comes in slow surges, 40-150 Hz, every fifteen seconds or so.
      const surge = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.07 * clock + 1.5 * Math.sin(2 * Math.PI * 0.023 * clock));
      const weight = 1 + big * (surge * (0.6 + 0.4 * flowK) - 0.5);
      // The sea's swell: a slow heave, about every ten seconds, the wash rising and brightening
      // with it, and what is left of the river's sound going with it.
      const heave = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.1 * clock + 0.3 * Math.sin(2 * Math.PI * 0.031 * clock));
      const heaving = 1 - 0.4 * seaW * (1 - heave);
      steer(k.rush, MIX.rush * (0.5 + 0.25 * stirred) * swell * (1 - 0.25 * night) * (0.45 + 0.55 * river) * weight * heaving, now, 0.4);
      steer(k.rushTone, 380 + 240 * stirred - 90 * night - 120 * seaW - 60 * big - 60 * low + 120 * brookish + 150 * flood, now, 0.3);
      steer(k.rumble, MIX.rumble * (0.9 + 0.1 * swell) * weight * (1 - 0.5 * brookish), now, 0.5);
      steer(k.rumbleTone, 90 + 30 * big, now, 1);
      steer(k.flow, MIX.flow * swell * (1 + 0.5 * stirred) * (1 - 0.3 * night) * (0.05 + 0.95 * river) * (0.8 + 0.3 * flowK) * (1 - 0.25 * low) * heaving * (1 - 0.25 * ice), now, 0.4);
      steer(k.flowTone, 480 + 160 * stirred - 60 * night - 100 * seaW - 40 * big - 50 * low + 200 * brookish, now, 0.4);
      steer(k.burble, MIX.burble * burble * (1 + 0.8 * stirred + roar) * (1 - 0.35 * night) * river * (1 - 0.3 * big - 0.3 * low + 0.6 * brookish) * (0.8 + 0.4 * depthRel) * (1 - 0.25 * ice), now, 0.5);
      steer(k.burbleTone, 820 + 200 * stirred - 80 * night + 350 * brookish - 120 * low, now, 0.5);
      steer(k.roar, MIX.roar * roar, now, 0.5);
      steer(k.roarLow, MIX.roarLow * roar, now, 0.5);
      steer(k.whiteWater, MIX.whiteWater * roar, now, 0.5);
      // (Where river and sea meet, the sea's part of it a little more than half.)
      const washing = Math.sqrt(seaW);
      steer(k.wash, MIX.wash * washing * (0.3 + 0.7 * Math.pow(heave, 1.5)), now, 0.5);
      steer(k.washTone, 160 + 260 * heave, now, 0.5);
      steer(k.washMid, MIX.washMid * washing * (0.3 + 0.7 * heave), now, 0.5);
      steer(k.air, MIX.air * (0.8 + 0.2 * swell) * (1 + 0.6 * roar + 0.8 * rain) * open, now, 0.4);
      steer(k.rain, MIX.rain * rain * open, now, 1.2);
      steer(k.rainUnder, MIX.rainUnder * rain * open, now, 1.2);
      // (The pings brightest just under the surface, fainter deeper down.)
      steer(k.pings, MIX.pings * rain * open * (0.3 + 0.7 * (1 - depthRel)), now, 1.2);
      // The home brook's scent: its gurgle and a soft chord, swelling the nearer home.
      steer(k.home, MIX.home * Math.min(1, home), now, 1.5);
      // The gills working while winded, harder the less breath there is.
      steer(k.gills, winded ? MIX.gills * Math.min(1, Math.max(0.2, 1 - breath / 0.45)) : 0, now, 0.3);
      // (The open sea darker too: its water takes more of the top.)
      clearTone = 7000 * (1 - 0.3 * night) * (1 - 0.45 * Math.min(1, depth / 40)) * (1 - 0.35 * seaW);
      steer(k.waterTone, waterTone(), now, 0.4);
    },
  };
}
