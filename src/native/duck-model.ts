import * as THREE from 'three';

export type DuckPlumage = 'drake' | 'hen';
export type WildDuckSpecies = 'mallard' | 'spot-billed-duck' | 'eurasian-teal';
/** Original geometry, sized to a roughly 60 cm mallard. Forward is local -Z. */
export function createDuckResources(detail = 12) {
  const sphere = new THREE.SphereGeometry(1, detail, Math.max(4, Math.floor(detail * 2 / 3)));
  const foot = new THREE.CylinderGeometry(1, 1, 1, 3);
  const wake = new THREE.RingGeometry(.97, 1, 24);
  const colors = {
    grey: '#b2b2a6', green: '#164d40', chestnut: '#633f2d', white: '#e9e5d5',
    brown: '#775b3d', buff: '#ae9164', dark: '#352e24', black: '#111714',
    blue: '#324d89', yellow: '#c3ad57', orange: '#c97932', olive: '#87866a', back: '#655c4e',
  };
  const materials = Object.fromEntries(Object.entries(colors).map(([key, color]) => [key, new THREE.MeshStandardMaterial({ color, roughness: .86 })])) as Record<keyof typeof colors, THREE.MeshStandardMaterial>;
  materials.green.roughness = .48; materials.green.metalness = .08;
  const curl = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, .11, .26), new THREE.Vector3(0, .16, .30), new THREE.Vector3(0, .17, .275), new THREE.Vector3(0, .145, .278)]), 10, .006, 5, false);
  const wakeMaterial = new THREE.MeshBasicMaterial({ color: '#c6dcd8', transparent: true, opacity: .17, depthWrite: false, side: THREE.DoubleSide });
  return { sphere, foot, wake, curl, materials, wakeMaterial, dispose() { sphere.dispose(); foot.dispose(); wake.dispose(); curl.dispose(); wakeMaterial.dispose(); Object.values(materials).forEach(material => material.dispose()); } };
}

