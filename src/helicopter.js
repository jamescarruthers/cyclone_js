import * as THREE from 'three';

// Arcade-style helicopter physics, matching the 1985 Cyclone feel:
//  * Cardinal thrust in screen space (forward/back/left/right) — tilt is
//    cosmetic, not the source of motion.
//  * Yaw is a separate control; it rotates the visual but does not change
//    the movement axes.
//  * Altitude is a separate channel (collective up/down).
//  * Constant frame rate update (ROM runs at 50 Hz); we integrate with dt.
//
// Numeric constants are hand-tuned to match the original's pacing as seen
// in emulator recordings — not byte-exact, but the right order of
// magnitude for top speed, climb rate, and turn rate.

const ROM = {
  // Horizontal movement (world units per second)
  maxHSpeed: 26,
  accel:      80,     // how quickly we spin up when a key is held
  decel:      60,     // how quickly we fall back to zero when released
  // Altitude
  maxClimb:   18,
  climbAcc:   40,
  gravity:    11,     // a gentle pull when no collective is applied
  // Yaw (rad / sec when Q/E is held)
  yawRate:    1.8,
  // Cosmetic tilt for visual feel only
  tiltMax:    0.35,   // rad
  tiltLerp:   7.0,
};

export function createHelicopter() {
  const group = new THREE.Group();   // yaw is applied here
  const body  = new THREE.Group();   // cosmetic tilt lives here
  group.add(body);

  // --- mesh -------------------------------------------------------
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.4, metalness: 0.3, flatShading: true });
  const dark   = new THREE.MeshStandardMaterial({ color: 0x333842, roughness: 0.7, metalness: 0.4, flatShading: true });
  const glass  = new THREE.MeshStandardMaterial({ color: 0x6dbcd8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 });
  const blade  = new THREE.MeshStandardMaterial({ color: 0x202128, roughness: 0.3, metalness: 0.7 });

  const shell = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), yellow);
  shell.scale.set(1.3, 1.0, 1.7);
  body.add(shell);

  const cab = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 10), glass);
  cab.scale.set(1.05, 0.85, 1.25);
  cab.position.set(0, 0.15, 1.1);
  body.add(cab);

  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 3.2, 8), yellow);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.25, -2.2);
  body.add(boom);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.6), yellow);
  fin.position.set(0, 0.8, -3.5);
  body.add(fin);

  for (const side of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), dark);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(side * 0.9, -1.2, 0);
    body.add(skid);
    for (const z of [-0.9, 0.9]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), dark);
      strut.position.set(side * 0.9, -0.75, z);
      body.add(strut);
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 8), dark);
  hub.position.set(0, 1.5, 0);
  body.add(hub);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.65, 0);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.06, 0.25), blade);
    b.rotation.y = (i * Math.PI) / 2;
    mainRotor.add(b);
  }
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
  );
  disk.rotation.x = -Math.PI / 2;
  mainRotor.add(disk);
  body.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.35, 0.6, -3.6);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.1), blade);
    b.rotation.z = (i * Math.PI) / 2;
    tailRotor.add(b);
  }
  body.add(tailRotor);

  // --- state -------------------------------------------------------
  const velocity = new THREE.Vector3();
  let tiltX = 0, tiltZ = 0;

  function update(dt, ctrl) {
    // Rotor spin
    mainRotor.rotation.y += dt * 38;
    tailRotor.rotation.x += dt * 55;

    // --- Horizontal motion in helicopter-local frame ---------------
    // "Pitch" (W/S) => forward/back thrust along local forward axis.
    // "Roll"  (A/D) => left/right thrust along local right axis.
    // Heading comes from `group.rotation.y` (yaw).
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(group.quaternion);
    const right   = new THREE.Vector3(1, 0,  0).applyQuaternion(group.quaternion);
    forward.y = 0; forward.normalize();
    right.y = 0;   right.normalize();

    const thrust = new THREE.Vector3();
    thrust.addScaledVector(forward,  ctrl.pitch);
    thrust.addScaledVector(right,    ctrl.roll);
    const tlen = thrust.length();
    if (tlen > 1) thrust.multiplyScalar(1 / tlen);

    // Apply acceleration toward desired velocity (ROM accel / decel)
    const hv = new THREE.Vector3(velocity.x, 0, velocity.z);
    const targetV = thrust.multiplyScalar(ROM.maxHSpeed);
    const a = (tlen > 0.01 ? ROM.accel : ROM.decel);
    const dv = targetV.sub(hv);
    const step = Math.min(a * dt, dv.length());
    if (dv.lengthSq() > 0) dv.setLength(step);
    velocity.x += dv.x; velocity.z += dv.z;

    // --- Altitude --------------------------------------------------
    if (ctrl.lift > 0) {
      velocity.y += ROM.climbAcc * dt;
    } else if (ctrl.lift < 0) {
      velocity.y -= (ROM.climbAcc * 0.8) * dt;
    } else {
      // sag toward 0 gently (hovering is easy in arcade)
      velocity.y -= ROM.gravity * dt * 0.25;
    }
    velocity.y = THREE.MathUtils.clamp(velocity.y, -ROM.maxClimb, ROM.maxClimb);

    // --- Yaw -------------------------------------------------------
    group.rotation.y += ctrl.yaw * ROM.yawRate * dt;

    // --- Cosmetic tilt (lean into motion) --------------------------
    const tgtTiltX =  thrust.dot(forward) * ROM.tiltMax;   // forward => nose dip
    const tgtTiltZ = -thrust.dot(right)   * ROM.tiltMax;   // right => right wing down
    tiltX += (tgtTiltX - tiltX) * Math.min(1, dt * ROM.tiltLerp);
    tiltZ += (tgtTiltZ - tiltZ) * Math.min(1, dt * ROM.tiltLerp);
    body.rotation.x = tiltX;
    body.rotation.z = tiltZ;

    // --- Integrate position ---------------------------------------
    group.position.addScaledVector(velocity, dt);

    // Clamp speed overall
    const hv2 = velocity.x*velocity.x + velocity.z*velocity.z;
    if (hv2 > ROM.maxHSpeed * ROM.maxHSpeed) {
      const s = ROM.maxHSpeed / Math.sqrt(hv2);
      velocity.x *= s; velocity.z *= s;
    }
  }

  return { group, body, update, velocity, ROM };
}
