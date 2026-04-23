import * as THREE from 'three';
import { createWorld } from './world.js';
import { createHelicopter } from './helicopter.js';
import { createCyclone } from './cyclone.js';
import { createCrate, createHelipad } from './props.js';

// Island names lifted straight out of the decrypted Cyclone binary
// (block 21, offset $2A50). "BASE" is the home island the helipad sits on.
const ISLAND_NAMES = [
  'BASE',          // home — must be index 0
  'BANANA', 'KOKOLA', 'LAGOON', 'PEAK',
  'GILLIGANS', 'RED', 'SKEG', 'BONE',
  'CLAW', 'ENTERPRISE',
  'ORTE ROCKS', 'GIANTS GATEWAY', 'LUKELAND ISLES',
];

const WORLD_SIZE = 600;
const ISLAND_COUNT = 11;       // BASE + 10 others
// The original game's mission text reads "COLLECT FIVE CRATES AND RETURN TO BASE".
const MISSION_CRATES = 5;
const CRATE_COUNT = 8;          // a couple of spares beyond the required 5

const state = {
  running: false,
  time: 0,
  delivered: 0,
  kills: 0,
  carried: 0,
  carryCap: 3,
  cameraMode: 0,
  wind: 0,                     // "WIND SPEED INCREASES WHEN APPROACHING CYCLONE"
};

const hud = {
  delivered: document.getElementById('hud-delivered'),
  remaining: document.getElementById('hud-remaining'),
  carried:   document.getElementById('hud-carried'),
  time:      document.getElementById('hud-time'),
  kills:     document.getElementById('hud-kills'),
  alt:       document.getElementById('hud-alt'),
  spd:       document.getElementById('hud-spd'),
  status:    document.getElementById('status-msg'),
};

const overlay = document.getElementById('overlay');
const cardIntro = document.getElementById('card-intro');
const cardEnd = document.getElementById('card-end');
const endTitle = document.getElementById('end-title');
const endSub = document.getElementById('end-sub');
const endBody = document.getElementById('end-body');

document.getElementById('btn-start').addEventListener('click', startMission);
document.getElementById('btn-restart').addEventListener('click', () => window.location.reload());

// --- scene setup ---------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd0ee, 250, WORLD_SIZE * 1.1);

const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.5, WORLD_SIZE * 3
);
camera.position.set(0, 40, 60);

// Lighting
const sun = new THREE.DirectionalLight(0xfff3d6, 1.1);
sun.position.set(120, 220, 80);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x8fb4d4, 0.55));
const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x234d2e, 0.35);
scene.add(hemi);

// World (sky, sea, islands) -----------------------------------------------
const world = createWorld({
  worldSize: WORLD_SIZE,
  islandCount: ISLAND_COUNT,
  seed: 17,
  names: ISLAND_NAMES,
});
scene.add(world.group);

// Helipad on the home island
const home = world.islands[0];
const pad = createHelipad();
pad.position.copy(home.topCenter);
pad.position.y += 0.02;
scene.add(pad);

// Helicopter
const helicopter = createHelicopter();
helicopter.group.position.copy(home.topCenter);
helicopter.group.position.y += 4;
scene.add(helicopter.group);

// Crates — scatter across the non-BASE islands.  The Vortex original
// stores crate positions as fixed spawn points; we randomise but keep the
// count equal to CRATE_COUNT.
const crates = [];
for (let i = 0; i < CRATE_COUNT; i++) {
  const island = world.islands[1 + (i % (world.islands.length - 1))];
  const c = createCrate();
  const r = Math.random() * island.radius * 0.65;
  const a = Math.random() * Math.PI * 2;
  c.position.set(
    island.topCenter.x + Math.cos(a) * r,
    island.topCenter.y + 0.6,
    island.topCenter.z + Math.sin(a) * r,
  );
  c.rotation.y = Math.random() * Math.PI * 2;
  c.userData = { picked: false, destroyed: false, island };
  scene.add(c);
  crates.push(c);
}

// Cyclone
const cyclone = createCyclone();
cyclone.group.position.set(WORLD_SIZE * 0.3, 0, -WORLD_SIZE * 0.25);
scene.add(cyclone.group);

