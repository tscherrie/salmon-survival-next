import * as THREE from "three";
import { abs, dot, exp, length, pow, step, uniform, uv, vec3 } from "three/tsl";
import { PointCloud, perPoint } from "./materials.js";

// A new stage of life, marked: a burst of golden light round the fish -- motes that swirl
// out and up from it and twinkle away, a ring of light spreading from it, a stream of
// bright bubbles rising -- while the camera takes a slow turn round the new fish.

const COUNT = 220;
const TAU = Math.PI * 2;

export function createCelebration(scene) {
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);
  const alphas = new Float32Array(COUNT);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  material.positionNode = perPoint(geometry, "position");
  material.scaleNode = perPoint(geometry, "size");
  {
    const p = uv().mul(2).sub(1);
    const r = dot(p, p);
    // A soft core and a four-pointed twinkle.
    const core = exp(r.mul(-5));
    const star = exp(abs(p.x).mul(-14))
      .mul(exp(abs(p.y).mul(-2.2)))
      .add(exp(abs(p.y).mul(-14)).mul(exp(abs(p.x).mul(-2.2))));
    material.colorNode = perPoint(geometry, "color").mul(core.add(star.mul(0.6))).mul(perPoint(geometry, "alpha"));
    material.opacityNode = step(r, 1);
    material.alphaTest = 0.5;
  }
  const points = new PointCloud(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 5;
  points.name = "Celebration";
  scene.add(points);

  // Two rings of light, one after the other, spreading out from the fish.
  const ringMaterial = () => {
    const strength = uniform(0);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const r = length(uv().mul(2).sub(1));
    const band = exp(pow(r.sub(0.85).mul(16), 2).negate()).add(exp(pow(r.sub(0.7).mul(22), 2).negate()).mul(0.2));
    material.colorNode = vec3(1.6, 1.2, 0.55).mul(band).mul(strength);
    material.uniforms = { strength };
    return material;
  };
  const rings = [0, 1].map(() => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMaterial());
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    scene.add(mesh);
    return mesh;
  });

  const motes = Array.from({ length: COUNT }, () => ({
    life: 0,
    age: 0,
    delay: 0,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    size: 0,
    bubble: false,
    twinkle: 0,
  }));
  const centre = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let clock = 0;
  let active = false;
  let L = 1;

  return {
    // Start the show round a fish at `at`, `length` long.
    burst(at, length) {
      centre.copy(at);
      L = length;
      clock = 0;
      active = true;
      points.visible = true;
      for (let i = 0; i < COUNT; i++) {
        const m = motes[i];
        const bubble = i % 4 === 0;
        const a = Math.random() * TAU,
          e = Math.acos(Math.random() * 2 - 1);
        tmp.set(Math.sin(e) * Math.cos(a), Math.cos(e) * 0.6, Math.sin(e) * Math.sin(a));
        m.position.copy(at).addScaledVector(tmp, L * (bubble ? 0.3 : 0.25 + 0.35 * Math.random()));
        // Out and round the fish, and up; bubbles straight up, wobbling.
        const out = L * (bubble ? 0.3 : 0.9 + 1.4 * Math.random());
        m.velocity.copy(tmp).multiplyScalar(out);
        m.velocity.x += -tmp.z * L * 1.2;
        m.velocity.z += tmp.x * L * 1.2;
        m.velocity.y += L * (bubble ? 1.4 + Math.random() : 0.4 + Math.random() * 0.8);
        m.delay = bubble ? Math.random() * 1.6 : Math.random() * 0.35;
        m.life = bubble ? 2.2 + Math.random() * 1.6 : 1.8 + Math.random() * 2.2;
        m.age = 0;
        m.size = L * (bubble ? 0.05 + 0.05 * Math.random() : 0.04 + 0.08 * Math.random());
        m.bubble = bubble;
        m.twinkle = Math.random() * TAU;
        const warm = Math.random();
        if (bubble) colors.set([0.75, 0.95, 1.1], i * 3);
        else colors.set([1.6, 1.15 + 0.3 * warm, 0.45 + 0.4 * warm], i * 3);
      }
      geometry.attributes.color.needsUpdate = true;
      rings.forEach((ring, k) => {
        ring.visible = true;
        ring.userData.start = k * 0.45;
      });
    },
    get active() {
      return active;
    },
    update(dt, camera, fishPosition) {
      if (!active) return;
      clock += dt;
      // The swirl stays with the fish as it drifts.
      if (fishPosition) centre.lerp(fishPosition, 1 - Math.exp(-dt * 3));
      let alive = 0;
      for (let i = 0; i < COUNT; i++) {
        const m = motes[i];
        if (clock < m.delay) {
          alphas[i] = 0;
          positions.set([centre.x, centre.y, centre.z], i * 3);
          sizes[i] = 0;
          alive++;
          continue;
        }
        m.age += dt;
        const t = m.age / m.life;
        if (t >= 1) {
          alphas[i] = 0;
          sizes[i] = 0;
          continue;
        }
        alive++;
        m.velocity.multiplyScalar(Math.exp(-dt * (m.bubble ? 0.4 : 1.4)));
        if (m.bubble) {
          m.velocity.y += L * 0.6 * dt;
          m.position.x += Math.sin(m.age * 9 + m.twinkle) * L * 0.08 * dt;
        } else m.velocity.y += L * 0.08 * dt;
        m.position.addScaledVector(m.velocity, dt);
        positions.set([m.position.x, m.position.y, m.position.z], i * 3);
        const fade = Math.min(1, m.age * 5) * (1 - t) * (1 - t);
        alphas[i] = fade * (m.bubble ? 0.6 : 0.75 + 0.25 * Math.sin(m.age * 18 + m.twinkle));
        sizes[i] = m.size * (m.bubble ? 1 : 1 + 0.3 * Math.sin(m.age * 11 + m.twinkle));
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.alpha.needsUpdate = true;
      geometry.attributes.size.needsUpdate = true;
      for (const ring of rings) {
        const t = (clock - ring.userData.start) / 1.6;
        if (t < 0 || t > 1) {
          ring.visible = t < 0;
          ring.material.uniforms.strength.value = 0;
          continue;
        }
        ring.visible = true;
        ring.position.copy(centre);
        ring.quaternion.copy(camera.quaternion);
        ring.scale.setScalar(L * (0.4 + 2.6 * (1 - (1 - t) * (1 - t))));
        ring.material.uniforms.strength.value = (1 - t) * (1 - t) * Math.min(1, t * 8) * 0.55;
      }
      if (alive === 0 && clock > 2.5) {
        active = false;
        points.visible = false;
        for (const ring of rings) ring.visible = false;
      }
    },
  };
}
