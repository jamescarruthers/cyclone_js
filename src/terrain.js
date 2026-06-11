// Authentic terrain queries, backed by the surveyed per-island
// heightmaps (src/island_heightmaps.js — the renderer's $7A8B terrain
// table sampled across every island; values are altitude/4 units).
//
// terrainLevelAt(posX, posY): height in alt/4 units (0 = water) at a
// flight-coordinate position.  Ground altitude = level * 4, exactly the
// scale the landing comparator at $8A80 uses (altitude SRA twice).

import { ISLAND_HEIGHTMAPS } from './island_heightmaps.js';
import { islandAt } from './rom-physics.js';
import { ISLAND_DATA } from './islands_data.js';

const BY_NAME = Object.fromEntries(ISLAND_HEIGHTMAPS.map(h => [h.name, h]));

export function heightmapFor(index) {
  return BY_NAME[ISLAND_DATA[index].name];
}

export function sampleHeightmap(hm, posX, posY) {
  const i = Math.round((posX - hm.x0) / hm.step);
  const j = Math.round((posY - hm.y0) / hm.step);
  if (i < 0 || j < 0 || i >= hm.w || j >= hm.h) return 0;
  return parseInt(hm.rows[j][i], 36);
}

// Terrain level (alt/4 units) at a flight position; 0 over open water.
export function terrainLevelAt(posX, posY) {
  const idx = islandAt(posX, posY);
  if (idx < 0) return 0;
  return sampleHeightmap(heightmapFor(idx), posX, posY);
}

// Ground altitude in ROM altitude units (what $750D is compared to).
export const groundAltitudeAt = (posX, posY) => terrainLevelAt(posX, posY) * 4;
