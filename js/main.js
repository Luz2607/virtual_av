import * as THREE from 'three';

import Stats from 'three/addons/libs/stats.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { Octree } from 'three/addons/math/Octree.js';
import { OctreeHelper } from 'three/addons/helpers/OctreeHelper.js';

import { Capsule } from 'three/addons/math/Capsule.js';

import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

/* ===================== Básicos ===================== */
const clock = new THREE.Clock();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88ccee);
scene.fog = new THREE.Fog(0x88ccee, 0, 50);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.rotation.order = 'YXZ';

const fillLight1 = new THREE.HemisphereLight(0x8dc1de, 0x00668d, 1.5);
fillLight1.position.set(2, 1, 1);
scene.add(fillLight1);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
directionalLight.position.set(-5, 25, -1);
directionalLight.castShadow = true;
directionalLight.shadow.camera.near = 0.01;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.left = -30;
directionalLight.shadow.camera.top = 30;
directionalLight.shadow.camera.bottom = -30;

/* ==== OPT: sombras más baratas al inicio ==== */
directionalLight.shadow.mapSize.width = 512;   // antes 1024
directionalLight.shadow.mapSize.height = 512;  // antes 1024
directionalLight.shadow.radius = 2;            // antes 4
directionalLight.shadow.bias = -0.0005;        // un poco más seguro contra acne
scene.add(directionalLight);

const container = document.getElementById('container');

/* ==== OPT: overlay de carga y manager ==== */
const manager = new THREE.LoadingManager();
const overlay = document.createElement('div');
overlay.style.cssText = `
  position:fixed;inset:0;background:#88ccee;display:flex;flex-direction:column;gap:10px;
  align-items:center;justify-content:center;font:600 14px/1 system-ui;color:#fff;z-index:10`;
overlay.innerHTML = `
  <div style="width:320px;height:8px;background:#ffffff33;border-radius:999px;overflow:hidden">
    <div id="fill" style="width:0;height:100%;background:#fff"></div>
  </div>
  <div>Cargando…</div>`;
document.body.appendChild(overlay);
manager.onProgress = (_url, loaded, total) => {
  const p = total ? Math.round((loaded / total) * 100) : 0;
  overlay.querySelector('#fill').style.width = p + '%';
};
manager.onLoad = () => setTimeout(() => overlay.remove(), 200);

/* ===================== Renderer ===================== */
const renderer = new THREE.WebGLRenderer({ antialias: true });

/* ==== OPT: limitar pixel ratio ==== */
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap; // respetado
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const stats = new Stats();
stats.domElement.style.position = 'absolute';
stats.domElement.style.top = '0px';
container.appendChild(stats.domElement);

/* ===================== Física / Colisiones ===================== */
const GRAVITY = 30;

/* ==== OPT: menos esferas ==== */
const NUM_SPHERES = 40; // antes 100

const SPHERE_RADIUS = 0.2;

/* ==== OPT: menos sub-pasos ==== */
const STEPS_PER_FRAME = 3; // antes 5

/* ==== OPT: icosaedro con menos detalle ==== */
const sphereGeometry = new THREE.IcosahedronGeometry(SPHERE_RADIUS, 2); // antes 5
const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xdede8d });

const spheres = [];
let sphereIdx = 0;

for (let i = 0; i < NUM_SPHERES; i++) {
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  scene.add(sphere);

  spheres.push({
    mesh: sphere,
    collider: new THREE.Sphere(new THREE.Vector3(0, -100, 0), SPHERE_RADIUS),
    velocity: new THREE.Vector3()
  });
}

const worldOctree = new Octree();

const playerCollider = new Capsule(
  new THREE.Vector3(0, 0.35, 0),
  new THREE.Vector3(0, 1, 0),
  0.35
);

const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();

let playerOnFloor = false;
let mouseTime = 0;

const keyStates = {};

const vector1 = new THREE.Vector3();
const vector2 = new THREE.Vector3();
const vector3 = new THREE.Vector3();

/* ===================== Input / Pointer Lock ===================== */
document.addEventListener('keydown', (event) => {
  keyStates[event.code] = true;
});

document.addEventListener('keyup', (event) => {
  keyStates[event.code] = false;
});

container.addEventListener('mousedown', () => {
  document.body.requestPointerLock();
  mouseTime = performance.now();
});

