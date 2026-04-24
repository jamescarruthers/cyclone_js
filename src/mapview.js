// 2-D archipelago map view.  Toggled with the M key, matching the
// original's "MAP OR MAIN SCREEN" HUD option.

export function createMapView(world) {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 288;
  canvas.style.cssText = [
    'position: absolute',
    'left: 50%', 'top: 50%',
    'transform: translate(-50%, -50%)',
    'border: 2px solid #ffd257',
    'border-radius: 6px',
    'background: rgba(5, 15, 30, 0.9)',
    'display: none',
    'z-index: 8',
    'image-rendering: pixelated',
  ].join(';');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  function worldToMap(p) {
    const s = world.worldSize;
    return {
      x: (p.x + s/2) / s * W,
      y: (p.z + s/2) / s * H,
    };
  }

  function draw({ helicopter, cyclone, crates, survivors }) {
    // Background (sea)
    ctx.fillStyle = '#0e304f';
    ctx.fillRect(0, 0, W, H);

    // Border grid (faint) — echoes the 32x24 ROM grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i <= 32; i++) {
      const x = (i / 32) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let i = 0; i <= 24; i++) {
      const y = (i / 24) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Islands
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    for (const is of world.islands) {
      const p = worldToMap(is.center);
      const r = (is.radius / world.worldSize) * W * 1.5;
      ctx.fillStyle = is.isHome ? '#64c27a' : '#4a8a47';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = is.isHome ? '#ffd257' : '#e3f4ff';
      ctx.textAlign = 'center';
      ctx.fillText(is.name, p.x, p.y + r + 9);
    }

    // Crates
    ctx.fillStyle = '#b07a3a';
    for (const c of crates) {
      if (c.userData.picked || c.userData.destroyed) continue;
      const p = worldToMap(c.position);
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }

    // Survivors
    ctx.fillStyle = '#ff7240';
    for (const s of survivors) {
      if (s.userData.rescued) continue;
      const p = worldToMap(s.position);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    // Cyclone — concentric rings
    {
      const p = worldToMap(cyclone.position);
      for (let i = 3; i >= 0; i--) {
        ctx.strokeStyle = `rgba(220, 220, 220, ${0.15 + i * 0.1})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + i * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#ff6b6b';
      ctx.textAlign = 'center';
      ctx.fillText('CYCLONE', p.x, p.y - 24);
    }

    // Helicopter
    {
      const p = worldToMap(helicopter.position);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(helicopter.rotation.y + Math.PI);
      ctx.fillStyle = '#ffd257';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Title
    ctx.fillStyle = '#ffd257';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CYCLONE MAP — press M to close', 8, 14);
  }

  return {
    canvas,
    toggle() { canvas.style.display = (canvas.style.display === 'none' ? 'block' : 'none'); },
    isOpen() { return canvas.style.display !== 'none'; },
    draw,
  };
}

// Compass needle drawn in a small CSS HUD element.
export function createCompass() {
  const el = document.getElementById('hud-compass');
  return {
    update(heading) {
      if (!el) return;
      // heading is a yaw in radians (0 = +Z).  Convert to N/S/E/W letters.
      // In our world, we treat -Z as North (top of map).
      const deg = (THREE_DEG(heading) + 360) % 360;
      let card = 'N';
      if (deg < 22.5 || deg >= 337.5) card = 'N';
      else if (deg < 67.5)  card = 'NE';
      else if (deg < 112.5) card = 'E';
      else if (deg < 157.5) card = 'SE';
      else if (deg < 202.5) card = 'S';
      else if (deg < 247.5) card = 'SW';
      else if (deg < 292.5) card = 'W';
      else                  card = 'NW';
      el.textContent = `${card} ${Math.round(deg).toString().padStart(3,'0')}°`;
    },
  };
}

function THREE_DEG(rad) { return rad * 180 / Math.PI; }
