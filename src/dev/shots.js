// Photo points: the same places along the river, at the same hour and season, pictured and
// measured the same way every time -- to see what a change to the graphics really does, and
// what it costs. Run with tools/capture-server.mjs:
//
//   node tools/capture-server.mjs     then open  http://localhost:8123/?shots=<set>
//
// Each point loads the game afresh with its own settings in the address (a new life at a
// stage and a place, the hour held, no rain, Math.random seeded), builds the river round
// the fish, lets it settle, times a run of frames on the graphics card, takes a picture,
// and goes on to the next. The pictures and numbers land in shots/<set>/ (tools/compare.html
// sets two runs side by side). ?shots=<set>&only=a,b runs just those points.

// A view is where the eye is and where it looks, each as [along, across, height]: metres
// down the river from the fish's start, metres across (to the right bank positive, as u),
// and height above the water's surface there (negative: under it). No view: the game's own
// camera behind the fish.
export const SHOTS = [
  // The spring pool where the eggs lie: gravel, the cleft, the first light.
  { name: "quelle", stage: "alevin", at: 24, season: "spring", hour: 11 },
  // The nursery pool: shallow, clear, plants.
  { name: "brutbecken", stage: "fry", at: 240, season: "summer", hour: 13 },
  // Looking up from a still reach at the surface: Snell's window, the banks, the trees.
  { name: "fenster", stage: "fingerling", at: 1260, season: "summer", hour: 12, view: { eye: [0, 0, -1.6], target: [6, 0, 1.5] } },
  // Among the stones of the brook, where the forest's edge shows through the surface.
  { name: "bach", stage: "parr", at: 2500, season: "summer", hour: 15 },
  // A still, wide reach of the upper river.
  { name: "stillwasser", stage: "parr", at: 4250, season: "summer", hour: 16 },
  // Below the salmon fall: the curtain, the pool, the foam.
  { name: "lachsfall", stage: "spawner", at: 5150, season: "autumn", hour: 12 },
  // The salmon fall from its pool, in the air: the curtain, the spray, the mist.
  { name: "wasserfall", stage: "spawner", at: 5240, season: "autumn", hour: 12, view: { eye: [14, 0, 1.2], target: [-30, 0, 9] } },
  // Above the water at the salmon fall: the surface from above, the banks, the sky.
  { name: "sprung", stage: "spawner", at: 5150, season: "autumn", hour: 12, view: { eye: [-12, 0, 1.4], target: [30, 0, 4] } },
  // Looking down into the brook from just above it: the bed through the water, the banks
  // mirrored.
  { name: "draufsicht", stage: "parr", at: 2500, season: "summer", hour: 13, view: { eye: [-7, 0, 3.2], target: [3, 0, -1.8] } },
  // The rock gorge.
  { name: "schlucht", stage: "parr", at: 7200, season: "summer", hour: 13 },
  // The eye crossing the surface in a leap: the waterline across the picture, the banks
  // over it, the river under it.
  { name: "wasserlinie", stage: "parr", at: 4250, season: "summer", hour: 16, view: { eye: [-4, 0, -0.005], target: [20, 0, 0.6] } },
  // Just come up out of the water: the glass wet, the film running off it, drops.
  { name: "nass", stage: "parr", at: 4250, season: "summer", hour: 16, view: { eye: [-6, 0, 0.5], target: [20, 0, 1.5] }, wet: 0.25 },
  // Close looks at the fish: a fry among the stones, a smolt in the school, a spawner in
  // its red coat (skin, fins, eye).
  { name: "brut-nah", stage: "fry", at: 240, season: "summer", hour: 13, closeup: [0.95, 0.2, 0.15] },
  { name: "smolt-nah", stage: "smolt", at: 11790, season: "spring", hour: 12, closeup: [0.95, 0.2, 0.15] },
  { name: "lachs-nah", stage: "spawner", at: 5150, season: "autumn", hour: 12, closeup: [0.95, 0.2, 0.15] },
  // The stone bridge from the water: arches, piers, people on it.
  { name: "bruecke", stage: "smolt", at: 11790, season: "spring", hour: 14, view: { eye: [-26, 0, 1.2], target: [10, 0, 3] } },
  // The lower river: brown peat water, a slow deep reach.
  { name: "unterlauf", stage: "grilse", at: 13950, season: "autumn", hour: 15 },
  // The open sea.
  { name: "meer", stage: "sea", at: 17500, season: "summer", hour: 12 },
  // The wreck in the fjord.
  { name: "wrack", stage: "sea", at: 16860, u: 380, season: "summer", hour: 12, view: { eye: [-30, -14, -8], target: [40, 0, -18] } },
  // Evening light over the still water, seen from just above it.
  { name: "abend", stage: "parr", at: 4300, season: "summer", hour: 17.4, view: { eye: [-10, 0, 0.9], target: [30, 0, 2] } },
  // A winter night with the northern lights, above the water.
  { name: "nordlicht", stage: "spawner", at: 4300, season: "winter", hour: 23, event: "aurora", view: { eye: [-6, 0, 1.2], target: [20, 0, 12] } },
  // A storm: a flash flood coming down, the water brown.
  { name: "sturm", stage: "parr", at: 3500, season: "autumn", hour: 15, event: "storm" },
  // The bed close, as a fry sees it: the stones and the sand between them.
  { name: "kiesbett", stage: "fry", at: 240, season: "summer", hour: 13, view: { eye: [-3, 0, -3.8], target: [3, 0, -6.6] } },
  // Sand and gravel half and half, in the big river: stone tops out of the sand.
  { name: "sandkies", stage: "parr", at: 4250, season: "summer", hour: 13, view: { eye: [-4, 0, -15.5], target: [4, 0, -19] } },
  // A wide gravel reach from above the bed, out to some forty metres: does it repeat?
  { name: "kacheln", stage: "parr", at: 6000, season: "summer", hour: 13, view: { eye: [-10, 0, -5], target: [22, 0, -14] } },
  // The bank at the waterline from just above the water.
  { name: "ufer", stage: "parr", at: 2500, season: "summer", hour: 15, view: { eye: [-6, -10, 0.8], target: [8, -24, 0.3] } },
];

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// The address of one point: the game with its settings, the run's name, the point's name.
export function shotURL(set, shot, extra = "") {
  const here = new URLSearchParams(location.search);
  for (const flag of ["stages", "webgl", "smoke", "fixsun", "nomirror", "noamb", "costs", "dumpwindow"]) if (here.has(flag)) extra += `&${flag}`;
  // (And any ?x... switch being tried out.)
  for (const [k, v] of here) if (k.startsWith("x")) extra += `&${k}=${v}`;
  if (here.get("probe")) extra += `&probe=${here.get("probe")}`;
  if (here.get("render")) extra += `&render=${here.get("render")}`;
  // (A run at another quality: ?shots=set&q=eco.)
  if (here.get("q")) extra += `&q=${here.get("q")}`;
  const q = new URLSearchParams({ capture: "1", seed: "7", day: "still", rain: "0", quality: new URLSearchParams(location.search).get("q") || "detail", shots: set, shot: shot.name, stage: shot.stage, at: String(shot.at), season: shot.season, hour: String(shot.hour) });
  q.set("new", "");
  if (shot.u != null) q.set("u", String(shot.u));
  if (shot.event) q.set("event", shot.event);
  return `${location.pathname}?${q.toString().replace("new=", "new")}${extra}`;
}

