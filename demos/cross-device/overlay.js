"use strict";

const FEATURE_COLORS = { head: "#1ed2ff", left: "#5adc46", right: "#f05adc" };
const MATCH_COLORS = [null, "#ffbf47", "#ff755b", "#ffffff"];
const POSE_AXIS_COLORS = ["#ed3548", "#22b352", "#297bff"];

function createOverlay(layers, cameras, playback) {
  const bitmap = document.createElement("canvas");
  const ctx = bitmap.getContext("2d");
  const texture = new THREE.CanvasTexture(bitmap);
  texture.encoding = THREE.sRGBEncoding;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false
  })));

  let width = 1;
  let height = 1;
  let scale = 1;
  let panel, strip, buttons, tiles, area, transport, playButton, seekBar;
  const font = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif';
  const play = { id: "play", label: "播放 / 暂停" };
  const seek = { id: "seek", label: "播放进度" };

  function resize(w, h, pixelRatio) {
    width = w;
    height = h;
    scale = Math.min(pixelRatio, Math.sqrt(5000000 / (w * h)));
    bitmap.width = Math.max(1, Math.round(w * scale));
    bitmap.height = Math.max(1, Math.round(h * scale));

    const sidePanel = w >= 760 && h >= 500;
    const tiny = h < 430;
    const margin = sidePanel ? 22 : 12;
    const columns = sidePanel ? 1 : w >= 590 ? 4 : w >= 352 ? 3 : 2;
    const panelWidth = sidePanel ? 213 : w - margin * 2;
    const rowHeight = tiny ? 28 : sidePanel ? 34 : 32;
    const headerHeight = tiny ? 38 : sidePanel ? 54 : 47;
    const colWidth = (panelWidth - 18) / columns;
    panel = { x: margin, y: margin, w: panelWidth, h: headerHeight + Math.ceil(layers.length / columns) * rowHeight + 9 };
    buttons = layers.map((layer, index) => ({ layer, x: margin + 9 + index % columns * colWidth,
      y: margin + headerHeight + Math.floor(index / columns) * rowHeight, w: colWidth, h: rowHeight }));

    const imageColumns = w >= 560 && w / h >= 0.95 ? 4 : 2;
    const imageRows = 4 / imageColumns;
    const gap = sidePanel ? 9 : 6;
    const pad = sidePanel ? 10 : 7;
    const tileTitle = tiny ? 17 : 22;
    const transportHeight = tiny ? 34 : 41;
    const byHeight = ((h / 3 - margin - pad - transportHeight - gap * (imageRows - 1))
      / imageRows - tileTitle) * 800 / 650;
    const imageWidth = Math.max(16, Math.min(byHeight,
      (w - 2 * margin - 2 * pad - (imageColumns - 1) * gap) / imageColumns));
    const imageHeight = imageWidth * 650 / 800;
    const tileHeight = imageHeight + tileTitle;
    const imagesWidth = imageColumns * imageWidth + (imageColumns - 1) * gap + pad * 2;
    const stripWidth = Math.max(imagesWidth, Math.min(w - margin * 2, 320));
    const stripHeight = pad + imageRows * tileHeight + (imageRows - 1) * gap + transportHeight;
    strip = { x: (w - stripWidth) / 2, y: h - margin - stripHeight, w: stripWidth, h: stripHeight };
    tiles = cameras.map((entry, index) => ({ entry, w: imageWidth, h: imageHeight, title: tileTitle,
      x: (w - imagesWidth) / 2 + pad + index % imageColumns * (imageWidth + gap),
      y: strip.y + pad + Math.floor(index / imageColumns) * (tileHeight + gap) }));
    transport = { x: strip.x, y: h - margin - transportHeight, w: strip.w, h: transportHeight };
    playButton = { x: transport.x + 13, y: transport.y + 4, w: 29, h: 28 };
    seekBar = { x: playButton.x + 42, y: transport.y + 5, w: Math.max(10, transport.w - 165), h: 26 };

    const left = sidePanel ? panel.x + panel.w + 12 : margin;
    const top = sidePanel ? margin : panel.y + panel.h + 7;
    area = { x: left, y: top, w: Math.max(1, w - left - margin), h: Math.max(1, strip.y - top - 8) };
  }

  function viewArea() {
    if (layersById.images.visible) return area;
    return { ...area, h: Math.max(1, transport.y - area.y - 8) };
  }

  function rounded(rect, radius) {
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
  }

  function card(rect) {
    ctx.save();
    ctx.shadowColor = "rgba(30, 36, 50, .13)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = "rgba(255, 255, 255, .97)";
    rounded(rect, 17);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(35, 39, 47, .10)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function text(value, x, y, size, weight, color, align = "left") {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(value, x, y);
  }

  function drawButton(button, hover, focus) {
    const { layer, x, y, w, h } = button;
    const compact = w < 145;
    const middle = y + h / 2;
    if (hover || focus) {
      rounded({ x: x + 1, y: y + 1, w: w - 2, h: h - 2 }, 8);
      ctx.fillStyle = "#eeeff1";
      ctx.fill();
      if (focus) {
        ctx.strokeStyle = "#787b84";
        ctx.stroke();
      }
    }
    if (!compact && layer.tone) {
      rounded({ x: x + 10, y: middle - 1.5, w: 16, h: 3 }, 1.5);
      ctx.fillStyle = layer.tone;
      ctx.fill();
    }
    text(layer.label, x + (compact ? 5 : layer.tone ? 34 : 10), middle, compact ? 12 : 13, 540, "#25262a");
    const switchW = compact ? 24 : 32;
    const switchH = compact ? 14 : 18;
    const switchX = x + w - switchW - (compact ? 6 : 10);
    rounded({ x: switchX, y: middle - switchH / 2, w: switchW, h: switchH }, switchH / 2);
    ctx.fillStyle = layer.visible ? "#303238" : "#d4d5da";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(switchX + (layer.visible ? switchW - switchH / 2 : switchH / 2), middle, switchH / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }

  function drawDetections(entry, layersById, scale, frame) {
    if (layersById.features.visible) {
      const points = entry.detections(frame);
      const radius = 0.9 / scale;
      ctx.strokeStyle = "rgba(10, 12, 16, .78)";
      ctx.fillStyle = FEATURE_COLORS[entry.device];
      ctx.lineWidth = 0.8 / scale;
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 2) {
        const u = points[i] / 32;
        const v = points[i + 1] / 32;
        ctx.moveTo(u + radius, v);
        ctx.arc(u, v, radius, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.fill();
    }
    if (layersById.matches.visible) {
      const points = entry.matches(frame);
      for (let i = 0; i < points.length; i += 3) {
        ctx.beginPath();
        ctx.arc(points[i] / 32, points[i + 1] / 32, 2.3 / scale, 0, Math.PI * 2);
        ctx.lineWidth = 2.6 / scale;
        ctx.strokeStyle = "#17181c";
        ctx.stroke();
        ctx.lineWidth = 1.25 / scale;
        ctx.strokeStyle = MATCH_COLORS[points[i + 2]];
        ctx.stroke();
      }
    }
  }

  function drawProjection(entry, scale) {
    for (const { origin, ends, label } of entry.projections) {
      ctx.lineCap = "round";
      for (const [axis, endpoint] of ends.entries()) {
        if (!endpoint) continue;
        ctx.beginPath();
        ctx.moveTo(...origin);
        ctx.lineTo(...endpoint);
        ctx.lineWidth = 4.4 / scale;
        ctx.strokeStyle = "#111217";
        ctx.stroke();
        ctx.lineWidth = 2.4 / scale;
        ctx.strokeStyle = POSE_AXIS_COLORS[axis];
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(...origin, 2.7 / scale, 0, Math.PI * 2);
      ctx.lineWidth = 2.7 / scale;
      ctx.strokeStyle = "#131419";
      ctx.stroke();
      ctx.lineWidth = 1.4 / scale;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.font = `700 ${10 / scale}px ${font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 2.6 / scale;
      ctx.strokeStyle = "#131419";
      ctx.fillStyle = "#fff";
      ctx.strokeText(label, origin[0] + 4.5 / scale, origin[1] - 4 / scale);
      ctx.fillText(label, origin[0] + 4.5 / scale, origin[1] - 4 / scale);
    }
  }

  function drawTile(tile, layersById, frame) {
    const { entry, x, y, w, h, title } = tile;
    rounded(tile, 7);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#dadce1";
    ctx.fillRect(x, y, w, h);
    if (!playback.failed && frame >= 0 && entry.available[frame]) {
      const ratio = w / entry.calibration.width;
      ctx.drawImage(playback.frameBitmap, ...entry.region, x, y, w, h);
      ctx.translate(x, y);
      ctx.scale(ratio, h / entry.calibration.height);
      drawDetections(entry, layersById, ratio, frame);
      if (layersById.projection.visible) drawProjection(entry, ratio);
    } else {
      const message = playback.failed ? "图像无法载入" : frame < 0 ? "正在载入" : "无同步画面";
      if (w > 65) text(message, x + w / 2, y + h / 2, 11, 500, "#565860", "center");
    }
    ctx.restore();
    if (w >= 45) text(entry.label, x + w / 2, y + h + title * 0.55, 11, 620, "#4c4e56", "center");
  }

  const layersById = Object.fromEntries(layers.map(layer => [layer.id, layer]));

  function drawTransport(hover, focus) {
    const { x, y, w, h } = playButton;
    const active = !playback.video.paused && !playback.video.ended;
    rounded(playButton, 9);
    ctx.fillStyle = hover === play ? "#151619" : "#303238";
    ctx.fill();
    if (focus === play) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#82858e";
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (active) {
      ctx.fillRect(cx - 4, cy - 5, 3, 10);
      ctx.fillRect(cx + 1, cy - 5, 3, 10);
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 5.5);
      ctx.lineTo(cx + 5.5, cy);
      ctx.lineTo(cx - 3, cy + 5.5);
      ctx.fill();
    }

    const time = playback.displayTime();
    const progress = time / playback.duration;
    const middle = seekBar.y + seekBar.h / 2;
    const end = seekBar.x + seekBar.w * progress;
    if (focus === seek) {
      rounded({ x: seekBar.x - 7, y: seekBar.y - 1, w: seekBar.w + 14, h: seekBar.h + 2 }, 8);
      ctx.strokeStyle = "#82858e";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#cbccd2";
    ctx.beginPath();
    ctx.moveTo(seekBar.x, middle);
    ctx.lineTo(seekBar.x + seekBar.w, middle);
    ctx.stroke();
    ctx.strokeStyle = "#303238";
    ctx.beginPath();
    ctx.moveTo(seekBar.x, middle);
    ctx.lineTo(end, middle);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(end, middle, hover === seek || playback.scrubbing ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = "#303238";
    ctx.fill();
    text(`${time.toFixed(1)} / ${playback.duration.toFixed(1)} s`, transport.x + transport.w - 12, cy, 11, 600, "#45474f", "right");
  }

  function draw(hover, focus) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    card(panel);
    text("跨设备定位", panel.x + 17, panel.y + (height < 430 ? 20 : 24), 17, 720, "#191a1e");
    for (const button of buttons) drawButton(button, button.layer === hover, button.layer === focus);
    card(layersById.images.visible ? strip : transport);
    if (layersById.images.visible) for (const tile of tiles) drawTile(tile, layersById, playback.index);
    drawTransport(hover, focus);
    texture.needsUpdate = true;
  }

  function contains(rect, x, y) {
    return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
  }

  return {
    scene, camera, resize, draw, viewArea, controls: [play, seek],
    hit: (x, y) => buttons.find(button => contains(button, x, y))?.layer
      ?? (contains(playButton, x, y) ? play : contains(seekBar, x, y) ? seek : null),
    fraction: x => Math.min(1, Math.max(0, (x - seekBar.x) / seekBar.w)),
    blocks: (x, y) => contains(panel, x, y) || contains(layersById.images.visible ? strip : transport, x, y)
  };
}
