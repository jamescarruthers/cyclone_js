// Touch/pointer controls — mirrors the ROM's 5 buttons onto an HTML overlay.
//
//   left thumb-cluster: TURN_L, FORWARD, TURN_R
//   right thumb-cluster: UP, DOWN
//   top: MAP, VIEW, MUTE  (one-shot toggles)
//
// Buttons feed the same `keys` object the keyboard handler writes to, so the
// game logic in main.js doesn't need to know whether input came from a
// keyboard or a finger.  The one-shots are delivered as native KeyboardEvents
// so the existing keydown switch in main.js still works.

export function setupTouchControls(keys, options = {}) {
  const root = document.createElement('div');
  root.id = 'touch-controls';
  root.innerHTML = `
    <div class="tc-cluster tc-left">
      <button class="tc-btn" data-key="KeyA" aria-label="turn left">&#9664;</button>
      <button class="tc-btn tc-fwd" data-key="KeyW" aria-label="forward">&#9650;</button>
      <button class="tc-btn" data-key="KeyD" aria-label="turn right">&#9654;</button>
    </div>
    <div class="tc-cluster tc-right">
      <button class="tc-btn tc-alt" data-key="Space" aria-label="climb">UP</button>
      <button class="tc-btn tc-alt" data-key="ShiftLeft" aria-label="descend">DN</button>
    </div>
    <div class="tc-cluster tc-top">
      <button class="tc-btn tc-small" data-oneshot="KeyM" aria-label="map">MAP</button>
      <button class="tc-btn tc-small" data-oneshot="KeyC" aria-label="camera">VIEW</button>
      <button class="tc-btn tc-small" data-oneshot="KeyN" aria-label="mute">MUTE</button>
    </div>
  `;
  document.body.appendChild(root);

  // ---- Continuous buttons (A / D / W / Space / Shift) -----------------
  const heldBtns = root.querySelectorAll('.tc-btn[data-key]');
  for (const btn of heldBtns) {
    const code = btn.dataset.key;
    const down = (e) => {
      e.preventDefault();
      keys[code] = true;
      btn.classList.add('tc-down');
      if (btn.setPointerCapture && e.pointerId !== undefined) {
        try { btn.setPointerCapture(e.pointerId); } catch {}
      }
    };
    const up = (e) => {
      keys[code] = false;
      btn.classList.remove('tc-down');
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup',   up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave',  up);
    // Fallback for browsers without pointer events
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend',   up);
  }

  // ---- One-shot toggles (M / C / N) -----------------------------------
  // Dispatched as synthetic KeyboardEvents so main.js's keydown listener
  // fires exactly once per tap.
  const oneBtns = root.querySelectorAll('.tc-btn[data-oneshot]');
  for (const btn of oneBtns) {
    const code = btn.dataset.oneshot;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('tc-down');
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
    });
    const up = () => btn.classList.remove('tc-down');
    btn.addEventListener('pointerup',     up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave',  up);
  }

  // ---- Safety: prevent scrolling / pull-to-refresh while playing -----
  const swallow = (e) => {
    if (e.target && e.target.closest('#touch-controls')) e.preventDefault();
  };
  document.addEventListener('touchmove', swallow, { passive: false });
  // iOS: disable rubber-banding
  document.body.style.overscrollBehavior = 'none';

  return root;
}
