import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';

// All dimensions are in metres, the table top is y = 0.

// Re-project UVs so that one texture tile spans one metre on every face.
function metricUVs(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, x, z);
    else if (nx >= nz) uv.setXY(i, z, y);
    else uv.setXY(i, x, y);
  }
  uv.needsUpdate = true;
  return geo;
}

function woodSet(set, rx, ry, { normal = 0.8 } = {}) {
  const out = {};
  for (const [k, tex] of Object.entries(set)) {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    out[k] = t;
  }
  return {
    map: out.diff,
    normalMap: out.nor,
    roughnessMap: out.rough,
    normalScale: new THREE.Vector2(normal, normal)
  };
}

function shadowed(obj, { cast = true, receive = true } = {}) {
  obj.traverse(o => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

let blobTexture = null;
function contactBlob(renderer, w, d, opacity = 0.55) {
  if (!blobTexture) blobTexture = T.toTexture(T.contactShadow(), renderer, { srgb: false });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity,
      depthWrite: false,
      color: 0x000000,
      alphaMap: blobTexture,
      polygonOffset: true,
      polygonOffsetFactor: -1
    })
  );
  m.position.y = 0.0004;
  m.renderOrder = 1;
  return m;
}

// Invisible box used for picking, so hover is stable over thin or hollow parts.
function hitBox(w, h, d, y = h / 2) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  m.position.y = y;
  return m;
}

function lathe(points, segments = 96) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

/* ---------------------------------------------------------------- table */

