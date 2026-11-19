// The split screen: the index is the page with its original CSS; the same page with the sketched
// CSS lies on top in a frame, cut at a divider the visitor drags. The frame does not scroll; it grows
// to its content and scrolls with the page, so both copies always line up (their layouts are the
// same, which is the point).
const divider = document.getElementById('divider');
const root = document.documentElement;
const buttons = [...document.querySelectorAll('[data-roughness]')];

const state = { split: 0.5, sketch: document.getElementById('sketch') };

const clamp = (value) => Math.min(1, Math.max(0, value));

const setSplit = (fraction) => {
  state.split = clamp(fraction);
  root.style.setProperty('--split', `${(state.split * root.clientWidth).toFixed(1)}px`);
  divider.setAttribute('aria-valuenow', String(Math.round(state.split * 100)));
};

// --- Heights -------------------------------------------------------------------------------

/** The two copies should be the same height; compared body to body (the frame, positioned, adds
 * nothing to the page's body). */
const compare = (frame) => {
  const doc = frame.contentDocument;
  if (!doc || doc.readyState !== 'complete' || doc.URL === 'about:blank') return;
  const page = document.body.offsetHeight;
  const sketch = doc.body.offsetHeight;
  if (Math.abs(page - sketch) > 0.5) {
    console.warn(`sketchify: the two copies differ in height (${page} vs ${sketch}px). The layout should be identical.`);
  }
};

/** Keeps the frame as tall as its document. */
const follow = (frame) => {
  const measure = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    frame.style.height = `${doc.documentElement.scrollHeight}px`;
    compare(frame);
  };
  const start = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    new ResizeObserver(measure).observe(doc.documentElement);
    measure();
  };
  if (frame.contentDocument?.readyState === 'complete') start();
  frame.addEventListener('load', start);
};

// --- Divider -------------------------------------------------------------------------------

const fractionAt = (clientX) => clientX / root.clientWidth;

divider.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  divider.setPointerCapture(event.pointerId);
  document.body.classList.add('dragging');
  setSplit(fractionAt(event.clientX));
});
divider.addEventListener('pointermove', (event) => {
  if (divider.hasPointerCapture(event.pointerId)) setSplit(fractionAt(event.clientX));
});
const release = (event) => {
  if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
  document.body.classList.remove('dragging');
};
divider.addEventListener('pointerup', release);
divider.addEventListener('pointercancel', release);
divider.addEventListener('dblclick', () => setSplit(0.5));
divider.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 0.1 : 0.02;
  const moves = { ArrowLeft: state.split - step, ArrowRight: state.split + step, Home: 0, End: 1 };
  if (event.key in moves) {
    event.preventDefault();
    setSplit(moves[event.key]);
  }
});
window.addEventListener('resize', () => setSplit(state.split));

/** Once, on arrival: sweep the divider a little to show that it moves. */
const hint = () => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const keyframes = [0.5, 0.38, 0.62, 0.5];
  const duration = 1600;
  const startAt = performance.now();
  const tick = (now) => {
    if (document.body.classList.contains('dragging')) return;
    const t = Math.min(1, (now - startAt) / duration);
    const position = t * (keyframes.length - 1);
    const index = Math.min(keyframes.length - 2, Math.floor(position));
    const local = position - index;
    const eased = 0.5 - Math.cos(local * Math.PI) / 2;
    setSplit(keyframes[index] + (keyframes[index + 1] - keyframes[index]) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  setTimeout(() => requestAnimationFrame(tick), 600);
};

// --- Roughness -----------------------------------------------------------------------------

/** Loads the page at another roughness behind the current one, then swaps, so nothing flashes. */
const switchTo = (roughness) => {
  buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.roughness === roughness)));
  const next = state.sketch.cloneNode(false);
  next.removeAttribute('id');
  next.src = `sketch-${roughness}.html`;
  next.style.visibility = 'hidden';
  state.sketch.after(next);
  next.addEventListener(
    'load',
    () => {
      const previous = state.sketch;
      state.sketch = next;
      next.id = 'sketch';
      follow(next);
      next.style.visibility = '';
      previous.remove();
    },
    { once: true },
  );
};
buttons.forEach((button) => button.addEventListener('click', () => switchTo(button.dataset.roughness)));

setSplit(0.5);
follow(state.sketch);
new ResizeObserver(() => compare(state.sketch)).observe(document.body);
hint();
