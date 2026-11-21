"use strict";

(() => {
  const canvas = document.getElementById("viewer");
  const keyboardHelp = "Tab 选择画布控件，Enter 启用。拖动旋转，滚轮缩放，右键或方向键平移。";
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    const fallback = canvas.cloneNode(false);
    canvas.replaceWith(fallback);
    fallback.width = window.innerWidth;
    fallback.height = window.innerHeight;
    const ctx = fallback.getContext("2d");
    ctx.fillStyle = "#24374c";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("浏览器未能启用 WebGL。", fallback.width / 2, fallback.height / 2);
    console.warn("Rig Viewer could not start WebGL", error);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);

  const rigScene = createRigScene();
  const gui = createRigGui();
  const eye = new THREE.PerspectiveCamera(36, 1, 2, 30000);
  const orbit = new THREE.OrbitControls(eye, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.16;
  orbit.zoomSpeed = 0.8;
  orbit.listenToKeyEvents(canvas);

  const state = {
    devices: RIG_CALIBRATIONS,
    device: RIG_CALIBRATIONS.find(device => device.id === "ego_mate_ultra"),
    modules: [],
    selected: null,
    fov: true,
    axes: false,
    body: true,
    inspector: window.innerWidth >= 820 && window.innerHeight >= 460,
    sources: false,
    menu: false,
    scroll: 0,
    view: "perspective",
    hover: null,
    focus: null
  };
  const raycaster = new THREE.Raycaster();
  const cursor = new THREE.Vector2();
  let width = 1;
  let height = 1;
  let pending = false;
  let guiDirty = true;
  let placing = false;
  let pointer;
  let suspended = false;

  function queueFrame() {
    if (pending || suspended) return;
    pending = true;
    requestAnimationFrame(render);
  }

  function invalidateGui() {
    guiDirty = true;
    queueFrame();
  }

  function flushGui() {
    if (!guiDirty) return;
    gui.draw(state);
    guiDirty = false;
  }

  function updateAccessibility(text) {
    const label = `${state.device.label} · ${state.selected?.label ?? ""}。`;
    canvas.setAttribute("aria-label", label + (text ? ` ${text}。` : "") + " " + keyboardHelp);
  }

  function configureProjection() {
    const { x, y, w, h } = gui.content();
    eye.setViewOffset(width, height, width / 2 - x - w / 2, height / 2 - y - h / 2, width, height);
    return { w, h };
  }

  function placeEye(view) {
    const bounds = rigScene.bounds();
    const center = bounds.getCenter(new THREE.Vector3());
    const offsets = {
      perspective: [1.75, 1.0, -4.0],
      top: [0, 8, -0.001],
      front: [0, 0.02, -1]
    };
    const back = new THREE.Vector3(...offsets[view]).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
    const up = back.clone().cross(right);
    const { w, h } = configureProjection();
    const halfVertical = Math.tan(THREE.MathUtils.degToRad(eye.fov / 2));
    const fitX = halfVertical * w / height * 0.88;
    const fitY = halfVertical * h / height * 0.96;
    orbit.minDistance = 220;
    orbit.maxDistance = 22000;
    let distance = orbit.minDistance;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          const fit = corner.dot(back) + Math.max(Math.abs(corner.dot(right)) / fitX, Math.abs(corner.dot(up)) / fitY);
          distance = Math.max(distance, fit);
        }
      }
    }

    placing = true;
    orbit.enableDamping = false;
    orbit.update();
    orbit.target.copy(center);
    eye.position.copy(center).addScaledVector(back, distance);
    eye.lookAt(center);
    orbit.update();
    orbit.enableDamping = true;
    placing = false;
    state.view = view;
    invalidateGui();
  }

  function resize() {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    gui.resize(width, height);
    guiDirty = true;
    if (!state.selected) return;
    flushGui();
    if (state.view) placeEye(state.view);
    else configureProjection();
    queueFrame();
  }

  function render() {
    pending = false;
    if (suspended) return;
    flushGui();
    orbit.update();
    renderer.clear();
    renderer.render(rigScene.scene, eye);
    gui.drawLabels(rigScene.labels(), eye);
    renderer.clearDepth();
    renderer.render(gui.scene, gui.camera);
  }

  function selectCamera(entry) {
    state.selected = entry;
    rigScene.update(state);
    updateAccessibility();
    invalidateGui();
  }

  function loadDevice(device) {
    state.device = device;
    document.title = device.label + "｜Rig Viewer";
    state.menu = false;
    state.hover = null;
    state.scroll = 0;
    state.modules = rigScene.load(device);
    selectCamera(state.modules[0].entries[0]);
    flushGui();
    placeEye("perspective");
  }

  function run(id) {
    if (!id) return;
    const [command, value, entryId] = id.split(":");
    if (state.menu && command !== "devices" && command !== "device") state.menu = false;
    switch (command) {
      case "devices": state.menu = !state.menu; break;
      case "device": loadDevice(state.devices.find(device => device.id === value)); break;
      case "entry": {
        const module = state.modules.find(item => item.id === value);
        selectCamera(module.entries.find(item => item.id === entryId));
        break;
      }
      case "view": placeEye(value); break;
      case "fov":
      case "axes":
      case "body":
        state[command] = !state[command];
        rigScene.update(state);
        break;
      case "sources": state.sources = !state.sources; break;
      case "inspector":
        state.inspector = !state.inspector;
        guiDirty = true;
        flushGui();
        configureProjection();
        break;
    }
    invalidateGui();
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function scrollPanel(delta) {
    const next = Math.max(0, Math.min(gui.scrollLimit(), state.scroll + delta));
    if (next === state.scroll) return;
    state.scroll = next;
    invalidateGui();
  }

  canvas.addEventListener("pointerdown", event => {
    if (!event.isPrimary) return;
    flushGui();
    canvas.focus({ preventScroll: true });
    const p = point(event);
    const region = gui.hit(p.x, p.y);
    state.focus = null;
    const blocked = gui.blocked(p.x, p.y);
    pointer = { ...p, id: region?.id, blocked: blocked || state.menu, drawer: gui.inDrawer(p.x, p.y), lastY: p.y };
    if (pointer.blocked) {
      canvas.setPointerCapture(event.pointerId);
      if (state.menu && !region) state.menu = false;
      stop(event);
    }
    invalidateGui();
  }, true);

  canvas.addEventListener("pointermove", event => {
    if (!event.isPrimary) return;
    const p = point(event);
    if (pointer?.blocked) {
      if (pointer.drawer && event.pointerType === "touch") scrollPanel(pointer.lastY - p.y);
      pointer.lastY = p.y;
      stop(event);
    }
    const hover = gui.hit(p.x, p.y)?.id;
    const next = hover ?? null;
    if (state.hover !== next) {
      state.hover = next;
      invalidateGui();
    }
    canvas.style.cursor = hover ? "pointer" : gui.blocked(p.x, p.y) ? "default" : "";
  }, true);

  function finishPointer(event) {
    if (!event.isPrimary || !pointer) return;
    const p = point(event);
    const touch = pointer;
    pointer = null;
    const tap = event.type !== "pointercancel" && Math.hypot(p.x - touch.x, p.y - touch.y) < 6;
    if (touch.blocked) {
      if (tap && event.button === 0 && touch.id && gui.hit(p.x, p.y)?.id === touch.id) run(touch.id);
      stop(event);
    } else if (tap && event.button === 0) {
      cursor.set(2 * p.x / width - 1, 1 - 2 * p.y / height);
      raycaster.setFromCamera(cursor, eye);
      const hits = raycaster.intersectObjects(rigScene.pickables());
      if (hits.length) selectCamera(hits[0].object.userData.camera);
    }
  }

  canvas.addEventListener("pointerup", finishPointer, true);
  canvas.addEventListener("pointercancel", finishPointer, true);
  canvas.addEventListener("pointerleave", () => {
    state.hover = null;
    if (!pointer?.blocked) pointer = null;
    invalidateGui();
  });
  for (const type of ["touchstart", "touchmove", "touchend"]) {
    canvas.addEventListener(type, event => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const p = point(touch);
      if (pointer?.blocked || gui.blocked(p.x, p.y)) stop(event);
    }, { capture: true, passive: false });
  }

  canvas.addEventListener("wheel", event => {
    const p = point(event);
    if (!gui.blocked(p.x, p.y)) return;
    if (gui.inDrawer(p.x, p.y)) scrollPanel(event.deltaY * (event.deltaMode === 1 ? 15 : 1));
    stop(event);
  }, { capture: true, passive: false });

  canvas.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.menu) {
      state.menu = false;
      state.focus = "devices";
      updateAccessibility("选择设备");
      invalidateGui();
      stop(event);
    } else if (event.key === "Tab") {
      flushGui();
      const controls = state.menu ? gui.controls().filter(item => item.id.startsWith("device:")) : gui.controls();
      const previous = controls.findIndex(item => item.id === state.focus);
      const index = previous === -1 ? event.shiftKey ? controls.length - 1 : 0 : previous + (event.shiftKey ? -1 : 1);
      state.focus = controls[index]?.id ?? null;
      updateAccessibility(controls[index]?.title);
      invalidateGui();
      if (state.focus) stop(event);
    } else if ((event.key === "Enter" || event.key === " ") && state.focus) {
      run(state.focus);
      stop(event);
    }
  }, true);
  canvas.addEventListener("blur", () => {
    state.focus = null;
    invalidateGui();
  });

  orbit.addEventListener("change", () => {
    if (state.view && !placing) {
      state.view = null;
      invalidateGui();
    }
    queueFrame();
  });

  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    suspended = true;
    canvas.setAttribute("aria-label", "三维视图已暂停，等待图形上下文恢复。");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    suspended = false;
    pending = false;
    updateAccessibility();
    invalidateGui();
  });

  new ResizeObserver(resize).observe(canvas);
  resize();
  loadDevice(state.device);
})();
