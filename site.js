const tocLinks = [...document.querySelectorAll(".toc a")];
const targets = tocLinks.map(link => document.getElementById(decodeURIComponent(link.hash.slice(1))));
const progress = document.querySelector(".reading-progress");
let queued = false;

function updateReadingPosition() {
  queued = false;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = scrollable > 0 ? Math.max(0, Math.min(1, window.scrollY / scrollable)) : 0;
  progress.style.transform = `scaleX(${ratio})`;
  let current = -1;
  for (const [index, target] of targets.entries()) {
    if (target.getBoundingClientRect().top <= 120) current = index;
  }
  for (const [index, link] of tocLinks.entries()) {
    if (index === current) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

function scheduleReadingUpdate() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(updateReadingPosition);
}

window.addEventListener("scroll", scheduleReadingUpdate, { passive: true });
window.addEventListener("resize", scheduleReadingUpdate);
window.addEventListener("load", scheduleReadingUpdate);
updateReadingPosition();

for (const demo of document.querySelectorAll(".demo")) {
  const button = demo.querySelector(".demo-fullscreen");
  const frame = demo.querySelector("iframe");
  const background = [];
  const isExpanded = () => demo.classList.contains("is-expanded");

  function updateFullscreenButton() {
    const text = document.fullscreenElement === demo || isExpanded() ? "退出全屏" : "全屏";
    button.setAttribute("aria-label", text);
    button.title = text;
  }

  function expandInPage(expanded) {
    demo.classList.toggle("is-expanded", expanded);
    if (expanded) {
      for (let node = demo; node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (sibling === node || sibling.inert) continue;
          sibling.inert = true;
          background.push(sibling);
        }
      }
    } else {
      for (const sibling of background.splice(0)) sibling.inert = false;
    }
    updateFullscreenButton();
    button.focus({ preventScroll: true });
  }

  function exitExpandedOnEscape(event) {
    if (event.key !== "Escape" || !isExpanded()) return;
    event.preventDefault();
    expandInPage(false);
  }

  button.hidden = false;
  button.addEventListener("click", async () => {
    if (isExpanded()) {
      expandInPage(false);
    } else if (document.fullscreenElement === demo) {
      await document.exitFullscreen().catch(updateFullscreenButton);
    } else {
      if (document.fullscreenEnabled && typeof demo.requestFullscreen === "function") {
        try {
          await demo.requestFullscreen();
          return;
        } catch {
          // Keep the viewer expandable when native fullscreen is unavailable.
        }
      }
      expandInPage(true);
    }
  });

  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("keydown", exitExpandedOnEscape);
  frame.addEventListener("load", () => {
    frame.contentDocument?.addEventListener("keydown", exitExpandedOnEscape);
  });
}

const panoramaVideo = document.querySelector(".media video");
if (panoramaVideo && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const startOnView = new IntersectionObserver(([entry]) => {
    if (entry.intersectionRatio < 0.5) return;
    startOnView.disconnect();
    if (panoramaVideo.paused && panoramaVideo.currentTime === 0) {
      panoramaVideo.play().catch(() => {
        // Native controls remain available if the browser blocks autoplay.
      });
    }
  }, { threshold: 0.5 });
  startOnView.observe(panoramaVideo);
}