// Time n frames on the graphics card (the WebGPU renderer's timestamp queries, or WebGL 2's
// timer query for the old renderer), and what the draw costs the processor.
async function measure(salmon, n = 90) {
  const { renderer } = salmon;
  const gpu = [],
    cpu = [];
  let calls = 0,
    triangles = 0;
  const webgpuRenderer = !!renderer.isWebGPURenderer;
  const timed = webgpuRenderer ? !!renderer.backend?.trackTimestamp : false;
  const gl = webgpuRenderer ? null : renderer.getContext?.();
  const ext = gl?.getExtension?.("EXT_disjoint_timer_query_webgl2");
  const pending = [];
  renderer.info.autoReset = false;
  if (timed) await renderer.resolveTimestampsAsync("render");
  for (let i = 0; i < n; i++) {
    let query = null;
    if (ext) {
      query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    }
    renderer.info.reset();
    const t0 = performance.now();
    salmon.draw(0);
    cpu.push(performance.now() - t0);
    calls = renderer.info.render.drawCalls ?? renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
    if (ext) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(query);
    }
    await nextFrame();
    if (timed) {
      const ms = await renderer.resolveTimestampsAsync("render");
      if (Number.isFinite(ms) && ms > 0) gpu.push(ms);
    }
    // Read back whatever the card has finished.
    while (ext && pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  }
  renderer.info.autoReset = true;
  const stats = (list) => {
    const sorted = [...list].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return sorted.length ? { median: +at(0.5).toFixed(2), p90: +at(0.9).toFixed(2), n: sorted.length } : null;
  };
  const memory = renderer.info.memory;
  // (The first frames warm up; keep the rest.)
  return { gpu: stats(gpu.slice(10)), cpu: stats(cpu.slice(10)), calls, triangles, programs: renderer.info.programs?.length ?? memory.programs ?? 0, textures: memory.textures, geometries: memory.geometries };
}

