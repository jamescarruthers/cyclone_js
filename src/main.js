import * as THREE from 'three';
import { createWorld } from './world.js';
import { createHelicopter } from './helicopter.js';
import { createCyclone } from './cyclone.js';
import { createCrate, createHelipad } from './props.js';
import { createBirds, createAircraft, createSurvivors } from './hazards.js';
import { createMapView, createCompass } from './mapview.js';
import { sound } from './sound.js';
import { setupTouchControls } from './touch-controls.js';

// -----------------------------------------------------------------------
// Tunables — rough analogues of the constants the original reads out of
// memory at $7500 each frame (fuel countdown, timer, cyclone tick).
const MISSION_CRATES = 5;
const CRATE_SPAWN    = 8;
const START_LIVES    = 3;
const START_FUEL     = 100;      // percent
const FUEL_BURN      = 100 / 360;// 100% over ~6 minutes of flight
const TIME_LIMIT     = 5 * 60;   // 5-minute mission timer
const CYCLONE_SPEED  = 4.5;

// Score values
const SCORE_CRATE    = 1000;
const SCORE_SURVIVOR = 500;
const SCORE_TIME_BONUS_PER_SEC = 5;

// -----------------------------------------------------------------------
const state = {
  running: false,
  time: 0,
  remaining: TIME_LIMIT,
  delivered: 0,
  kills: 0,
  carried: 0,
  carryCap: 3,
  lives: START_LIVES,
  fuel: START_FUEL,
  score: 0,
  wind: 0,
  cameraMode: 0,
  paused: false,
  noFuel: false,
};

const hud = {
  delivered: document.getElementById('hud-delivered'),
  carried:   document.getElementById('hud-carried'),
  lives:     document.getElementById('hud-lives'),
  score:     document.getElementById('hud-score'),
  time:      document.getElementById('hud-time'),
  island:    document.getElementById('hud-island'),
  alt:       document.getElementById('hud-alt'),
  spd:       document.getElementById('hud-spd'),
  status:    document.getElementById('status-msg'),
  fuelBar:   document.getElementById('hud-fuel-bar'),
  fuelPct:   document.getElementById('hud-fuel-pct'),
  compass:   document.getElementById('hud-compass'),
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

const world = createWorld({ seed: 17 });
scene.add(world.group);
scene.fog = new THREE.Fog(0x9fd0ee, 250, world.worldSize * 1.1);

const camera = new THREE.PerspectiveCamera(
  55, window.innerWidth / window.innerHeight, 0.5, world.worldSize * 3
);
camera.position.set(0, 40, 60);

// Lighting
scene.add(new THREE.DirectionalLight(0xfff3d6, 1.1).translateY(220));
const sun = new THREE.DirectionalLight(0xfff3d6, 1.1);
sun.position.set(120, 220, 80);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x8fb4d4, 0.55));
scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x234d2e, 0.35));

// Helicopter starts on BASE's helipad
const home = world.islands.find(i => i.isHome);
const pad = createHelipad();
pad.position.copy(home.topCenter);
pad.position.y += 0.02;
scene.add(pad);

const helicopter = createHelicopter();
// Seed the ROM state so posX/posY match BASE
helicopter.setWorldPosition(new THREE.Vector3(
  home.topCenter.x, home.topCenter.y + 14, home.topCenter.z,
));
scene.add(helicopter.group);

// Crates — deterministic positions derived from island records
const crates = [];
for (let i = 0; i < CRATE_SPAWN; i++) {
  const pickable = world.islands.filter(is => !is.isHome);
  const island = pickable[i % pickable.length];
  const c = createCrate();
  const a = (i * 2.4) % (Math.PI * 2);
  const r = island.radius * 0.55 * ((i % 3) / 3 + 0.3);
  c.position.set(
    island.topCenter.x + Math.cos(a) * r,
    island.topCenter.y + 0.6,
    island.topCenter.z + Math.sin(a) * r,
  );
  c.rotation.y = a;
  c.userData = { picked: false, destroyed: false, island };
  scene.add(c);
  crates.push(c);
}

// Cyclone — deterministic 50 Hz waypoint tour through the archipelago
const cyclone = createCyclone(world.worldSize);
scene.add(cyclone.group);

