"use strict";

// Image coordinates and extrinsics stay in OpenCV's right-handed convention here.
function calibrationPose(rig, camera) {
  const [x, y, z] = camera.t.map(value => value * (rig.inputUnit === "m" ? 1000 : 1));
  const R = camera.R;
  const pose = new THREE.Matrix4().set(
    ...R[0], x,
    ...R[1], y,
    ...R[2], z,
    0, 0, 0, 1
  );
  return rig.poseConvention === "reference-to-camera" ? pose.invert() : pose;
}

function makeUnprojector(camera) {
  const [fx, fy, cx, cy] = camera.K;
  if (camera.model === "SEUCM") {
    const [alpha, beta] = camera.D;
    const boundaryTerm = (2 * alpha - 1) * beta;
    const maxRadius = boundaryTerm > 0 ? 1 / Math.sqrt(boundaryTerm) : Infinity;
    return (u, v, clip = false) => {
      let x = (u - cx) / fx;
      let y = (v - cy) / fy;
      const r = Math.hypot(x, y);
      if (r > maxRadius) {
        if (!clip) return null;
        const scale = maxRadius / r;
        x *= scale;
        y *= scale;
      }
      const r2 = x * x + y * y;
      const discriminant = Math.max(0, 1 - boundaryTerm * r2);
      const z = (1 - alpha * alpha * beta * r2) /
        (alpha * Math.sqrt(discriminant) + 1 - alpha);
      return new THREE.Vector3(x, y, z).normalize();
    };
  }

  const [k1, k2, k3, k4] = camera.D;
  const radius = theta => {
    const t2 = theta * theta;
    return theta * (1 + t2 * (k1 + t2 * (k2 + t2 * (k3 + t2 * k4))));
  };
  const derivative = theta => {
    const t2 = theta * theta;
    return 1 + t2 * (3 * k1 + t2 * (5 * k2 + t2 * (7 * k3 + t2 * 9 * k4)));
  };

  // Invert only the branch connected to the optical axis.
  let limit = Math.PI;
  for (let step = 1; step <= 256; step++) {
    const angle = Math.PI * step / 256;
    if (derivative(angle) > 0) continue;
    let low = Math.PI * (step - 1) / 256;
    let high = angle;
    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2;
      if (derivative(mid) > 0) low = mid;
      else high = mid;
    }
    limit = low;
    break;
  }

  const maxRadius = radius(limit);
  return (u, v, clip = false) => {
    const x = (u - cx) / fx;
    const y = (v - cy) / fy;
    const r = Math.hypot(x, y);
    if (r < 1e-12) return new THREE.Vector3(0, 0, 1);
    if (r > maxRadius && !clip) return null;
    const target = Math.min(r, maxRadius);

    let low = 0;
    let high = limit;
    for (let i = 0; i < 36; i++) {
      const theta = (low + high) / 2;
      if (radius(theta) < target) low = theta;
      else high = theta;
    }
    const theta = (low + high) / 2;
    const scale = Math.sin(theta) / r;
    return new THREE.Vector3(x * scale, y * scale, Math.cos(theta));
  };
}

function calibratedFov(camera, unproject) {
  const [width, height] = camera.size;
  const [, , cx, cy] = camera.K;
  const signedAngle = (ray, axis) => ray ? Math.atan2(ray[axis], ray.z) : NaN;
  return [
    signedAngle(unproject(width - 1, cy), "x") - signedAngle(unproject(0, cy), "x"),
    signedAngle(unproject(cx, height - 1), "y") - signedAngle(unproject(cx, 0), "y")
  ].map(THREE.MathUtils.radToDeg);
}

function sampleImageRays(camera, unproject, columns = 36, rows = 24) {
  const [width, height] = camera.size;
  return Array.from({ length: rows + 1 }, (_, row) =>
    Array.from({ length: columns + 1 }, (_, column) =>
      // The rectangular image can have a corner outside the model's valid radius.
      unproject((width - 1) * column / columns, (height - 1) * row / rows, true)));
}
