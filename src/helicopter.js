import * as THREE from 'three';

export function createHelicopter() {
  const group = new THREE.Group();

  const yellow = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.4, metalness: 0.3, flatShading: true });
  const dark   = new THREE.MeshStandardMaterial({ color: 0x333842, roughness: 0.7, metalness: 0.4, flatShading: true });
  const glass  = new THREE.MeshStandardMaterial({ color: 0x6dbcd8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 });
  const blade  = new THREE.MeshStandardMaterial({ color: 0x202128, roughness: 0.3, metalness: 0.7 });

  // Body
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), yellow);
  body.scale.set(1.3, 1.0, 1.7);
  group.add(body);

  // Cockpit glass
  const cab = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 10), glass);
  cab.scale.set(1.05, 0.85, 1.25);
  cab.position.set(0, 0.15, 1.1);
  group.add(cab);

  // Tail boom
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 3.2, 8), yellow);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.25, -2.2);
  group.add(boom);

  // Tail fin
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.6), yellow);
  fin.position.set(0, 0.8, -3.5);
  group.add(fin);

  // Skids
  for (const side of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), dark);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(side * 0.9, -1.2, 0);
    group.add(skid);
    for (const z of [-0.9, 0.9]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), dark);
      strut.position.set(side * 0.9, -0.75, z);
      group.add(strut);
    }
  }

  // Main rotor hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 8), dark);
  hub.position.set(0, 1.5, 0);
  group.add(hub);

  // Main rotor (rotates around Y)
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.65, 0);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.06, 0.25), blade);
    b.rotation.y = (i * Math.PI) / 2;
    mainRotor.add(b);
  }
  // motion-blur disk hint
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
  );
  disk.rotation.x = -Math.PI / 2;
  mainRotor.add(disk);
  group.add(mainRotor);

  // Tail rotor
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.35, 0.6, -3.6);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.1), blade);
    b.rotation.z = (i * Math.PI) / 2;
    tailRotor.add(b);
  }
  group.add(tailRotor);

  // -------- Physics / controls --------------------------------------
  const velocity = new THREE.Vector3();
  const angularVel = new THREE.Vector3(); // pitch, yaw, roll deltas (euler body)

  const MAX_TILT = THREE.MathUtils.degToRad(28);
  const TILT_SPRING = 4.0;     // return to level
  const TILT_INPUT = 2.2;      // input strength
  const YAW_SPEED = 1.4;
  const THRUST = 18.0;
  const DRAG   = 0.86;         // per second effective
  const GRAV   = 9.8;
  const LIFT_TRIM = GRAV;      // hover-neutral
  const LIFT_EXTRA = 14;       // climb ceiling
  const LIFT_DOWN  = 9;

  let pitch = 0, roll = 0;

  function update(dt, ctrl) {
    // Spin rotors
    mainRotor.rotation.y += dt * 38;
    tailRotor.rotation.x += dt * 55;

    // Attitude: user input drives target pitch/roll, then spring back
    const targetPitch = -ctrl.pitch * MAX_TILT;
    const targetRoll  =  ctrl.roll  * MAX_TILT;

    pitch += (targetPitch - pitch) * Math.min(1, dt * TILT_INPUT);
    roll  += (targetRoll  - roll)  * Math.min(1, dt * TILT_INPUT);
    // passive centering (when no input)
    if (ctrl.pitch === 0) pitch += (0 - pitch) * Math.min(1, dt * TILT_SPRING);
    if (ctrl.roll  === 0) roll  += (0 - roll)  * Math.min(1, dt * TILT_SPRING);

    // Yaw
    group.rotation.y += ctrl.yaw * YAW_SPEED * dt;
    group.rotation.x = pitch;
    group.rotation.z = roll;

    // Thrust from tilt (in helicopter's local forward/right)
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(group.quaternion);
    // horizontal components only for lateral motion
    forward.y = 0; forward.normalize();
    right.y = 0;   right.normalize();

    velocity.addScaledVector(forward, -pitch / MAX_TILT * THRUST * dt);
    velocity.addScaledVector(right,    roll  / MAX_TILT * THRUST * dt);

    // Vertical: gravity + collective
    const lift = LIFT_TRIM + (ctrl.lift > 0 ? LIFT_EXTRA : 0) - (ctrl.lift < 0 ? LIFT_DOWN : 0);
    velocity.y += (lift - GRAV) * dt;

    // Drag
    const dragFactor = Math.pow(DRAG, dt * 60);
    velocity.x *= dragFactor;
    velocity.z *= dragFactor;
    velocity.y *= Math.pow(0.985, dt * 60);

    // Speed cap
    const maxH = 32;
    const h2 = velocity.x*velocity.x + velocity.z*velocity.z;
    if (h2 > maxH*maxH) {
      const s = maxH / Math.sqrt(h2);
      velocity.x *= s; velocity.z *= s;
    }

    group.position.addScaledVector(velocity, dt);
  }

  return { group, update, velocity };
}
