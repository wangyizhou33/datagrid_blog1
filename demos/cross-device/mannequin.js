"use strict";

function createTrackedMannequin() {
  // Web1 supplies a baked SMPL carry pose. The bind landmarks below are in metres, Z up.
  const vector = coordinates => new THREE.Vector3(...coordinates);
  const scale = 0.76;
  const headAnchor = vector([0.018, 0.177, 1.598]);
  const neck = vector([0.006, -0.043, 1.475]);
  const up = vector([0, 0, 1]);
  const across = vector([1, 0, 0]);
  const mounted = pitch => new THREE.Quaternion().setFromAxisAngle(across, THREE.MathUtils.degToRad(270 + pitch));
  const headMount = mounted(-42);
  const wristMount = mounted(-29);

  const source = new Int16Array(decodeBytes(HUMAN_MESH.positions).buffer);
  const indices = new Uint16Array(decodeBytes(HUMAN_MESH.indices).buffer);
  const vertices = [];
  const positions = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 3) {
    const point = new THREE.Vector3(source[i], -source[i + 2], source[i + 1]).multiplyScalar(0.001);
    point.toArray(positions, i);
    vertices.push(point);
  }

  function bone(position, orientation) {
    const result = new THREE.Bone();
    if (position) result.position.copy(position);
    if (orientation) result.quaternion.copy(orientation);
    return result;
  }

  function boneFrame(direction, normal) {
    // Roll follows the elbow plane, with local +Y along the limb.
    const axis = direction.clone().normalize();
    const tangent = normal.clone().cross(axis).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(normal, axis, tangent));
  }

  function bindArm(shoulderCoords, elbowCoords, wristCoords, anchorCoords) {
    const shoulder = vector(shoulderCoords);
    const elbow = vector(elbowCoords);
    const wrist = vector(wristCoords);
    const anchor = vector(anchorCoords);
    const upperDir = elbow.clone().sub(shoulder);
    const lowerDir = wrist.clone().sub(elbow);
    const normal = upperDir.clone().cross(lowerDir).normalize();
    const inLine = wrist.clone().sub(shoulder).normalize();
    const pole = upperDir.clone().addScaledVector(inLine, -upperDir.dot(inLine)).normalize()
      .addScaledVector(up, -0.35).normalize();
    const upper = bone(shoulder, boneFrame(upperDir, normal));
    const lower = bone(elbow, boneFrame(lowerDir, normal));
    const hand = bone(wrist, wristMount);
    return {
      shoulder, elbow, wrist, anchorOffset: anchor.sub(wrist), upperDir, lowerDir, pole, upper, lower, hand,
      upperBind: upper.quaternion.clone(), lowerBind: lower.quaternion.clone()
    };
  }

  const left = bindArm([-0.156, -0.043, 1.408], [-0.274, 0.043, 1.174],
    [-0.275, 0.197, 0.951], [-0.280, 0.228, 0.946]);
  const right = bindArm([0.174, -0.038, 1.411], [0.284, 0.060, 1.170],
    [0.288, 0.208, 0.950], [0.297, 0.241, 0.945]);
  const torso = bone();
  const head = bone(neck, headMount);
  const bones = [torso, head, left.upper, left.lower, left.hand, right.upper, right.lower, right.hand];

  function armWeights() {
    // Cutting this particular rest mesh below its armpits separates each sleeve and hand from the torso.
    const links = vertices.map(() => new Set());
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.subarray(i, i + 3);
      links[a].add(b).add(c);
      links[b].add(a).add(c);
      links[c].add(a).add(b);
    }
    const cut = 1.3;
    const masks = [left, right].map((arm, side) => {
      const mask = new Float32Array(vertices.length);
      let seed = 0;
      let distance = Infinity;
      for (let i = 0; i < vertices.length; i++) {
        const p = vertices[i];
        const range = p.distanceToSquared(arm.wrist);
        if (p.z < cut && range < distance) {
          seed = i;
          distance = range;
        }
        if (p.z >= cut) {
          const outward = (p.x - neck.x) * (side === 0 ? -1 : 1);
          mask[i] = THREE.MathUtils.smoothstep(outward, 0.088, 0.218)
            * (1 - THREE.MathUtils.smoothstep(p.z, 1.398, 1.468));
        }
      }
      const queue = [seed];
      mask[seed] = 1;
      for (let i = 0; i < queue.length; i++) {
        for (const neighbour of links[queue[i]]) {
          if (vertices[neighbour].z < cut && mask[neighbour] === 0) {
            mask[neighbour] = 1;
            queue.push(neighbour);
          }
        }
      }
      return mask;
    });

    // Smooth weights across the stitched shoulder on the surface of the mesh.
    for (let i = 0; i < masks.length; i++) {
      for (let pass = 0; pass < 4; pass++) {
        const source = masks[i];
        const next = source.slice();
        for (let v = 0; v < vertices.length; v++) {
          if (vertices[v].z < 1.22 || vertices[v].z > 1.49 || !links[v].size) continue;
          let sum = 0;
          for (const neighbour of links[v]) sum += source[neighbour];
          next[v] = 0.55 * source[v] + 0.45 * sum / links[v].size;
        }
        masks[i] = next;
      }
    }
    return masks;
  }

  const masks = armWeights();
  const skinIndices = new Uint16Array(vertices.length * 4);
  const skinWeights = new Float32Array(vertices.length * 4);
  [left, right].forEach(arm => {
    arm.wristDirection = arm.lowerDir.clone().normalize();
    arm.elbowDirection = arm.upperDir.clone().normalize().add(arm.wristDirection).normalize();
  });
  const delta = new THREE.Vector3();
  for (let i = 0; i < vertices.length; i++) {
    const point = vertices[i];
    const side = masks[0][i] >= masks[1][i] ? 0 : 1;
    const arm = side === 0 ? left : right;
    const armWeight = masks[side][i];
    const headWeight = THREE.MathUtils.smoothstep(point.z, 1.448, 1.53) * (1 - armWeight);
    const elbowBlend = THREE.MathUtils.smoothstep(delta.subVectors(point, arm.elbow).dot(arm.elbowDirection), -0.065, 0.07);
    const wristBlend = THREE.MathUtils.smoothstep(delta.subVectors(point, arm.wrist).dot(arm.wristDirection), -0.045, 0.037);
    const upper = 2 + side * 3;
    const weights = [
      [0, 1 - headWeight - armWeight], [1, headWeight],
      [upper, armWeight * (1 - elbowBlend)], [upper + 1, armWeight * elbowBlend * (1 - wristBlend)],
      [upper + 2, armWeight * elbowBlend * wristBlend]
    ].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = weights.reduce((sum, weight) => sum + weight[1], 0);
    for (const [j, [index, weight]] of weights.entries()) {
      skinIndices[i * 4 + j] = index;
      skinWeights[i * 4 + j] = weight / total;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({
    color: new THREE.Color("#b4b7be").convertSRGBToLinear(), roughness: 0.83, skinning: true
  }));
  mesh.frustumCulled = false;
  mesh.add(...bones);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.scale.setScalar(scale);

  const headBindInverse = headMount.clone().invert();
  const wristBindInverse = wristMount.clone().invert();
  const foreheadFromNeck = headAnchor.clone().sub(neck);
  const worldToBody = new THREE.Quaternion();

  function fitArm(arm, pose) {
    if (!pose) {
      arm.upper.quaternion.copy(arm.upperBind);
      arm.lower.position.copy(arm.elbow);
      arm.lower.quaternion.copy(arm.lowerBind);
      arm.hand.position.copy(arm.wrist);
      arm.hand.quaternion.copy(wristMount);
      arm.upper.scale.y = arm.lower.scale.y = 1;
      return;
    }
    const handRotation = worldToBody.clone().multiply(pose.quaternion);
    const handDelta = handRotation.clone().multiply(wristBindInverse);
    const wrist = pose.position.clone().sub(mesh.position).applyQuaternion(worldToBody).divideScalar(scale)
      .sub(arm.anchorOffset.clone().applyQuaternion(handDelta));
    const direction = wrist.clone().sub(arm.shoulder);
    const distance = Math.max(direction.length(), 0.0001);
    direction.normalize();

    const upperLength = arm.upperDir.length();
    const lowerLength = arm.lowerDir.length();
    // A small stretch preserves the attachment if a measured wrist is beyond the avatar's reach.
    const stretch = Math.max(1, distance / (upperLength + lowerLength - 0.015));
    const upperReach = upperLength * stretch;
    const lowerReach = lowerLength * stretch;
    const along = THREE.MathUtils.clamp((upperReach ** 2 - lowerReach ** 2 + distance ** 2) / (2 * distance), -upperReach, upperReach);
    const height = Math.sqrt(Math.max(0, upperReach ** 2 - along ** 2));
    const bend = arm.pole.clone().addScaledVector(direction, -arm.pole.dot(direction));
    if (bend.lengthSq() < 1e-6) bend.copy(across).addScaledVector(direction, -direction.x);
    bend.normalize();
    const elbow = arm.shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    const upper = elbow.clone().sub(arm.shoulder);
    const lower = wrist.clone().sub(elbow);
    const normal = bend.cross(direction).normalize();

    arm.upper.quaternion.copy(boneFrame(upper, normal));
    arm.upper.scale.y = upper.length() / upperLength;
    arm.lower.position.copy(elbow);
    arm.lower.quaternion.copy(boneFrame(lower, normal));
    arm.lower.scale.y = lower.length() / lowerLength;
    arm.hand.position.copy(wrist);
    arm.hand.quaternion.copy(handRotation);
  }

  function update(headPose, leftPose, rightPose) {
    if (!headPose) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const headDelta = headPose.quaternion.clone().multiply(headBindInverse);
    const horizontal = across.clone().applyQuaternion(headDelta);
    mesh.quaternion.setFromAxisAngle(up, Math.atan2(horizontal.y, horizontal.x));
    worldToBody.copy(mesh.quaternion).invert();
    mesh.position.copy(headPose.position)
      .addScaledVector(foreheadFromNeck.clone().applyQuaternion(headDelta), -scale)
      .addScaledVector(neck.clone().applyQuaternion(mesh.quaternion), -scale);
    head.quaternion.copy(worldToBody).multiply(headPose.quaternion);
    fitArm(left, leftPose);
    fitArm(right, rightPose);
  }

  mesh.visible = false;
  return { mesh, update };
}