document.addEventListener('mouseup', () => {
  if (document.pointerLockElement !== null) throwBall();
});

document.body.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === document.body) {
    camera.rotation.y -= event.movementX / 500;
    camera.rotation.x -= event.movementY / 500;
  }
});

window.addEventListener('resize', onWindowResize);

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ===================== Jugador y esferas ===================== */
function throwBall() {
  const sphere = spheres[sphereIdx];

  camera.getWorldDirection(playerDirection);

  sphere.collider.center
    .copy(playerCollider.end)
    .addScaledVector(playerDirection, playerCollider.radius * 1.5);

  // Más fuerza si mantienes clic y si te mueves
  const impulse =
    15 + 30 * (1 - Math.exp((mouseTime - performance.now()) * 0.001));

  sphere.velocity.copy(playerDirection).multiplyScalar(impulse);
  sphere.velocity.addScaledVector(playerVelocity, 2);

  sphereIdx = (sphereIdx + 1) % spheres.length;
}

function playerCollisions() {
  const result = worldOctree.capsuleIntersect(playerCollider);

  playerOnFloor = false;

  if (result) {
    playerOnFloor = result.normal.y > 0;

    if (!playerOnFloor) {
      playerVelocity.addScaledVector(
        result.normal,
        -result.normal.dot(playerVelocity)
      );
    }

    if (result.depth >= 1e-10) {
      playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }
  }
}

function updatePlayer(deltaTime) {
  let damping = Math.exp(-4 * deltaTime) - 1;

  if (!playerOnFloor) {
    playerVelocity.y -= GRAVITY * deltaTime;
    // pequeña resistencia del aire
    damping *= 0.1;
  }

  playerVelocity.addScaledVector(playerVelocity, damping);

  const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
  playerCollider.translate(deltaPosition);

  playerCollisions();

  camera.position.copy(playerCollider.end);
}

function playerSphereCollision(sphere) {
  const center = vector1
    .addVectors(playerCollider.start, playerCollider.end)
    .multiplyScalar(0.5);

  const sphere_center = sphere.collider.center;

  const r = playerCollider.radius + sphere.collider.radius;
  const r2 = r * r;

  // aproximación: jugador = 3 esferas
  for (const point of [playerCollider.start, playerCollider.end, center]) {
    const d2 = point.distanceToSquared(sphere_center);

    if (d2 < r2) {
      const normal = vector1.subVectors(point, sphere_center).normalize();
      const v1 = vector2.copy(normal).multiplyScalar(normal.dot(playerVelocity));
      const v2 = vector3.copy(normal).multiplyScalar(normal.dot(sphere.velocity));

      playerVelocity.add(v2).sub(v1);
      sphere.velocity.add(v1).sub(v2);

      const d = (r - Math.sqrt(d2)) / 2;
      sphere_center.addScaledVector(normal, -d);
    }
  }
}

function spheresCollisions() {
  for (let i = 0, length = spheres.length; i < length; i++) {
    const s1 = spheres[i];

    for (let j = i + 1; j < length; j++) {
      const s2 = spheres[j];

      const d2 = s1.collider.center.distanceToSquared(s2.collider.center);
      const r = s1.collider.radius + s2.collider.radius;
      const r2 = r * r;

      if (d2 < r2) {
        const normal = vector1
          .subVectors(s1.collider.center, s2.collider.center)
          .normalize();
        const v1 = vector2.copy(normal).multiplyScalar(normal.dot(s1.velocity));
        const v2 = vector3.copy(normal).multiplyScalar(normal.dot(s2.velocity));

        s1.velocity.add(v2).sub(v1);
        s2.velocity.add(v1).sub(v2);

        const d = (r - Math.sqrt(d2)) / 2;

        s1.collider.center.addScaledVector(normal, d);
        s2.collider.center.addScaledVector(normal, -d);
      }
    }
  }
}

function updateSpheres(deltaTime) {
  spheres.forEach((sphere) => {
    sphere.collider.center.addScaledVector(sphere.velocity, deltaTime);

    const result = worldOctree.sphereIntersect(sphere.collider);

    if (result) {
      sphere.velocity.addScaledVector(
        result.normal,
        -result.normal.dot(sphere.velocity) * 1.5
      );
      sphere.collider.center.add(result.normal.multiplyScalar(result.depth));
    } else {
      sphere.velocity.y -= GRAVITY * deltaTime;
    }

    const damping = Math.exp(-1.5 * deltaTime) - 1;
    sphere.velocity.addScaledVector(sphere.velocity, damping);

    playerSphereCollision(sphere);
  });

  spheresCollisions();

  for (const sphere of spheres) {
    sphere.mesh.position.copy(sphere.collider.center);
  }
}

function getForwardVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  playerDirection.normalize();
  return playerDirection;
}

function getSideVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  playerDirection.normalize();
  playerDirection.cross(camera.up);
  return playerDirection;
}

function controls(deltaTime) {
  // un poco de control en el aire
  const speedDelta = deltaTime * (playerOnFloor ? 25 : 8);

  if (keyStates['KeyW']) {
    playerVelocity.add(getForwardVector().multiplyScalar(speedDelta));
  }
  if (keyStates['KeyS']) {
    playerVelocity.add(getForwardVector().multiplyScalar(-speedDelta));
  }
  if (keyStates['KeyA']) {
    playerVelocity.add(getSideVector().multiplyScalar(-speedDelta));
  }
  if (keyStates['KeyD']) {
    playerVelocity.add(getSideVector().multiplyScalar(speedDelta));
  }

  if (playerOnFloor) {
    if (keyStates['Space']) {
      playerVelocity.y = 15;
    }
  }
}

/* ===================== Carga del mundo ===================== */
/* ==== OPT: usar el LoadingManager ==== */
const loader = new GLTFLoader(manager).setPath('./models/gltf/');

/*'level_blockout.glb', BLD_Ghost_city.glb*/

loader.load(
  'level_blockout.glb',
  (gltf) => {
    scene.add(gltf.scene);

    worldOctree.fromGraphNode(gltf.scene);

    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          /* ==== OPT: anisotropy bajo al cargar ==== */
          child.material.map.anisotropy = 1; // antes 4
        }
      }
    });

    const helper = new OctreeHelper(worldOctree);
    helper.visible = false;
    scene.add(helper);

    const gui = new GUI({ width: 200 });
    gui
      .add({ debug: false }, 'debug')
      .name('Show Octree')
      .onChange((value) => (helper.visible = value));
  },
  undefined,
  // Fallback si el GLB no existe (para que el demo funcione igual)
  (err) => {
    console.warn(
      '[GLB no encontrado] Se generará un mundo básico para pruebas.',
      err?.message || err
    );
    buildFallbackWorld();
  }
);

function buildFallbackWorld() {
  // Suelo
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x556b7a,
    roughness: 1
  });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(60, 2, 60), groundMat);
  ground.position.set(0, -1, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // Bloques aleatorios
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x8db0de,
    roughness: 0.9
  });
  const boxGeo = new THREE.BoxGeometry(4, 4, 4);
  const group = new THREE.Group();
  scene.add(group);

  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(boxGeo, boxMat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(
      THREE.MathUtils.randFloatSpread(50),
      THREE.MathUtils.randFloat(1, 10),
      THREE.MathUtils.randFloatSpread(50)
    );
    m.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    group.add(m);
  }

  // Generar Octree a partir del grupo
  const world = new THREE.Group();
  world.add(ground);
  world.add(...group.children);
  scene.add(world);

  worldOctree.fromGraphNode(world);

  const helper = new OctreeHelper(worldOctree);
  helper.visible = false;
  scene.add(helper);

  const gui = new GUI({ width: 200 });
  gui
    .add({ debug: false }, 'debug')
    .name('Show Octree')
    .onChange((value) => (helper.visible = value));
}

/* ===================== Seguridad (fuera de límites) ===================== */
function teleportPlayerIfOob() {
  if (camera.position.y <= -25) {
    playerCollider.start.set(0, 0.35, 0);
    playerCollider.end.set(0, 1, 0);
    playerCollider.radius = 0.35;
    camera.position.copy(playerCollider.end);
    camera.rotation.set(0, 0, 0);
  }
}

/* ===================== Loop ===================== */
function animate() {
  const deltaTime = Math.min(0.05, clock.getDelta()) / STEPS_PER_FRAME;

  // Varias sub-iteraciones para evitar atravesar geometría
  for (let i = 0; i < STEPS_PER_FRAME; i++) {
    controls(deltaTime);
    updatePlayer(deltaTime);
    updateSpheres(deltaTime);
    teleportPlayerIfOob();
  }

  renderer.render(scene, camera);
  stats.update();
}
