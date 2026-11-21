"use strict";

// The baked carry pose faces world −Z. The mounting points follow its forehead and hands.
const WEAR_POSE = {
  head: { anchor: [17, 1635, -151], pitch: -42 },
  left: { wrist: [-280, 936, -277], finger: [-287, 848, -296], pitch: -29 },
  right: { wrist: [297, 935, -290], finger: [305, 849, -320], pitch: -29 }
};

function createMannequin() {
  const decode = text => Uint8Array.from(atob(text), character => character.charCodeAt(0)).buffer;
  const geometry = new THREE.BufferGeometry();
  const positions = Float32Array.from(new Int16Array(decode(HUMAN_MESH.positions)));
  const indices = new Uint16Array(decode(HUMAN_MESH.indices));
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#aeb8c9").convertSRGBToLinear(),
    roughness: 0.85,
    metalness: 0
  });
  return new THREE.Mesh(geometry, material);
}