export function table(ctx) {
  const geo = new THREE.PlaneGeometry(5, 4).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({
    ...woodSet(ctx.tex.dark, 5 / 1.1, 4 / 1.1, { normal: 0.55 }),
    color: 0xc4b4a6,
    clearcoat: 0.22,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.85
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -0.9;
  mesh.receiveShadow = true;
  return mesh;
}

/* ---------------------------------------------------------------- go */

const GO = { width: 0.424, depth: 0.455, height: 0.072, spacingX: 0.022, spacingZ: 0.0237 };

// A quiet mid-game shape: corners claimed, a fight brewing on the right side.
const BLACK = [
  [3, 3], [15, 15], [2, 14], [16, 3], [13, 16], [9, 3], [16, 9], [14, 4], [3, 9],
  [12, 14], [15, 11], [6, 16], [5, 2], [15, 7], [10, 16], [16, 12], [13, 9], [4, 12]
];
const WHITE = [
  [15, 2], [3, 15], [16, 15], [14, 2], [13, 3], [16, 5], [15, 13], [14, 14], [16, 10],
  [5, 15], [2, 6], [11, 16], [14, 10], [13, 12], [15, 8], [7, 3], [9, 15]
];

function stoneGeometry() {
  return new THREE.SphereGeometry(0.0111, 40, 20).scale(1, 0.41, 1);
}

function stoneMaterials() {
  return {
    black: new THREE.MeshPhysicalMaterial({
      color: 0x101012,
      roughness: 0.42,
      clearcoat: 0.25,
      clearcoatRoughness: 0.5
    }),
    white: new THREE.MeshPhysicalMaterial({
      color: 0xf1eee6,
      roughness: 0.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      sheen: 0.3,
      sheenColor: new THREE.Color(0xfff6e8)
    })
  };
}

function placeStones(mesh, coords, y, rand) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  coords.forEach(([i, j], k) => {
    const p = new THREE.Vector3(
      (i - 9) * GO.spacingX + (rand() - 0.5) * 0.0014,
      y,
      (j - 9) * GO.spacingZ + (rand() - 0.5) * 0.0014
    );
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.02, rand() * 6.28, (rand() - 0.5) * 0.02));
    mesh.setMatrixAt(k, m.compose(p, q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function goBowl(ctx, { open, stoneMat, stoneGeo, rand }) {
  const g = new THREE.Group();
  const wood = woodSet(ctx.tex.rose, 0.42, 0.16, { normal: 0.4 });
  const mat = new THREE.MeshPhysicalMaterial({
    ...wood,
    color: 0xc2a088,
    clearcoat: 0.45,
    clearcoatRoughness: 0.22,
    side: THREE.DoubleSide
  });
  const bowl = new THREE.Mesh(lathe([
    [0, 0.0], [0.045, 0.0], [0.056, 0.008], [0.064, 0.026], [0.066, 0.045], [0.062, 0.062],
    [0.058, 0.066], [0.0545, 0.064], [0.057, 0.048], [0.055, 0.03], [0.046, 0.014], [0.03, 0.009], [0, 0.008]
  ]), mat);
  g.add(bowl);

  if (open) {
    const count = 70;
    const inst = new THREE.InstancedMesh(stoneGeo, stoneMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < count; k++) {
      const layer = k / count;
      const y = 0.016 + layer * 0.034 + rand() * 0.004;
      const rMax = 0.03 + layer * 0.018;
      const r = Math.sqrt(rand()) * rMax;
      const a = rand() * Math.PI * 2;
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.9, rand() * 6.28, (rand() - 0.5) * 0.9));
      inst.setMatrixAt(k, m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, s));
    }
    g.add(inst);
  } else {
    const lid = new THREE.Mesh(lathe([
      [0, 0.024], [0.03, 0.022], [0.052, 0.015], [0.066, 0.005], [0.068, 0.0], [0.06, 0.0], [0, 0.0]
    ]), mat);
    lid.position.y = 0.064;
    g.add(lid);
  }
  g.add(contactBlob(ctx.renderer, 0.2, 0.2, 0.5));
  return shadowed(g);
}

export function goSet(ctx) {
  const g = new THREE.Group();
  const rand = T.rng(3);

  const board = new THREE.Group();
  const body = new THREE.Mesh(
    metricUVs(new RoundedBoxGeometry(GO.width, GO.height, GO.depth, 4, 0.0025)),
    new THREE.MeshPhysicalMaterial({
      ...woodSet(ctx.tex.oak, 1, 1, { normal: 0.5 }),
      color: 0xffe2b0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.4
    })
  );
  body.position.y = GO.height / 2;
  board.add(body);

  const faceCanvas = T.gobanFace(ctx.tex.oak.diff.image, GO);
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(GO.width - 0.004, GO.depth - 0.004).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({
      map: T.toTexture(faceCanvas, ctx.renderer),
      roughness: 0.48,
      clearcoat: 0.15,
      clearcoatRoughness: 0.45
    })
  );
  top.position.y = GO.height + 0.0001;
  board.add(top);

  const stoneGeo = stoneGeometry();
  const mats = stoneMaterials();
  const black = new THREE.InstancedMesh(stoneGeo, mats.black, BLACK.length);
  const white = new THREE.InstancedMesh(stoneGeo, mats.white, WHITE.length);
  placeStones(black, BLACK, GO.height + 0.0044, rand);
  placeStones(white, WHITE, GO.height + 0.0044, rand);
  board.add(black, white);
  shadowed(board);
  board.add(contactBlob(ctx.renderer, GO.width * 1.25, GO.depth * 1.25, 0.6));
  board.rotation.y = -0.08;
  g.add(board);

  const bowlB = goBowl(ctx, { open: true, stoneMat: mats.black, stoneGeo, rand });
  bowlB.position.set(0.31, 0, 0.03);
  const bowlW = goBowl(ctx, { open: false, stoneMat: mats.white, stoneGeo, rand });
  bowlW.position.set(0.3, 0, -0.17);
  bowlW.rotation.y = 1.1;
  g.add(bowlB, bowlW);

  // a single white stone left near the edge, as if just picked up
  const loose = new THREE.Mesh(stoneGeo, mats.white);
  loose.position.set(0.22, 0.0046, 0.21);
  shadowed(loose);
  g.add(loose);

  const hit = hitBox(0.68, 0.09, 0.5);
  hit.position.x = 0.1;
  g.add(hit);

  return { group: g, hit, anchor: new THREE.Vector3(0, 0.12, -0.1) };
}

/* ---------------------------------------------------------------- about: photo frame */

