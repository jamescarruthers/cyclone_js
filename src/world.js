import * as THREE from 'three';

// Deterministic PRNG so the archipelago is stable between loads.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld({ worldSize = 600, islandCount = 9, seed = 1, names = [] } = {}) {
  const group = new THREE.Group();
  const rand = mulberry32(seed);

  // -------- Sky dome with gradient -----------------------------------
  const skyGeo = new THREE.SphereGeometry(worldSize * 1.4, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top:    { value: new THREE.Color(0x5aa7e6) },
      bottom: { value: new THREE.Color(0xe3f4ff) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 top; uniform vec3 bottom;
      void main() {
        float h = clamp(vP.y / ${(worldSize * 1.4).toFixed(1)} * 1.2 + 0.1, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, h), 1.0);
      }
    `,
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));

  // -------- Sea --------------------------------------------------------
  const seaGeo = new THREE.PlaneGeometry(worldSize * 2.4, worldSize * 2.4, 64, 64);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.MeshStandardMaterial({
    color: 0x1f6ea0,
    roughness: 0.85, metalness: 0.05,
    flatShading: true,
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.y = 0;
  group.add(sea);

  // subtle wave displacement
  const originalY = new Float32Array(seaGeo.attributes.position.count);
  for (let i = 0; i < seaGeo.attributes.position.count; i++) {
    originalY[i] = seaGeo.attributes.position.getY(i);
  }

  // -------- Islands ----------------------------------------------------
  const islands = [];
  const occupied = [];
  function placeIsland(radius) {
    for (let tries = 0; tries < 400; tries++) {
      const x = (rand() * 2 - 1) * (worldSize * 0.42);
      const z = (rand() * 2 - 1) * (worldSize * 0.42);
      const c = new THREE.Vector3(x, 0, z);
      let ok = true;
      for (const o of occupied) {
        if (c.distanceTo(o.c) < radius + o.r + 28) { ok = false; break; }
      }
      if (ok) { occupied.push({ c, r: radius }); return c; }
    }
    return new THREE.Vector3((rand()*2-1)*worldSize*0.3, 0, (rand()*2-1)*worldSize*0.3);
  }

  // The home island (index 0) — larger & central-ish
  const homeCenter = new THREE.Vector3((rand()*2-1)*30, 0, (rand()*2-1)*30);
  occupied.push({ c: homeCenter, r: 40 });
  const home = makeIsland(homeCenter, 40, 5, true, rand);
  home.name = names[0] || 'BASE';
  islands.push(home);

  for (let i = 1; i < islandCount; i++) {
    const r = 18 + rand() * 26;
    const c = placeIsland(r);
    const is = makeIsland(c, r, 3 + rand() * 6, false, rand);
    is.name = names[i] || `ISLAND-${i}`;
    islands.push(is);
  }

  for (const is of islands) group.add(is.mesh);

  // -------- Clouds (sprites) ------------------------------------------
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const s = 28 + rand() * 46;
    const g = new THREE.SphereGeometry(s, 10, 8);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7,
      roughness: 1, metalness: 0, emissive: 0x223344, emissiveIntensity: 0.05,
      flatShading: true,
    });
    const cl = new THREE.Mesh(g, m);
    cl.position.set(
      (rand()*2-1) * worldSize * 0.6,
      110 + rand() * 60,
      (rand()*2-1) * worldSize * 0.6,
    );
    cl.scale.set(1.6 + rand()*1.2, 0.6 + rand()*0.3, 1 + rand()*1.0);
    cl.userData.drift = 2 + rand() * 3;
    group.add(cl);
    clouds.push(cl);
  }

  function update(dt, t) {
    // sea waves
    const pos = seaGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = Math.sin((x + t*8) * 0.03) * 0.35 + Math.cos((z - t*6) * 0.04) * 0.35;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    for (const cl of clouds) {
      cl.position.x += cl.userData.drift * dt;
      if (cl.position.x > worldSize * 0.7) cl.position.x = -worldSize * 0.7;
    }
  }

  return { group, islands, update };
}

function makeIsland(center, radius, height, isHome, rand) {
  const grp = new THREE.Group();
  grp.position.copy(center);

  // Underwater base (fades beneath surface)
  const baseGeo = new THREE.ConeGeometry(radius * 1.4, height + 12, 24, 1, false);
  baseGeo.translate(0, -(height + 12) / 2 + height, 0);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a5a80, roughness: 1 });
  grp.add(new THREE.Mesh(baseGeo, baseMat));

  // Sandy beach band
  const beachGeo = new THREE.CylinderGeometry(radius * 1.05, radius * 1.15, 0.8, 28);
  beachGeo.translate(0, 0.4, 0);
  const beachMat = new THREE.MeshStandardMaterial({ color: 0xe8d9a8, roughness: 1 });
  grp.add(new THREE.Mesh(beachGeo, beachMat));

  // Main island body — irregular top
  const bodyGeo = new THREE.CylinderGeometry(radius * 0.92, radius * 1.05, height, 28, 4);
  const vp = bodyGeo.attributes.position;
  for (let i = 0; i < vp.count; i++) {
    const y = vp.getY(i);
    if (y > height * 0.3) {
      vp.setX(i, vp.getX(i) * (0.92 + rand() * 0.12));
      vp.setZ(i, vp.getZ(i) * (0.92 + rand() * 0.12));
      vp.setY(i, y + (rand() - 0.3) * 1.2);
    }
  }
  bodyGeo.computeVertexNormals();
  bodyGeo.translate(0, height / 2 + 0.4, 0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: isHome ? 0x4f9a54 : 0x4a8a47,
    roughness: 0.95, flatShading: true,
  });
  grp.add(new THREE.Mesh(bodyGeo, bodyMat));

  // Palm trees
  const palmCount = Math.floor(2 + rand() * 5);
  for (let i = 0; i < palmCount; i++) {
    const palm = makePalm(rand);
    const a = rand() * Math.PI * 2;
    const r = rand() * radius * 0.75;
    palm.position.set(Math.cos(a) * r, height + 0.4, Math.sin(a) * r);
    grp.add(palm);
  }

  // Little rocks
  for (let i = 0; i < 3 + Math.floor(rand()*3); i++) {
    const rockGeo = new THREE.DodecahedronGeometry(0.6 + rand() * 1.1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777266, flatShading: true, roughness: 1 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const a = rand() * Math.PI * 2;
    const r = rand() * radius * 0.85;
    rock.position.set(Math.cos(a)*r, height + 0.3, Math.sin(a)*r);
    rock.rotation.set(rand()*2, rand()*2, rand()*2);
    grp.add(rock);
  }

  const topCenter = new THREE.Vector3(center.x, height + 0.8, center.z);
  return { mesh: grp, center: center.clone(), radius, height, topCenter, isHome };
}

function makePalm(rand) {
  const g = new THREE.Group();
  const trunkH = 4 + rand() * 3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true }),
  );
  trunk.position.y = trunkH / 2;
  trunk.rotation.z = (rand() - 0.5) * 0.3;
  g.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a3a, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const leafGeo = new THREE.ConeGeometry(0.5, 2.2, 4, 1);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.y = trunkH;
    leaf.rotation.z = Math.PI / 2.4;
    leaf.rotation.y = (i / 7) * Math.PI * 2;
    leaf.position.x = Math.cos((i/7)*Math.PI*2) * 1.2;
    leaf.position.z = Math.sin((i/7)*Math.PI*2) * 1.2;
    leaf.position.y += 0.2;
    leaf.scale.set(1, 1.4 + rand()*0.3, 1);
    g.add(leaf);
  }
  return g;
}