// A little play at the point: swimming and turning, a stage celebrated, a death and the next
// life, with a frame drawn every quarter second so every material in them is built.
async function smoke(salmon, shot) {
  salmon.pause(true);
  salmon.view(null);
  const { input } = salmon;
  const play = async (seconds, script) => {
    let drawn = 0;
    await salmon.run(seconds, (t) => {
      script?.(t);
      if (t >= drawn) {
        drawn += 0.25;
        salmon.draw(1 / 30);
      }
    });
  };
  await play(6, (t) => {
    input.forward = true;
    input.yaw = Math.sin(t * 0.7) * 0.02;
    input.lunge = t % 2 < 0.05;
  });
  input.forward = false;
  salmon.celebrate?.(salmon.fish.stage);
  await play(3);
  if (shot.stage !== "spawner") {
    salmon.die?.("smoke test");
    await play(7);
  }
  for (let i = 0; i < 4; i++) {
    salmon.draw(0);
    await nextFrame();
  }
}

// Frames drawn back to back, then waited for: what one frame really costs, card and all
// (timestamps per pass overlap on tile-based GPUs, Apple's among them, and add up to more).
async function throughput(salmon, n = 60) {
  const { renderer } = salmon;
  const sync = async () => {
    const device = renderer.backend?.device;
    if (device) return device.queue.onSubmittedWorkDone();
    const gl = renderer.backend?.gl ?? renderer.getContext?.();
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };
  const runs = [];
  for (let k = 0; k < 3; k++) {
    await sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) salmon.draw(0);
    await sync();
    runs.push((performance.now() - t0) / n);
    await nextFrame();
  }
  runs.sort((a, b) => a - b);
  return +runs[1].toFixed(2);
}

// Where the frame's time on the card goes: the caustic net, the scene (with its shadow map),
// and the passes after it, each timed on its own (WebGPU timestamps, one stage at a time).
async function stages(salmon, n = 30) {
  const { renderer, scene, camera, post, caustics, key } = salmon;
  if (!renderer.backend?.trackTimestamp) return null;
  const time = async (fn) => {
    const list = [];
    for (let i = 0; i < n; i++) {
      await renderer.resolveTimestampsAsync("render");
      fn();
      await nextFrame();
      const ms = await renderer.resolveTimestampsAsync("render");
      if (Number.isFinite(ms)) list.push(ms);
    }
    list.sort((a, b) => a - b);
    return +list[Math.floor(list.length / 2)].toFixed(2);
  };
  const out = {};
  out.caustics = await time(() => caustics.render());
  out.scene = await time(() => {
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(post.main);
    renderer.render(scene, camera);
  });
  out.post = await time(() => post.render({ light: key, sunLight: new salmon.THREE.Vector3(1, 1, 1), density: 0.02 }));
  for (const [name, fn] of post.debugPasses?.() ?? []) out[`post ${name}`] = await time(fn);
  out.whole = await time(() => salmon.draw(0));
  return out;
}

