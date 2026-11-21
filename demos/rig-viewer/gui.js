"use strict";

function createRigGui() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 10);
  camera.position.z = 5;
  const surface = document.createElement("canvas");
  const pen = surface.getContext("2d");
  const texture = new THREE.CanvasTexture(surface);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.encoding = THREE.sRGBEncoding;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false })
  );
  screen.renderOrder = 10;
  scene.add(screen);
  const labels = new Map();

  const ink = "#202d3d";
  const muted = "#576779";
  const blue = "#19529a";
  const systemFont = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  let width = 1;
  let height = 1;
  let dpr = 1;
  let edge = 24;
  let compact;
  let header;
  let dock;
  let drawer;
  let clip;
  let regions = [];
  let blocks = [];
  let scrollLimit = 0;

  function resize(w, h) {
    width = w;
    height = h;
    compact = w < 820;
    edge = compact ? 12 : 26;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    surface.width = Math.round(w * dpr);
    surface.height = Math.round(h * dpr);
    camera.left = 0;
    camera.right = w;
    camera.top = 0;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
    screen.position.set(w / 2, -h / 2, 0);
    screen.scale.set(w, h, 1);
  }

  const contains = (box, x, y) => box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;

  function rounded(x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    pen.beginPath();
    pen.moveTo(x + r, y);
    pen.arcTo(x + w, y, x + w, y + h, r);
    pen.arcTo(x + w, y + h, x, y + h, r);
    pen.arcTo(x, y + h, x, y, r);
    pen.arcTo(x, y, x + w, y, r);
    pen.closePath();
  }

  function box(x, y, w, h, fill, radius = 10, stroke) {
    rounded(x, y, w, h, radius);
    pen.fillStyle = fill;
    pen.fill();
    if (stroke) {
      pen.strokeStyle = stroke;
      pen.lineWidth = 1;
      pen.stroke();
    }
  }

  function panel(rect) {
    pen.save();
    pen.shadowColor = "rgba(30,49,69,.11)";
    pen.shadowBlur = 22;
    pen.shadowOffsetY = 7;
    box(rect.x, rect.y, rect.w, rect.h, "rgba(253,254,255,.96)", 17);
    pen.restore();
    rounded(rect.x, rect.y, rect.w, rect.h, 17);
    pen.strokeStyle = "#cbd4df";
    pen.lineWidth = 1;
    pen.stroke();
    blocks.push(rect);
  }

  function text(value, x, y, { size = 14, color = ink, weight = 550, align = "left", mono = false } = {}) {
    pen.font = `${weight} ${size}px ${mono ? "ui-monospace, Menlo, monospace" : systemFont}`;
    pen.textAlign = align;
    pen.textBaseline = "middle";
    pen.fillStyle = color;
    pen.fillText(value, x, y);
  }

  function rule(x, y, w) {
    pen.beginPath();
    pen.moveTo(x, y);
    pen.lineTo(x + w, y);
    pen.strokeStyle = "#dbe1e9";
    pen.lineWidth = 1;
    pen.stroke();
  }

  function dot(x, y, color, radius = 3.6) {
    pen.beginPath();
    pen.arc(x, y, radius, 0, Math.PI * 2);
    pen.fillStyle = color;
    pen.fill();
  }

  function arrow(x, y, open) {
    const d = open ? -1 : 1;
    pen.beginPath();
    pen.moveTo(x - 4, y - d * 2);
    pen.lineTo(x, y + d * 2);
    pen.lineTo(x + 4, y - d * 2);
    pen.strokeStyle = muted;
    pen.lineWidth = 1.5;
    pen.lineCap = "round";
    pen.stroke();
  }

  function register(id, title, rect) {
    let { x, y, w, h } = rect;
    if (clip) {
      const right = Math.min(x + w, clip.x + clip.w);
      const bottom = Math.min(y + h, clip.y + clip.h);
      x = Math.max(x, clip.x);
      y = Math.max(y, clip.y);
      w = right - x;
      h = bottom - y;
    }
    if (w > 0 && h > 0) regions.push({ id, title, x, y, w, h });
  }

  function button(state, id, title, x, y, w, h, options = {}) {
    const { active, align = "center", color, radius = 8, size = 14 } = options;
    const focused = id === state.focus;
    const hover = id === state.hover;
    const fill = active ? "#e3edfc" : hover || focused ? "#eef2f7" : null;
    if (fill) box(x, y, w, h, fill, radius, focused ? "#3f80d2" : null);
    text(title, align === "left" ? x + 10 : x + w / 2, y + h / 2,
      { size, align, color: color ?? (active ? blue : ink), weight: active ? 700 : 590 });
    register(id, title, { x, y, w, h });
  }

  function deviceHeader(state) {
    const w = Math.min(310, width - 2 * edge);
    header = { x: edge, y: edge, w, h: 59 };
    panel(header);
    const {x, y} = header;
    box(x + 11, y + 12, 35, 35, "#2a384b", 10);
    const cx = x + 28.5;
    const cy = y + 29.5;
    pen.beginPath();
    pen.moveTo(cx, cy - 10);
    pen.lineTo(cx + 9, cy - 5);
    pen.lineTo(cx + 9, cy + 5);
    pen.lineTo(cx, cy + 10);
    pen.lineTo(cx - 9, cy + 5);
    pen.lineTo(cx - 9, cy - 5);
    pen.closePath();
    pen.moveTo(cx - 9, cy - 5);
    pen.lineTo(cx, cy);
    pen.lineTo(cx + 9, cy - 5);
    pen.moveTo(cx, cy);
    pen.lineTo(cx, cy + 10);
    pen.strokeStyle = "#fff";
    pen.lineWidth = 1.35;
    pen.stroke();
    if (state.hover === "devices" || state.focus === "devices") {
      box(x + 51, y + 6, w - 58, 47, "#eff4fb", 10, state.focus === "devices" ? "#3f80d2" : null);
    }
    text("设备", x + 59, y + 18, { size: 11.5, color: muted, weight: 650 });
    text(state.device.label, x + 59, y + 37, { size: w < 287 ? 13 : 14.5, weight: 710 });
    arrow(x + w - 17, y + 30, state.menu);
    register("devices", "选择设备", header);
  }

  function layerControls(state) {
    const settingButtons = [
      ["fov", "视场", state.fov, 47],
      ["axes", "坐标轴", state.axes, 61],
      ["body", "人体", state.body, 47],
      ["inspector", "参数", state.inspector, 47]
    ];
    const w = settingButtons.reduce((sum, item) => sum + item[3], 10);
    const x = width - edge - w;
    const y = compact ? edge + 68 : edge + 8;
    panel({ x, y, w, h: 42 });
    let left = x + 5;
    for (const [id, label, active, size] of settingButtons) {
      button(state, id, label, left, y + 5, size, 32, { active });
      left += size;
    }
  }

  function inspector(state) {
    if (!state.inspector) return;
    const w = Math.min(compact ? 305 : 310, width - 2 * edge);
    const x = width - edge - w;
    const y = compact ? edge + 119 : edge + 70;
    const count = state.modules.reduce((sum, module) => sum + module.entries.length, 0);
    const grouped = state.modules.length > 1;
    const contentHeight = 52 + count * 29 + (grouped ? state.modules.length * 21 : 0) + (state.sources ? 227 : 195);
    const h = Math.max(52, Math.min(contentHeight, height - y - (compact ? 62 : 28)));
    scrollLimit = Math.max(0, contentHeight - h);
    state.scroll = Math.max(0, Math.min(scrollLimit, state.scroll));
    drawer = { x, y, w, h };
    panel(drawer);
    clip = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    pen.save();
    rounded(x + 1, y + 1, w - 2, h - 2, 16);
    pen.clip();
    let top = y + 22 - state.scroll;

    text("相机", x + 15, top, { size: 16, weight: 720 });
    box(x + 55, top - 10, 25, 20, "#eef1f5", 9);
    text(String(count), x + 67.5, top, { size: 12, align: "center", mono: true });
    button(state, "sources", state.sources ? "返回参数" : "标定来源", x + w - 85, top - 13, 73, 26, { size: 12 });

    top += 23;
    for (const module of state.modules) {
      if (grouped) {
        text(module.label, x + 17, top + 9, { size: 12, color: muted, weight: 700 });
        top += 21;
      }
      for (const entry of module.entries) {
        const id = `entry:${module.id}:${entry.id}`;
        const title = entry.id.startsWith("cam_") ? `C${entry.id.slice(4)}  ${entry.label}` : entry.label;
        if (state.selected === entry || state.hover === id || state.focus === id) {
          box(x + 12, top, w - 24, 27, state.selected === entry ? "#eaf2ff" : "#f0f3f7", 8,
            state.focus === id ? "#3f80d2" : null);
        }
        dot(x + 22, top + 13.5, entry.color);
        text(title, x + 33, top + 13.5, { size: 13, weight: state.selected === entry ? 720 : 590 });
        text(entry.size.join("×"), x + w - 18, top + 13.5, { size: 11.5, align: "right", color: muted, mono: true });
        register(id, module.label + " " + title, { x: x + 12, y: top, w: w - 24, h: 27 });
        top += 29;
      }
    }

    rule(x + 15, top + 8, w - 30);
    top += 24;
    if (state.sources) {
      text("标定来源与坐标", x + 15, top, { weight: 720 });
      const module = state.modules.find(entry => entry.id === state.selected.module.id);
      const sourceText = [
        "佩戴位置和俯角为示意。部件内相机使用原始标定。",
        "内外参用各自部件的参考系表示，平移和基线以毫米为单位。",
        ...module.sources
      ];
      for (const line of sourceText) {
        top += 20;
        const size = 12;
        let part = "";
        for (const character of line) {
          if (pen.measureText(part + character).width > w - 32 && part) {
            text(part, x + 15, top, { color: muted, size });
            top += 17;
            part = "";
          }
          part += character;
        }
        text(part, x + 15, top, { color: muted, size });
      }
    } else {
      const entry = state.selected;
      const data = state.modules.find(module => module.id === entry.module.id);
      const angle = value => Number.isFinite(value) ? value.toFixed(1) + "°" : "—";
      const vector = (value, decimals) => value.toArray().map(item => item.toFixed(decimals)).join(", ");
      text(entry.label + " · " + entry.model, x + 15, top, { weight: 720 });
      const fields = [["水平视场", angle(entry.fov[0])], ["垂直视场", angle(entry.fov[1])]];
      fields.forEach(([label, value], index) => {
        const fieldWidth = (w - 38) / 2;
        const left = x + 15 + index * (fieldWidth + 8);
        box(left, top + 16, fieldWidth, 44, "#f0f4f9", 8);
        text(label, left + 8, top + 28, { size: 11.5, color: muted });
        text(value, left + 8, top + 46, { size: 13, mono: true, weight: 690 });
      });
      const details = [
        ["焦距", `${entry.K[0].toFixed(1)}, ${entry.K[1].toFixed(1)} px`],
        ["主点", `${entry.K[2].toFixed(1)}, ${entry.K[3].toFixed(1)} px`],
        ["光心 XYZ", vector(entry.position, 1) + " mm"],
        ["光轴 XYZ", vector(entry.axis, 3)]
      ];
      if (data.baseline !== null) details.push(["双目基线", data.baseline.toFixed(2) + " mm"]);
      details.forEach(([label, value], index) => {
        text(label, x + 15, top + 73 + 16.5 * index, { color: muted, size: 11.5 });
        text(value, x + 91, top + 73 + 16.5 * index, { size: 11.5, mono: true });
      });
    }
    pen.restore();
    clip = null;
    if (scrollLimit > 0) {
      box(x + w - 5, y + 5 + state.scroll * (h - 32) / scrollLimit, 2, 22, "#acbacb", 1);
    }
  }

  function viewDock(state) {
    const x = edge;
    const y = height - edge - 43;
    const views = [["perspective", "透视"], ["top", "俯视"], ["front", "正视"]];
    dock = {x, y, w: 9 + views.length * 51, h: 43};
    panel(dock);
    views.forEach(([id, label], index) => {
      button(state, "view:" + id, label, x + 5 + 51 * index, y + 5, 50, 33, { active: state.view === id });
    });
    if (!compact) {
      const right = drawer ? drawer.x - 14 : width - edge;
      text("拖动旋转 · 滚轮缩放 · 右键平移", right, y + 33, { size: 12.5, color: muted, align: "right" });
      text("佩戴示意 · 网格 25 cm", right, y + 13,
        { size: 12.5, color: muted, align: "right", weight: 670 });
    }
  }

  function menu(state) {
    if (!state.menu) return;
    const rect = { x: header.x, y: header.y + header.h + 7, w: header.w, h: state.devices.length * 38 + 12 };
    panel(rect);
    state.devices.forEach((device, index) => {
      button(state, "device:" + device.id, device.label, rect.x + 6, rect.y + 6 + index * 38, rect.w - 12, 36,
        { active: state.device === device, align: "left" });
    });
  }

  function draw(state) {
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, width, height);
    blocks = [];
    regions = [];
    drawer = null;
    scrollLimit = 0;
    deviceHeader(state);
    layerControls(state);
    inspector(state);
    viewDock(state);
    menu(state);
    texture.needsUpdate = true;
  }

  function labelSprite(item) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `680 13px ${systemFont}`;
    const isAxis = item.kind === "axis";
    const w = isAxis ? 23 : Math.ceil(ctx.measureText(item.text).width) + 27;
    canvas.width = w * 2;
    canvas.height = 50;
    ctx.scale(2, 2);
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, w - 1, 24, 7);
    ctx.fillStyle = "rgba(253,254,255,.95)";
    ctx.fill();
    ctx.strokeStyle = item.selected || isAxis ? item.color : "#bbc8d7";
    ctx.stroke();
    if (!isAxis) {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(9, 12.5, 2.6, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.font = `680 13px ${systemFont}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = isAxis ? "center" : "left";
    ctx.fillStyle = isAxis ? item.color : ink;
    ctx.fillText(item.text, isAxis ? w / 2 : 17, 12.5);
    const map = new THREE.CanvasTexture(canvas);
    map.encoding = THREE.sRGBEncoding;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true, toneMapped: false }));
    sprite.scale.set(w, 25, 1);
    scene.add(sprite);
    return sprite;
  }

  function drawLabels(items, eye) {
    for (const sprite of labels.values()) sprite.visible = false;
    const placed = [];
    const priority = item => item.kind === "axis" ? 2 : Number(!!item.selected);
    for (const item of [...items].sort((a, b) => priority(b) - priority(a))) {
      const key = item.key ?? item.text + item.color + !!item.selected;
      if (!labels.has(key)) labels.set(key, labelSprite(item));
      const sprite = labels.get(key);
      const point = item.point.clone().project(eye);
      const x = (point.x + 1) * width / 2;
      const y = (1 - point.y) * height / 2;
      const half = sprite.scale.x / 2;
      const hitsChrome = blocks.some(rect => (
        x + half + 3 > rect.x && x - half - 3 < rect.x + rect.w &&
        y + 14 > rect.y && y - 14 < rect.y + rect.h
      ));
      if (hitsChrome || point.z < -1 || point.z > 1 || x < half || x > width - half || y < 12 || y > height - 12) continue;
      if (placed.some(other => Math.abs(other.x - x) < other.half + half + 5 && Math.abs(other.y - y) < 27)) continue;
      sprite.position.set(x, -y, 0.1);
      sprite.visible = true;
      placed.push({x, y, half});
    }
  }

  return {
    scene, camera, resize, draw, drawLabels,
    hit: (x, y) => [...regions].reverse().find(region => contains(region, x, y)),
    blocked: (x, y) => blocks.some(rect => contains(rect, x, y)),
    inDrawer: (x, y) => contains(drawer, x, y),
    controls: () => regions,
    scrollLimit: () => scrollLimit,
    content() {
      const top = compact ? edge + 112 : edge + 66;
      const right = drawer && !compact ? drawer.x - 10 : width - edge;
      return { x: edge, y: top, w: Math.max(60, right - edge), h: Math.max(60, height - top - edge - 49) };
    }
  };
}
