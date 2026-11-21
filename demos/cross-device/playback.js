"use strict";

function decodeBytes(value) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(value);
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function unpackStream(stream, Type, stride) {
  const values = new Type(decodeBytes(stream.values).buffer);
  return index => values.subarray(stream.offsets[index] * stride, stream.offsets[index + 1] * stride);
}

async function loadReplay() {
  const compressed = new Blob(CROSS_POSE_DATA.map(decodeBytes));
  const data = await new Response(compressed.stream().pipeThrough(new DecompressionStream("gzip"))).json();
  for (const device of Object.values(data.devices)) device.slam.sample = unpackStream(device.slam, Float32Array, 4);
  for (const camera of data.cameras) {
    camera.detections = unpackStream(camera.detections, Uint16Array, 2);
    camera.matches = unpackStream(camera.matches, Uint16Array, 3);
  }
  data.landmarks = unpackStream(data.landmarks, Float32Array, 4);
  return data;
}

function createPlayback(replay, onFrame, invalidate) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const frameBitmap = document.createElement("canvas");
  const frameContext = frameBitmap.getContext("2d", { alpha: false });
  const duration = replay.times.at(-1);
  const state = { video, frameBitmap, duration, index: -1, failed: false, scrubbing: false };
  const hasFrameCallback = typeof video.requestVideoFrameCallback === "function";
  let requestedFrame = null;
  let resumeAfterSeek = false;

  function commit(mediaTime) {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const index = Math.min(replay.times.length - 1, Math.max(0, Math.round(mediaTime * replay.fps)));
    if (requestedFrame !== null && requestedFrame !== index && video.seeking) return;
    if (requestedFrame === index) requestedFrame = null;
    if (state.index === index) return;
    if (frameBitmap.width !== video.videoWidth || frameBitmap.height !== video.videoHeight) {
      frameBitmap.width = video.videoWidth;
      frameBitmap.height = video.videoHeight;
    }
    // Keep the same decoded image while the layer controls repaint or a new seek is pending.
    frameContext.drawImage(video, 0, 0);
    state.index = index;
    onFrame(index);
    invalidate();
  }

  function nextFrame(_, { mediaTime }) {
    commit(mediaTime);
    video.requestVideoFrameCallback(nextFrame);
  }

  function fallbackFrame() {
    if (!video.seeking) commit(Math.floor((video.currentTime + 0.002) * replay.fps) / replay.fps);
    if (!video.paused && !video.ended) requestAnimationFrame(fallbackFrame);
  }

  function play() {
    video.play().catch(invalidate);
  }

  function seek(index) {
    const next = Math.min(replay.times.length - 1, Math.max(0, index));
    if (requestedFrame === next || (state.index === next && requestedFrame === null)) return;
    requestedFrame = next;
    video.currentTime = (next + 0.05) / replay.fps;
    invalidate();
  }

  state.displayTime = () => replay.times[requestedFrame ?? state.index] ?? 0;
  state.toggle = () => {
    if (state.failed || video.readyState === HTMLMediaElement.HAVE_NOTHING) return;
    if (video.paused || video.ended) {
      if (video.ended) seek(0);
      play();
    } else video.pause();
  };
  state.seekFraction = fraction => {
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) return;
    seek(Math.round(fraction * (replay.times.length - 1)));
  };
  state.step = frameDelta => {
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) return;
    video.pause();
    seek((requestedFrame ?? state.index) + frameDelta);
  };
  state.beginScrub = () => {
    resumeAfterSeek = !video.paused && !video.ended;
    video.pause();
    state.scrubbing = true;
    invalidate();
  };
  state.endScrub = () => {
    state.scrubbing = false;
    if (resumeAfterSeek) play();
    invalidate();
  };

  if (hasFrameCallback) video.requestVideoFrameCallback(nextFrame);
  else video.addEventListener("play", fallbackFrame);
  video.addEventListener("loadeddata", () => {
    if (state.index < 0) commit(0);
    play();
  }, { once: true });
  video.addEventListener("seeked", () => {
    // A seek can complete before the next video-frame callback.
    commit(Math.floor(video.currentTime * replay.fps + 1e-3) / replay.fps);
    requestedFrame = null;
    invalidate();
  });
  for (const type of ["play", "pause", "ended"]) video.addEventListener(type, invalidate);
  video.addEventListener("error", () => { state.failed = true; invalidate(); });
  video.src = URL.createObjectURL(new Blob(CROSS_POSE_VIDEO.map(decodeBytes), { type: "video/mp4" }));
  return state;
}
