import * as THREE from 'three';

// Cyclone visuals.  The cyclone's POSITION is no longer invented: it is
// driven by the instruction-exact random walk ported from the ROM
// ($909E, trace-verified — see src/rom-physics.js), which lives inside
// the helicopter's tick so it shares the authentic main-loop cadence
// and PRNG.  main.js feeds the resulting map-cell position in here via
// setWorldTarget(); this module only renders the funnel and glides it
// smoothly between the discrete cells (the original moves one cell
// every ~2.5 s).


export function createCyclone(worldSize = 600) {
  const group = new THREE.Group();

  // --------- visual: stack of particle rings + funnel mesh -------------
  const RADIUS = 28;
  const HEIGHT = 180;
  const LAYERS = 60, PER_LAYER = 42;
  const positions = new Float32Array(LAYERS * PER_LAYER * 3);
  const colors    = new Float32Array(LAYERS * PER_LAYER * 3);
  const sizes     = new Float32Array(LAYERS * PER_LAYER);
  const phases    = new Float32Array(LAYERS * PER_LAYER);

  let k = 0;
  for (let L = 0; L < LAYERS; L++) {
    const t = L / (LAYERS - 1);
    const y = t * HEIGHT;
    const shape = Math.sin(Math.pow(t, 0.6) * Math.PI);
    const r = 4 + shape * RADIUS * 1.4;
    for (let P = 0; P < PER_LAYER; P++) {
      const a = (P / PER_LAYER) * Math.PI * 2;
      positions[k*3+0] = Math.cos(a) * r;
      positions[k*3+1] = y;
      positions[k*3+2] = Math.sin(a) * r;
      const v = 0.55 + Math.random() * 0.3;
      const warm = Math.random() * 0.15;
      colors[k*3+0] = v + warm;
      colors[k*3+1] = v;
      colors[k*3+2] = v - warm * 0.5;
      sizes[k]  = 2.8 + Math.random() * 4.0;
      phases[k] = Math.random() * Math.PI * 2;
      k++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0.55 } },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vA;
      void main() {
        vColor = color;
        vec3 p = position;
        p.x += sin(uTime * 1.3 + aPhase) * 0.8;
        p.z += cos(uTime * 1.1 + aPhase * 1.3) * 0.8;
        p.y += sin(uTime * 0.8 + aPhase) * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * (260.0 / -mv.z);
        vA = smoothstep(180.0, 20.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vA;
      uniform float uAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float soft = smoothstep(0.5, 0.15, d);
        gl_FragColor = vec4(vColor, soft * uAlpha * vA);
      }
    `,
    transparent: true, depthWrite: false, vertexColors: true,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  group.add(points);
  const funnelGeo = new THREE.CylinderGeometry(8, 3, HEIGHT, 20, 1, true);
  funnelGeo.translate(0, HEIGHT / 2, 0);
  const funnel = new THREE.Mesh(funnelGeo, new THREE.MeshBasicMaterial({
    color: 0x2c2f35, transparent: true, opacity: 0.35,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  group.add(funnel);

  // --------- authentic-position target ---------------------------------
  // main.js sets this from the ROM cyclone's map cell each frame; the
  // funnel glides toward it (one cell every ~2.5 s in the original, so a
  // ~1.5 s glide reads as continuous motion).
  const target = new THREE.Vector3();
  let hasTarget = false;
  function setWorldTarget(x, z) {
    target.set(x, 0, z);
    if (!hasTarget) { group.position.set(x, 0, z); hasTarget = true; }
  }

  function update(dt, t /*, world */) {
    mat.uniforms.uTime.value = t;
    points.rotation.y = t * 1.4;
    funnel.rotation.y = -t * 0.6;
    if (hasTarget) {
      const k = 1 - Math.pow(0.25, dt);   // ~1.5 s glide to the new cell
      group.position.x += (target.x - group.position.x) * k;
      group.position.z += (target.z - group.position.z) * k;
    }
  }

  return {
    group, update, setWorldTarget,
    radius: RADIUS,
    get position() { return group.position; },
  };
}
