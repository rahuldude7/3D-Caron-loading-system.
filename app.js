(function () {
  'use strict';

  /* ── CONSTANTS ── */
  const COLORS = [
    0xF59E0B, 0x2DD4BF, 0x818CF8, 0x34D399,
    0xF472B6, 0x60A5FA, 0xFB923C, 0xA78BFA,
    0x4ADE80, 0xFACC15, 0x38BDF8, 0xF87171,
  ];

  // FCL = Full Container Load, LCL = Less-than-Container Load
  const PRESETS = {
    20:    [589,  234, 239, 21700, 'FCL'],
    40:    [1203, 234, 239, 26680, 'FCL'],
    hc:    [1203, 234, 269, 26480, 'FCL'],
    lt:    [1360, 248, 278, 15000, 'FCL'],
    lcl20: [589,  234, 239, 10000, 'LCL'],  // half-load LCL in 20ft
    lcl40: [1203, 234, 239, 14000, 'LCL'],  // half-load LCL in 40ft
  };

  /* ── STATE ── */
  let types    = [];
  let places   = [];
  let colorIdx = 0;
  let currentMode = 'FCL';   // 'FCL' or 'LCL'

  /* ─────────────────────────────────────────────
     FCL / LCL MODE TOGGLE
  ───────────────────────────────────────────── */
  function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('mode' + mode).classList.add('active');

    const badge = document.getElementById('modeBadge');
    const info  = document.getElementById('modeInfo');
    if (mode === 'FCL') {
      badge.textContent = 'FCL';
      badge.className   = 'mode-badge fcl';
      info.textContent  = 'Full Container Load — entire container reserved for one shipper.';
    } else {
      badge.textContent = 'LCL';
      badge.className   = 'mode-badge lcl';
      info.textContent  = 'Less-than-Container Load — shared container, partial fill.';
    }

    // Show/hide LCL utilization warning threshold
    const lclNote = document.getElementById('lclNote');
    if (lclNote) lclNote.style.display = mode === 'LCL' ? 'block' : 'none';
  }

  /* ─────────────────────────────────────────────
     CONTAINER PRESETS
  ───────────────────────────────────────────── */
  function setPreset(type, el) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    const [l, w, h, wt, mode] = PRESETS[type];
    document.getElementById('cL').value     = l;
    document.getElementById('cW').value     = w;
    document.getElementById('cH').value     = h;
    document.getElementById('cMaxWt').value = wt;
    if (mode) setMode(mode);
  }

  /* ─────────────────────────────────────────────
     ADD CARTON TYPE
  ───────────────────────────────────────────── */
  function addCarton() {
    const l   = +document.getElementById('bL').value;
    const w   = +document.getElementById('bW').value;
    const h   = +document.getElementById('bH').value;
    const qty = +document.getElementById('bQty').value || 1;
    const wt  = +document.getElementById('bWt').value  || 0;
    const sku = document.getElementById('bSKU').value.trim()
                || `SKU-${String(types.length + 1).padStart(3, '0')}`;
    const rot = +document.getElementById('bRot').value;
    const fb  = document.getElementById('fb');

    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0) {
      fb.innerHTML = '<div class="feedback fb-warn">Enter valid L, W, H (all > 0)</div>';
      return;
    }

    const color = COLORS[colorIdx % COLORS.length];
    colorIdx++;
    types.push({ l, w, h, qty, wt, sku, rot, color, id: Date.now() });

    fb.innerHTML = `<div class="feedback fb-ok">Added ${qty}× ${sku} (${l}×${w}×${h} cm)</div>`;
    _renderCartonList();
    ['bL', 'bW', 'bH', 'bQty', 'bWt', 'bSKU'].forEach(id => {
      document.getElementById(id).value = '';
    });
  }

  function removeType(id) {
    types = types.filter(t => t.id !== id);
    _renderCartonList();
  }

  function _renderCartonList() {
    const el  = document.getElementById('cartonList');
    const ctC = document.getElementById('ctC');
    ctC.textContent = types.length ? `(${types.length})` : '';

    if (!types.length) {
      el.innerHTML = '<div class="empty-note">No types added yet.</div>';
      return;
    }

    el.innerHTML = types.map(t => {
      const hex = '#' + t.color.toString(16).padStart(6, '0');
      return `
        <div class="carton-row">
          <div class="c-swatch" style="background:${hex}"></div>
          <div class="c-info">
            <div class="c-name">${t.sku}</div>
            <div class="c-meta">${t.l}×${t.w}×${t.h} cm · ${t.qty} pcs · ${t.wt}kg</div>
          </div>
          <button class="c-del" onclick="App.removeType(${t.id})">✕</button>
        </div>`;
    }).join('');
  }

  /* ─────────────────────────────────────────────
     RUN OPTIMIZATION
  ───────────────────────────────────────────── */
  function run() {
    const fb = document.getElementById('fb');

    if (!types.length) {
      fb.innerHTML = '<div class="feedback fb-warn">Add at least one carton type first.</div>';
      return;
    }

    const cL    = +document.getElementById('cL').value;
    const cW    = +document.getElementById('cW').value;
    const cH    = +document.getElementById('cH').value;
    const maxWt = +document.getElementById('cMaxWt').value || Infinity;

    if (!cL || !cW || !cH) {
      fb.innerHTML = '<div class="feedback fb-warn">Set container dimensions first.</div>';
      return;
    }

    // LCL: apply 60% fill cap (shared container, reserved space for other shippers)
    const effectiveVol = currentMode === 'LCL'
      ? cL * cW * cH * 0.60
      : cL * cW * cH;

    const result = Packer.pack(cL, cW, cH, maxWt, types);
    places = result.placements;

    // For LCL, trim placements to 60% volume cap
    if (currentMode === 'LCL') {
      let cumVol = 0;
      places = places.filter(p => {
        cumVol += p.l * p.w * p.h;
        return cumVol <= effectiveVol;
      });
    }

    const cVol  = cL * cW * cH;
    const pVol  = places.reduce((s, p) => s + p.l * p.w * p.h, 0);
    const util  = (pVol / cVol) * 100;
    const totReq = types.reduce((s, t) => s + t.qty, 0);
    const ys    = places.map(p => p.y + p.h);
    const maxH  = ys.length ? Math.max(...ys) : 0;
    const layers = places.length ? new Set(places.map(p => Math.round(p.y))).size : 0;

    // Utilisation colour — LCL warns above 60%
    const utilColor = currentMode === 'LCL'
      ? (util > 60 ? 'var(--red)' : util > 40 ? 'var(--amber)' : 'var(--green)')
      : (util > 80 ? 'var(--green)' : util > 55 ? 'var(--amber)' : 'var(--red)');

    _setStat('sv1', `${util.toFixed(1)}<span class="u"> %</span>`);
    _setBar('sb1', util, utilColor);

    _setStat('sv2', places.length);
    document.getElementById('ss2').textContent = `of ${totReq} requested`;

    _setStat('sv3', `${result.totalWeight.toFixed(0)}<span class="u"> kg</span>`);
    _setBar('sb3', result.totalWeight / (maxWt || result.totalWeight || 1) * 100, 'var(--indigo)');

    _setStat('sv4', layers);
    document.getElementById('ss4').textContent = `height ${maxH.toFixed(0)} cm`;

    _setStat('sv5', `${(cVol / 1e6).toFixed(2)}<span class="u"> m³</span>`);
    document.getElementById('ss5').textContent = `${(pVol / 1e6).toFixed(2)} m³ packed`;

    // Mode badge in stats
    const modeStat = document.getElementById('svMode');
    if (modeStat) {
      modeStat.innerHTML = `<span class="mode-badge ${currentMode.toLowerCase()}">${currentMode}</span>`;
    }

    Renderer.buildScene({ l: cL, w: cW, h: cH }, places);
    _renderManifest();
    _renderLegend();
    fb.innerHTML = '';
  }

  /* ─────────────────────────────────────────────
     CLEAR ALL
  ───────────────────────────────────────────── */
  function clearAll() {
    types = []; places = []; colorIdx = 0;
    _renderCartonList();
    document.getElementById('fb').innerHTML = '';
    document.getElementById('mBody').innerHTML =
      '<tr><td colspan="9" class="no-data">Run optimization to see placement manifest.</td></tr>';
    document.getElementById('mBadge').textContent = '0 placements';
    document.getElementById('legItems').innerHTML =
      '<div style="font-size:11px;color:var(--muted2)">Run to visualize</div>';

    ['sv1','sv2','sv3','sv4','sv5'].forEach(id =>
      document.getElementById(id).innerHTML = '—'
    );
    document.getElementById('ss2').textContent = 'of — requested';
    document.getElementById('ss4').textContent = 'height —';
    document.getElementById('ss5').textContent = '— m³ packed';
    ['sb1','sb3'].forEach(id => document.getElementById(id).style.width = '0%');

    Renderer.clearScene();
  }

  /* ─────────────────────────────────────────────
     MANIFEST TABLE
  ───────────────────────────────────────────── */
  function _renderManifest() {
    document.getElementById('mBadge').textContent = `${places.length} placements`;

    if (!places.length) {
      document.getElementById('mBody').innerHTML =
        '<tr><td colspan="9" class="no-data">No placements generated.</td></tr>';
      return;
    }

    document.getElementById('mBody').innerHTML = places.map((p, i) => {
      const hex     = '#' + p.item.color.toString(16).padStart(6, '0');
      const isNative = p.l === p.item.l && p.w === p.item.w && p.h === p.item.h;
      const vol     = (p.l * p.w * p.h / 1e6).toFixed(4);
      return `
        <tr>
          <td class="mono">${i + 1}</td>
          <td>
            <span style="display:inline-block;width:7px;height:7px;border-radius:2px;
              background:${hex};margin-right:5px;vertical-align:middle"></span>
            ${p.item.sku}
          </td>
          <td class="mono">${p.l}×${p.w}×${p.h}</td>
          <td class="mono">${p.x.toFixed(0)}</td>
          <td class="mono">${p.y.toFixed(0)}</td>
          <td class="mono">${p.z.toFixed(0)}</td>
          <td style="color:var(--muted2)">${isNative ? 'L×W×H' : 'rotated'}</td>
          <td class="mono">${p.item.wt}</td>
          <td class="mono">${vol}</td>
        </tr>`;
    }).join('');
  }

  /* ─────────────────────────────────────────────
     LEGEND
  ───────────────────────────────────────────── */
  function _renderLegend() {
    document.getElementById('legItems').innerHTML = types.map(t => {
      const hex = '#' + t.color.toString(16).padStart(6, '0');
      return `
        <div class="leg-item">
          <div class="leg-swatch" style="background:${hex}"></div>
          <span>${t.sku} ×${t.qty}</span>
        </div>`;
    }).join('');
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */
  function _setStat(id, html) { document.getElementById(id).innerHTML = html; }
  function _setBar(id, pct, color) {
    const el = document.getElementById(id);
    el.style.width      = Math.min(pct, 100) + '%';
    el.style.background = color;
  }

  /* ─────────────────────────────────────────────
     GENERATE PDF REPORT
  ───────────────────────────────────────────── */
  function generateReport() {
    const fb = document.getElementById('fb');
    if (!places.length) {
      fb.innerHTML = '<div class="feedback fb-warn">Run optimization first before generating a report.</div>';
      return;
    }
    if (!window.jspdf) {
      fb.innerHTML = '<div class="feedback fb-warn">PDF library not loaded — check internet connection.</div>';
      return;
    }

    const cL    = +document.getElementById('cL').value;
    const cW    = +document.getElementById('cW').value;
    const cH    = +document.getElementById('cH').value;
    const maxWt = +document.getElementById('cMaxWt').value || 99999;

    const runId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const now   = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
    const totalWeight = places.reduce((s, p) => s + (p.item.wt || 0), 0);

    ReportGen.generate({
      containerL:  cL,
      containerW:  cW,
      containerH:  cH,
      maxWeight:   maxWt,
      placements:  places,
      cartonTypes: types,
      totalWeight,
      runId,
      timestamp:   now,
      mode:        currentMode,
    });

    fb.innerHTML = '<div class="feedback fb-ok">✓ PDF report downloaded.</div>';
  }

  /* ─────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────── */
  function _boot() {
    Renderer.init();
    Renderer.initTooltip();
    setMode('FCL');
    // Start completely empty — no demo cartons, no auto-run
    document.getElementById('fb').innerHTML = '';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  window.App = {
    setPreset,
    addCarton,
    removeType,
    run,
    clearAll,
    generateReport,
    setMode,
    cam:           p  => Renderer.setCameraPreset(p),
    toggleExplode: ()  => Renderer.toggleExplode(),
    toggleWire:    ()  => Renderer.toggleWireframe(),
    toggleDoor:    ()  => Renderer.toggleDoor(),
  };

})();