// What each part of the scene costs: the frame timed with each visible mesh group hidden in
// turn (grouped by name), largest first. (?costs; slow, for finding where the time goes.)
async function costs(salmon) {
  const groups = new Map();
  salmon.scene.traverse((object) => {
    if (!object.visible || !(object.isMesh || object.isSprite || object.isPoints)) return;
    const name = object.name || object.parent?.name || object.material?.type || "?";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(object);
  });
  const whole = await throughput(salmon, 20);
  const out = { whole };
  for (const [name, objects] of groups) {
    for (const object of objects) object.visible = false;
    out[name] = +(whole - (await throughput(salmon, 20))).toFixed(2);
    for (const object of objects) object.visible = true;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// The window's cube laid out as a cross (?dumpwindow), to see what the surface shows from
// below: +y on top, then -x +z +x -z round the middle, -y at the bottom.
async function dumpWindow(salmon, name) {
  const { windowTarget } = await import("../render/mirror.js");
  const size = windowTarget.width;
  const canvas = Object.assign(document.createElement("canvas"), { width: size * 4, height: size * 3 });
  const g = canvas.getContext("2d");
  const half = (h) => {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    return s * (e ? Math.pow(2, e - 15) * (1 + f / 1024) : Math.pow(2, -14) * (f / 1024));
  };
  const at = { 0: [2, 1], 1: [0, 1], 2: [1, 0], 3: [1, 2], 4: [1, 1], 5: [3, 1] };
  for (let face = 0; face < 6; face++) {
    const data = await salmon.renderer.readRenderTargetPixelsAsync(windowTarget, 0, 0, size, size, 0, face);
    const image = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++)
      for (let c = 0; c < 3; c++) {
        const v = half(data[i * 4 + c]);
        image.data[i * 4 + c] = 255 * Math.pow(v / (1 + v), 1 / 2.2);
      }
    for (let i = 0; i < size * size; i++) image.data[i * 4 + 3] = 255;
    g.putImageData(image, at[face][0] * size, at[face][1] * size);
  }
  await fetch(`/__capture/${name}-window`, { method: "POST", body: canvas.toDataURL("image/png") });
}

// Which graphics card drew it (a software renderer would make the timings meaningless).
function gpuName(renderer) {
  const info = renderer.backend?.adapter?.info;
  if (info) return [info.vendor, info.architecture, info.description].filter(Boolean).join(" ");
  const gl = renderer.getContext?.();
  const debug = gl?.getExtension?.("WEBGL_debug_renderer_info");
  return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unknown";
}

function banner(text) {
  let el = document.querySelector("#shots-banner");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "shots-banner" });
    Object.assign(el.style, { position: "fixed", left: "50%", top: "12px", transform: "translateX(-50%)", zIndex: 100, padding: "6px 12px", borderRadius: "8px", background: "rgba(0,0,0,0.7)", color: "#fff", font: "13px system-ui, sans-serif", pointerEvents: "none" });
    document.body.append(el);
  }
  el.textContent = text;
}

