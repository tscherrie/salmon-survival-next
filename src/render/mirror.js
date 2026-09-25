import * as THREE from "three";
import { cubeTexture, texture, uniform } from "three/tsl";

// The river mirrors the world above it. Seen from the air at a low angle the banks, the
// trees and a bridge are what the water shows, far more than the sky -- and most of that is
// not on the screen at all (the underside of a bridge overhead), so it cannot be borrowed
// from the picture. The scene is drawn a second time instead, from the eye mirrored in the
// water's plane where the eye is (a river is nearly level over the stretch one sees), at a
// fraction of the resolution, and only while the eye is above the water. The surface
// (materials.js) looks the reflected ray up in it.

// The picture in the mirror, and whether there is one this frame.
export const mirrorMap = texture(new THREE.Texture());
export const mirrorOn = uniform(0);

// Under the water and never above it: not drawn into the mirror or the window (the clip
// plane would cut them away anyway, but only after their vertices were worked out). Not
// the bed, which holds the banks; the plants, though the grass on the banks is among them:
// the weed under the water is by far the most of them.
const SUNKEN = /^(Plants|Cobbles|Gravel|Food|Eggs|Moon jellies|Laichlachs school|minnow|grayling|troutParr)/;
// ...and in the window not the white water of a fall either: layer on layer of spray and
// mist, dear to draw, and from under the water the fall is right there to see anyway.
const SUNKEN_OR_FALLING = new RegExp(`${SUNKEN.source}|^(Fall|Plunge|Foam|Spray|Plume|Mist|Boil)`);

export function createMirror(renderer, { scale = 0.5 } = {}) {
  const target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
  target.texture.name = "Mirror";
  mirrorMap.value = target.texture;
  const virtual = new THREE.PerspectiveCamera();
  const plane = new THREE.Vector4();
  const q = new THREE.Vector4();
  const flip = new THREE.Matrix4();
  const mirrored = new THREE.Matrix4();
  const swap = new THREE.Matrix4().makeScale(-1, 1, 1);

  function setSize(width, height) {
    target.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  }

  // Draw the mirror for `camera` in the plane y = level, leaving out the surface itself.
  function render(scene, camera, level, surfaceMaterial) {
    // The eye mirrored in the plane: y -> 2 level - y, as a matrix on the camera's world
    // matrix, with the picture's left and right swapped back (the surface samples it with
    // x mirrored) so the triangles keep their winding.
    flip.set(1, 0, 0, 0, 0, -1, 0, 2 * level, 0, 0, 1, 0, 0, 0, 0, 1);
    mirrored.multiplyMatrices(flip, camera.matrixWorld).multiply(swap);
    mirrored.decompose(virtual.position, virtual.quaternion, virtual.scale);
    virtual.updateMatrixWorld();
    virtual.near = camera.near;
    virtual.far = camera.far;
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    virtual.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    // Only what is above the plane: its near plane is bent onto the water (Lengyel's
    // oblique clipping), so nothing under the surface is drawn into the mirror.
    const n = new THREE.Vector3(0, 1, 0).transformDirection(virtual.matrixWorldInverse);
    const p = new THREE.Vector3(0, level, 0).applyMatrix4(virtual.matrixWorldInverse);
    plane.set(n.x, n.y, n.z, -n.dot(p));
    const m = virtual.projectionMatrix.elements;
    q.set((Math.sign(plane.x) + m[8]) / m[0], (Math.sign(plane.y) + m[9]) / m[5], -1, (1 + m[10]) / m[14]);
    plane.multiplyScalar(1 / plane.dot(q));
    const webgpu = renderer.coordinateSystem === THREE.WebGPUCoordinateSystem;
    m[2] = plane.x;
    m[6] = plane.y;
    m[10] = webgpu ? plane.z : plane.z + 1;
    m[14] = plane.w;
    virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();

    aboveOnly(scene, surfaceMaterial, SUNKEN, () => {
      const current = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, virtual);
      renderer.setRenderTarget(current);
    });
    mirrorOn.value = 1;
  }

  return { target, setSize, render, off: () => (mirrorOn.value = 0) };
}

// The window: from under the water the whole sky and the banks round it are squeezed into
// a circle overhead (Snell's window), rimmed by the mirror of the river. What shows in it
// is drawn into a small cube round the point of the surface over the eye, one face every
// other frame (the one overhead most often; the one below never, the window cannot see
// down) -- what is above changes slowly, and each drawing of the scene costs a millisecond.
export const windowTarget = new THREE.CubeRenderTarget(256, { type: THREE.HalfFloatType });
windowTarget.texture.name = "Window";
export const windowMap = cubeTexture(windowTarget.texture);
export const windowOn = uniform(0);
const ROUND = [2, 0, 2, 1, 2, 4, 2, 5];

export function createWindow(renderer) {
  const cube = new THREE.CubeCamera(0.05, 900, windowTarget);
  let turn = 0;

  // Draw the window's cube at `at` (just over the water); every face when it has none yet.
  function render(scene, at, surfaceMaterial) {
    if (cube.coordinateSystem !== renderer.coordinateSystem) {
      cube.coordinateSystem = renderer.coordinateSystem;
      cube.updateCoordinateSystem();
    }
    cube.position.copy(at);
    cube.updateMatrixWorld(true);
    if (windowOn.value && turn++ % 2) return;
    const faces = windowOn.value ? [ROUND[(turn >> 1) % ROUND.length]] : [2, 0, 1, 4, 5];
    aboveOnly(scene, surfaceMaterial, SUNKEN_OR_FALLING, () => {
      const current = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace();
      const level = renderer.getActiveMipmapLevel();
      for (const f of faces) {
        renderer.setRenderTarget(windowTarget, f);
        renderer.render(scene, cube.children[f]);
      }
      renderer.setRenderTarget(current, face, level);
    });
    windowOn.value = 1;
  }

  return { render, off: () => (windowOn.value = 0) };
}

// Draw with what is only ever under the water (by name), and the surface itself, left out.
const hidden = [];
function aboveOnly(scene, surfaceMaterial, leaveOut, draw) {
  hidden.length = 0;
  scene.traverse((object) => {
    if (object.visible && leaveOut.test(object.name)) {
      hidden.push(object);
      object.visible = false;
    }
  });
  surfaceMaterial.visible = false;
  draw();
  surfaceMaterial.visible = true;
  for (const object of hidden) object.visible = true;
}
