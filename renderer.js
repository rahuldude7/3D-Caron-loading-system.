(function (global) {
  'use strict';

  /* ── private state ── */
  let scene, camera, renderer;
  let meshes  = [];
  let cMesh   = null;
  let CL = 1, CW = 1, CH = 1;
  let exploded = false;
  let wired    = false;

  /* door animation */
  let doorL = null, doorR = null;
  let doorOpen = false;
  let doorAnimId = null;
  let doorTargetAngle = 0;
  let doorCurrentAngle = 0;

  let containerGroup = null;

  /* raycaster */
  const rc = new THREE.Raycaster();
  const mv = new THREE.Vector2();

  /* ─────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────── */
  function init() {
    const canvas = document.getElementById('canvas3d');

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x1a1a2e);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a1a2e, 0.000045);

    /* ── Lighting ── */
    const amb = new THREE.AmbientLight(0x8ab4d4, 0.65);
    scene.add(amb);

    const sun = new THREE.DirectionalLight(0xfff0d0, 1.1);
    sun.position.set(800, 1500, 600);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 8000;
    sun.shadow.camera.left  = -2000;
    sun.shadow.camera.right =  2000;
    sun.shadow.camera.top   =  2000;
    sun.shadow.camera.bottom = -2000;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x4fc3f7, 0.3);
    fill.position.set(-600, 300, -400);
    scene.add(fill);

    /* Deck floor */
    const deckGeo = new THREE.PlaneGeometry(6000, 6000);
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x1a2a1a });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -1;
    deck.receiveShadow = true;
    deck.name = 'deck';
    scene.add(deck);

    /* Grid */
    const grid = new THREE.GridHelper(3000, 60, 0x2a4a2a, 0x1a2a1a);
    grid.name = 'grid';
    scene.add(grid);

    camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
    camera.position.set(700, 600, 900);
    camera.lookAt(294, 119, 117);

    _setupOrbit(canvas);
    _resize();
    window.addEventListener('resize', _resize);
    _loop();
  }

  /* ─────────────────────────────────────────────
     RENDER LOOP
  ───────────────────────────────────────────── */
  function _loop() {
    requestAnimationFrame(_loop);
    renderer.render(scene, camera);
  }

  /* ─────────────────────────────────────────────
     RESIZE
  ───────────────────────────────────────────── */
  function _resize() {
    const vp = document.getElementById('vp');
    renderer.setSize(vp.clientWidth, vp.clientHeight);
    camera.aspect = vp.clientWidth / vp.clientHeight;
    camera.updateProjectionMatrix();
  }

  /* ─────────────────────────────────────────────
     ORBIT CONTROLS
  ───────────────────────────────────────────── */
  function _setupOrbit(canvas) {
    let drag = false, rightDrag = false, lx = 0, ly = 0;
    const S = { th: 0.8, ph: 0.9, r: 1200 };
    const T = { x: 294, y: 119, z: 117 };

    function update() {
      camera.position.set(
        T.x + S.r * Math.sin(S.ph) * Math.sin(S.th),
        T.y + S.r * Math.cos(S.ph),
        T.z + S.r * Math.sin(S.ph) * Math.cos(S.th)
      );
      camera.lookAt(T.x, T.y, T.z);
    }
    update();
    window._OS = { S, T, update };

    canvas.addEventListener('mousedown', e => {
      drag = true; rightDrag = e.button === 2;
      lx = e.clientX; ly = e.clientY;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mouseup', () => { drag = false; });

    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (rightDrag) {
        T.x -= dx * 1.2;
        T.z -= dy * 1.2;
      } else {
        S.th -= dx * 0.008;
        S.ph = Math.max(0.08, Math.min(Math.PI - 0.08, S.ph + dy * 0.008));
      }
      update();
    });

    canvas.addEventListener('wheel', e => {
      S.r = Math.max(80, Math.min(8000, S.r + e.deltaY * 1.2));
      update();
    }, { passive: true });

    let touches = [], lastPinch = 0;
    canvas.addEventListener('touchstart', e => { touches = [...e.touches]; lastPinch = 0; }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touches[0].clientX;
        const dy = e.touches[0].clientY - touches[0].clientY;
        S.th -= dx * 0.012;
        S.ph = Math.max(0.08, Math.min(Math.PI - 0.08, S.ph + dy * 0.012));
        update(); touches = [...e.touches];
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (lastPinch) S.r = Math.max(80, Math.min(8000, S.r - (d - lastPinch) * 3));
        lastPinch = d; update();
      }
    }, { passive: true });
  }

  /* ─────────────────────────────────────────────
     BUILD CONTAINER
     Coordinate system:
       X axis: 0 = REAR/DOOR end,  cL = FRONT/closed end
       Y axis: 0 = floor,          cH = roof
       Z axis: 0 = left side,      cW = right side

     The rear face (x=0) has two doors.

     DOOR GEOMETRY & ROTATION — the key insight:
       Each door panel is a PlaneGeometry sitting in the ZY plane at x=0.
       The panel's local geometry is centered at origin of the pivot group.
       
       Left door:
         - Hinge edge at z=0 (left side of container rear)
         - Panel extends from z=0 to z=cW/2
         - Local: panel center is at z = +dHalfW/2 inside pivot group
         - Pivot group world position: (0, cH/2, 0)
         - OPEN = rotate pivot group by -PI/2 around Y
           → panel swings from ZY plane into XZ plane, going to NEGATIVE Z (outside)
           
       Right door:
         - Hinge edge at z=cW (right side of container rear)
         - Panel extends from z=cW/2 to z=cW
         - Local: panel center is at z = -dHalfW/2 inside pivot group
         - Pivot group world position: (0, cH/2, cW)
         - OPEN = rotate pivot group by +PI/2 around Y
           → panel swings from ZY plane into XZ plane, going to POSITIVE Z (outside)
  ───────────────────────────────────────────── */
  function _buildContainer(cL, cW, cH) {
    if (containerGroup) {
      scene.remove(containerGroup);
      containerGroup = null;
    }
    doorL = null; doorR = null;
    doorOpen = false;
    doorCurrentAngle = 0;
    doorTargetAngle  = 0;

    containerGroup = new THREE.Group();

    const steelMat = new THREE.MeshLambertMaterial({
      color: 0x2f81f7, transparent: true, opacity: 0.03, side: THREE.BackSide
    });
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xF59E0B, transparent: true, opacity: 0.7
    });
    const wallMat = new THREE.MeshLambertMaterial({
      color: 0x4a90d9, transparent: true, opacity: 0.06, side: THREE.DoubleSide
    });

    /* Ghost box */
    const cGeo = new THREE.BoxGeometry(cL, cH, cW);
    const ghost = new THREE.Mesh(cGeo, steelMat);
    ghost.position.set(cL / 2, cH / 2, cW / 2);
    containerGroup.add(ghost);

    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(cGeo), edgeMat);
    edge.position.copy(ghost.position);
    containerGroup.add(edge);

    /* Side walls (left z=0, right z=cW) */
    const sideGeo = new THREE.PlaneGeometry(cL, cH);
    const sideL = new THREE.Mesh(sideGeo, wallMat);
    sideL.position.set(cL / 2, cH / 2, 0);
    containerGroup.add(sideL);

    const sideR = new THREE.Mesh(sideGeo.clone(), wallMat);
    sideR.position.set(cL / 2, cH / 2, cW);
    containerGroup.add(sideR);

    /* Roof */
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(cL, cW), wallMat);
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(cL / 2, cH, cW / 2);
    containerGroup.add(roof);

    /* Front wall (closed end, x=cL) */
    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(cW, cH), wallMat);
    frontWall.rotation.y = Math.PI / 2;
    frontWall.position.set(cL, cH / 2, cW / 2);
    containerGroup.add(frontWall);

    /* Floor */
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(cL, cW),
      new THREE.MeshLambertMaterial({ color: 0x2a1a0a, transparent: true, opacity: 0.7 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(cL / 2, 0, cW / 2);
    floorMesh.receiveShadow = true;
    containerGroup.add(floorMesh);

    /* Horizontal ribs on side walls */
    const ribMat = new THREE.LineBasicMaterial({ color: 0x1a4a8a, transparent: true, opacity: 0.4 });
    for (let rib = 0; rib < 6; rib++) {
      const y = (cH / 7) * (rib + 1);
      [[0, 0, cL, 0], [0, cW, cL, cW]].forEach(([x0, z0, x1, z1]) => {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z1)
        ]);
        containerGroup.add(new THREE.LineSegments(geo, ribMat));
      });
    }

    /* ════════════════════════════════════════
       REAR DOORS  (at x=0 face)
       
       Strategy: build each door as a box (thin slab) so it has
       physical thickness and looks solid from both sides.
       
       The pivot group is placed at the HINGE WORLD POSITION.
       The door slab is offset inside the group so the hinge edge
       sits at the group's local origin.
       
       Opening direction:
         Left  door rotates around Y at z=0:  angle goes 0 → -π/2
           (swings the free end from z=+dHalfW outward to x=-dHalfW)
         Right door rotates around Y at z=cW: angle goes 0 → +π/2
           (swings the free end from z=-dHalfW outward to x=+dHalfW)
    ════════════════════════════════════════ */
    const dHalfW  = cW / 2;
    const dH      = cH - 4;
    const dThick  = 5;   // door thickness (cm)
    const OPEN_ANGLE = Math.PI / 2; // 90° open

    const doorPaintMat = new THREE.MeshLambertMaterial({ color: 0x1e4a8a });
    const doorEdgeMat2 = new THREE.LineBasicMaterial({ color: 0xF59E0B, transparent: true, opacity: 0.9 });
    const handleMat   = new THREE.MeshLambertMaterial({ color: 0xcccccc });

    /* ── LEFT DOOR ──
       Hinge: world (0, cH/2, 0)  — left edge of rear face
       Slab local: BoxGeometry(dThick, dH, dHalfW)
         center at local (0, 0, dHalfW/2)  → free end at local z=dHalfW
       Closed: slab lies in ZY plane (x≈0, z=[0..dHalfW])
       Open: pivot rotates -π/2 around Y → free end moves to world x=-dHalfW
    */
    {
      const slabGeo  = new THREE.BoxGeometry(dThick, dH, dHalfW);
      const slabMesh = new THREE.Mesh(slabGeo, doorPaintMat);
      slabMesh.position.set(0, 0, dHalfW / 2);   // hinge edge at local z=0
      slabMesh.castShadow = true;

      const slabEdge = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), doorEdgeMat2);
      slabEdge.position.copy(slabMesh.position);

      /* Handle: near free end of door */
      const handle = new THREE.Mesh(new THREE.BoxGeometry(8, 60, 6), handleMat);
      handle.position.set(dThick / 2 + 2, 0, dHalfW - 12);

      /* Lock rod */
      const lock = new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3, dH * 0.55, 6),
        new THREE.MeshLambertMaterial({ color: 0xaaaaaa })
      );
      lock.position.set(0, 0, dHalfW - 20);

      doorL = new THREE.Group();
      doorL.position.set(0, cH / 2, 0);   // pivot at hinge
      doorL.add(slabMesh, slabEdge, handle, lock);
      containerGroup.add(doorL);
    }

    /* ── RIGHT DOOR ──
       Hinge: world (0, cH/2, cW)  — right edge of rear face
       Slab local: center at local (0, 0, -dHalfW/2) → free end at local z=-dHalfW
       Open: pivot rotates +π/2 around Y → free end moves to world x=+dHalfW (outside)
    */
    {
      const slabGeo  = new THREE.BoxGeometry(dThick, dH, dHalfW);
      const slabMesh = new THREE.Mesh(slabGeo, doorPaintMat);
      slabMesh.position.set(0, 0, -dHalfW / 2);  // hinge edge at local z=0
      slabMesh.castShadow = true;

      const slabEdge = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), doorEdgeMat2);
      slabEdge.position.copy(slabMesh.position);

      const handle = new THREE.Mesh(new THREE.BoxGeometry(8, 60, 6), handleMat);
      handle.position.set(dThick / 2 + 2, 0, -dHalfW + 12);

      const lock = new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3, dH * 0.55, 6),
        new THREE.MeshLambertMaterial({ color: 0xaaaaaa })
      );
      lock.position.set(0, 0, -dHalfW + 20);

      doorR = new THREE.Group();
      doorR.position.set(0, cH / 2, cW);  // pivot at hinge
      doorR.add(slabMesh, slabEdge, handle, lock);
      containerGroup.add(doorR);
    }

    containerGroup.userData.openAngle = OPEN_ANGLE;

    scene.add(containerGroup);
    cMesh = ghost;

    return containerGroup;
  }

  /* ─────────────────────────────────────────────
     DOOR ANIMATION
     Left  door: rotation.y: 0 → -π/2  (swings outward to negative-Z side)
     Right door: rotation.y: 0 → +π/2  (swings outward to positive-Z side)
  ───────────────────────────────────────────── */
  function toggleDoor() {
    doorOpen = !doorOpen;
    const openAngle = (containerGroup && containerGroup.userData.openAngle) || Math.PI / 2;
    doorTargetAngle = doorOpen ? openAngle : 0;
    _animateDoor();

    const btn = document.getElementById('doorBtn');
    if (btn) btn.textContent = doorOpen ? '🔓 Close Door' : '🚪 Open Door';
  }

  function _animateDoor() {
    if (doorAnimId) cancelAnimationFrame(doorAnimId);
    const step = () => {
      if (!doorL || !doorR) return;
      const diff = doorTargetAngle - doorCurrentAngle;
      if (Math.abs(diff) < 0.003) {
        doorCurrentAngle = doorTargetAngle;
        doorL.rotation.y = -doorCurrentAngle;   // left:  swings outward = negative Y rotation
        doorR.rotation.y = +doorCurrentAngle;   // right: swings outward = positive Y rotation
        return;
      }
      doorCurrentAngle += diff * 0.07;
      doorL.rotation.y = -doorCurrentAngle;
      doorR.rotation.y = +doorCurrentAngle;
      doorAnimId = requestAnimationFrame(step);
    };
    step();
  }

  /* ─────────────────────────────────────────────
     SHOW EMPTY CONTAINER (no cartons)
  ───────────────────────────────────────────── */
  function showEmptyContainer(cL, cW, cH) {
    CL = cL; CW = cW; CH = cH;

    meshes.forEach(m => scene.remove(m));
    meshes = [];

    _buildContainer(CL, CW, CH);

    const grid = scene.getObjectByName('grid');
    if (grid) {
      grid.position.set(CL / 2, -0.5, CW / 2);
      grid.scale.set(CL / 2000, 1, CW / 2000);
    }
    const deck = scene.getObjectByName('deck');
    if (deck) deck.position.set(0, -1, 0);

    if (window._OS) {
      const os = window._OS;
      os.T.x = CL / 2; os.T.y = CH / 4; os.T.z = CW / 2;
      os.S.r = Math.max(CL, CW, CH) * 2.4;
      os.update();
    }

    exploded = false; wired = false;
    document.getElementById('vpEx').classList.remove('on');
    document.getElementById('vpWf').classList.remove('on');

    // Ensure door is closed for empty container view
    if (doorOpen) toggleDoor();
  }

  /* ─────────────────────────────────────────────
     BUILD SCENE FROM PLACEMENTS — animated
     Cartons appear one-by-one, back-to-front
     (highest x first = back wall first)
  ───────────────────────────────────────────── */
  let _placeAnimId = null;

  function buildScene(containerDims, placements) {
    CL = containerDims.l;
    CW = containerDims.w;
    CH = containerDims.h;

    // Cancel any running placement animation
    if (_placeAnimId) { clearTimeout(_placeAnimId); _placeAnimId = null; }

    meshes.forEach(m => scene.remove(m));
    meshes = [];

    _buildContainer(CL, CW, CH);

    const grid = scene.getObjectByName('grid');
    if (grid) {
      grid.position.set(CL / 2, -0.5, CW / 2);
      grid.scale.set(CL / 2000, 1, CW / 2000);
    }
    const deck = scene.getObjectByName('deck');
    if (deck) deck.position.set(0, -1, 0);

    if (window._OS) {
      const os = window._OS;
      os.T.x = CL / 2; os.T.y = CH / 4; os.T.z = CW / 2;
      os.S.r = Math.max(CL, CW, CH) * 2.4;
      os.update();
    }

    exploded = false;
    wired    = false;
    document.getElementById('vpEx').classList.remove('on');
    document.getElementById('vpWf').classList.remove('on');

    // Sort placements back-to-front: highest x (back wall) first
    const sorted = [...placements].sort((a, b) => (b.x + b.l / 2) - (a.x + a.l / 2));

    // Open door before animation starts
    if (!doorOpen) {
      setTimeout(() => { if (!doorOpen) toggleDoor(); }, 200);
    }

    // Animate placements one-by-one with a short stagger
    const DELAY = Math.min(60, Math.max(18, 1800 / sorted.length)); // adaptive speed
    let idx = 0;

    function placeNext() {
      if (idx >= sorted.length) {
        _placeAnimId = null;
        return;
      }
      const p = sorted[idx];
      const i = placements.indexOf(p); // preserve original index for tooltip

      const geo = new THREE.BoxGeometry(p.l - 1.2, p.h - 1.2, p.w - 1.2);
      const mat = new THREE.MeshLambertMaterial({ color: p.item.color, transparent: true, opacity: 0.88 });
      const mesh = new THREE.Mesh(geo, mat);

      const finalX = p.x + p.l / 2;
      const finalY = p.y + p.h / 2;
      const finalZ = p.z + p.w / 2;

      // Start position: slide in from the door end (x=0 side), slightly outside
      mesh.position.set(-p.l * 2, finalY, finalZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { ...p, index: i };
      scene.add(mesh);
      meshes.push(mesh);

      const edgeLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
      );
      edgeLine.position.copy(mesh.position);
      scene.add(edgeLine);
      meshes.push(edgeLine);

      // Smooth slide-in animation toward final position
      let t = 0;
      function slideStep() {
        t += 0.14;
        if (t >= 1) {
          mesh.position.set(finalX, finalY, finalZ);
          edgeLine.position.copy(mesh.position);
          return;
        }
        const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
        mesh.position.x = -p.l * 2 + (finalX - (-p.l * 2)) * ease;
        edgeLine.position.copy(mesh.position);
        requestAnimationFrame(slideStep);
      }
      slideStep();

      idx++;
      _placeAnimId = setTimeout(placeNext, DELAY);
    }

    // Small initial pause so door starts opening first
    _placeAnimId = setTimeout(placeNext, 500);
  }

  /* ─────────────────────────────────────────────
     CAMERA PRESETS
  ───────────────────────────────────────────── */
  function setCameraPreset(preset) {
    ['vpPersp', 'vpFront', 'vpTop', 'vpSide'].forEach(id =>
      document.getElementById(id).classList.remove('on')
    );
    if (!window._OS) return;
    const { S, update } = window._OS;
    const r = Math.max(CL, CW, CH) * 2.4;
    switch (preset) {
      case 'persp': S.th = 0.8;       S.ph = 0.9;         S.r = r;       document.getElementById('vpPersp').classList.add('on'); break;
      case 'front': S.th = 0;         S.ph = Math.PI / 2; S.r = r;       document.getElementById('vpFront').classList.add('on'); break;
      case 'top':   S.th = 0;         S.ph = 0.06;        S.r = r * 1.2; document.getElementById('vpTop').classList.add('on');   break;
      case 'side':  S.th = Math.PI/2; S.ph = Math.PI / 2; S.r = r;       document.getElementById('vpSide').classList.add('on');  break;
    }
    update();
  }

  /* ─────────────────────────────────────────────
     EXPLODE MODE
  ───────────────────────────────────────────── */
  function toggleExplode() {
    exploded = !exploded;
    document.getElementById('vpEx').classList.toggle('on', exploded);
    meshes.filter(m => m.isMesh && m.userData.item).forEach(m => {
      const d = m.userData;
      if (exploded) {
        const cx = d.x + d.l / 2 - CL / 2;
        const cy = d.y + d.h / 2 - CH / 2;
        const cz = d.z + d.w / 2 - CW / 2;
        const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
        m.position.set(
          d.x + d.l / 2 + (cx / len) * 90,
          d.y + d.h / 2 + (cy / len) * 90,
          d.z + d.w / 2 + (cz / len) * 90
        );
      } else {
        m.position.set(d.x + d.l / 2, d.y + d.h / 2, d.z + d.w / 2);
      }
    });
  }

  /* ─────────────────────────────────────────────
     WIREFRAME MODE
  ───────────────────────────────────────────── */
  function toggleWireframe() {
    wired = !wired;
    document.getElementById('vpWf').classList.toggle('on', wired);
    meshes.filter(m => m.isMesh && m.userData.item).forEach(m => {
      m.material.wireframe = wired;
      m.material.opacity   = wired ? 0.55 : 0.88;
    });
  }

  /* ─────────────────────────────────────────────
     HOVER TOOLTIP
  ───────────────────────────────────────────── */
  function initTooltip() {
    const vpEl = document.getElementById('vp');
    const tt   = document.getElementById('tt');

    vpEl.addEventListener('mousemove', e => {
      const rect = vpEl.getBoundingClientRect();
      mv.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mv.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

      rc.setFromCamera(mv, camera);
      const hits = rc.intersectObjects(meshes.filter(m => m.isMesh));

      if (hits.length && hits[0].object.userData.item) {
        const d = hits[0].object.userData;
        const hex = '#' + d.item.color.toString(16).padStart(6, '0');
        document.getElementById('ttS').style.background = hex;
        document.getElementById('ttT').textContent  = d.item.sku;
        document.getElementById('ttSz').textContent = `${d.l}×${d.w}×${d.h}`;
        document.getElementById('ttP').textContent  = `${d.x.toFixed(0)}, ${d.y.toFixed(0)}, ${d.z.toFixed(0)}`;
        document.getElementById('ttW').textContent  = `${d.item.wt} kg`;
        document.getElementById('ttI').textContent  = `#${d.index + 1}`;
        tt.style.display = 'block';
        tt.style.left    = (e.clientX - rect.left + 14) + 'px';
        tt.style.top     = (e.clientY - rect.top  - 10) + 'px';
      } else {
        tt.style.display = 'none';
      }
    });
    vpEl.addEventListener('mouseleave', () => { tt.style.display = 'none'; });
  }

  /* ─────────────────────────────────────────────
     CLEAR SCENE
  ───────────────────────────────────────────── */
  function clearScene() {
    meshes.forEach(m => scene.remove(m));
    meshes = [];
    if (containerGroup) { scene.remove(containerGroup); containerGroup = null; }
    cMesh = null;
    doorL = null; doorR = null;
    exploded = false;
    wired    = false;
  }

  global.Renderer = {
    init,
    initTooltip,
    buildScene,
    showEmptyContainer,
    setCameraPreset,
    toggleExplode,
    toggleWireframe,
    clearScene,
    toggleDoor,
  };

})(window);
