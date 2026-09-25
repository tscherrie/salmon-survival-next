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
  // Above the water at the salmon fall: the surface from above, the banks, the sky.
  { name: "sprung", stage: "spawner", at: 5150, season: "autumn", hour: 12, view: { eye: [-12, 0, 1.4], target: [30, 0, 4] } },
  // The rock gorge.
  { name: "schlucht", stage: "parr", at: 7200, season: "summer", hour: 13 },
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
];

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// The address of one point: the game with its settings, the run's name, the point's name.
export function shotURL(set, shot, extra = "") {
  const q = new URLSearchParams({ capture: "1", seed: "7", day: "still", rain: "0", quality: "detail", shots: set, shot: shot.name, stage: shot.stage, at: String(shot.at), season: shot.season, hour: String(shot.hour) });
  q.set("new", "");
  if (shot.u != null) q.set("u", String(shot.u));
  if (shot.event) q.set("event", shot.event);
  return `${location.pathname}?${q.toString().replace("new=", "new")}${extra}`;
}

// Time n frames on the graphics card (WebGL2's timer query), and what the draw costs the
// processor; with no timer on this card, only the latter.
async function measure(salmon, n = 90) {
  const { renderer } = salmon;
  const gl = renderer.getContext?.();
  const ext = gl?.getExtension?.("EXT_disjoint_timer_query_webgl2");
  const gpu = [],
    cpu = [],
    pending = [];
  renderer.info.autoReset = false;
  let calls = 0,
    triangles = 0;
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
    calls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
    if (ext) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(query);
    }
    await nextFrame();
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
  // (The first frames warm up; keep the rest.)
  return { gpu: stats(gpu.slice(10)), cpu: stats(cpu.slice(10)), calls, triangles, programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
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
  document.body.classList.add("shooting");
  const { course } = salmon;
  // The river built all round, the fish and its neighbours settled into it.
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
  salmon.pause(true);
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
  const numbers = await measure(salmon);
  await salmon.capture(`${set}/${shot.name}`, 1600, 900);
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
  };
  await fetch(`/__report/${set}/${shot.name}`, { method: "POST", body: JSON.stringify(report, null, 2) });
  await nextTask();
  if (index + 1 < list.length) location.href = shotURL(set, list[index + 1], extra);
  else banner(`${set}: all ${list.length} points done`);
}
