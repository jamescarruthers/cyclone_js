import * as THREE from 'three';

// Birds: small flocking sprites that idle near islands — "BEWARE AIRCRAFT"
// message in the original ROM refers mostly to the planes below, but birds
// are a classic Cyclone hazard too.
export function createBirds(world, count = 12) {
  const group = new THREE.Group();
  const birds = [];
  for (let i = 0; i < count; i++) {
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1.0, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, flatShading: true }),
    );
    body.rotation.x = Math.PI / 2;
    const wings = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.05, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true }),
    );
    const b = new THREE.Group();
    b.add(body); b.add(wings);
    b.userData = {
      base: pickPos(world),
      t: Math.random() * Math.PI * 2,
      r: 18 + Math.random() * 30,
      h: 20 + Math.random() * 35,
      speed: 0.7 + Math.random() * 0.9,
      wings,
    };
    group.add(b);
    birds.push(b);
  }
  function pickPos(world) {
    const isle = world.islands[Math.floor(Math.random() * world.islands.length)];
    return isle.topCenter.clone();
  }
  function update(dt, t) {
    for (const b of birds) {
      b.userData.t += dt * b.userData.speed;
      const p = b.userData.base;
      b.position.set(
        p.x + Math.cos(b.userData.t) * b.userData.r,
        p.y + b.userData.h + Math.sin(b.userData.t * 0.7) * 4,
        p.z + Math.sin(b.userData.t) * b.userData.r,
      );
      b.rotation.y = -b.userData.t + Math.PI / 2;
      // wing flap
      b.userData.wings.scale.y = 1 + Math.sin(t * 12 + b.userData.t) * 0.5;
    }
  }
  return { group, birds, update };
}

// Aircraft: small light planes that track across the map on random lines.
export function createAircraft(world, count = 3) {
  const group = new THREE.Group();
  const planes = [];
  const sz = world.worldSize;
  for (let i = 0; i < count; i++) {
    const plane = makePlane();
    respawn(plane, sz);
    group.add(plane);
    planes.push(plane);
  }
  function respawn(p, worldSize) {
    const side = Math.floor(Math.random() * 4);
    const s = worldSize * 0.55;
    const off = (Math.random() * 2 - 1) * s;
    if (side === 0) { p.position.set(-s, 40 + Math.random()*50,  off); p.userData.vel = new THREE.Vector3(14, 0, 0); }
    if (side === 1) { p.position.set( s, 40 + Math.random()*50,  off); p.userData.vel = new THREE.Vector3(-14, 0, 0); }
    if (side === 2) { p.position.set( off, 40 + Math.random()*50, -s); p.userData.vel = new THREE.Vector3(0, 0, 14); }
    if (side === 3) { p.position.set( off, 40 + Math.random()*50,  s); p.userData.vel = new THREE.Vector3(0, 0, -14); }
    const a = Math.atan2(p.userData.vel.x, p.userData.vel.z);
    p.rotation.y = a;
  }
  function update(dt, t) {
    for (const p of planes) {
      p.position.addScaledVector(p.userData.vel, dt);
      const s = world.worldSize * 0.65;
      if (Math.abs(p.position.x) > s || Math.abs(p.position.z) > s) respawn(p, world.worldSize);
    }
  }
  return { group, planes, update, respawn };
}

function makePlane() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 3.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xbabdc2, metalness: 0.5, roughness: 0.4 }),
  );
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const wings = new THREE.Mesh(
    new THREE.BoxGeometry(5, 0.1, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.4, roughness: 0.5 }),
  );
  g.add(wings);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.08, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.4, roughness: 0.5 }),
  );
  tail.position.z = -1.4;
  g.add(tail);
  const fin = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.7, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.4, roughness: 0.5 }),
  );
  fin.position.set(0, 0.4, -1.4);
  g.add(fin);
  return g;
}

// Survivors: small figures on islands that can be rescued for bonus points.
// The ROM's text reads "RESCUE SURVIVORS FOR EXTRA POINTS".
export function createSurvivors(world, count = 6) {
  const group = new THREE.Group();
  const survivors = [];
  const pickable = world.islands.filter(i => !i.isHome);
  for (let i = 0; i < count; i++) {
    const island = pickable[i % pickable.length];
    const s = makeSurvivor();
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * island.radius * 0.6;
    s.position.set(
      island.topCenter.x + Math.cos(a) * r,
      island.topCenter.y + 0.9,
      island.topCenter.z + Math.sin(a) * r,
    );
    s.userData = { rescued: false, island, bobPhase: Math.random() * Math.PI * 2 };
    group.add(s);
    survivors.push(s);
  }
  function update(dt, t) {
    for (const s of survivors) {
      if (s.userData.rescued) continue;
      // Gently wave an arm to signal distress.
      const arm = s.children[3];
      if (arm) arm.rotation.z = Math.sin(t * 3 + s.userData.bobPhase) * 0.9 + 0.6;
    }
  }
  return { group, survivors, update };
}

function makeSurvivor() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff7240, flatShading: true }),
  );
  body.position.y = 0.4;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xf2c68a, flatShading: true }),
  );
  head.position.y = 0.95;
  g.add(head);
  const legs = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.35, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x334766, flatShading: true }),
  );
  legs.position.y = 0.1;
  g.add(legs);
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.45, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xff7240, flatShading: true }),
  );
  arm.position.set(0.22, 0.55, 0);
  arm.geometry.translate(0, -0.18, 0);  // pivot at shoulder
  g.add(arm);
  return g;
}
