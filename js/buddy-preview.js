/* ==========================================================================
   Elden Earth — Buddy 3D Preview
   Reusable Three.js GLB viewer used by the battle screen, the tame/capture
   screen and the buddy bag detail. Handles:
     - fresh-instance parsing of the two Gen-0 models (voodoo / robot)
     - per-instance color hue tint (every wild buddy is a different shade)
     - progressive cosmetic attachments driven by BuddyData.CUSTOMIZATION_TIERS
     - idle/walk/play animation playback where the model supports it
   ========================================================================== */
const BuddyPreview = (() => {
  "use strict";

  const MODEL_PATHS = {
    // Merged by tools/merge-voodoo.js: rig + mesh + BOTH Mixamo clips renamed
    // to "idle" / "running". The two original exports each carried a full
    // duplicate of the 117k-vert mesh, so one merged file halves the download
    // and is the only way to tell the clips apart at runtime (both were
    // exported with the name "mixamo.com").
    voodoo: "models/Voodoo-Dool-Animated.glb",
    robot:  "models/RobotExpressive.glb",
  };

  // Raw GLB bytes are cached; each preview re-parses them so two previews can
  // exist at once without sharing (and fighting over) one material set.
  const rawCache = {};
  const loaderCache = { loader: null };

  function getLoader() {
    if (!loaderCache.loader) {
      if (typeof THREE === "undefined" || !THREE.GLTFLoader) return null;
      loaderCache.loader = new THREE.GLTFLoader();
    }
    return loaderCache.loader;
  }

  function fetchRaw(modelKey, cb) {
    const path = MODEL_PATHS[modelKey] || MODEL_PATHS.robot;
    if (rawCache[path]) { cb(null, rawCache[path]); return; }

    fetch(path)
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then(buf => { rawCache[path] = buf; cb(null, buf); })
      .catch(err => cb(err || new Error("model load failed")));
  }

  /* ------------------------------------------------------- Hue tinting */
  // `hueOrHsl` is either a 0..1 hue or a {h,s,l} triple from the buddy's
  // rolled colorway. Using the stored triple is what keeps a buddy labelled
  // "Ivory" actually looking ivory instead of whatever the hue wheel says.
  function resolveColor(hueOrHsl) {
    const c = new THREE.Color();
    if (hueOrHsl === null || hueOrHsl === undefined) {
      // No rolled colour (classic untinted companion) — neutral, not NaN.
      c.setHSL(0, 0, 0.55);
      return c;
    }
    if (typeof hueOrHsl === "object") {
      c.setHSL(
        ((hueOrHsl.h % 1) + 1) % 1,
        Math.max(0, Math.min(1, hueOrHsl.s == null ? 0.62 : hueOrHsl.s)),
        Math.max(0, Math.min(1, hueOrHsl.l == null ? 0.52 : hueOrHsl.l))
      );
    } else {
      c.setHSL(((hueOrHsl % 1) + 1) % 1, 0.62, 0.52);
    }
    return c;
  }

  // Textures (the voodoo doll's fabric/camo maps) keep their detail because
  // `color` multiplies the map rather than replacing it.
  function tintObject(root, hueOrHsl, strength) {
    const s = (typeof strength === "number") ? strength : 0.85;
    const base = resolveColor(hueOrHsl);

    root.traverse(obj => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        if (!mat) return;
        try {
          if (!mat.userData.__buddyOrig) {
            mat.userData.__buddyOrig = {
              color: mat.color ? mat.color.clone() : null,
              emissive: mat.emissive ? mat.emissive.clone() : null,
            };
          }
          if (mat.color) {
            const orig = mat.userData.__buddyOrig.color || new THREE.Color(1, 1, 1);
            mat.color.copy(orig).lerp(base, s);
          }
          if (mat.emissive) {
            mat.emissive.copy(base).multiplyScalar(0.16);
          }
          if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.55;
          mat.needsUpdate = true;
        } catch (e) {}
      });
    });
    return base;
  }

  /* --------------------------------------------------- Cosmetics layer */
  // Simple additive geometry decorations driven by the buddy's unlocked
  // customization slots. Kept primitive on purpose — cheap to build and
  // dispose, and reads clearly at preview scale.
  function buildCosmetics(group, hueOrHsl, customization, size) {
    const clean = [];
    const col = resolveColor(hueOrHsl);
    const S = size || 1;

    function add(mesh) { group.add(mesh); clean.push(mesh); return mesh; }

    const c = customization || {};
    const height = 1.6 * S;

    if (c.eyes) {
      [-1, 1].forEach(side => {
        const g = new THREE.SphereGeometry(0.055 * S, 10, 10);
        const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 });
        const eye = new THREE.Mesh(g, m);
        eye.position.set(side * 0.13 * S, height * 0.78, 0.22 * S);
        add(eye);
      });
    }

    if (c.aura) {
      const strong = c.aura === "aura_b" || c.aura === "aura_c" || c.aura === "ascendant";
      const g = new THREE.TorusGeometry((strong ? 0.72 : 0.52) * S, 0.035 * S, 10, 42);
      const m = new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: strong ? 0.55 : 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(g, m);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = height * 0.45;
      ring.userData.spin = 0.6;
      add(ring);

      if (strong) {
        const g2 = new THREE.TorusGeometry(0.92 * S, 0.022 * S, 8, 40);
        const ring2 = new THREE.Mesh(g2, m.clone());
        ring2.rotation.x = Math.PI / 2;
        ring2.position.y = height * 0.22;
        ring2.userData.spin = -0.4;
        add(ring2);
      }
    }

    if (c.trail) {
      const ember = c.trail === "trail_b";
      for (let i = 0; i < (ember ? 10 : 6); i++) {
        const g = new THREE.SphereGeometry((ember ? 0.045 : 0.03) * S, 8, 8);
        const m = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: ember ? 0.6 : 0.38,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = new THREE.Mesh(g, m);
        const a = (i / (ember ? 10 : 6)) * Math.PI * 2;
        p.position.set(Math.cos(a) * 0.6 * S, 0.12 * S + i * 0.045 * S, Math.sin(a) * 0.6 * S);
        p.userData.orbit = { a, r: 0.6 * S, speed: 0.5 + i * 0.06 };
        add(p);
      }
    }

    if (c.hat) {
      const helm = c.hat === "hat_b";
      const g = new THREE.ConeGeometry(0.26 * S, (helm ? 0.34 : 0.26) * S, 12);
      const m = new THREE.MeshStandardMaterial({
        color: helm ? 0x8b9bb4 : 0x3d4a63, metalness: helm ? 0.75 : 0.3, roughness: 0.42,
        emissive: col, emissiveIntensity: 0.18,
      });
      const hat = new THREE.Mesh(g, m);
      hat.position.y = height * 0.92;
      add(hat);
    }

    if (c.pattern) {
      for (let i = 0; i < 5; i++) {
        const g = new THREE.TorusGeometry(0.07 * S, 0.012 * S, 6, 16);
        const m = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const rune = new THREE.Mesh(g, m);
        rune.position.set(
          (Math.random() - 0.5) * 0.5 * S,
          height * (0.32 + Math.random() * 0.32),
          0.3 * S
        );
        rune.rotation.z = Math.random() * Math.PI;
        add(rune);
      }
    }

    if (c.wings) {
      [-1, 1].forEach(side => {
        const g = new THREE.PlaneGeometry(0.9 * S, 0.62 * S);
        const m = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const wing = new THREE.Mesh(g, m);
        wing.position.set(side * 0.62 * S, height * 0.62, -0.18 * S);
        wing.rotation.set(0, side * -0.55, side * 0.32);
        wing.userData.flutter = side;
        add(wing);
      });
    }

    if (c.crown) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.24 * S, 0.035 * S, 8, 22),
        new THREE.MeshStandardMaterial({
          color: 0xfbbf24, metalness: 0.9, roughness: 0.25,
          emissive: col, emissiveIntensity: 0.35,
        })
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = height * 0.98;
      add(band);
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.035 * S, 0.13 * S, 6),
          new THREE.MeshStandardMaterial({
            color: 0xfbbf24, metalness: 0.9, roughness: 0.25, emissive: col, emissiveIntensity: 0.4,
          })
        );
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.24 * S, height * 1.06, Math.sin(a) * 0.24 * S);
        add(spike);
      }
    }

    return clean;
  }

  /* -------------------------------------------------------- Preview ctor */
  /**
   * Mount a preview into `container`.
   * @param {HTMLElement} container
   * @param {object} buddy  BuddyEngine instance (or { speciesId, hue, customization, level })
   * @param {object} [opts] { size, background, animate, onReady }
   */
  function create(container, buddy, opts) {
    const o = opts || {};
    const api = {
      disposed: false,
      setBuddy: null,
      playAnim: null,
      dispose: null,
    };

    if (typeof THREE === "undefined" || !THREE.GLTFLoader) {
      container.innerHTML = '<div style="padding:18px;color:#8aa0bd;font-size:12px">3D preview unavailable</div>';
      // Always hand back a working teardown path so callers can dispose()
      // unconditionally in their cleanup blocks.
      api.dispose = () => { api.disposed = true; };
      api.setBuddy = () => {};
      api.playAnim = () => {};
      api.resize = () => {};
      api.capture = () => null;
      return api;
    }

    const width = Math.max(80, container.clientWidth || 200);
    const height = Math.max(80, container.clientHeight || 200);

    const scene = new THREE.Scene();
    if (o.background) scene.background = new THREE.Color(o.background);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 100);
    camera.position.set(0, 1.35, 3.5);
    camera.lookAt(0, 0.85, 0);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      // No WebGL context (old device, blocked context, headless). Degrade to a
      // static placeholder instead of throwing and taking the caller with it.
      container.innerHTML =
        '<div style="padding:18px;color:#8aa0bd;font-size:12px;text-align:center">' +
        (buddy && buddy.nickname ? buddy.nickname : "Buddy") + "<br>3D unavailable</div>";
      api.dispose = () => { api.disposed = true; };
      api.setBuddy = () => {};
      api.playAnim = () => {};
      api.resize = () => {};
      api.capture = () => null;
      return api;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    if (o.background === undefined) renderer.setClearColor(0x000000, 0);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    // Lighting: soft key + cool fill + warm rim so both models read well.
    scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x223044, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-4, 2, -2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xff9a5c, 0.35);
    rim.position.set(0, -2, -4);
    scene.add(rim);

    // Ground shadow disc.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.012;
    scene.add(disc);

    const holder = new THREE.Group();
    scene.add(holder);

    let modelRoot = null;
    let mixer = null;
    let clips = [];
    let currentAction = null;
    let currentClipName = null;
    let hoverState = null;
    let sinkOverride = 0;
    let cosmeticNodes = [];
    let hue = 0.5;
    let raf = 0;
    let t0 = performance.now();
    let yaw = 0;

    function clearModel() {
      if (modelRoot) {
        holder.remove(modelRoot);
        modelRoot.traverse(n => {
          if (n.isMesh) {
            if (n.geometry) n.geometry.dispose();
            const mats = Array.isArray(n.material) ? n.material : [n.material];
            mats.forEach(m => { if (m && m.dispose) m.dispose(); });
          }
        });
        modelRoot = null;
      }
      cosmeticNodes.forEach(n => {
        try {
          holder.remove(n);
          if (n.geometry) n.geometry.dispose();
          if (n.material && n.material.dispose) n.material.dispose();
        } catch (e) {}
      });
      cosmeticNodes = [];
      mixer = null;
      clips = [];
      currentAction = null;
      currentClipName = null;
      hoverState = null;
      sinkOverride = 0;
    }

    function playAnim(name) {
      if (!mixer || !clips.length) return;
      // Semantic name ("walk", "punch") -> whatever the loaded model actually
      // offers. The voodoo doll has idle/running; the robot has 14 clips.
      const best = (typeof BuddyData !== "undefined" && BuddyData.resolveAnim)
        ? BuddyData.resolveAnim(name, clips.map(c => c.name))
        : null;
      const clip = (best && clips.find(c => c.name === best)) || clips[0];
      if (!clip) return;

      // Never restart a clip that is already playing. Several semantic names
      // ("walk"/"run"/"jump") collapse onto the voodoo doll's single "running"
      // clip, and action.reset() on each call would twitch the model.
      if (currentClipName === clip.name && currentAction) return;
      currentClipName = clip.name;

      try {
        const action = mixer.clipAction(clip);
        if (currentAction && currentAction !== action) {
          currentAction.fadeOut(0.22);
          action.reset().fadeIn(0.22).play();
        } else {
          action.reset().play();
        }
        currentAction = action;
      } catch (e) {}
    }

    function setBuddy(nextBuddy, nextOpts) {
      if (api.disposed) return;
      const bo = nextOpts || {};
      const sp = BuddyData.getSpecies(nextBuddy.speciesId);
      const modelKey = (sp && sp.model) || "robot";
      hue = (typeof nextBuddy.hue === "number") ? nextBuddy.hue : 0.5;
      // Prefer the rolled colorway paint so the label and the render agree.
      // null/undefined means "no colour rolled" -> leave the model untinted.
      const paint = (nextBuddy.colorHsl != null) ? nextBuddy.colorHsl
        : (typeof nextBuddy.hue === "number" ? nextBuddy.hue : null);

      fetchRaw(modelKey, (err, buf) => {
        if (api.disposed) return;
        if (err) {
          console.warn("[BuddyPreview] model load failed:", err.message);
          return;
        }
        const loader = getLoader();
        if (!loader) return;

        loader.parse(buf, "", (gltf) => {
          if (api.disposed) {
            disposeObject(gltf.scene);
            return;
          }
          clearModel();
          modelRoot = gltf.scene || gltf.scenes[0];

          // Fit + centre the model.
          const box = new THREE.Box3().setFromObject(modelRoot);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const scale = 1.85 / maxDim;
          modelRoot.scale.setScalar(scale);
          modelRoot.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

          if (paint != null) tintObject(modelRoot, paint, bo.tintStrength);

          // The voodoo doll ships with no animation clips — give it a gentle
          // procedural bob so it doesn't read as a frozen prop.
          if (!gltf.animations || !gltf.animations.length) {
            modelRoot.userData.procedural = true;
          }

          holder.add(modelRoot);

          // Cosmetics from the instance's unlocked slots.
          const custom = nextBuddy.customization || {};
          cosmeticNodes = buildCosmetics(holder, hue, custom, 1);

          if (gltf.animations && gltf.animations.length) {
            mixer = new THREE.AnimationMixer(modelRoot);
            clips = gltf.animations.slice();
            playAnim(bo.anim || "idle");
          }

          if (typeof bo.onReady === "function") {
            try { bo.onReady(api); } catch (e) {}
          }
        }, undefined, (err2) => {
          console.warn("[BuddyPreview] parse failed:", err2);
        });
      });
    }

    function disposeObject(root) {
      try {
        root.traverse(n => {
          if (n.isMesh) {
            if (n.geometry) n.geometry.dispose();
            const mats = Array.isArray(n.material) ? n.material : [n.material];
            mats.forEach(m => { if (m && m.dispose) m.dispose(); });
          }
        });
      } catch (e) {}
    }

    function frame() {
      if (api.disposed) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, (now - t0) / 1000);
      t0 = now;

      if (o.animate !== false) yaw += dt * 0.32;
      holder.rotation.y = yaw;

      if (mixer) mixer.update(dt);

      // Levitation hover. Also covers "procedural" models with no clips at
      // all. NOTE: this must ADD to the fitted base transform — the old code
      // overwrote position.y outright, which sank the model into the ground.
      if (modelRoot) {
        if (!hoverState) hoverState = createHoverState();
        applyHover(hoverState, modelRoot, dt, {
          lean: (typeof o.hoverLean === "function" ? o.hoverLean() : o.hoverLean) || 0,
          sink: sinkOverride,
        });
      }

      cosmeticNodes.forEach(n => {
        if (n.userData.spin) n.rotation.z += dt * n.userData.spin;
        if (n.userData.orbit) {
          n.userData.orbit.a += dt * n.userData.orbit.speed;
          n.position.x = Math.cos(n.userData.orbit.a) * n.userData.orbit.r;
          n.position.z = Math.sin(n.userData.orbit.a) * n.userData.orbit.r;
        }
        if (n.userData.flutter) {
          n.rotation.z = n.userData.flutter * (0.32 + Math.sin(now * 0.003) * 0.16);
        }
      });

      renderer.render(scene, camera);
    }

    function resize() {
      if (api.disposed) return;
      const w = Math.max(80, container.clientWidth || width);
      const h = Math.max(80, container.clientHeight || height);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    api.setBuddy = setBuddy;
    api.playAnim = playAnim;
    api.resize = resize;
    // 0 = floating at rest, 1 = slumped over (used when a buddy faints).
    api.setSink = (v) => { sinkOverride = Math.max(0, Math.min(1, v || 0)); };
    // 0 = upright float, 1 = leaning forward into travel.
    api.setLean = (v) => { o.hoverLean = Math.max(0, Math.min(1, v || 0)); };
    // Render a frame and grab the canvas immediately, while the drawing buffer
    // is still valid (avoids needing preserveDrawingBuffer on every preview).
    api.capture = () => {
      if (api.disposed) return null;
      try {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      } catch (e) {
        return null;
      }
    };
    api.dispose = () => {
      if (api.disposed) return;
      api.disposed = true;
      cancelAnimationFrame(raf);
      try { if (api._ro) api._ro.disconnect(); } catch (e) {}
      clearModel();
      try { renderer.dispose(); } catch (e) {}
      // dispose() does NOT free the WebGL context. Browsers (Safari and the
      // Android WebView especially) cap live contexts and silently evict the
      // OLDEST one when you go over — which is MapLibre's map canvas, and
      // that is exactly what turns the map dark. Always force the loss.
      try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) {}
      try { if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      } } catch (e) {}
    };

    if (buddy) setBuddy(buddy, o);
    frame();

    // Auto-resize with the container (modals animate in/out).
    try {
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => resize());
        ro.observe(container);
        api._ro = ro;
      }
    } catch (e) {}

    return api;
  }

  /**
   * Fetch + cache the raw GLB bytes for a model key ("voodoo" | "robot").
   * Shared with BuddyCompanion so the map model and the modal previews always
   * agree on geometry and materials.
   */
  function loadRaw(modelKey, cb) { fetchRaw(modelKey, cb); }

  /* ------------------------------------------------- Levitation pose ---- */
  /**
   * Ghostly levitation, applied every frame on top of the (static) pose model.
   *
   * The voodoo doll ships as a single frozen frame rather than an animation
   * clip, so the motion is done here: a slow two-frequency bob that never
   * looks mechanical, plus a forward lean of the head/torso while travelling.
   *
   *   const st = BuddyPreview.createHoverState();
   *   ...each frame: BuddyPreview.applyHover(st, modelRoot, dt, { lean: 0..1 });
   *
   * `lean` 0 = hovering at rest, 1 = gliding forward (head leads).
   * `sink` 0..1 = defeat slump, so a fainted buddy droops instead of floating.
   */
  function createHoverState() {
    return {
      t: Math.random() * 100,   // random phase so two buddies never sync up
      lean: 0,
      sink: 0,
      baseY: null,
      baseRX: null,
      baseRZ: null,
    };
  }

  function applyHover(state, root, dt, opts) {
    if (!state || !root) return;
    if (state.baseY === null) {
      state.baseY = root.position.y;
      state.baseRX = root.rotation.x;
      state.baseRZ = root.rotation.z;
    }
    const step = Math.min(0.05, Math.max(0, dt || 0));
    state.t += step;

    const wantLean = Math.max(0, Math.min(1, (opts && opts.lean) || 0));
    const wantSink = Math.max(0, Math.min(1, (opts && opts.sink) || 0));
    // Smooth the transitions so it never snaps between "hover" and "lean".
    state.lean += (wantLean - state.lean) * Math.min(1, step * 3.2);
    state.sink += (wantSink - state.sink) * Math.min(1, step * 2.2);

    const t = state.t;
    const lean = state.lean;
    const sink = state.sink;

    // Slow levitation: two out-of-phase sines give a floating drift rather
    // than a mechanical sine pump. Height relaxes as the buddy slumps.
    const bob =
      Math.sin(t * 1.02) * 0.048 +
      Math.sin(t * 0.63 + 1.2) * 0.024 +
      Math.sin(t * 0.27 + 2.9) * 0.012;
    root.position.y = state.baseY + bob * (1 - sink * 0.65) - sink * 0.42;

    // Gentle yaw/roll drift while idle; a touch more life while gliding.
    const drift = 0.030 + lean * 0.022;
    root.rotation.z = state.baseRZ + Math.sin(t * 0.71) * drift + sink * 0.42;
    // Forward lean: head/torso lead the movement. This is the "tilt forward
    // slightly so its head is leaning forward" the design calls for.
    root.rotation.x = state.baseRX - lean * 0.34 + sink * 0.30;
  }

  /* ------------------------------------------------------- thumbnails */
  // Static PNG of a buddy, rendered once and cached. Used by the Buddy Bag
  // grid so a cell looks like the same creature as the map companion and the
  // detail screen — not like a generic coloured ball.
  //
  // IMPORTANT: every THREE.WebGLRenderer is a live browser WebGL context.
  // Browsers cap those and evict the oldest when the cap is hit (Safari ~8,
  // iOS WebView similar), and the oldest is almost always MapLibre's map
  // canvas. So we allocate exactly ONE shared offscreen renderer for all
  // thumbnails and keep it for the life of the page — never one per image.
  const thumbCache = new Map();
  const thumbQueue = [];
  let thumbBusy = false;
  let thumbHost = null;
  let thumbPreview = null;

  function thumbKey(b) {
    return [
      b.speciesId, b.hue, b.level,
      JSON.stringify(b.customization || {}),
    ].join("|");
  }

  function ensureThumbPreview(size) {
    if (thumbPreview && !thumbPreview.disposed) return thumbPreview;
    thumbHost = document.createElement("div");
    thumbHost.style.cssText =
      "position:fixed;left:-9999px;top:0;width:" + size + "px;height:" + size +
      "px;opacity:0;pointer-events:none;";
    document.body.appendChild(thumbHost);
    // No buddy yet — setBuddy() is called per job.
    thumbPreview = create(thumbHost, null, { animate: false });
    return thumbPreview;
  }

  function drainThumbQueue() {
    if (thumbBusy) return;
    const job = thumbQueue.shift();
    if (!job) return;
    thumbBusy = true;

    const { buddy, size, cb } = job;
    let settled = false;
    const finish = (url) => {
      if (settled) return;
      settled = true;
      thumbBusy = false;
      setTimeout(drainThumbQueue, 0);
      try { cb(url); } catch (e) {}
    };

    let preview;
    try {
      preview = ensureThumbPreview(size);
    } catch (e) {
      finish(null);
      return;
    }

    let done = false;
    const settle = (url) => {
      if (done) return;
      done = true;
      finish(url);
    };

    try {
      preview.setBuddy(buddy, {
        anim: "idle",
        // capture() renders synchronously, so there is no need to wait for a
        // rAF here — and waiting for one is a deadlock risk, because if rAF is
        // throttled (background tab, offscreen canvas) finish() would never
        // run and thumbBusy would stay true, wedging the queue forever.
        onReady: () => settle(preview.capture()),
      });
    } catch (e) {
      settle(null);
      return;
    }

    // Never let a wedged model load block the whole queue.
    setTimeout(() => settle(preview.capture()), 4000);
  }

  /**
   * Get (or generate) a PNG data URL for a buddy.
   * @param {object}   buddy
   * @param {number}   size  pixel size of the square thumbnail
   * @param {function} cb    (dataUrl|null) => void
   * @returns {string|null}  the cached URL if already generated
   */
  function thumbnail(buddy, size, cb) {
    if (!buddy) { if (cb) cb(null); return null; }
    const key = thumbKey(buddy);
    if (thumbCache.has(key)) {
      const url = thumbCache.get(key);
      if (cb) cb(url);
      return url;
    }
    if (cb) {
      thumbQueue.push({
        buddy, size: size || 120,
        cb: (url) => { if (url) thumbCache.set(key, url); cb(url); },
      });
      drainThumbQueue();
    }
    return null;
  }

  // Free the shared thumbnail context on page hide so a long session never
  // holds more contexts than it needs. Re-allocates lazily on next use.
  if (typeof document !== "undefined") {
    try {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) return;
        if (!thumbPreview) return;
        try { thumbPreview.dispose(); } catch (e) {}
        thumbPreview = null;
        try { if (thumbHost) thumbHost.remove(); } catch (e) {}
        thumbHost = null;
        thumbBusy = false;
      });
    } catch (e) {}
  }

  return {
    create,
    thumbnail,
    MODEL_PATHS,
    loadRaw,
    tintObject,
    buildCosmetics,
    createHoverState,
    applyHover,
  };
})();
