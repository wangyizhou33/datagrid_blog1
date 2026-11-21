"use strict";

(async () => {
  const canvas = document.getElementById("viewer");
  let renderer;
  let replay;
  try {
    replay = await loadReplay();
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    const fallback = canvas.cloneNode(false);
    canvas.replaceWith(fallback);
    fallback.width = fallback.clientWidth;
    fallback.height = fallback.clientHeight;
    const ctx = fallback.getContext("2d");
    ctx.fillStyle = "#25262a";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(replay ? "浏览器未能启用 WebGL。" : "无法读取回放数据。", fallback.width / 2, fallback.height / 2);
    console.warn(error);
    return;
  }

  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);

  const devices = [
    { id: "head", label: "头环", mark: "H", tone: "#1d1e21", radius: 0.0025 },
    { id: "left", label: "左手环", mark: "L", tone: "#53555c", radius: 0.0021 },
    { id: "right", label: "右手环", mark: "R", tone: "#858890", radius: 0.0021 }
  ];
  const layers = [
    ...devices.map(device => ({ ...device, visible: true })),
    { id: "body", label: "人体模型", visible: true },
    { id: "slam", label: "SLAM 点", visible: true },
    { id: "matches", label: "跨设备匹配", visible: true },
    { id: "images", label: "相机图像", visible: true },
    { id: "features", label: "2D 特征", visible: true },
    { id: "projection", label: "手环投影", visible: true }
  ];

  const scene = new THREE.Scene();
  const eye = new THREE.PerspectiveCamera(37, 1, 0.005, 40);
  eye.up.set(0, 0, 1);
  const orbit = new THREE.OrbitControls(eye, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.15;
  orbit.minDistance = 0.12;
  orbit.maxDistance = 12;
  orbit.listenToKeyEvents(canvas);

  const data = replay.devices;
  const bounds = new THREE.Box3();
  const trackPoints = [];
  const segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  const jointGeometry = new THREE.SphereGeometry(1, 8, 5);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const poseAxes = [new THREE.Vector3(1, 0, 0), yAxis, new THREE.Vector3(0, 0, 1)];
  const transform = new THREE.Object3D();
  const slam = new THREE.Group();
  const tracks = {};
  const maps = {};
  scene.add(slam);
  const objects = { slam };

  function sceneColor(hex) {
    // Three.js r128 expects linear colors when sRGB output is enabled.
    return new THREE.Color(hex).convertSRGBToLinear();
  }

  const axisMaterials = POSE_AXIS_COLORS.map(color => new THREE.MeshBasicMaterial({
    color: sceneColor(color), depthTest: false, depthWrite: false, transparent: true
  }));
  const axisShaft = new THREE.CylinderGeometry(0.0029, 0.0029, 0.066, 10);
  const axisTip = new THREE.ConeGeometry(0.006, 0.016, 10);

  function upperBound(rows, time, key = row => row) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (key(rows[mid]) <= time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  const poseTime = row => row[0];

  function setSegment(start, end, radius) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    if (length <= 1e-7) return false;
    transform.position.copy(start).add(end).multiplyScalar(0.5);
    transform.quaternion.setFromUnitVectors(yAxis, direction.multiplyScalar(1 / length));
    transform.scale.set(radius, length, radius);
    transform.updateMatrix();
    return true;
  }

  function makeTrack(rows, points, style) {
    const material = new THREE.MeshBasicMaterial({ color: sceneColor(style.tone) });
    const wires = new THREE.InstancedMesh(segmentGeometry, material, points.length - 1);
    const joints = new THREE.InstancedMesh(jointGeometry, material, points.length);
    const segmentTimes = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      bounds.expandByPoint(p);
      transform.position.copy(p);
      transform.quaternion.identity();
      transform.scale.setScalar(style.radius);
      transform.updateMatrix();
      joints.setMatrixAt(i, transform.matrix);
      if (i > 0 && setSegment(points[i - 1], p, style.radius)) {
        wires.setMatrixAt(segmentTimes.length, transform.matrix);
        segmentTimes.push(rows[i][0]);
      }
    }
    const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({
      color: sceneColor(style.tone), transparent: true, opacity: 0.32, depthWrite: false
    }));
    const partial = new THREE.Mesh(segmentGeometry, material);
    const marker = makeMarker(style);
    partial.matrixAutoUpdate = false;
    const group = new THREE.Group();
    group.add(path, wires, joints, partial, marker.group);
    wires.count = 0;
    joints.count = 0;
    marker.group.visible = false;
    partial.visible = false;
    return { group, rows, points, wires, joints, segmentTimes, partial, marker, radius: style.radius };
  }

  function makeMarker(style) {
    const rig = new THREE.Group();
    const color = sceneColor(style.tone);
    const material = new THREE.MeshBasicMaterial({ color });
    const center = new THREE.Mesh(jointGeometry, material);
    center.scale.setScalar(0.007);
    rig.add(center);
    for (const [index, axis] of poseAxes.entries()) {
      const shaft = new THREE.Mesh(axisShaft, axisMaterials[index]);
      const tip = new THREE.Mesh(axisTip, axisMaterials[index]);
      shaft.position.copy(axis).multiplyScalar(0.035);
      tip.position.copy(axis).multiplyScalar(0.076);
      shaft.quaternion.setFromUnitVectors(yAxis, axis);
      tip.quaternion.copy(shaft.quaternion);
      shaft.renderOrder = tip.renderOrder = 7;
      rig.add(shaft, tip);
    }

    const bitmap = document.createElement("canvas");
    bitmap.width = 64;
    bitmap.height = 64;
    const ctx = bitmap.getContext("2d");
    ctx.beginPath();
    ctx.roundRect(6, 6, 52, 52, 16);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = style.tone;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = style.tone;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 31px -apple-system, Helvetica, sans-serif";
    ctx.fillText(style.mark, 32, 33);
    const texture = new THREE.CanvasTexture(bitmap);
    texture.encoding = THREE.sRGBEncoding;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, sizeAttenuation: false, depthTest: false, depthWrite: false
    }));
    label.renderOrder = 8;

    const group = new THREE.Group();
    group.add(rig, label);
    return { group, rig, label };
  }

  function samplePose(track, time, result, count = upperBound(track.rows, time, poseTime)) {
    const { rows, points } = track;
    if (!count || time > rows.at(-1)[0] + 1e-6) return null;
    const pose = result ?? { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    const before = rows[count - 1];
    const after = rows[count] ?? before;
    const fraction = after[0] > before[0] ? (time - before[0]) / (after[0] - before[0]) : 0;
    pose.position.copy(points[count - 1]).lerp(points[count] ?? points[count - 1], fraction);
    pose.quaternion.fromArray(before, 4).normalize()
      .slerp(new THREE.Quaternion().fromArray(after, 4).normalize(), fraction);
    return pose;
  }

  function updateTrack(track, time) {
    const { rows, points, wires, joints, segmentTimes, partial, marker, radius } = track;
    const count = upperBound(rows, time, poseTime);
    wires.count = upperBound(segmentTimes, time);
    joints.count = count;
    partial.visible = false;
    marker.group.visible = Boolean(samplePose(track, time, marker.rig, count));
    if (!marker.group.visible) return;

    marker.label.position.copy(marker.rig.position);
    marker.label.position.z += 0.032;
    partial.visible = setSegment(points[count - 1], marker.rig.position, radius);
    if (partial.visible) {
      partial.matrix.copy(transform.matrix);
      partial.matrixWorldNeedsUpdate = true;
    }
  }

  function circleTexture() {
    const bitmap = document.createElement("canvas");
    bitmap.width = bitmap.height = 32;
    const ctx = bitmap.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fill();
    return new THREE.CanvasTexture(bitmap);
  }

  const pointTexture = circleTexture();
  function pointLayer(geometry, { color, size, opacity }) {
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: sceneColor(color), size, opacity, sizeAttenuation: false, map: pointTexture, transparent: true, depthWrite: false
    }));
    points.frustumCulled = false;
    return points;
  }

  function makePointBuffer(capacity) {
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positions);
    geometry.setDrawRange(0, 0);
    return { geometry, positions };
  }

  function updateMap(map, time) {
    const count = upperBound(map.stream.times, time);
    if (count === map.count) return;
    if (count < map.count) {
      map.points.clear();
      map.count = 0;
    }
    for (; map.count < count; map.count++) {
      const sample = map.stream.sample(map.count);
      for (let i = 0; i < sample.length; i += 4) {
        map.points.set(sample[i], [sample[i + 1], sample[i + 2], sample[i + 3]]);
      }
    }
    let index = 0;
    for (const point of map.points.values()) map.positions.setXYZ(index++, ...point);
    map.geometry.setDrawRange(0, index);
    map.positions.needsUpdate = true;
  }

  function makeGrid() {
    const grid = new THREE.Group();
    const main = [];
    const minor = [];
    const limit = 1.5;
    for (let i = -30; i <= 30; i++) {
      const offset = i * 0.05;
      const lines = i % 2 === 0 ? main : minor;
      lines.push(-limit, offset, 0, limit, offset, 0, offset, -limit, 0, offset, limit, 0);
    }
    for (const [positions, opacity] of [[main, 0.46], [minor, 0.24]]) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      grid.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: sceneColor("#858992"), transparent: true, opacity, depthWrite: false
      })));
    }
    return grid;
  }

  const mapColors = { head: "#087fac", left: "#398d2b", right: "#a23493" };
  for (const device of devices) {
    const source = data[device.id];
    const points = source.trajectory.map(row => new THREE.Vector3().fromArray(row, 1));
    trackPoints.push(...points);
    const track = makeTrack(source.trajectory, points, device);
    tracks[device.id] = track;
    scene.add(track.group);
    objects[device.id] = track.group;
    const map = makePointBuffer(source.slam.offsets.at(-1));
    maps[device.id] = { ...map, stream: source.slam, points: new Map(), count: 0 };
    slam.add(pointLayer(map.geometry, { color: mapColors[device.id], size: 4.7, opacity: 0.93 }));
  }
  const matches = new THREE.Group();
  const matchBuffers = [];
  const matchCapacity = Math.max(...replay.times.map((_, frame) => replay.landmarks(frame).length / 4));
  for (const mask of [1, 2, 3]) {
    const buffer = makePointBuffer(matchCapacity);
    matchBuffers[mask] = buffer;
    matches.add(pointLayer(buffer.geometry, { color: "#444650", size: 7.3, opacity: 0.95 }));
    matches.add(pointLayer(buffer.geometry, { color: MATCH_COLORS[mask], size: 5.1, opacity: 1 }));
  }
  scene.add(matches);
  objects.matches = matches;
  const mannequin = createTrackedMannequin();
  const body = new THREE.Group();
  body.add(mannequin.mesh);
  objects.body = body;
  scene.add(body, new THREE.HemisphereLight(0xf9fafb, 0xa0a3ab, 0.77));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(-2, 4, 5);
  const rim = new THREE.DirectionalLight(0xf8f9fc, 0.34);
  rim.position.set(3, -4, 2);
  const grid = makeGrid();
  const firstHead = data.head.trajectory[0];
  mannequin.update({
    position: new THREE.Vector3().fromArray(firstHead, 1),
    quaternion: new THREE.Quaternion().fromArray(firstHead, 4).normalize()
  }, null, null);
  const modelOrigin = mannequin.mesh.position.clone();
  const modelFloor = modelOrigin.z;
  mannequin.mesh.visible = false;
  grid.position.z = modelFloor;
  scene.add(grid, key, rim);

  const wristDevices = devices.filter(device => device.id !== "head");
  const projectedAxes = poseAxes.map(axis => axis.clone().multiplyScalar(0.1));

  function wristProjections({ device: cameraDevice, calibration: camera, times }, index) {
    // The replay uses nearest camera frames. Evaluate both poses at the image's capture time.
    const time = times[index];
    if (time === null) return [];
    const observer = samplePose(tracks[cameraDevice], time);
    if (!observer) return [];
    const worldToBody = observer.quaternion.clone().invert();
    const bodyToCamera = new THREE.Matrix3().set(...camera.R_camera_body);
    const translation = new THREE.Vector3(...camera.p_body_camera);
    const [fx, fy, cx, cy, k1, k2, k3, k4] = camera.intrinsics;

    // The bundled cameras use equidistant fisheye intrinsics in processing pixels.
    function project(worldPoint) {
      const { x, y, z } = worldPoint.clone().sub(observer.position).applyQuaternion(worldToBody)
        .applyMatrix3(bodyToCamera).add(translation);
      if (z <= 1e-8) return null;
      const radius = Math.hypot(x, y);
      if (radius <= 1e-12) return [cx, cy];
      const theta = Math.atan2(radius, z);
      const t2 = theta * theta;
      const distortion = theta * (1 + t2 * (k1 + t2 * (k2 + t2 * (k3 + t2 * k4)))) / radius;
      return [cx + fx * x * distortion, cy + fy * y * distortion];
    }

    return wristDevices.flatMap(device => {
      if (device.id === cameraDevice) return [];
      const target = samplePose(tracks[device.id], time);
      if (!target) return [];
      const { position, quaternion } = target;
      const origin = project(position);
      if (!origin || origin[0] < 0 || origin[0] >= camera.width || origin[1] < 0 || origin[1] >= camera.height) return [];
      const ends = projectedAxes.map(axis => project(axis.clone().applyQuaternion(quaternion).add(position)));
      return [{ origin, ends, label: device.mark }];
    });
  }

  const cameras = replay.cameras.map(entry => ({ ...entry, projections: [],
    label: `${devices.find(device => device.id === entry.device).label} · ${entry.calibration.camera_id}` }));

  let activeFrame = -1;
  function useFrame(index) {
    if (activeFrame === index) return;
    activeFrame = index;
    const time = replay.times[index];
    for (const device of devices) {
      updateTrack(tracks[device.id], time);
      updateMap(maps[device.id], time);
    }
    const pose = id => tracks[id].marker.group.visible ? tracks[id].marker.rig : null;
    mannequin.update(pose("head"), pose("left"), pose("right"));
    const counts = [0, 0, 0, 0];
    const worldPoints = replay.landmarks(index);
    for (let i = 0; i < worldPoints.length; i += 4) {
      const mask = worldPoints[i + 3];
      matchBuffers[mask].positions.setXYZ(counts[mask]++, worldPoints[i], worldPoints[i + 1], worldPoints[i + 2]);
    }
    for (const mask of [1, 2, 3]) {
      const { geometry, positions } = matchBuffers[mask];
      geometry.setDrawRange(0, counts[mask]);
      positions.needsUpdate = true;
    }
    for (const entry of cameras) entry.projections = wristProjections(entry, index);
  }

  let width = 1;
  let height = 1;
  let viewArea;
  let pending = 0;
  let overlayDirty = true;
  let moved = false;
  let focus = null;
  let hover = null;
  let hudPointer = null;
  let hudTouch = false;
  const playback = createPlayback(replay, useFrame, invalidateOverlay);
  const overlay = createOverlay(layers, cameras, playback);
  const controls = [...layers, ...overlay.controls];
  const keyboardHelp = "拖动旋转，滚轮缩放，右键平移。空格播放或暂停。Tab 选择控件。";

  function queueFrame() {
    if (!pending) pending = requestAnimationFrame(render);
  }

  function invalidateOverlay() {
    overlayDirty = true;
    queueFrame();
  }

  function render() {
    pending = 0;
    if (overlayDirty) {
      overlay.draw(hover, focus);
      overlayDirty = false;
    }
    orbit.update();
    renderer.clear();
    renderer.render(scene, eye);
    renderer.render(overlay.scene, overlay.camera);
  }

  function fitCamera(area) {
    const samples = trackPoints.slice();
    const fitBounds = bounds.clone();
    if (body.visible) {
      for (const [x, y, z] of [[-0.3, -0.24, 1.8], [0.32, 0.04, 1.8], [0, 0.32, 1.77],
        [-0.21, -0.22, -0.035], [0.24, 0.23, -0.035]]) {
        const sample = new THREE.Vector3(x, y, z).multiplyScalar(mannequin.mesh.scale.x).add(modelOrigin);
        samples.push(sample);
        fitBounds.expandByPoint(sample);
      }
    }
    const center = fitBounds.getCenter(new THREE.Vector3());
    const azimuth = THREE.MathUtils.degToRad(body.visible ? 62 : -105);
    const elevation = THREE.MathUtils.degToRad(body.visible ? 17 : 34);
    const back = new THREE.Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation));
    const right = new THREE.Vector3().crossVectors(eye.up, back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    const vertical = Math.tan(THREE.MathUtils.degToRad(eye.fov / 2));
    const fitX = vertical * area.w / height * 0.70;
    const fitY = vertical * area.h / height * (body.visible ? 0.85 : 0.67);
    let distance = 0.55;
    const point = new THREE.Vector3();
    for (const sample of samples) {
      point.subVectors(sample, center);
      const clearance = Math.max(Math.abs(point.dot(right)) / fitX, Math.abs(point.dot(up)) / fitY);
      distance = Math.max(distance, point.dot(back) + clearance);
    }
    orbit.target.copy(center);
    eye.position.copy(center).addScaledVector(back, distance);
    orbit.update();
  }

  function frameViewport() {
    viewArea = overlay.viewArea();
    eye.setViewOffset(width, height, width / 2 - viewArea.x - viewArea.w / 2,
      height / 2 - viewArea.y - viewArea.h / 2, width, height);
    if (!moved) fitCamera(viewArea);
  }

  function resize() {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    overlay.resize(width, height, ratio);
    const labelScale = 27 * 2 * Math.tan(THREE.MathUtils.degToRad(eye.fov / 2)) / height;
    for (const track of Object.values(tracks)) track.marker.label.scale.set(labelScale, labelScale, 1);
    frameViewport();
    invalidateOverlay();
  }

  function setFocus(control) {
    focus = control;
    let title = control?.label ?? "跨设备定位三维视图";
    if (control?.id === "play") title = playback.video.paused ? "播放" : "暂停";
    if (control?.id === "seek") title += `，${playback.displayTime().toFixed(1)} 秒，共 ${playback.duration.toFixed(1)} 秒`;
    if (control?.visible !== undefined) title += control.visible ? "，开启" : "，关闭";
    canvas.setAttribute("aria-label", `${title}。${keyboardHelp}`);
    invalidateOverlay();
  }

  function toggle(layer) {
    layer.visible = !layer.visible;
    if (objects[layer.id]) objects[layer.id].visible = layer.visible;
    if (layer.id === "body") {
      grid.position.z = layer.visible ? modelFloor : bounds.min.z - 0.045;
      if (!moved) fitCamera(viewArea);
    }
    if (layer.id === "images") frameViewport();
    setFocus(layer);
  }

  function activate(control) {
    if (control.id === "play") {
      playback.toggle();
      setFocus(control);
    } else if (control.id !== "seek") toggle(control);
  }

  function coords(event) {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  canvas.addEventListener("pointerdown", event => {
    const position = coords(event);
    if (!overlay.blocks(...position)) {
      if (focus) setFocus(null);
      return;
    }
    stop(event);
    if (!event.isPrimary || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    const control = overlay.hit(...position);
    hudPointer = { id: event.pointerId, control };
    canvas.setPointerCapture(event.pointerId);
    if (control?.id === "seek") {
      setFocus(control);
      playback.beginScrub();
      playback.seekFraction(overlay.fraction(position[0]));
    }
  }, true);

  canvas.addEventListener("pointermove", event => {
    if (!event.isPrimary) return;
    const position = coords(event);
    const layer = overlay.hit(...position);
    if (hover !== layer) {
      hover = layer;
      invalidateOverlay();
    }
    canvas.style.cursor = layer ? "pointer" : overlay.blocks(...position) ? "default" : "";
    if (hudPointer?.id === event.pointerId) {
      if (hudPointer.control?.id === "seek") playback.seekFraction(overlay.fraction(position[0]));
      stop(event);
    }
  }, true);

  function finishPointer(event) {
    if (hudPointer?.id !== event.pointerId) return;
    const { control } = hudPointer;
    hudPointer = null;
    if (control?.id === "seek") {
      if (event.type === "pointerup") playback.seekFraction(overlay.fraction(coords(event)[0]));
      playback.endScrub();
      setFocus(control);
    } else if (event.type === "pointerup" && control && control === overlay.hit(...coords(event))) {
      activate(control);
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    stop(event);
  }
  canvas.addEventListener("pointerup", finishPointer, true);
  canvas.addEventListener("pointercancel", finishPointer, true);
  canvas.addEventListener("lostpointercapture", event => {
    if (hudPointer?.id !== event.pointerId) return;
    if (hudPointer.control?.id === "seek") playback.endScrub();
    hudPointer = null;
  });
  canvas.addEventListener("pointerleave", () => {
    if (!hover) return;
    hover = null;
    invalidateOverlay();
  });
  canvas.addEventListener("wheel", event => {
    if (overlay.blocks(...coords(event))) stop(event);
  }, { capture: true, passive: false });

  // This version of OrbitControls handles touch events alongside mouse pointer events.
  function guardTouch(event) {
    if (event.type === "touchstart" && event.touches.length === event.changedTouches.length) {
      hudTouch = overlay.blocks(...coords(event.touches[0]));
    }
    if (hudTouch) stop(event);
    if (!event.touches.length) hudTouch = false;
  }
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
    canvas.addEventListener(type, guardTouch, { capture: true, passive: false });
  }

  canvas.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      const next = focus ? controls[controls.indexOf(focus) + (event.shiftKey ? -1 : 1)]
        : controls[event.shiftKey ? controls.length - 1 : 0];
      if (next) {
        event.preventDefault();
        setFocus(next);
      }
    } else if (event.key === " ") {
      event.preventDefault();
      if (!event.repeat) {
        playback.toggle();
        if (focus?.id === "play") setFocus(focus);
      }
    } else if (focus && event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat) activate(focus);
    } else if (focus?.id === "seek" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      stop(event);
      playback.step(event.key === "ArrowLeft" ? -1 : 1);
      setFocus(focus);
    }
  }, true);
  canvas.addEventListener("blur", () => setFocus(null));
  canvas.addEventListener("webglcontextrestored", invalidateOverlay);
  orbit.addEventListener("start", () => { moved = true; });
  orbit.addEventListener("change", queueFrame);
  window.addEventListener("resize", resize);
  setFocus(null);
  resize();
})();
