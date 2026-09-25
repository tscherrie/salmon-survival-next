import * as THREE from "three";
import { Fn, cameraViewMatrix, faceDirection, instanceColor, instancedBufferAttribute, instancedDynamicBufferAttribute, mat4, modelWorldMatrix, normalGeometry, normalize, positionGeometry, varying, vec3, vec4 } from "three/tsl";

// For an instanced mesh whose shader reshapes its geometry before placing it -- a fish
// bending as it swims, a food shape tumbling -- the renderer's own instancing would place
// each copy first and the reshaping would then happen in the wrong frame. Such a mesh
// places its copies itself: this turns the renderer's instancing off for it and returns the
// instance's matrix as a node, read from the same array the game writes with setMatrixAt.
// Meshes sharing one instanceMatrix (a fish's body and fins) share the node.
const shared = new WeakMap();

export function ownInstanceMatrix(mesh) {
  const matrices = mesh.instanceMatrix;
  let entry = shared.get(matrices);
  if (!entry) {
    const interleaved = new THREE.InstancedInterleavedBuffer(matrices.array, 16, 1);
    interleaved.setUsage(THREE.DynamicDrawUsage);
    const node = mat4(...[0, 4, 8, 12].map((offset) => instancedDynamicBufferAttribute(interleaved, "vec4", 16, offset)));
    entry = { interleaved, node };
    shared.set(matrices, entry);
    // Not the renderer's to apply any more (the flag is its test).
    matrices.isInstancedBufferAttribute = false;
  }
  const { interleaved } = entry;
  // Whatever the game has written since the last frame goes up with the interleaved copy --
  // before the shadow pass as well as before the picture (the shadow is drawn first).
  const sync = () => {
    if (interleaved.version !== matrices.version) {
      interleaved.clearUpdateRanges();
      interleaved.updateRanges.push(...matrices.updateRanges);
      matrices.clearUpdateRanges();
      interleaved.version = matrices.version;
    }
  };
  for (const hook of ["onBeforeRender", "onBeforeShadow"]) {
    const before = mesh[hook];
    mesh[hook] = function (...args) {
      sync();
      before.apply(this, args);
    };
  }
  return entry.node;
}

// A mesh placing its own copies, for a material of its own: `reshape(p, matrix)` changes each
// point in the copy's own frame before it is placed (return p for no change); the normal is
// carried along with the placing (a reshape that only moves or scales keeps it right). A
// copy's own colour (setColorAt) is laid on by the renderer as usual -- or, with
// `ownColour`, returned as a node for the material to use as it likes.
export function placeOwnInstances(mesh, material, reshape = (p) => p, { doubleSided = false, ownColour = false } = {}) {
  const matrix = ownInstanceMatrix(mesh);
  material.positionNode = Fn(() => {
    if (mesh.instanceColor) instanceColor.assign(ownColour ? vec3(1) : instancedBufferAttribute(mesh.instanceColor));
    return matrix.mul(vec4(reshape(positionGeometry, matrix), 1)).xyz;
  })();
  const view = varying(cameraViewMatrix.mul(modelWorldMatrix.mul(matrix).mul(vec4(normalGeometry, 0))).xyz);
  material.normalNode = doubleSided ? normalize(view).mul(faceDirection) : normalize(view);
  const colour = ownColour && mesh.instanceColor ? varying(instancedBufferAttribute(mesh.instanceColor)) : vec3(1);
  return { matrix, colour };
}
