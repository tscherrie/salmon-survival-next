import * as THREE from "three";
import { texture, uniform } from "three/tsl";

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

// Under the water and never above it: not drawn into the mirror (the clip plane would cut
// them away anyway, but only after their vertices were worked out).
const SUNKEN = /^(Bed|Plants|Cobbles|Gravel|Food|Eggs|Moon jellies|Laichlachs school|minnow|grayling|troutParr)/;

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
  const hidden = [];

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

    hidden.length = 0;
    scene.traverse((object) => {
      if (object.visible && SUNKEN.test(object.name)) {
        hidden.push(object);
        object.visible = false;
      }
    });
    surfaceMaterial.visible = false;
    const current = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, virtual);
    renderer.setRenderTarget(current);
    surfaceMaterial.visible = true;
    for (const object of hidden) object.visible = true;
    mirrorOn.value = 1;
  }

  return { target, setSize, render, off: () => (mirrorOn.value = 0) };
}