// Hazards
const birds    = createBirds(world, 14);
const aircraft = createAircraft(world, 3);
const survivors = createSurvivors(world, 6);
scene.add(birds.group);
scene.add(aircraft.group);
scene.add(survivors.group);

// UI overlays
const mapView = createMapView(world);
const compass = createCompass();

// Touch controls: always mounted, but CSS hides them on non-coarse pointers.
// `?touch=1` in the URL forces them on for testing from desktop.
if (new URL(location.href).searchParams.get('touch') === '1') {
  document.body.classList.add('force-touch');
}
setupTouchControls(keys);

// Input ------------------------------------------------------------------
const keys = Object.create(null);
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') window.location.reload();
  if (e.code === 'KeyC') state.cameraMode = (state.cameraMode + 1) % 4;
  if (e.code === 'KeyM') mapView.toggle();
  if (e.code === 'KeyP') state.paused = !state.paused;
  if (e.code === 'KeyN') {
    state.muted = !state.muted;
    sound.setEnabled(!state.muted);
    if (state.muted) { sound.rotorStop(); sound.windSet(0); }
    else if (state.running) { sound.rotorStart(); }
    setStatus(state.muted ? 'Sound muted (press N to unmute)' : 'Sound on');
  }
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
  sound.resume();
  sound.rotorStart();
}

function endMission(won, reasonTitle, reasonSub, reasonBody) {
  state.running = false;
  overlay.style.display = 'flex';
  cardIntro.classList.add('hidden');
  cardEnd.classList.remove('hidden');
  endTitle.textContent = reasonTitle;
  endSub.textContent = reasonSub;
  endBody.innerHTML = reasonBody + `<br/><br/>FINAL SCORE <b>${state.score}</b>`;
  sound.rotorStop();
  sound.windSet(0);
  if (won) sound.win(); else sound.gameOver();
}

function setStatus(msg, cls) {
  hud.status.innerHTML = cls ? `<span class="${cls}">${msg}</span>` : msg;
}

