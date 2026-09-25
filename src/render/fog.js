import * as THREE from "three";
import { Fn, cameraPosition, exp, float, length, max, mix, output, positionWorld, reference, renderGroup, smoothstep, vec3, vec4 } from "three/tsl";

// Water, not air, between the viewer and everything in the river.
//
// Plain fog blends each fragment toward one colour by a single factor. Water does two
// things instead: it takes light away along the path, red far faster than green, and it
// adds light scattered into the path from the sunlit water around it, which is brighter
// looking up toward the surface than looking down into the bed. Both depend on the true
// distance along the view ray and its direction. The scene's fog (a FogExp2, which the game
// sets each frame) holds the numbers: its colour is the in-scattered light for a level view,
// its density the green extinction per scene unit; the other channels scale from it.
export const EXTINCTION_RATIO = new THREE.Vector3(1.55, 1.0, 1.12);

let fogColor = null,
  fogDensity = null;

// The light scattered toward the eye by the water, looking along `direction`.
export const underwaterInscatter = Fn(([direction]) => {
  const up = direction.y;
  // Brighter toward the lit surface, dimmer and bluer toward the bed.
  const tint = mix(vec3(0.8, 0.93, 1.0), vec3(1.08, 1.04, 0.92), smoothstep(-0.1, 0.5, up));
  return fogColor.mul(tint).mul(smoothstep(-0.45, 0.62, up).mul(0.95).add(0.52));
});

// The fog's colour and density as nodes (for materials that work the water out themselves).
export const fogNodes = () => ({ color: fogColor, density: fogDensity });

// Water between the eye and a point `distance` away along `direction`: what gets through
// (per channel) and what is scattered in.
export const waterBetween = Fn(([color, distance, direction]) => {
  const transmit = exp(fogDensity.mul(distance).mul(vec3(EXTINCTION_RATIO.x, EXTINCTION_RATIO.y, EXTINCTION_RATIO.z)).negate());
  return color.mul(transmit).add(underwaterInscatter(direction).mul(transmit.oneMinus()));
});

// Every material with fog on gets the water model instead of the renderer's own fog.
export function installUnderwaterFog(scene) {
  fogColor = reference("color", "color", scene.fog).setGroup(renderGroup);
  fogDensity = reference("density", "float", scene.fog).setGroup(renderGroup);
  scene.fogNode = Fn(() => {
    const ray = positionWorld.sub(cameraPosition);
    const distance = length(ray);
    const direction = ray.div(max(distance, float(1e-4)));
    return vec4(waterBetween(output.rgb, distance, direction), output.a);
  })();
}