// Input ------------------------------------------------------------------
const keys = Object.create(null);
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') window.location.reload();
  if (e.code === 'KeyC') state.cameraMode = (state.cameraMode + 1) % 3;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
}, { passive: false });
window.addEventListener('keyup', e => { keys[e.code] = false; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Game flow --------------------------------------------------------------
function startMission() {
  overlay.style.display = 'none';
  state.running = true;
  clock.start();
}

function endMission(won, reasonTitle, reasonSub, reasonBody) {
  state.running = false;
  overlay.style.display = 'flex';
  cardIntro.classList.add('hidden');
  cardEnd.classList.remove('hidden');
  endTitle.textContent = reasonTitle;
  endSub.textContent = reasonSub;
  endBody.innerHTML = reasonBody;
}

function setStatus(msg, cls) {
  hud.status.innerHTML = cls ? `<span class="${cls}">${msg}</span>` : msg;
}

// Helpers ----------------------------------------------------------------
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
function horizontalDistance(a, b) {
  tmp.copy(a); tmp2.copy(b);
  tmp.y = 0; tmp2.y = 0;
  return tmp.distanceTo(tmp2);
}

function altitudeAboveGround(p) {
  // Approx: highest island top under p, else sea level 0.
  let ground = 0;
  for (const is of world.islands) {
    const d = horizontalDistance(p, is.topCenter);
    if (d < is.radius * 0.95) {
      ground = Math.max(ground, is.topCenter.y);
    }
  }
  return p.y - ground;
}

// Main loop --------------------------------------------------------------
const clock = new THREE.Clock(false);
let last = 0;

function tick() {
  requestAnimationFrame(tick);
  const t = clock.getElapsedTime();
  const dt = Math.min(0.05, t - last);
  last = t;

  if (state.running) {
    state.time = t;

    // Flight input -> helicopter
    const ctrl = {
      pitch: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
      roll:  (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      yaw:   (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0),
      lift:  (keys.Space ? 1 : 0) - (keys.ShiftLeft || keys.ShiftRight ? 1 : 0),
    };
    helicopter.update(dt, ctrl);

    // Clamp to world
    const p = helicopter.group.position;
    p.x = THREE.MathUtils.clamp(p.x, -WORLD_SIZE/2, WORLD_SIZE/2);
    p.z = THREE.MathUtils.clamp(p.z, -WORLD_SIZE/2, WORLD_SIZE/2);
    p.y = Math.max(p.y, 0.8);  // water level minimum
    p.y = Math.min(p.y, 180);

    // Ground collision with islands (simple resolve: push up to island top)
    for (const is of world.islands) {
      const d = horizontalDistance(p, is.topCenter);
      if (d < is.radius * 0.9) {
        const minY = is.topCenter.y + 2.2;
        if (p.y < minY) {
          p.y = minY;
          // soft landing kills vertical velocity
          if (helicopter.velocity.y < 0) helicopter.velocity.y = 0;
        }
      }
    }

    // World animation
    world.update(dt, t);
    cyclone.update(dt, t, world);

    // Wind: string recovered from ROM says "WIND SPEED INCREASES WHEN
    // APPROACHING CYCLONE".  Distance-based gust that pushes the helicopter
    // away from the cyclone and buffets its attitude.
    const dCyc = horizontalDistance(p, cyclone.group.position);
    state.wind = THREE.MathUtils.clamp(1 - dCyc / 160, 0, 1);
    if (state.wind > 0) {
      const away = p.clone().sub(cyclone.group.position);
      away.y = 0;
      if (away.lengthSq() > 0) away.normalize();
      // buffet toward/away with a swirl component (tangent)
      const swirl = new THREE.Vector3(-away.z, 0, away.x);
      const gust = state.wind * 6 * dt;
      helicopter.velocity.addScaledVector(away, gust * 0.6);
      helicopter.velocity.addScaledVector(swirl, gust);
    }

    // Crate interactions
    let remaining = 0;
    for (const c of crates) {
      if (c.userData.destroyed) continue;

      // Cyclone destroys crates it touches
      const dc = horizontalDistance(c.position, cyclone.group.position);
      if (dc < cyclone.radius * 0.95) {
        c.userData.destroyed = true;
        state.kills++;
        scene.remove(c);
        continue;
      }

      if (c.userData.picked) continue;
      remaining++;

      // Pick up when helicopter is close & low
      const dh = horizontalDistance(c.position, p);
      if (dh < 4.5 && p.y - c.position.y < 6 && state.carried < state.carryCap) {
        c.userData.picked = true;
        state.carried++;
        scene.remove(c);
        setStatus(`Crate secured. Return to base. (${state.carried}/${state.carryCap})`, 'good');
      }
    }
    hud.remaining.textContent = remaining;
    hud.carried.textContent = state.carried;
    hud.kills.textContent = state.kills;

    // Delivery: close to helipad & low altitude
    const dPad = horizontalDistance(p, pad.position);
    const onPad = dPad < 5 && (p.y - pad.position.y) < 5;
    if (onPad && state.carried > 0) {
      state.delivered += state.carried;
      state.carried = 0;
      hud.delivered.textContent = state.delivered;
      hud.carried.textContent = 0;
      setStatus(`Delivered! Total saved: ${state.delivered}.`, 'good');
    }

    // Cyclone hit player
    const dp = horizontalDistance(p, cyclone.group.position);
    if (dp < cyclone.radius * 0.85 && p.y < 60) {
      endMission(false,
        'Lost to the Cyclone',
        'The storm caught your helicopter.',
        `You delivered <b>${state.delivered}</b> crate${state.delivered === 1 ? '' : 's'} before being downed.`
      );
    }

    // Mission-complete: original text is "COLLECT FIVE CRATES AND RETURN TO BASE".
    if (state.delivered >= MISSION_CRATES) {
      endMission(true,
        'Mission Complete',
        `${state.delivered} crates delivered to BASE.`,
        `The cyclone destroyed <b>${state.kills}</b>. Well flown, pilot.`
      );
    } else if (remaining === 0 && state.carried === 0 && state.delivered < MISSION_CRATES) {
      endMission(false,
        'Archipelago Lost',
        'The cyclone took too many.',
        `Only <b>${state.delivered}</b> of the required ${MISSION_CRATES} crates delivered.`
      );
    }

    // HUD
    const mm = Math.floor(state.time / 60);
    const ss = String(Math.floor(state.time % 60)).padStart(2, '0');
    hud.time.textContent = `${mm}:${ss}`;
    hud.alt.textContent = Math.max(0, Math.round(altitudeAboveGround(p)));
    const v = helicopter.velocity;
    hud.spd.textContent = Math.round(Math.hypot(v.x, v.z) * 2);

    // Nearest island label (the original game names every island on screen)
    let near = null, nearD = Infinity;
    for (const is of world.islands) {
      const d = horizontalDistance(p, is.topCenter);
      if (d < nearD) { nearD = d; near = is; }
    }
    if (near && nearD < near.radius * 2.5) {
      document.getElementById('hud-island').textContent = near.name || '';
    } else {
      document.getElementById('hud-island').textContent = '—';
    }

    // Status hints
    if (!state.running) { /* noop */ }
    else if (state.carried >= state.carryCap) {
      setStatus('Cargo full — return to the helipad.', 'good');
    } else if (remaining > 0 && state.time > 1 && hud.status.dataset.sticky !== '1') {
      // subtle advisory when near a crate's island
      // (kept simple — no rewrite each frame)
    }

    // Cyclone proximity warning
    if (dp < 80 && p.y < 80) {
      setStatus('CYCLONE NEARBY — break off!', 'warn');
    }
  }

  // Camera
  updateCamera(dt);

  renderer.render(scene, camera);
}

// Chase camera --------------------------------------------------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
function updateCamera(dt) {
  const h = helicopter.group;
  const mode = state.cameraMode;
  let offset;
  if (mode === 0) {       // chase
    offset = new THREE.Vector3(0, 8, 22);
  } else if (mode === 1) { // high iso (nod to original)
    offset = new THREE.Vector3(40, 55, 40);
  } else {                // low cinematic
    offset = new THREE.Vector3(-6, 3, 14);
  }

  if (mode === 0 || mode === 2) {
    offset.applyQuaternion(h.quaternion);
    camTarget.copy(h.position).add(offset);
  } else {
    camTarget.copy(h.position).add(offset);
  }
  camPos.lerp(camTarget, 1 - Math.pow(0.0015, dt));
  camera.position.copy(camPos);
  camera.lookAt(h.position);
}

tick();
