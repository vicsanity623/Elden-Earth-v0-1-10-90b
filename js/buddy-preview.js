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
    voodoo: "models/Voodoo-Dool.glb",
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
  // Converts a 0..1 hue into a THREE.Color, then re-tints every material.
  // Textures (the voodoo doll's fabric/camo maps) keep their detail because
  // `color` multiplies the map rather than replacing it.
  function tintObject(root, hue, strength) {
    const s = (typeof strength === "number") ? strength : 0.85;
    const base = new THREE.Color();
    base.setHSL(((hue % 1) + 1) % 1, 0.62, 0.52);

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
  function buildCosmetics(group, hue, customization, size) {
    const clean = [];
    const col = new THREE.Color().setHSL(((hue % 1) + 1) % 1, 0.75, 0.58);
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
    }

    function playAnim(name) {
      if (!mixer || !clips.length) return;
      const lower = String(name || "idle").toLowerCase();
      let clip = clips.find(c => c.name.toLowerCase() === lower)
        || clips.find(c => c.name.toLowerCase().includes(lower))
        || clips.find(c => c.name.toLowerCase().includes("idle"))
        || clips[0];
      if (!clip) return;
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

          tintObject(modelRoot, hue, bo.tintStrength);

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

      if (modelRoot && modelRoot.userData.procedural) {
        modelRoot.position.y = Math.sin(now * 0.0016) * 0.055;
        modelRoot.rotation.z = Math.sin(now * 0.0011) * 0.045;
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
      clearModel();
      try { renderer.dispose(); } catch (e) {}
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

  /* ------------------------------------------------------- thumbnails */
  // Static PNG of a buddy, rendered offscreen once and cached. Used by the
  // Buddy Bag grid so a cell looks like the same creature as the map
  // companion and the detail screen — not like a generic coloured ball.
  const thumbCache = new Map();
  const thumbQueue = [];
  let thumbBusy = false;

  function thumbKey(b) {
    return [
      b.speciesId, b.hue, b.level,
      JSON.stringify(b.customization || {}),
    ].join("|");
  }

  function drainThumbQueue() {
    if (thumbBusy) return;
    const job = thumbQueue.shift();
    if (!job) return;
    thumbBusy = true;

    const { buddy, size, cb } = job;
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:-9999px;top:0;width:" + size + "px;height:" + size +
      "px;opacity:0;pointer-events:none;";
    document.body.appendChild(host);

    let settled = false;
    const finish = (dataUrl) => {
      if (settled) return;
      settled = true;
      try { host.remove(); } catch (e) {}
      thumbBusy = false;
      setTimeout(drainThumbQueue, 0);
      try { cb(dataUrl); } catch (e) {}
    };

    let preview;
    try {
      preview = create(host, buddy, {
        animate: true,
        anim: "idle",
        onReady: () => {
          // Let one frame land so geometry/materials are fully submitted.
          requestAnimationFrame(() => {
            const url = preview.capture ? preview.capture() : null;
            try { preview.dispose(); } catch (e) {}
            finish(url);
          });
        },
      });
    } catch (e) {
      try { if (preview) preview.dispose(); } catch (e2) {}
      finish(null);
      return;
    }

    // Never let a wedged model load block the whole queue.
    setTimeout(() => {
      const url = preview && preview.capture ? preview.capture() : null;
      try { if (preview) preview.dispose(); } catch (e) {}
      finish(url);
    }, 4000);
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

  return {
    create,
    thumbnail,
    MODEL_PATHS,
    loadRaw,
    tintObject,
    buildCosmetics,
  };
})();
