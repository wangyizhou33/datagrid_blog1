"use strict";

const RIG_COLORS = ["#2675dc", "#008f79", "#7651d4", "#c77622", "#bc4481", "#898117"];

function createRigScene() {
  const scene = new THREE.Scene();
  const displayTransform = new THREE.Matrix4().makeScale(1, -1, -1);
  const axisColors = ["#c22d47", "#107749", "#225fcc"];
  const mannequin = createMannequin();
  const fullBodyBounds = new THREE.Box3(
    new THREE.Vector3(-440, 0, -595), new THREE.Vector3(440, 1775, 195)
  );

  const guide = floorGuide();
  scene.add(mannequin, floorGrid(), guide);
  scene.add(new THREE.HemisphereLight(0xf7faff, 0x889caf, 0.72));
  const key = new THREE.DirectionalLight(0xf9fcff, 0.86);
  key.position.set(-2, 5, -4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcbdfff, 0.28);
  rim.position.set(4, 2, 3.5);
  scene.add(rim);

  let root;
  let modules = [];
  let selected;
  let showAxes = false;

  function floorGrid() {
    const group = new THREE.Group();
    const radius = 3750;
    for (const major of [false, true]) {
      const positions = [];
      const half = major ? 2.1 : 1.2;
      function strip(x0, z0, x1, z1) {
        positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1);
        positions.push(x0, 0, z0, x1, 0, z1, x0, 0, z1);
      }
      for (let offset = -radius; offset <= radius; offset += 250) {
        if ((offset % 1000 === 0) !== major) continue;
        strip(offset - half, -radius, offset + half, radius);
        strip(-radius, offset - half, radius, offset + half);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.MeshBasicMaterial({
        color: major ? 0x384a61 : 0x4d617a,
        opacity: major ? 0.78 : 0.62,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      material.onBeforeCompile = shader => {
        shader.vertexShader = "varying vec2 gridPosition;\n" + shader.vertexShader.replace(
          "#include <begin_vertex>", "#include <begin_vertex>\ngridPosition = position.xz;"
        );
        shader.fragmentShader = "varying vec2 gridPosition;\n" + shader.fragmentShader.replace(
          "#include <alphatest_fragment>",
          "diffuseColor.a *= 1.0 - smoothstep(1600.0, 4100.0, length(gridPosition));"
        );
      };
      group.add(new THREE.Mesh(geometry, material));
    }

    const shade = document.createElement("canvas");
    shade.width = shade.height = 96;
    const pen = shade.getContext("2d");
    const gradient = pen.createRadialGradient(48, 48, 3, 48, 48, 47);
    gradient.addColorStop(0, "rgba(45,64,91,.24)");
    gradient.addColorStop(1, "rgba(45,64,91,0)");
    pen.fillStyle = gradient;
    pen.fillRect(0, 0, 96, 96);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(660, 520),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shade), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(12, 0.25, -162);
    group.add(shadow);
    return group;
  }

  function floorGuide() {
    const group = new THREE.Group();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ dashSize: 44, gapSize: 25, transparent: true, opacity: 0.7, depthWrite: false })
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(18, 22, 32),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.84, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(line, ring);
    group.visible = false;
    return group;
  }

  function updateFloorGuide(state) {
    const frame = modules.find(module => module.id === "head")?.frames.find(entry => entry.camera === selected);
    guide.visible = false;
    if (!state.fov || !frame) return;
    const origin = frame.hit.getWorldPosition(new THREE.Vector3());
    const axis = new THREE.Vector3(0, 0, 1).transformDirection(frame.hit.matrixWorld);
    if (axis.y >= -0.28) return;
    const landing = origin.clone().addScaledVector(axis, (1 - origin.y) / axis.y);
    const [line, ring] = guide.children;
    line.material.color.set(selected.color);
    line.geometry.setFromPoints([origin, landing]);
    line.geometry.computeBoundingSphere();
    line.computeLineDistances();
    ring.material.color.set(selected.color);
    ring.position.copy(landing);
    guide.visible = true;
  }

  function cameraEntry(camera, module, index) {
    const unproject = makeUnprojector(camera);
    const pose = calibrationPose(module, camera);
    const colorOffset = module.id === "head" ? 0 : module.id === "left" ? 1 : 2;
    return {
      ...camera, module, pose,
      color: RIG_COLORS[(index + colorOffset) % RIG_COLORS.length],
      fov: calibratedFov(camera, unproject),
      rays: sampleImageRays(camera, unproject),
      position: new THREE.Vector3().setFromMatrixPosition(pose),
      axis: new THREE.Vector3(0, 0, 1).transformDirection(pose)
    };
  }
  function line(points, color, opacity = 1) {
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1, depthWrite: false })
    );
  }

  function depthMaterial(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
  }

  function makeAxes() {
    const arrows = new THREE.Group();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 3; i++) {
      const direction = new THREE.Vector3().setComponent(i, 1);
      const arrow = new THREE.Group();
      arrow.quaternion.setFromUnitVectors(up, direction);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(axisColors[i]).convertSRGBToLinear(),
        transparent: true, opacity: 0.97, depthTest: false, depthWrite: false
      });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.79, 12), material);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.061, 0.21, 16), material);
      shaft.position.y = 0.395;
      tip.position.y = 0.895;
      shaft.renderOrder = tip.renderOrder = 6;
      arrow.add(shaft, tip);
      arrows.add(arrow);
    }
    return arrows;
  }

  function buildField(entry, range) {
    const field = new THREE.Group();
    const origin = new THREE.Vector3();
    const rays = entry.rays.map(row => row.map(ray => ray?.clone().multiplyScalar(range)));
    const boundary = [
      ...rays[0],
      ...rays.slice(1).map(row => row.at(-1)),
      ...rays.at(-1).slice(0, -1).reverse(),
      ...rays.slice(1, -1).reverse().map(row => row[0])
    ];
    const capVertices = [];
    const sideVertices = [];
    const addTriangle = (vertices, a, b, c) => {
      if (a && b && c) vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    };
    for (let row = 1; row < rays.length; row++) {
      for (let col = 1; col < rays[row].length; col++) {
        const a = rays[row - 1][col - 1];
        const b = rays[row - 1][col];
        const c = rays[row][col - 1];
        const d = rays[row][col];
        addTriangle(capVertices, a, b, c);
        addTriangle(capVertices, b, d, c);
      }
    }

    const rimVertices = [];
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i];
      const b = boundary[(i + 1) % boundary.length];
      if (!a || !b) continue;
      addTriangle(sideVertices, origin, a, b);
      rimVertices.push(...a.toArray(), ...b.toArray());
    }
    function geometry(vertices) {
      const buffer = new THREE.BufferGeometry();
      buffer.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      return buffer;
    }
    const cap = new THREE.Mesh(geometry(capVertices), depthMaterial(entry.color, 0.075));
    const side = new THREE.Mesh(geometry(sideVertices), depthMaterial(entry.color, 0.095));
    const rim = new THREE.LineSegments(
      geometry(rimVertices),
      new THREE.LineBasicMaterial({ color: entry.color, transparent: true, opacity: 0.72, depthWrite: false })
    );
    const cornerIndices = [0, rays[0].length - 1, rays[0].length + rays.length - 2, 2 * rays[0].length + rays.length - 3];
    const corners = cornerIndices.map(index => line([origin, boundary[index]], entry.color, 0.43));
    // Image midlines help show the curved focal surface on wide-angle lenses.
    const middleRows = [rays[Math.floor(rays.length / 2)], rays.map(row => row[Math.floor(row.length / 2)])];
    const midlines = middleRows.map(points => line(points, entry.color, 0.17));
    field.add(side, cap, rim, ...corners, ...midlines);
    return { field, cap, side, rim, corners, midlines };
  }

  function buildCamera(group, entry, range, size) {
    const frame = new THREE.Group();
    frame.matrix.copy(displayTransform).multiply(entry.pose);
    frame.matrixAutoUpdate = false;

    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(size * 1.65, size * 1.33, size * 0.67),
      new THREE.MeshStandardMaterial({ color: 0x293746, metalness: 0.26, roughness: 0.47 })
    );
    housing.position.z = -size * 0.42;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(housing.geometry),
      new THREE.LineBasicMaterial({ color: 0x778599, transparent: true, opacity: 0.85 })
    );
    housing.add(edge);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.42, size * 0.48, size * 0.43, 24),
      new THREE.MeshStandardMaterial({ color: 0x1d2637, metalness: 0.40, roughness: 0.32 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -size * 0.16;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.36, size * 0.037, 8, 28),
      new THREE.MeshBasicMaterial({ color: entry.color })
    );
    ring.position.z = size * 0.075;
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.28, 20, 12),
      new THREE.MeshStandardMaterial({ color: entry.color, emissive: entry.color, emissiveIntensity: 0.21, metalness: 0.64, roughness: 0.23 })
    );
    glass.scale.z = 0.4;
    glass.position.z = -size * 0.025;

    const opticalAxis = line([new THREE.Vector3(0, 0, size * 0.1), new THREE.Vector3(0, 0, range * 0.86)], entry.color, 0.68);
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.9, 10, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.userData.camera = entry;
    const fieldParts = buildField(entry, range);
    frame.add(housing, lens, ring, glass, opticalAxis, hit, fieldParts.field);
    group.add(frame);

    return { camera: entry, hit, ring, opticalAxis, ...fieldParts };
  }

  function mountModule(module) {
    const entries = module.cameras.map((camera, index) => cameraEntry(camera, module, index));
    const centers = entries.map(entry => entry.position.clone().applyMatrix4(displayTransform));
    const box = new THREE.Box3().setFromPoints(centers);
    const center = box.getCenter(new THREE.Vector3());
    const isHead = module.id === "head";
    const range = isHead ? 340 : 190;
    const size = isHead ? 17 : entries.length === 1 ? 24 : 15;
    const placement = WEAR_POSE[module.id];
    const anchor = new THREE.Vector3().fromArray(isHead ? placement.anchor : entries.length === 1 ? placement.wrist : placement.finger);
    const group = new THREE.Group();
    group.rotation.x = THREE.MathUtils.degToRad(placement.pitch);
    group.position.copy(anchor).sub(center.clone().applyEuler(group.rotation));
    root.add(group);
    const frames = entries.map(entry => buildCamera(group, entry, range, size));

    const reference = new THREE.Group();
    reference.matrix.copy(displayTransform);
    reference.matrixAutoUpdate = false;
    const deviceAxes = makeAxes();
    deviceAxes.scale.setScalar(isHead ? 177 : 135);
    reference.add(deviceAxes);
    group.add(reference);

    const [leftId, rightId] = module.baseline;
    const left = entries.findIndex(entry => entry.id === leftId);
    const right = entries.findIndex(entry => entry.id === rightId);
    const baseline = left < 0 || right < 0 ? null : centers[left].distanceTo(centers[right]);
    if (baseline !== null) group.add(line([centers[left], centers[right]], 0x435b7a, 0.95));

    group.updateMatrixWorld(true);
    return {
      ...module, deviceAxes, entries, frames, baseline,
      labelPoint: anchor.clone().add(new THREE.Vector3(isHead ? 0 : module.id === "left" ? -78 : 78, isHead ? 113 : 44, -62))
    };
  }

  function load(device) {
    if (root) {
      scene.remove(root);
      const materials = new Set();
      root.traverse(object => {
        object.geometry?.dispose();
        if (object.material) materials.add(object.material);
      });
      for (const material of materials) material.dispose();
    }
    root = new THREE.Group();
    scene.add(root);
    modules = device.modules.map(mountModule);
    return modules;
  }

  function update(state) {
    selected = state.selected;
    showAxes = state.axes;
    mannequin.visible = state.body;
    for (const module of modules) {
      module.deviceAxes.visible = showAxes;
      for (const frame of module.frames) {
        const active = frame.camera === selected;
        frame.field.visible = state.fov;
        frame.cap.material.opacity = active ? 0.27 : 0.035;
        frame.side.material.opacity = active ? 0.19 : 0.023;
        frame.rim.material.opacity = active ? 1 : 0.32;
        for (const corner of frame.corners) corner.material.opacity = active ? 0.67 : 0.14;
        for (const midline of frame.midlines) midline.material.opacity = active ? 0.28 : 0.055;
        for (const part of frame.field.children) part.renderOrder = active ? 3 : 0;
        frame.opticalAxis.material.opacity = active ? 0.97 : 0.22;
        frame.opticalAxis.renderOrder = active ? 4 : 0;
        frame.ring.scale.setScalar(active ? 1.15 : 1);
      }
    }
    updateFloorGuide(state);
  }

  function labels() {
    const output = [];
    for (const module of modules) {
      const active = module.entries.includes(selected);
      output.push({
        text: module.label, point: module.labelPoint, color: active ? selected.color : module.entries[0].color,
        selected: active
      });
      if (showAxes) {
        for (let i = 0; i < 3; i++) output.push({
          text: "XYZ"[i],
          point: module.deviceAxes.localToWorld(new THREE.Vector3().setComponent(i, 1.13)),
          color: axisColors[i],
          kind: "axis",
          key: module.id + "XYZ"[i]
        });
      }
    }
    return output;
  }

  return {
    scene, load, labels, update,
    bounds: () => fullBodyBounds,
    pickables: () => modules.flatMap(module => module.frames.map(frame => frame.hit))
  };
}
