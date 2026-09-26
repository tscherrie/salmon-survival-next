// The first thing on screen: the title, a line about what the game is, the controls, and
// the button that starts the swim (which is also the click the browser needs before it
// plays sound or captures the mouse). With a keyboard and a mouse the card lists the keys;
// on a phone or a tablet, the touch controls (src/touch.js). Paused mid-swim, the same card
// comes back as the pause, with everything on it (the language, vegan mode, the graphics,
// a new game): its button swims on. Either way the river stays in sight behind it, neither
// blurred nor darkened, and the buttons in the corner can be used (#habitat.menu).

export function isDesktop() {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua);
  // iPadOS presents itself as a Mac, but a Mac has no touch screen.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const pointer = matchMedia("(pointer: fine)").matches || matchMedia("(any-pointer: fine)").matches;
  const hover = matchMedia("(hover: hover)").matches || matchMedia("(any-hover: hover)").matches;
  return !mobile && !iPad && pointer && hover;
}

import { VERSION } from "./version.js";
import { clearSave } from "./save.js";
import { LANGS, lang, setLang } from "./i18n.js";
import { track } from "./track.js";
import { mode, setVegan } from "./vegan.js";

const box = () => document.querySelector("#intro");

// Graphics quality: the four steps side by side, each with a word on what it is for, the
// one in use marked and the one this kind of device starts with marked "empfohlen"; below,
// what the one under the pointer or the focus does (render/policy.js, gameSettings() in
// main.js). The renderer is built for one quality, so picking another saves the fish and
// loads the game afresh: one click, as for a language. The same control sits on the card
// and in the panel at the graphics button (G); `createQualityChoice` holds what both show.
// (On a phone the resolution is the screen's at every step, so Ultra adds little there.)
export const QUALITIES = [
  { id: "eco", name: "Niedrig", short: "Akku sparen", about: "Für schwache Geräte und lange Akkulaufzeit: schlichteres Bild, weniger Pflanzen." },
  { id: "balanced", name: "Mittel", short: "ausgewogen", about: "Ausgewogen: glatte Kanten, aber ohne Spiegelungen und klares Wasser." },
  { id: "detail", name: "Hoch", short: "klares Wasser", about: "Klares Wasser mit Spiegelungen, Relief im Flussbett, mehr Pflanzen und Leben." },
  { id: "ultra", name: "Ultra", short: "volle Auflösung", about: "Wie Hoch, in voller Bildschirmauflösung – für starke Grafikkarten.", shortTouch: "noch feiner", aboutTouch: "Wie Hoch, noch etwas feiner – auf Handys und Tablets kaum ein Unterschied." },
];
export const qualityName = (id) => QUALITIES.find((q) => q.id === id)?.name ?? id;

