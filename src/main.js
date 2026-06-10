import * as THREE from 'three';
import { createWorld } from './world.js';
import { createHelicopter, cellToWorld } from './helicopter.js';
import { createCyclone } from './cyclone.js';
import { createCrate, createHelipad } from './props.js';
import { createBirds, createAircraft, createSurvivors } from './hazards.js';
import { createMapView, createCompass } from './mapview.js';
import { sound } from './sound.js';
import { setupTouchControls } from './touch-controls.js';

// -----------------------------------------------------------------------
// Mission constants.  Fuel and the mission timer are no longer invented:
// they run on the ROM's own gauge-pointer systems inside helicopter.js
// (see src/rom-physics.js — burn every 49th tick, refuel while landed,
// timer step every 255 ticks, ~17.4 minutes total).
const MISSION_CRATES = 5;
const CRATE_SPAWN    = 8;
const START_LIVES    = 3;
// (cyclone speed lives in cyclone.js — CYCLONE_STEP, in ROM units/tick)

// Score values
const SCORE_CRATE    = 1000;
const SCORE_SURVIVOR = 500;
const SCORE_TIME_BONUS_PER_SEC = 5;

// -----------------------------------------------------------------------
const state = {
  running: false,
  time: 0,
  remaining: 0,
  delivered: 0,
  kills: 0,
  carried: 0,
  carryCap: 3,
  lives: START_LIVES,
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
// Start landed on BASE's helipad, refuelling — exactly how the 1985 game
// begins (state template: landed=1, $752E=1).  Hold UP to take off.
// The template fuel gauge ($47BC) is nearly empty; the original refuels
// during its boot/menu phase, reaching $427C (~54%) by first take-off —
// give spawns that observed boot-ready level.
const FUEL_BOOT_READY = 0x427C;
const PAD_REST_Y = () => pad.position.y + 1.5;
helicopter.rom.fuelGauge = FUEL_BOOT_READY;
helicopter.setWorldPosition(new THREE.Vector3(
  home.topCenter.x, PAD_REST_Y(), home.topCenter.z,
), { landed: true });
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

// Input ------------------------------------------------------------------
const keys = Object.create(null);

// Touch controls: always mounted, but CSS hides them on non-coarse pointers.
// `?touch=1` in the URL forces them on for testing from desktop.
if (new URL(location.href).searchParams.get('touch') === '1') {
  document.body.classList.add('force-touch');
}
setupTouchControls(keys);

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
  // Respawn landed on the pad with the template fuel load, but preserve
  // the mission timer across the death.
  const timerGauge = helicopter.rom.timerGauge;
  const timerPrescaler = helicopter.rom.timerPrescaler;
  helicopter.reset();
  helicopter.rom.timerGauge = timerGauge;
  helicopter.rom.timerPrescaler = timerPrescaler;
  helicopter.rom.fuelGauge = FUEL_BOOT_READY;
  helicopter.setWorldPosition(new THREE.Vector3(
    home.topCenter.x, PAD_REST_Y(), home.topCenter.z,
  ), { landed: true });
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
    // Accumulate mission time from dt (not the wall clock) so pausing
    // actually stops it.  The mission countdown itself runs on the ROM
    // timer gauge inside the helicopter tick; state.remaining is set
    // below from helicopter.timeLeftSeconds().
    state.time += dt;

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

    // Fuel and the mission timer run on the ROM systems inside the
    // helicopter tick (burn, refuel-when-landed, forced descent and
    // thrust-decay on empty are all native rom-physics behaviour).
    const events = helicopter.update(dt, ctrl);
    if (events.refuelBlip) sound.warnHi();
    if (helicopter.rom.noFuel === 1 && !state.noFuel) {
      state.noFuel = true;
      setStatus('NO FUEL — going down!', 'warn');
      sound.noFuel();
    } else if (helicopter.rom.noFuel === 0 && state.noFuel) {
      state.noFuel = false;
    }
    state.remaining = helicopter.timeLeftSeconds();

    // World-edge clamp (original shows "LEAVING MAP AREA" warning)
    const p = helicopter.group.position;
    const limit = world.worldSize * 0.48;
    const beyond = Math.max(Math.abs(p.x), Math.abs(p.z)) - limit;
    let clamped = false;
    if (beyond > 0) {
      setStatus('LEAVING MAP AREA — turn back!', 'warn');
      p.x = THREE.MathUtils.clamp(p.x, -limit - 2, limit + 2);
      p.z = THREE.MathUtils.clamp(p.z, -limit - 2, limit + 2);
      clamped = true;
    }
    // Write clamps back into the ROM position, otherwise the next physics
    // tick recomputes group.position from the unclamped ROM coordinates
    // and the clamp has no effect.
    if (clamped) {
      helicopter.setWorldPosition(p, { landed: helicopter.rom.landed === 1 });
    }

    // Terrain contact — ROM landing semantics ($8A7A/$8AEB): touching down
    // with a descent ramp of 3 crashes ($8AB7); a gentler touch lands,
    // arms refuelling and snaps altitude to the 8-unit grid.  Flying into
    // an island side, or descending to sea level ($7514), is fatal.
    if (helicopter.rom.landed !== 1) {
      const over = world.islands.find(is =>
        horizontalDistance(p, is.topCenter) < is.radius * 0.9);
      const groundY = over ? over.topCenter.y + 1.5 : 0;
      const byCyclone = helicopter.cyclone.dist < 3 ? ' — the cyclone tore you down' : '';
      if (over && p.y < groundY - 2.5) {
        loseLife('Flew into the terrain' + byCyclone);
      } else if (helicopter.rom.hitGround === 1 && !over) {
        loseLife('Ditched into the sea' + byCyclone);
      } else if (p.y <= groundY + 0.1 && helicopter.rom.rampDn >= 1 && over) {
        if (helicopter.rom.rampDn >= 3) {
          loseLife('Came down too fast' + byCyclone);
        } else {
          helicopter.land({ refuelZone: true, groundY });
          setStatus(`Landed on ${over.name} — refuelling. Hold SPACE to take off.`,
            over.isHome ? 'good' : undefined);
        }
      }
    }

    // World animation
    world.update(dt, t);
    cyclone.update(dt, t, world);
    birds.update(dt, t);
    aircraft.update(dt, t);
    survivors.update(dt, t);

    // Cyclone — its position is the ROM random walk ($909E), ticked
    // inside the helicopter at the authentic cadence.  The original's
    // "wind" is CONTROL CORRUPTION (already applied in rom-physics:
    // random fake button presses below Chebyshev distance 5, full
    // override to DOWN+LEFT inside the core).  Here we drive the funnel
    // visual and the HUD force gauge ($913C: force = 16 - distance).
    cyclone.setWorldTarget(
      cellToWorld(helicopter.cyclone.x),
      cellToWorld(helicopter.cyclone.y),
    );
    const dCyc = horizontalDistance(p, cyclone.group.position);
    const cycDist = helicopter.cyclone.dist;
    state.wind = cycDist >= 15 ? 0 : (0x10 - cycDist) / 0x10;

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

      // Pick up by landing beside the crate (the original's model —
      // "land beside a crate to pick it up").
      const dh = horizontalDistance(c.position, p);
      if (helicopter.rom.landed === 1 && dh < 9 && state.carried < state.carryCap) {
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

    // Deliver to BASE by landing on the pad.  (Refuelling needs no pad —
    // any successful landing arms the ROM refuel system.)
    const dPad = horizontalDistance(p, pad.position);
    if (helicopter.rom.landed === 1 && dPad < 8 && state.carried > 0) {
      state.delivered += state.carried;
      state.score += state.carried * SCORE_CRATE;
      state.carried = 0;
      hud.delivered.textContent = state.delivered;
      hud.carried.textContent = 0;
      setStatus(`Delivered! ${state.delivered}/${MISSION_CRATES} total.`, 'good');
      sound.deliver();
    }

    // (No separate "cyclone hit" check: as in the original, the cyclone
    // kills by forcing you down — the terrain-contact logic above turns
    // that into a crash.)

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
    } else if (events.timeUp) {
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
    const fuelPct = helicopter.fuelFraction() * 100;
    hud.fuelBar.style.width = fuelPct.toFixed(0) + '%';
    hud.fuelPct.textContent = fuelPct.toFixed(0) + '%';
    hud.fuelPct.style.color = fuelPct < 15 ? '#ff6b6b' : fuelPct < 30 ? '#ffd257' : '#fff';
    hud.score.textContent = state.score;
    compass.update(helicopter.group.rotation.y);

    let near = null, nearD = Infinity;
    for (const is of world.islands) {
      const d = horizontalDistance(p, is.topCenter);
      if (d < nearD) { nearD = d; near = is; }
    }
    hud.island.textContent = (near && nearD < near.radius * 2.5) ? near.name : '—';

    // Proximity warnings — overrides other status when close
    if (cycDist < 5 && !helicopter.rom.landed) setStatus('CYCLONE — CONTROLS FAILING!', 'warn');
    else if (cycDist < 8) setStatus('CYCLONE NEARBY — wind force rising!', 'warn');
    else if (fuelPct < 20 && !state.noFuel && !helicopter.rom.landed) setStatus('FUEL LOW — land to refuel!', 'warn');
    else if (state.remaining < 60) setStatus('TIME CRITICAL!', 'warn');

    // Continuous sounds
    sound.windSet(state.wind);
    const throttle = Math.max(Math.abs(ctrl.pitch), Math.abs(ctrl.yaw), Math.abs(ctrl.lift));
    sound.rotorSet(throttle);

    // Low-fuel warning chirp (every ~2s)
    if (!state.noFuel && fuelPct < 20 && !helicopter.rom.landed) {
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