function loseLife(reason) {
  state.lives--;
  hud.lives.textContent = state.lives;
  sound.crash();
  if (state.lives <= 0) {
    endMission(false, 'Game Over', reason, `Crates delivered: <b>${state.delivered}</b>.`);
    return;
  }
  setStatus(`${reason} — ${state.lives} ${state.lives === 1 ? 'life' : 'lives'} left.`, 'warn');
  helicopter.reset();
  helicopter.setWorldPosition(new THREE.Vector3(
    home.topCenter.x, home.topCenter.y + 20, home.topCenter.z,
  ));
  state.fuel = Math.max(state.fuel, 60);
  state.noFuel = false;
  state.carried = 0;
  state.invulnUntil = state.time + 3;
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

  if (state.running && !state.paused) {
    state.time = t;
    state.remaining = Math.max(0, TIME_LIMIT - t);

    // Flight input — maps directly to the ROM's FORWARD / TURN_L / TURN_R /
    // UP / DOWN buttons (see helicopter.js romTick).  There is no pitch
    // or roll axis in the original — the helicopter moves only in the
    // direction it is facing, so A/D turn the heading rather than strafe.
    const ctrl = {
      pitch: (keys.KeyW || keys.ArrowUp    ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
      yaw:   (keys.KeyD || keys.KeyE || keys.ArrowRight ? 1 : 0)
           - (keys.KeyA || keys.KeyQ || keys.ArrowLeft  ? 1 : 0),
      lift:  (keys.Space ? 1 : 0)
           - (keys.ShiftLeft || keys.ShiftRight ? 1 : 0),
    };

    // Fuel: burned whenever we have any input, at idle rate otherwise.
    const moving = ctrl.pitch || ctrl.lift || ctrl.yaw;
    const burn = FUEL_BURN * (moving ? 1.4 : 0.5);
    state.fuel = Math.max(0, state.fuel - burn * dt);
    if (state.fuel <= 0 && !state.noFuel) {
      state.noFuel = true;
      setStatus('NO FUEL — auto-descending!', 'warn');
      sound.noFuel();
    }
    // If out of fuel, force descent (lift = -1) and kill thrust.
    const effectiveCtrl = state.noFuel
      ? { pitch: 0, yaw: 0, lift: -1 }
      : ctrl;
    helicopter.update(dt, effectiveCtrl);

    // World-edge clamp (original shows "LEAVING MAP AREA" warning)
    const p = helicopter.group.position;
    const limit = world.worldSize * 0.48;
    const beyond = Math.max(Math.abs(p.x), Math.abs(p.z)) - limit;
    if (beyond > 0) {
      setStatus('LEAVING MAP AREA — turn back!', 'warn');
      p.x = THREE.MathUtils.clamp(p.x, -limit - 2, limit + 2);
      p.z = THREE.MathUtils.clamp(p.z, -limit - 2, limit + 2);
    }
    p.y = Math.max(p.y, 0.8);
    p.y = Math.min(p.y, 180);

    // Collisions with island tops
    for (const is of world.islands) {
      const d = horizontalDistance(p, is.topCenter);
      if (d < is.radius * 0.9) {
        const minY = is.topCenter.y + 2.2;
        if (p.y < minY) {
          p.y = minY;
          if (helicopter.velocity.y < 0) helicopter.velocity.y = 0;
        }
      }
    }

    // World animation
    world.update(dt, t);
    cyclone.update(dt, t, world);
    birds.update(dt, t);
    aircraft.update(dt, t);
    survivors.update(dt, t);

    // Wind from cyclone — ROM says "WIND SPEED INCREASES WHEN APPROACHING CYCLONE"
    const dCyc = horizontalDistance(p, cyclone.group.position);
    state.wind = THREE.MathUtils.clamp(1 - dCyc / 180, 0, 1);
    if (state.wind > 0) {
      const away = p.clone().sub(cyclone.group.position);
      away.y = 0;
      if (away.lengthSq() > 0) away.normalize();
      const swirl = new THREE.Vector3(-away.z, 0, away.x);
      const gust = state.wind * 7 * dt;
      helicopter.velocity.addScaledVector(away, gust * 0.6);
      helicopter.velocity.addScaledVector(swirl, gust);
    }

    // Crate interactions
    let remaining = 0;
    for (const c of crates) {
      if (c.userData.destroyed) continue;

      const dc = horizontalDistance(c.position, cyclone.group.position);
      if (dc < cyclone.radius * 0.95) {
        c.userData.destroyed = true;
        state.kills++;
        scene.remove(c);
        continue;
      }

      if (c.userData.picked) continue;
      remaining++;

      const dh = horizontalDistance(c.position, p);
      if (dh < 4.5 && p.y - c.position.y < 6 && state.carried < state.carryCap) {
        c.userData.picked = true;
        state.carried++;
        scene.remove(c);
        setStatus(`Crate secured (${state.carried}/${state.carryCap}). Back to BASE.`, 'good');
        sound.pickup();
      }
    }
    hud.carried.textContent = state.carried;

    // Survivor rescue (each worth SCORE_SURVIVOR)
    for (const s of survivors.survivors) {
      if (s.userData.rescued) continue;
      // Cyclone wipes them out
      if (horizontalDistance(s.position, cyclone.group.position) < cyclone.radius * 0.95) {
        s.userData.rescued = true; // (count as removed)
        survivors.group.remove(s);
        continue;
      }
      if (horizontalDistance(s.position, p) < 5 && p.y - s.position.y < 6) {
        s.userData.rescued = true;
        survivors.group.remove(s);
        state.score += SCORE_SURVIVOR;
        setStatus(`Survivor rescued! +${SCORE_SURVIVOR}`, 'good');
        sound.rescue();
      }
    }

    // Deliver to BASE
    const dPad = horizontalDistance(p, pad.position);
    const onPad = dPad < 5 && (p.y - pad.position.y) < 5;
    if (onPad) {
      if (state.carried > 0) {
        state.delivered += state.carried;
        state.score += state.carried * SCORE_CRATE;
        state.carried = 0;
        hud.delivered.textContent = state.delivered;
        hud.carried.textContent = 0;
        setStatus(`Delivered! ${state.delivered}/${MISSION_CRATES} total.`, 'good');
        sound.deliver();
      }
      // Refuel on the pad (slow trickle)
      state.fuel = Math.min(100, state.fuel + 30 * dt);
      if (state.noFuel && state.fuel > 5) state.noFuel = false;
    }

    // Cyclone hit
    if ((state.invulnUntil || 0) < state.time &&
        dCyc < cyclone.radius * 0.85 && p.y < 60) {
      loseLife('Caught by the cyclone');
    }

    // Aircraft collision
    for (const plane of aircraft.planes) {
      if ((state.invulnUntil || 0) >= state.time) break;
      if (plane.position.distanceTo(p) < 4) {
        loseLife('Mid-air collision');
        break;
      }
    }

    // Win / time-up conditions
    if (state.delivered >= MISSION_CRATES) {
      state.score += Math.floor(state.remaining * SCORE_TIME_BONUS_PER_SEC);
      endMission(true,
        'Mission Complete',
        `${state.delivered} crates delivered to BASE.`,
        `Time bonus: <b>${Math.floor(state.remaining * SCORE_TIME_BONUS_PER_SEC)}</b>. ` +
        `Cyclone destroyed <b>${state.kills}</b>.`
      );
    } else if (state.remaining <= 0) {
      endMission(false, 'Time Up',
        `Only ${state.delivered} of ${MISSION_CRATES} crates delivered.`,
        'The cyclone wins.');
    }

    // HUD updates
    const mm = Math.floor(state.remaining / 60);
    const ss = String(Math.floor(state.remaining % 60)).padStart(2, '0');
    hud.time.textContent = `${mm}:${ss}`;
    hud.alt.textContent = Math.max(0, Math.round(altitudeAboveGround(p)));
    hud.spd.textContent = Math.round(Math.hypot(helicopter.velocity.x, helicopter.velocity.z) * 2);
    hud.fuelBar.style.width = state.fuel.toFixed(0) + '%';
    hud.fuelPct.textContent = state.fuel.toFixed(0) + '%';
    hud.fuelPct.style.color = state.fuel < 15 ? '#ff6b6b' : state.fuel < 30 ? '#ffd257' : '#fff';
    hud.score.textContent = state.score;
    compass.update(helicopter.group.rotation.y);

    let near = null, nearD = Infinity;
    for (const is of world.islands) {
      const d = horizontalDistance(p, is.topCenter);
      if (d < nearD) { nearD = d; near = is; }
    }
    hud.island.textContent = (near && nearD < near.radius * 2.5) ? near.name : '—';

    // Proximity warnings — overrides other status when close
    if (state.wind > 0.4) setStatus('CYCLONE NEARBY — wind force rising!', 'warn');
    else if (state.fuel < 15 && !state.noFuel) setStatus('FUEL LOW — return to BASE!', 'warn');
    else if (state.remaining < 30) setStatus('TIME CRITICAL!', 'warn');

    // Continuous sounds
    sound.windSet(state.wind);
    const throttle = Math.max(Math.abs(ctrl.pitch), Math.abs(ctrl.yaw), Math.abs(ctrl.lift));
    sound.rotorSet(throttle);

    // Low-fuel warning chirp (every ~2s)
    if (state.fuel > 0 && state.fuel < 20) {
      if (!state.lastLowFuel || state.time - state.lastLowFuel > 2) {
        state.lastLowFuel = state.time; sound.lowFuel();
      }
    }
    // Edge-warning chirp
    if (beyond > 0) {
      if (!state.lastEdge || state.time - state.lastEdge > 2) {
        state.lastEdge = state.time; sound.leave();
      }
    }
  }

  // Camera
  updateCamera(dt);

  // Map overlay (redraw only when visible)
  if (mapView.isOpen()) {
    mapView.draw({
      helicopter: helicopter.group,
      cyclone: cyclone.group,
      crates,
      survivors: survivors.survivors,
    });
  }

  renderer.render(scene, camera);
}

// Chase camera --------------------------------------------------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
function updateCamera(dt) {
  const h = helicopter.group;
  const mode = state.cameraMode;
  let offset;
  if (mode === 0) {        // ISOMETRIC (Vortex default)
    offset = new THREE.Vector3(45, 55, 45);
  } else if (mode === 1) { // chase
    offset = new THREE.Vector3(0, 8, 22).applyQuaternion(h.quaternion);
  } else if (mode === 2) { // low cinematic
    offset = new THREE.Vector3(-6, 3, 14).applyQuaternion(h.quaternion);
  } else {                 // overhead
    offset = new THREE.Vector3(0, 110, 0.001);
  }
  camTarget.copy(h.position).add(offset);
  camPos.lerp(camTarget, 1 - Math.pow(0.0015, dt));
  camera.position.copy(camPos);
  camera.lookAt(h.position);
}

tick();
