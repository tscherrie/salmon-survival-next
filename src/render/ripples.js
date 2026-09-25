import * as THREE from "three";
import { RIPPLE_COUNT, river } from "./water.js";
import { SURFACE_FLOW } from "./caustics.js";

// Rings on the surface: a pellet landing, a bubble bursting, a fish breaking the film. Each
// spreads from where it started as the whole film slides downstream, and dies away; the
// slots are shared with the shaders (river.ripples), the oldest ring making way.
export function createRipples() {
  const slots = river.rippleSlots;
  const born = new Float32Array(RIPPLE_COUNT);
  const origins = Array.from({ length: RIPPLE_COUNT }, () => new THREE.Vector2());
  let next = 0;
  let clock = 0;
  return {
    // A ring starting at (x, z) on the surface; strength 1 is a pellet landing.
    add(x, z, strength = 1) {
      // A free slot if there is one, otherwise the ring with the least left in it.
      let slot = next,
        weakest = Infinity;
      for (let i = 0; i < RIPPLE_COUNT; i++) {
        const k = (next + i) % RIPPLE_COUNT;
        const left = slots[k].w * Math.max(0, 7 - (clock - born[k]));
        if (left < weakest) {
          weakest = left;
          slot = k;
        }
        if (left <= 0) break;
      }
      next = (slot + 1) % RIPPLE_COUNT;
      origins[slot].set(x, z);
      born[slot] = clock;
      slots[slot].set(x, z, 0, Math.min(1.6, strength));
      return slot;
    },
    update(dt) {
      clock += dt;
      for (let i = 0; i < RIPPLE_COUNT; i++) {
        const ring = slots[i];
        if (ring.w <= 0) continue;
        const age = clock - born[i];
        if (age > 7) {
          ring.w = 0;
          continue;
        }
        ring.x = origins[i].x + SURFACE_FLOW.x * age;
        ring.y = origins[i].y + SURFACE_FLOW.y * age;
        ring.z = age;
        ring.w *= Math.exp(-dt * 0.55);
      }
    },
  };
}
