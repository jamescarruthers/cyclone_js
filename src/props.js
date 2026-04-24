import * as THREE from 'three';

export function createCrate() {
  const grp = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.8, 1.8),
    new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.85, flatShading: true }),
  );
  grp.add(box);

  // Cross-straps
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x6b4521, roughness: 0.9 });
  for (const axis of ['x', 'z']) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(
      axis === 'x' ? 2.0 : 0.18,
      0.18,
      axis === 'z' ? 2.0 : 0.18,
    ), strapMat);
    s.position.y = 0.0;
    grp.add(s);
  }
  // Top strap (vertical ridge)
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.0, 0.18), strapMat);
  grp.add(ridge);

  // Tiny signal beacon
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xff4040, emissive: 0xff2020, emissiveIntensity: 1.5, roughness: 0.4,
    }),
  );
  beacon.position.set(0.7, 1.05, 0.7);
  grp.add(beacon);

  return grp;
}

export function createHelipad() {
  const grp = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 0.15, 36),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
  );
  grp.add(pad);
  // White ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 3.8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  grp.add(ring);
  // H mark — two verticals and a crossbar using thin boxes
  const mark = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const hBar = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mark);
    m.position.set(x, 0.11, z);
    grp.add(m);
  };
  hBar(0.5, 3.4, -0.9, 0);
  hBar(0.5, 3.4,  0.9, 0);
  hBar(2.3, 0.5,  0,   0);
  // Red safety triangles around the ring
  const tMat = new THREE.MeshBasicMaterial({ color: 0xc23a2a });
  for (let i = 0; i < 8; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 3), tMat);
    const a = (i / 8) * Math.PI * 2;
    t.position.set(Math.cos(a) * 4.4, 0.1, Math.sin(a) * 4.4);
    t.rotation.y = a;
    t.rotation.x = Math.PI / 2;
    grp.add(t);
  }
  return grp;
}