export function createDuckModel(plumage: DuckPlumage, resources: ReturnType<typeof createDuckResources>, species: WildDuckSpecies = 'mallard') {
  const root = new THREE.Group(), body = new THREE.Group(), neck = new THREE.Group();
  const instances: THREE.InstancedMesh[] = [];
  root.name = species; root.add(body); body.add(neck);
  if (species === 'eurasian-teal') root.scale.setScalar(.64);
  const { sphere, materials: m } = resources, male = plumage === 'drake', mallardMale = male && species === 'mallard', tealMale = male && species === 'eurasian-teal';
  const ellipsoid = (parent: THREE.Object3D, name: string, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const mesh = new THREE.Mesh(sphere, material); mesh.name = name; mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); return mesh;
  };
  ellipsoid(body, 'duck-body', mallardMale || tealMale ? m.grey : m.brown, 0, .055, .035, .12, .12, .235);
  ellipsoid(body, 'duck-breast', mallardMale ? m.chestnut : m.buff, 0, .075, -.122, .105, .113, .092);
  ellipsoid(body, 'duck-tail', male ? m.black : m.dark, 0, .11, .26, .065, .031, .085).rotation.x = -.25;
  neck.position.set(0, .1, -.13);
  ellipsoid(neck, 'duck-neck', mallardMale ? m.green : tealMale ? m.chestnut : m.buff, 0, .082, -.023, .046, .103, .053);
  if (mallardMale) ellipsoid(neck, 'duck-white-neck-ring', m.white, 0, .085, -.025, .049, .012, .057);
  ellipsoid(neck, 'duck-head', mallardMale ? m.green : tealMale ? m.chestnut : m.buff, 0, .166, -.058, .067, .071, .082);
  const bill = ellipsoid(neck, 'duck-bill', species !== 'mallard' ? m.dark : male ? m.yellow : m.olive, 0, .147, -.163, .044, .018, .073);
  ellipsoid(neck, 'duck-bill-tip', species === 'spot-billed-duck' ? m.yellow : m.dark, 0, .149, -.227, .014, .006, .01);
  for (const side of [-1, 1]) {
    ellipsoid(neck, 'duck-eye', m.black, side * .061, .18, -.083, .006, .007, .008);
    if (!mallardMale && !tealMale) ellipsoid(neck, 'duck-eye-stripe', m.dark, side * .065, .178, -.047, .006, .011, .058);
    ellipsoid(body, 'duck-folded-wing', male ? m.back : m.dark, side * .099, .095, .065, .027, .081, .164);
    ellipsoid(body, 'duck-white-speculum-border', m.white, side * .123, .096, .095, .007, .044, .086);
    ellipsoid(body, species === 'mallard' ? 'duck-blue-speculum' : 'duck-green-speculum', species === 'mallard' ? m.blue : m.green, side * .128, .098, .095, .006, .032, .075);
  }
  if (mallardMale) {
    for (const side of [-1, 1]) {
      const curl = new THREE.Mesh(resources.curl, m.black); curl.name = 'duck-curled-tail-feather'; curl.position.x = side * .012; body.add(curl);
      ellipsoid(body, 'duck-white-tail-edge', m.white, side * .041, .105, .28, .022, .014, .071);
    }
  } else ellipsoid(neck, 'duck-brown-crown', m.dark, 0, .223, -.049, .045, .017, .062);
  if (tealMale) for (const side of [-1, 1]) {
    ellipsoid(neck, 'teal-green-eye-patch', m.green, side * .064, .185, -.052, .009, .028, .057);
    ellipsoid(body, 'teal-cream-tail-patch', m.yellow, side * .05, .09, .25, .034, .022, .04);
  }
  if (species === 'spot-billed-duck') for (const side of [-1, 1]) ellipsoid(neck, 'spotbill-white-cheek', m.white, side * .063, .156, -.06, .006, .013, .055);
  // One draw call for each hen's mottled feather markings, rather than extra meshes.
  if (!mallardMale && !tealMale) {
    const mottles = new THREE.InstancedMesh(sphere, m.buff, 48), transform = new THREE.Object3D();
    mottles.name = 'duck-mottled-feathers';
    for (let i = 0; i < 48; i++) {
      const side = i % 2 ? 1 : -1, column = Math.floor(i / 2) % 8, row = Math.floor(i / 16);
      const phi = (row - 1) * .56, theta = -.95 + column * .27;
      transform.position.set(side * (.102 + Math.cos(phi) * Math.cos(theta) * .027), .095 + Math.sin(phi) * .081, .065 + Math.cos(phi) * Math.sin(theta) * .164);
      transform.scale.set(.004, .005, .024); transform.rotation.set(side * .18, side * .3, side * -.35); transform.updateMatrix(); mottles.setMatrixAt(i, transform.matrix);
    }
    body.add(mottles); instances.push(mottles);
    const streaks = new THREE.InstancedMesh(sphere, m.dark, 32); streaks.name = 'duck-breast-streaks';
    for (let i = 0; i < 32; i++) {
      const row = Math.floor(i / 8), angle = (i % 8 - 3.5) * .2, height = -.35 + row * .38;
      const spread = Math.sqrt(1 - height * height);
      transform.position.set(Math.sin(angle) * .105 * spread, .075 + height * .113, -.122 - Math.cos(angle) * .092 * spread - .003);
      transform.scale.set(.004, .013, .003); transform.rotation.set(.1, angle, angle * -.25); transform.updateMatrix(); streaks.setMatrixAt(i, transform.matrix);
    }
    body.add(streaks); instances.push(streaks);
  }
  const feet = [-1, 1].map(side => {
    const pivot = new THREE.Group(); pivot.position.set(side * .066, -.06, .07); body.add(pivot);
    const mesh = new THREE.Mesh(resources.foot, m.orange); mesh.name = 'duck-webbed-foot'; mesh.scale.set(.035, .008, .058); mesh.position.z = -.025; pivot.add(mesh); return pivot;
  });
  return {
    root,
    dispose() { instances.forEach(mesh => mesh.dispose()); },
    pose(time: number, phase: number, speed: number, dabble: number, preen: number) {
      const paddle = Math.min(1, speed / .3), cycle = time * (5 + speed * 3) + phase;
      body.position.y = Math.sin(time * 2.1 + phase) * .007;
      body.rotation.x = -.38 * dabble; body.rotation.z = Math.sin(cycle) * .012 * paddle;
      neck.rotation.x = -.9 * dabble; neck.rotation.y = .9 * preen + Math.sin(time * .5 + phase) * .08 * (1 - dabble);
      bill.rotation.x = Math.sin(time * 10) * .03 * dabble;
      feet.forEach((foot, i) => { foot.rotation.x = Math.sin(cycle + i * Math.PI) * .65 * paddle; });
    },
  };
}