let pickers = 0;
export function createQualityChoice({ current, recommended, touch = false, onPick = () => {} }) {
  const views = [];
  let picked = null;
  const text = (q, key) => (touch && q[key + "Touch"]) || q[key];
  function pick(id) {
    if (picked || id === current || !QUALITIES.some((q) => q.id === id)) return false;
    picked = id;
    for (const view of views) view.busy(id);
    onPick(id);
    return true;
  }
  // The control, into `slot`. `heading`: its own "Grafik" line (the panel has a title).
  function mount(slot, { heading = true } = {}) {
    if (!slot) return null;
    const n = ++pickers;
    const root = document.createElement("div");
    root.className = "quality-picker";
    const head = document.createElement("p");
    head.className = "head";
    const title = document.createElement("b");
    title.id = `quality-${n}-title`;
    title.textContent = "Grafik";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Ein Wechsel lädt das Spiel neu – dein Lachs bleibt gespeichert.";
    if (heading) head.append(title, " ");
    head.append(hint);
    const group = document.createElement("div");
    group.className = "options";
    group.setAttribute("role", "group");
    if (heading) group.setAttribute("aria-labelledby", title.id);
    else group.setAttribute("aria-label", "Grafik");
    const about = document.createElement("p");
    about.className = "about";
    about.setAttribute("aria-hidden", "true");
    const notes = document.createElement("div");
    notes.hidden = true;
    const buttons = QUALITIES.map((q) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.dataset.quality = q.id;
      button.setAttribute("aria-pressed", String(q.id === current));
      button.tabIndex = q.id === current ? 0 : -1;
      const name = document.createElement("b");
      name.textContent = q.name;
      const short = document.createElement("small");
      short.textContent = text(q, "short");
      button.append(name, short);
      if (q.id === recommended) {
        button.classList.add("recommended");
        const tag = document.createElement("em");
        tag.className = "tag";
        tag.textContent = "empfohlen";
        button.append(tag);
      }
      // What it does, for a screen reader (the line under the steps is for the eye).
      const note = document.createElement("span");
      note.id = `quality-${n}-${q.id}`;
      note.textContent = text(q, "about");
      notes.append(note);
      button.setAttribute("aria-describedby", note.id);
      button.addEventListener("click", () => pick(q.id));
      button.addEventListener("pointerenter", () => describe(q));
      button.addEventListener("focus", () => describe(q));
      group.append(button);
      return button;
    });
    const describe = (q) => {
      if (!picked) about.textContent = text(q, "about");
    };
    const rest = () => describe(QUALITIES.find((q) => q.id === current) ?? QUALITIES[1]);
    group.addEventListener("pointerleave", () => {
      if (!group.contains(document.activeElement)) rest();
    });
    group.addEventListener("focusout", (event) => {
      if (!group.contains(event.relatedTarget)) rest();
    });
    // Arrows (and Home, End) move between the steps, Enter or Space takes one; kept from
    // the game's keys (Space would be a dash there).
    group.addEventListener("keydown", (event) => {
      const at = buttons.indexOf(document.activeElement);
      let to = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") to = Math.min(buttons.length - 1, at + 1);
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = Math.max(0, at - 1);
      else if (event.key === "Home") to = 0;
      else if (event.key === "End") to = buttons.length - 1;
      else if (event.key !== "Enter" && event.key !== " ") return;
      event.stopPropagation();
      if (to === null || at < 0) return;
      event.preventDefault();
      for (const b of buttons) b.tabIndex = -1;
      buttons[to].tabIndex = 0;
      buttons[to].focus();
    });
    rest();
    root.append(head, group, about, notes);
    slot.replaceChildren(root);
    const view = {
      root,
      // Focus the step in use (the panel, opened).
      focus() {
        const now = buttons.find((b) => b.dataset.quality === current) ?? buttons[0];
        for (const b of buttons) b.tabIndex = b === now ? 0 : -1;
        now.focus({ preventScroll: true });
      },
      busy(id) {
        root.classList.add("busy");
        for (const b of buttons) {
          b.disabled = true;
          if (b.dataset.quality === id) {
            b.classList.add("picked");
            b.querySelector("small").textContent = "lädt neu …";
          }
        }
        about.textContent = `Grafik: ${qualityName(id)} …`;
      },
    };
    views.push(view);
    if (picked) view.busy(picked);
    return view;
  }
  return { current, recommended, pick, mount };
}
// The language picker on the card: the one in use marked; another reloads in it (after
// `leaving()`, which keeps the fish when the game is under way).
function languages(intro, leaving = () => {}) {
  intro.querySelector(".links a")?.addEventListener("click", () => track("github"));
  const picker = intro.querySelector(".langs");
  if (!picker || picker.childElementCount) return;
  for (const [code, name] of Object.entries(LANGS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.lang = code;
    button.setAttribute("aria-pressed", code === lang ? "true" : "false");
    button.addEventListener("click", () => {
      if (code === lang) return;
      track("language", { to: code });
      leaving();
      setTimeout(() => setLang(code), 150);
    });
    picker.append(button);
  }
}
// On an iPhone or iPad the page cannot ask for the whole screen; added to the home screen
// it gets it. The card says how, until the game is opened from there.
const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
export const asApp = () => navigator.standalone === true || matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
function homeScreen(intro) {
  const hint = intro.querySelector(".homescreen");
  if (hint) hint.hidden = !(apple() && !asApp());
}
const showVersion = (intro) => {
  const tag = intro.querySelector(".version");
  if (tag) tag.textContent = VERSION === "dev" ? "Entwicklungsversion" : `Version ${VERSION}`;
};

export function showPhoneNotice() {
  const intro = box();
  intro.classList.add("phone");
  intro.hidden = false;
  showVersion(intro);
  languages(intro);
  document.querySelector("#loading").hidden = true;
  document.querySelector("#hud").hidden = true;
  const copy = intro.querySelector("#intro-copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href.split("?")[0]);
      copy.textContent = "Link kopiert";
    } catch {
      copy.textContent = location.href.split("?")[0];
    }
  });
}