// Run the point this page was loaded for, then load the next.
export async function runShots(salmon, query) {
  const set = query.get("shots") || "run";
  const only = query.get("only")?.split(",");
  const list = only ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;
  const extra = only ? `&only=${only.join(",")}` : "";
  const name = query.get("shot");
  const index = list.findIndex((s) => s.name === name);
  if (index < 0) {
    location.href = shotURL(set, list[0], extra);
    return;
  }
  const shot = list[index];
  banner(`${set}: ${shot.name} (${index + 1}/${list.length})`);
  // What went wrong so far, and every few seconds what has gone wrong since.
  const sendLog = () => window.__shotLog?.length && fetch(`/__report/${set}/${shot.name}-log`, { method: "POST", body: JSON.stringify(window.__shotLog, null, 1) });
  sendLog();
  const logTimer = setInterval(sendLog, 3000);
  document.body.classList.add("shooting");
  const { course } = salmon;
  // The river built all round, the fish and its neighbours settled into it. (The game held
  // meanwhile: it moves only in run()'s fixed steps, so the fish -- and every view placed
  // from it -- comes out in the same place however long the building took.)
  salmon.pause(true);
  // (And chance starts over here: how many frames ran while the game loaded, drawing on it,
  // depends on how long the loading took.)
  let a = 7;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  await salmon.settle(40);
  await salmon.run(1.5);
  await salmon.settle(20);
  if (shot.view) {
    const s0 = salmon.fish.river.s,
      u0 = salmon.fish.river.u;
    const point = ([along, across, height]) => {
      const p = course.place(s0 + along, u0 + across, {});
      return [p.x, course.level(s0 + along) + height, p.z];
    };
    salmon.view(point(shot.view.eye), point(shot.view.target));
    await salmon.run(0.05);
    await salmon.settle(20);
  }
  // A close look at the fish itself: closeup is [aside, above, ahead] in fish lengths, from
  // the fish in its own frame (aside to its left), looking at it.
  if (shot.closeup) {
    const { THREE, fish } = salmon;
    const L = fish.length;
    const heading = fish.heading.clone().setY(0).normalize();
    const left = new THREE.Vector3(0, 1, 0).cross(heading).normalize();
    const [aside, above, ahead] = shot.closeup;
    const eye = fish.position.clone().addScaledVector(left, aside * L).addScaledVector(heading, ahead * L);
    eye.y += above * L;
    const target = fish.position.clone().addScaledVector(heading, 0.05 * L);
    salmon.view(eye.toArray(), target.toArray(), L * 0.02);
    await salmon.run(0.05);
  }
  if (shot.wet !== undefined) salmon.wetLens(shot.wet);
  salmon.pause(true);

  // (?xhide=regex: the parts of the scene whose names match left out, to find what is what.)
  if (query.get("xhide")) {
    const hide = new RegExp(query.get("xhide"));
    const found = new Set();
    salmon.scene.traverse((o) => {
      if (o.name && hide.test(o.name)) {
        o.visible = false;
        found.add(o.name);
      }
    });
    console.log("hidden:", [...found].join(", "));
  }
  // Measured at the size of the picture, whatever the window: the same pixels every time.
  const bounds = salmon.renderer.domElement.getBoundingClientRect();
  salmon.renderer.setSize(1600, 900, false);
  salmon.post.setSize(1600, 900, 1600 / bounds.width);
  salmon.camera.aspect = 1600 / 900;
  salmon.camera.updateProjectionMatrix();
  for (let i = 0; i < 8; i++) {
    salmon.draw(0);
    await nextFrame();
  }
  // (?probe=x,y;x,y: what the eye sees at those points of the picture, 0..1 from top left.)
  if (query.get("probe")) {
    const { THREE, camera, scene } = salmon;
    const ray = new THREE.Raycaster();
    const found = [];
    for (const point of query.get("probe").split(";")) {
      const [x, y] = point.split(",").map(Number);
      ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
      const hits = ray.intersectObjects(scene.children, true).slice(0, 4);
      found.push({ at: [x, y], hits: hits.map((h) => ({ name: h.object.name, type: h.object.type, material: h.object.material?.type, distance: +h.distance.toFixed(2), y: +h.point.y.toFixed(2), level: +salmon.course.level(salmon.fish.river.s).toFixed(2) })) });
    }
    window.__probe = found;
  }
  // (?smoke: the game played a little after the picture, to catch what breaks in play.)
  if (query.has("smoke")) await smoke(salmon, shot);
  const numbers = await measure(salmon);
  numbers.frame = await throughput(salmon);
  if (query.has("stages")) numbers.stages = await stages(salmon);
  if (query.has("costs")) numbers.costs = await costs(salmon);
  if (query.has("dumpwindow")) await dumpWindow(salmon, `${set}/${shot.name}`);
  await salmon.capture(`${set}/${shot.name}`, 1600, 900, { render: Number(query.get("render")) || 1 });
  const report = {
    name: shot.name,
    set,
    renderer: salmon.renderer.isWebGPURenderer ? (salmon.renderer.backend?.isWebGPUBackend ? "webgpu" : "webgpu-fallback-webgl2") : "webgl2",
    three: salmon.THREE.REVISION,
    gpuName: gpuName(salmon.renderer),
    size: [1600, 900],
    screen: [innerWidth, innerHeight, devicePixelRatio],
    agent: navigator.userAgent,
    when: new Date().toISOString(),
    ...numbers,
    probe: window.__probe,
  };
  clearInterval(logTimer);
  await sendLog();
  await fetch(`/__report/${set}/${shot.name}`, { method: "POST", body: JSON.stringify(report, null, 2) });
  await nextTask();
  if (index + 1 < list.length) location.href = shotURL(set, list[index + 1], extra);
  else banner(`${set}: all ${list.length} points done`);
}
