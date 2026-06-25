(function (global) {
  'use strict';

  /**
   * Build all distinct orientations for a box (l × w × h).
   */
  function getOrientations(l, w, h, rot) {
    if (rot === 1) return [{ l, w, h }];
    if (rot === 2) return [{ l, w, h }, { l: w, w: l, h }];

    const seen = new Set();
    const result = [];
    [[l,w,h],[l,h,w],[w,l,h],[w,h,l],[h,l,w],[h,w,l]].forEach(([a, b, c]) => {
      const key = [a, b, c].slice().sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ l: a, w: b, h: c });
      }
    });
    return result;
  }

  /**
   * Pack carton-type descriptors into a container.
   *
   * Loading order: cartons are packed from the CLOSED FRONT END (x = cL)
   * toward the DOOR END (x = 0), so the container fills from back to front.
   * This mirrors real-world practice: you load the container from the far end
   * and work back toward the doors.
   *
   * @param {number} cL  container length (cm)  — x axis: 0=door end, cL=front/closed end
   * @param {number} cW  container width  (cm)
   * @param {number} cH  container height (cm)
   * @param {number} maxWeight  max payload (kg); use Infinity to skip
   * @param {Array}  cartonTypes  [{l, w, h, qty, wt, sku, rot, color, id}]
   *
   * @returns {{ placements, totalWeight, totalItems }}
   */
  function pack(cL, cW, cH, maxWeight, cartonTypes) {
    /* Flatten to individual items, largest-volume-first */
    const items = [];
    for (const type of cartonTypes) {
      for (let i = 0; i < type.qty; i++) {
        items.push({ ...type });
      }
    }
    items.sort((a, b) => (b.l * b.w * b.h) - (a.l * a.w * a.h));

    /*
     * Extreme-point initialised at the FRONT-BOTTOM-LEFT corner (x = cL - ε)
     * is tricky because we'd need to work backward. Instead we use a simple
     * coordinate flip approach:
     *
     * We pack in a virtual container where x'=0 is the physical FRONT (x=cL).
     * After packing, we transform: real_x = cL - (x' + item_l)
     *
     * The extreme-point algorithm naturally fills from x'=0 (physical front)
     * outward, so real boxes appear from the closed end toward the door.
     */
    let eps = [{ x: 0, y: 0, z: 0 }];
    const virtualPlacements = [];
    let totalWeight = 0;

    for (const item of items) {
      if (item.wt && totalWeight + item.wt > maxWeight) continue;

      const orientations = getOrientations(item.l, item.w, item.h, item.rot);
      let best = null;
      let bestScore = Infinity;

      for (const ep of eps) {
        for (const o of orientations) {
          const { l, w, h } = o;

          if (ep.x + l > cL + 0.01) continue;
          if (ep.y + h > cH + 0.01) continue;
          if (ep.z + w > cW + 0.01) continue;

          let overlaps = false;
          for (const p of virtualPlacements) {
            if (
              ep.x < p.x + p.l && ep.x + l > p.x &&
              ep.y < p.y + p.h && ep.y + h > p.y &&
              ep.z < p.z + p.w && ep.z + w > p.z
            ) { overlaps = true; break; }
          }
          if (overlaps) continue;

          /*
           * Score: fill back wall (low X in virtual space = real back/closed end)
           * completely before advancing toward the door.
           * Priority: X first (pack deep), then Y (floor to ceiling), then Z.
           * This fills the full W×H cross-section slice at each depth level
           * before moving toward the door — real-world container loading order.
           */
          const score = ep.x * 1e10 + ep.y * 1e5 + ep.z;
          if (score < bestScore) {
            bestScore = score;
            best = { x: ep.x, y: ep.y, z: ep.z, l, w, h, item };
          }
        }
      }

      if (!best) continue;

      const { x, y, z, l, w, h } = best;
      virtualPlacements.push({ x, y, z, l, w, h, item });
      totalWeight += item.wt;

      eps.push({ x: x + l, y,       z       });
      eps.push({ x,        y: y + h, z       });
      eps.push({ x,        y,        z: z + w });

      const seen2 = new Set();
      eps = eps.filter(ep => {
        if (ep.x >= cL || ep.y >= cH || ep.z >= cW) return false;
        for (const p of virtualPlacements) {
          if (
            ep.x >= p.x && ep.x < p.x + p.l &&
            ep.y >= p.y && ep.y < p.y + p.h &&
            ep.z >= p.z && ep.z < p.z + p.w
          ) return false;
        }
        const key = `${ep.x},${ep.y},${ep.z}`;
        if (seen2.has(key)) return false;
        seen2.add(key);
        return true;
      });
    }

  
    const placements = virtualPlacements.map(p => ({
      ...p,
      x: cL - (p.x + p.l),   // real x start in [0 .. cL]
    }));

    return {
      placements,
      totalWeight,
      totalItems: items.length,
    };
  }

  global.Packer = { pack };

})(window);
