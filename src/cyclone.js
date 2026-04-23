import * as THREE from 'three';

// Tornado as a stack of rotating, spiraling particle rings.
export function createCyclone() {
  const group = new THREE.Group();

  const RADIUS = 28; // effective danger radius (roughly at mid-height)
  const HEIGHT = 180;
  const LAYERS = 60;
  const PER_LAYER = 42;

  const positions = new Float32Array(LAYERS * PER_LAYER * 3);
  const colors    = new Float32Array(LAYERS * PER_LAYER * 3);
  const sizes     = new Float32Array(LAYERS * PER_LAYER);
  const phases    = new Float32Array(LAYERS * PER_LAYER);

  let i = 0;
  for (let L = 0; L < LAYERS; L++) {
    const t = L / (LAYERS - 1);
    const y = t * HEIGHT;
    // Radius tapers at top & bottom, widest around 40% up
    const shape = Math.sin(Math.pow(t, 0.6) * Math.PI);
    const r = 4 + shape * RADIUS * 1.4;
    for (let P = 0; P < PER_LAYER; P++) {
      const a = (P / PER_LAYER) * Math.PI * 2;
      positions[i*3+0] = Math.cos(a) * r;
      positions[i*3+1] = y;
      positions[i*3+2] = Math.sin(a) * r;
      // mostly grey with a hint of warm dust
      const v = 0.55 + Math.random() * 0.3;
      const warm = Math.random() * 0.15;
      colors[i*3+0] = v + warm;
      colors[i*3+1] = v;
      colors[i*3+2] = v - warm * 0.5;
      sizes[i] = 2.8 + Math.random() * 4.0;
      phases[i] = Math.random() * Math.PI * 2;
      i++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:  { value: 0 },
      uAlpha: { value: 0.55 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vA;
      void main() {
        vColor = color;
        vec3 p = position;
        // jitter within ring
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
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  group.add(points);

  // A subtle dark funnel mesh underneath for mass
  const funnelGeo = new THREE.CylinderGeometry(8, 3, HEIGHT, 20, 1, true);
  funnelGeo.translate(0, HEIGHT / 2, 0);
  const funnelMat = new THREE.MeshBasicMaterial({
    color: 0x2c2f35,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const funnel = new THREE.Mesh(funnelGeo, funnelMat);
  group.add(funnel);

  // Wander target — a simple pathing state
  let target = new THREE.Vector3();
  const SPEED = 4.5;
  function pickTarget(worldSize = 600) {
    target.set((Math.random()*2 - 1) * worldSize * 0.4, 0,
               (Math.random()*2 - 1) * worldSize * 0.4);
  }
  pickTarget();

  function update(dt, t, world) {
    mat.uniforms.uTime.value = t;
    points.rotation.y = t * 1.4;
    funnel.rotation.y = -t * 0.6;

    // Drift toward target; pick a new one when close
    const to = target.clone().sub(group.position);
    to.y = 0;
    const d = to.length();
    if (d < 12) {
      pickTarget(world ? 600 : undefined);
    } else {
      to.divideScalar(d);
      group.position.addScaledVector(to, SPEED * dt);
    }
  }

  return { group, update, radius: RADIUS, get position() { return group.position; } };
}
