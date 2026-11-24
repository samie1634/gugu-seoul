import * as THREE from 'three';

export type CallDuckAge = 'adult' | 'duckling';
/** Original shapes informed by the supplied white-adult and yellow-duckling photos. */
export function createCallDuckResources() {
  const sphere = new THREE.SphereGeometry(1, 14, 10), foot = new THREE.CylinderGeometry(1, 1, 1, 3), tuft = new THREE.OctahedronGeometry(1, 0);
  const colors = { white: '#f4f1e6', wing: '#e9e8de', down: '#f0d28c', paleDown: '#f7e3a9', bill: '#e9a13a', foot: '#d57c28', eye: '#241d17', nostril: '#975021', brownDown: '#3d3523', greyBill: '#706a45' };
  const materials = Object.fromEntries(Object.entries(colors).map(([key, color]) => [key, new THREE.MeshStandardMaterial({ color, roughness: 1 })])) as Record<keyof typeof colors, THREE.MeshStandardMaterial>;
  return { sphere, foot, tuft, materials, dispose() { sphere.dispose(); foot.dispose(); tuft.dispose(); Object.values(materials).forEach(m => m.dispose()); } };
}

/** Adult sex intentionally does not change mesh, scale, or plumage. */
export function createCallDuckModel(age: CallDuckAge, resources: ReturnType<typeof createCallDuckResources>, mallardDown = false) {
  const root = new THREE.Group(), body = new THREE.Group(), neck = new THREE.Group(), feet: THREE.Group[] = [];
  root.name = age === 'adult' ? 'white-call-duck' : 'yellow-call-duckling'; root.add(body); body.add(neck);
  const baby = age === 'duckling', m = resources.materials, skin = baby ? mallardDown ? m.brownDown : m.down : m.white;
  const ellipsoid = (parent: THREE.Object3D, name: string, material: THREE.Material, position: number[], scale: number[]) => {
    const mesh = new THREE.Mesh(resources.sphere, material); mesh.name = name; mesh.position.set(position[0], position[1], position[2]); mesh.scale.set(scale[0], scale[1], scale[2]); parent.add(mesh); return mesh;
  };
  ellipsoid(body, 'call-duck-body', skin, [0, .052, .025], baby ? [.074, .072, .102] : [.12, .13, .19]);
  ellipsoid(body, 'call-duck-breast', baby ? m.paleDown : m.white, [0, baby ? .058 : .077, baby ? -.055 : -.105], baby ? [.067, .068, .057] : [.1, .117, .082]);
  ellipsoid(body, 'call-duck-tail', skin, [0, baby ? .075 : .11, baby ? .116 : .208], baby ? [.042, .027, .044] : [.062, .029, .075]).rotation.x = -.27;
  neck.position.set(0, baby ? .095 : .12, baby ? -.059 : -.13);
  ellipsoid(neck, 'call-duck-neck', skin, [0, baby ? .015 : .062, -.01], baby ? [.033, .037, .034] : [.038, .085, .043]);
  ellipsoid(neck, 'call-duck-head', baby ? m.paleDown : m.white, [0, baby ? .058 : .13, baby ? -.028 : -.038], baby ? [.053, .052, .057] : [.067, .067, .074]);
  ellipsoid(neck, 'call-duck-bill', baby && mallardDown ? m.greyBill : m.bill, [0, baby ? .038 : .111, baby ? -.093 : -.13], baby ? [.025, .012, .036] : [.036, .015, .061]);
  ellipsoid(neck, 'call-duck-bill-nail', baby && mallardDown ? m.greyBill : m.foot, [0, baby ? .039 : .113, baby ? -.123 : -.183], baby ? [.008, .004, .005] : [.01, .004, .007]);
  for (const side of [-1, 1]) {
    ellipsoid(neck, 'call-duck-eye', m.eye, [side * (baby ? .047 : .06), baby ? .066 : .143, baby ? -.046 : -.06], baby ? [.0045, .006, .006] : [.0055, .006, .007]);
    ellipsoid(neck, 'call-duck-nostril', m.nostril, [side * (baby ? .014 : .021), baby ? .05 : .126, baby ? -.096 : -.141], [.002, .0015, .005]);
    ellipsoid(body, 'call-duck-folded-wing', baby ? mallardDown ? m.brownDown : m.down : m.wing, [side * (baby ? .063 : .1), baby ? .072 : .095, baby ? .027 : .05], baby ? [.013, .043, .066] : [.025, .077, .135]);
    const pivot = new THREE.Group(); pivot.position.set(side * (baby ? .039 : .061), baby ? -.016 : -.055, baby ? .04 : .06); body.add(pivot); feet.push(pivot);
    const web = new THREE.Mesh(resources.foot, m.foot); web.name = 'call-duck-webbed-foot'; web.position.z = -.016; web.scale.set(baby ? .022 : .034, .006, baby ? .031 : .05); pivot.add(web);
  }
  // A bounded instanced fringe creates down rather than copying the photo texture.
  let down: THREE.InstancedMesh | undefined;
  if (baby) {
    down = new THREE.InstancedMesh(resources.tuft, mallardDown ? m.brownDown : m.paleDown, 56); down.name = 'call-duckling-down';
    const transform = new THREE.Object3D();
    for (let i = 0; i < 56; i++) {
      const theta = i * 2.399963, vertical = .08 + (i % 8) / 9, lateral = Math.sqrt(1 - vertical * vertical);
      const direction = new THREE.Vector3(Math.cos(theta) * lateral, vertical, Math.sin(theta) * lateral);
      transform.position.set(direction.x * .073, .052 + direction.y * .07, .025 + direction.z * .1);
      transform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      transform.scale.set(.0015, .008 + (i % 3) * .002, .0015); transform.updateMatrix(); down.setMatrixAt(i, transform.matrix);
    }
    body.add(down);
  }
  if (baby && mallardDown) {
    root.name = 'striped-mallard-duckling';
    ellipsoid(neck, 'mallard-duckling-crown', m.brownDown, [0, .094, -.027], [.04, .019, .054]);
    for (const side of [-1, 1]) {
      ellipsoid(neck, 'mallard-duckling-eye-stripe', m.brownDown, [side * .049, .064, -.018], [.004, .007, .044]);
      ellipsoid(body, 'mallard-duckling-yellow-patch', m.paleDown, [side * .069, .075, .025], [.009, .016, .022]);
    }
  }
  let disposed = false;
  return {
    root,
    dispose() { if (disposed) return; disposed = true; down?.dispose(); },
    pose(time: number, phase: number, speed: number, dabble: number, preen: number) {
      const paddle = Math.min(1, speed / .28), cycle = time * (baby ? 8 : 5.7) + phase;
      body.position.y = Math.sin(time * 2 + phase) * (baby ? .004 : .006);
      body.rotation.x = -(baby ? .32 : .34) * dabble; body.rotation.z = Math.sin(cycle) * .012 * paddle;
      neck.rotation.x = -(baby ? .52 : .85) * dabble; neck.rotation.y = preen * .85 + Math.sin(time * .5 + phase) * .07 * (1 - dabble);
      feet.forEach((foot, i) => { foot.rotation.x = Math.sin(cycle + i * Math.PI) * .7 * paddle; });
    },
  };
}