// Shows the card at once, while the river is still being built; `ready()` enables the
// button, and the promise resolves when it is pressed. (Development runs start without it:
// `title: false`.) Mid-swim `pause()` shows it again and `resume()` takes it away; its
// button then calls `onResume`, and `beforeReload` runs before a language switch reloads.
export function showIntro({ resume = null, title = true, quality = null, onResume = () => {}, beforeReload = () => {} } = {}) {
  const intro = box();
  const habitat = document.querySelector("#habitat");
  const button = intro.querySelector("#intro-start");
  const status = intro.querySelector("#intro-status");
  const kicker = intro.querySelector(".kicker");
  let paused = false;
  let gone = 0;
  const show = () => {
    clearTimeout(gone);
    intro.classList.remove("leaving");
    intro.hidden = false;
    habitat?.classList.add("menu");
  };
  const hide = () => {
    clearTimeout(gone);
    habitat?.classList.remove("menu");
    intro.classList.add("leaving");
    gone = setTimeout(() => {
      intro.hidden = true;
      intro.classList.remove("paused");
    }, 500);
  };
  showVersion(intro);
  languages(intro, () => paused && beforeReload());
  homeScreen(intro);
  // The graphics, a row near the languages (the same control as the panel at G).
  quality?.mount(intro.querySelector(".quality-slot"));
  if (title) {
    show();
    if (asApp()) track("app");
  }
  button.disabled = true;
  button.textContent = "Der Fluss entsteht …";
  if (resume) status.textContent = `Gespeichert: ${resume}`;
  // Vegan mode (vegan.js): nobody is eaten; kept for next time.
  const vegan = intro.querySelector("#intro-vegan");
  if (vegan) {
    vegan.checked = mode.vegan;
    vegan.addEventListener("change", () => {
      setVegan(vegan.checked);
      track("vegan", { on: vegan.checked });
    });
  }
  let release;
  const started = new Promise((resolve) => (release = resolve));
  button.addEventListener("click", () => {
    if (paused) return onResume();
    hide();
    release();
  });
  // With a fish saved: a small way to start over instead (asked twice, it cannot be undone).
  const fresh = intro.querySelector("#intro-new");
  let sure = false;
  if (fresh) {
    fresh.hidden = !resume;
    fresh.addEventListener("click", () => {
      if (!sure) {
        sure = true;
        fresh.textContent = "Wirklich? Dein Lachs geht verloren – nochmal klicken";
        return;
      }
      clearSave();
      location.replace(location.pathname);
    });
  }
  return {
    started,
    ready() {
      button.disabled = false;
      button.textContent = resume ? "Weiterschwimmen" : "Losschwimmen";
      button.focus({ preventScroll: true });
    },
    // Paused: the card over the river as it is, with the fish's stage as saved; the
    // button, P or a click beside the card swims on.
    pause({ saved = null, touch = false } = {}) {
      paused = true;
      intro.classList.add("paused");
      if (kicker) kicker.hidden = false;
      button.disabled = false;
      button.textContent = "Weiterschwimmen";
      if (!touch) {
        const key = document.createElement("kbd");
        key.textContent = "P";
        button.append(" ", key);
      }
      status.textContent = saved ? `Gespeichert: ${saved}` : "";
      if (vegan) vegan.checked = mode.vegan;
      if (fresh) {
        sure = false;
        fresh.textContent = "Neues Spiel starten";
        fresh.hidden = false;
      }
      show();
      // (On a small screen the card scrolls: from the top, as far as the button.)
      intro.querySelector(".card").scrollTop = 0;
      button.scrollIntoView({ block: "nearest" });
      button.focus({ preventScroll: true });
    },
    resume() {
      if (!paused) return;
      paused = false;
      button.blur();
      hide();
    },
  };
}