export function photoFrame(ctx) {
  const g = new THREE.Group();
  const W = 0.15, H = 0.15, D = 0.01, open = 0.116;

  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, -H / 2);
  shape.lineTo(W / 2, -H / 2);
  shape.lineTo(W / 2, H / 2);
  shape.lineTo(-W / 2, H / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-open / 2, -open / 2);
  hole.lineTo(-open / 2, open / 2);
  hole.lineTo(open / 2, open / 2);
  hole.lineTo(open / 2, -open / 2);
  hole.closePath();
  shape.holes.push(hole);
  const frameGeo = new THREE.ExtrudeGeometry(shape, {
    depth: D,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 3,
    curveSegments: 1
  });
  frameGeo.translate(0, 0, -D / 2);

  const pic = new THREE.Group();
  pic.add(new THREE.Mesh(frameGeo, new THREE.MeshPhysicalMaterial({
    ...woodSet(ctx.tex.dark, 5, 5, { normal: 0.35 }),
    color: 0x9c8574,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22
  })));

  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(open + 0.004, open + 0.004, 0.003),
    new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 })
  );
  backing.position.z = -0.0035;
  pic.add(backing);
  const mount = new THREE.Mesh(
    new THREE.PlaneGeometry(open, open),
    new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.92 })
  );
  mount.position.z = -0.0018;
  pic.add(mount);

  const photoTex = new THREE.Texture(ctx.images.portrait);
  photoTex.colorSpace = THREE.SRGBColorSpace;
  photoTex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
  photoTex.needsUpdate = true;
  const photo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.088, 0.088),
    new THREE.MeshPhysicalMaterial({ map: photoTex, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.2 })
  );
  photo.position.z = -0.0015;
  pic.add(photo);

  // glass: almost invisible, it only catches the room's reflections
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(open, open),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, transparent: true, opacity: 0.1, depthWrite: false })
  );
  glass.position.z = 0.002;
  pic.add(glass);

  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.032, 0.105, 0.003).translate(0, -0.0525, 0),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 0.85 })
  );
  stand.position.set(0, 0.03, -0.007);
  stand.rotation.x = 0.42;
  pic.add(stand);

  const lean = 0.2;
  pic.rotation.x = -lean;
  pic.position.y = (H / 2 + 0.002) * Math.cos(lean) + (D / 2 + 0.002) * Math.sin(lean);
  shadowed(pic);
  glass.castShadow = false;
  g.add(pic);

  const blob = contactBlob(ctx.renderer, 0.2, 0.13, 0.45);
  blob.position.z = -0.03;
  g.add(blob);

  const hit = hitBox(0.17, 0.17, 0.11, 0.085);
  g.add(hit);
  return { group: g, hit, anchor: new THREE.Vector3(0, 0.2, 0), focusPoint: new THREE.Vector3(0, 0.075, 0) };
}

/* ---------------------------------------------------------------- books */

export function books(ctx) {
  const g = new THREE.Group();
  const pages = new THREE.MeshStandardMaterial({ color: 0xece5d4, roughness: 0.95 });
  const specs = [
    { w: 0.165, h: 0.032, d: 0.235, color: 0x2e3a34, turn: 0 },
    { w: 0.148, h: 0.024, d: 0.212, color: 0x86684a, turn: 0.13 }
  ];
  let y = 0;
  for (const b of specs) {
    const cloth = new THREE.MeshPhysicalMaterial({
      color: b.color,
      roughness: 0.78,
      sheen: 0.5,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(b.color).offsetHSL(0, -0.1, 0.25)
    });
    const book = new THREE.Group();
    const board = 0.0028;
    for (const sy of [board / 2, b.h - board / 2]) {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(b.w, board, b.d), cloth);
      cover.position.y = sy;
      book.add(cover);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.004, b.h, b.d), cloth);
    spine.position.set(-b.w / 2 + 0.002, b.h / 2, 0);
    book.add(spine);
    const block = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.008, b.h - board * 2, b.d - 0.008), pages);
    block.position.set(0.0, b.h / 2, 0);
    book.add(block);
    book.position.y = y;
    book.rotation.y = b.turn;
    y += b.h;
    g.add(book);
  }
  shadowed(g);
  g.add(contactBlob(ctx.renderer, 0.28, 0.34, 0.5));
  return { group: g };
}

/* ---------------------------------------------------------------- research */

