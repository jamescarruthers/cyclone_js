// Minimal three.js stand-in so src/helicopter.js can run headless under
// node:test.  Implements only the surface that module touches; geometry
// and materials are inert placeholders.

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}

class Euler {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; }
}

export class Object3D {
  constructor() {
    this.children = [];
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.quaternion = {};
    this.userData = {};
  }
  add(...o) { this.children.push(...o); return this; }
}

export class Group extends Object3D {}
export class Mesh extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}

const inertGeo = () => ({ translate() { return this; }, rotateX() { return this; }, attributes: {} });
export class SphereGeometry { constructor() { return inertGeo(); } }
export class CylinderGeometry { constructor() { return inertGeo(); } }
export class BoxGeometry { constructor() { return inertGeo(); } }
export class CircleGeometry { constructor() { return inertGeo(); } }
export class MeshStandardMaterial { constructor(o) { Object.assign(this, o); } }
export class MeshBasicMaterial { constructor(o) { Object.assign(this, o); } }
export const DoubleSide = 2;
export const MathUtils = { clamp: (v, a, b) => Math.min(b, Math.max(a, v)) };