export function researchStack(ctx) {
  const g = new THREE.Group();
  // US Letter, like the arXiv PDF
  const sheet = new THREE.PlaneGeometry(0.216, 0.279).rotateX(-Math.PI / 2);
  const plain = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.9 });
  [[-0.012, 0.09, 0.0006], [0.008, -0.05, 0.0012]].forEach(([x, r, y]) => {
    const s = new THREE.Mesh(sheet, plain);
    s.position.set(x, y, 0.004);
    s.rotation.y = r;
    s.receiveShadow = true;
    g.add(s);
  });
  const pageTex = new THREE.Texture(ctx.images.page);
  pageTex.colorSpace = THREE.SRGBColorSpace;
  pageTex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
  pageTex.needsUpdate = true;
  const page = new THREE.Mesh(sheet, new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.88 }));
  page.position.y = 0.0018;
  page.receiveShadow = true;
  g.add(page);

  const print = new THREE.Group();
  const card = new THREE.Mesh(
    new THREE.BoxGeometry(0.088, 0.0009, 0.107),
    new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.7 })
  );
  card.position.y = 0.00045;
  print.add(card);
  const photoTex = new THREE.Texture(ctx.images.fusion);
  photoTex.colorSpace = THREE.SRGBColorSpace;
  photoTex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
  photoTex.needsUpdate = true;
  const photoMat = new THREE.MeshPhysicalMaterial({
    map: photoTex,
    roughness: 0.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.08
  });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.078, 0.078).rotateX(-Math.PI / 2), photoMat);
  photo.position.set(0, 0.00095, -0.008);
  print.add(photo);
  shadowed(print, { cast: false });
  print.position.set(0.06, 0.0021, 0.075);
  print.rotation.y = 0.24;
  g.add(print);

  const hit = hitBox(0.26, 0.02, 0.33);
  g.add(hit);
  return {
    group: g,
    hit,
    anchor: new THREE.Vector3(0, 0.04, -0.12),
    photo: { material: photoMat, image: photoTex },
    focusPoint: new THREE.Vector3(0.04, 0, 0.04)
  };
}

/* ---------------------------------------------------------------- laptop */

export function laptop(ctx) {
  const g = new THREE.Group();
  const W = 0.312, D = 0.218;
  const alu = new THREE.MeshPhysicalMaterial({ color: 0xc4c7cc, metalness: 1, roughness: 0.34, clearcoat: 0.1 });

  const base = new THREE.Mesh(new RoundedBoxGeometry(W, 0.011, D, 4, 0.0042), alu);
  base.position.y = 0.0058;
  g.add(base);

  const keys = new THREE.Mesh(
    new THREE.PlaneGeometry(0.272, 0.112).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: T.toTexture(T.keyboard(), ctx.renderer), roughness: 0.72, metalness: 0, envMapIntensity: 0.6 })
  );
  keys.position.set(0, 0.01135, -0.038);
  g.add(keys);
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.125, 0.074).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xb3b6bc, metalness: 0.9, roughness: 0.22 })
  );
  pad.position.set(0, 0.01133, 0.062);
  g.add(pad);

  const hinge = new THREE.Group();
  hinge.position.set(0, 0.0112, -D / 2 + 0.002);
  hinge.rotation.x = -1.88;
  const lid = new THREE.Mesh(new RoundedBoxGeometry(W, 0.006, D, 4, 0.0028), alu);
  lid.position.set(0, 0.003, D / 2);
  hinge.add(lid);
  const bezel = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.008, D - 0.008).rotateX(Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.08, clearcoat: 1 })
  );
  bezel.position.set(0, -0.0002, D / 2);
  hinge.add(bezel);

  const screenTex = new THREE.Texture(ctx.images.mano);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
  screenTex.needsUpdate = true;
  const screenMat = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: screenTex,
    emissiveIntensity: 0.9,
    roughness: 0.14,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.5
  });
  const sw = W - 0.024;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 1.6).rotateX(Math.PI / 2), screenMat);
  screen.position.set(0, -0.0004, D / 2 + 0.006);
  hinge.add(screen);
  g.add(hinge);
  shadowed(g);
  screen.castShadow = false;

  g.add(contactBlob(ctx.renderer, 0.38, 0.28, 0.4));

  const hit = hitBox(0.33, 0.22, 0.26, 0.1);
  hit.position.z = -0.03;
  g.add(hit);
  return {
    group: g,
    hit,
    anchor: new THREE.Vector3(0, 0.15, -0.14),
    screen: screenMat,
    focusPoint: new THREE.Vector3(0, 0.1, -0.1)
  };
}
