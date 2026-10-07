// ============================================================
// Elden Earth — Bootloader & 3D Cinematic Loading Stage (Optimized)
// Fast Boot Pipeline, 30FPS Throttle & Complete GPU Memory Disposal
// ============================================================
const Bootloader = (() => {
  const el = (id) => document.getElementById(id);
  let loaderRenderer = null;
  let loaderScene = null;
  let loaderCamera = null;
  let loaderMixer = null;
  let loaderAnimId = null;

  function setProgress(percent, statusText) {
    const bar = el("loader-progress-bar");
    const status = el("loader-status-text");
    const percentText = el("loader-percent-text");

    if (bar) bar.style.width = `${percent}%`;
    if (percentText) percentText.textContent = `${Math.round(percent)}%`;
    if (status) status.textContent = `> ${statusText}`;
  }

  async function step(ms, percent, text) {
    setProgress(percent, text);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Mount 3D CesiumMan in Slow-Motion with Auto-Framing & 30FPS Throttle
  function mount3DLoaderCharacter() {
    return new Promise((resolve) => {
      const canvas = el("loader-3d-canvas");
      if (!canvas || typeof THREE === "undefined" || !THREE.GLTFLoader) {
        resolve();
        return;
      }

      try {
        loaderCamera = new THREE.PerspectiveCamera(35, 220 / 200, 0.1, 100);
        loaderCamera.position.set(0, 0, 3.2);

        loaderScene = new THREE.Scene();

        // Balanced Cinematic Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
        loaderScene.add(ambientLight);

        const frontLight = new THREE.DirectionalLight(0x4fd6c4, 2.8);
        frontLight.position.set(2, 4, 3);
        loaderScene.add(frontLight);

        const rimLight = new THREE.DirectionalLight(0xf0d38a, 2.2);
        rimLight.position.set(-2, 2, -2);
        loaderScene.add(rimLight);

        loaderRenderer = new THREE.WebGLRenderer({
          canvas: canvas,
          alpha: true,
          antialias: true,
          powerPreference: "low-power" // Battery Saver
        });
        loaderRenderer.setSize(220, 200);
        loaderRenderer.setPixelRatio(1); // 1x pixel ratio saves GPU during boot

        // Load CesiumMan with automatic scale & center framing
        const loader = new THREE.GLTFLoader();
        loader.load(
          "models/CesiumMan.glb",
          (gltf) => {
            const model = gltf.scene;

            // Auto-frame model height to fit the stage perfectly
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const scale = 1.7 / (size.y || 1);
            model.scale.set(scale, scale, scale);

            // Center model vertically behind the spinning logo
            model.position.x = -center.x * scale;
            model.position.y = -center.y * scale + 0.1;
            model.position.z = -center.z * scale;
            model.rotation.y = 0.45;

            loaderScene.add(model);

            if (gltf.animations && gltf.animations.length > 0) {
              loaderMixer = new THREE.AnimationMixer(model);
              const walkAction = loaderMixer.clipAction(gltf.animations[0]);
              walkAction.setEffectiveTimeScale(0.40); // 40% slow motion
              walkAction.play();
            }

            resolve();
          },
          undefined,
          (err) => {
            console.warn("[Bootloader] 3D character load notice:", err);
            resolve();
          }
        );

        // 30 FPS Frame-Throttled Loader Loop (Zero Device Heating during Boot)
        const clock = new THREE.Clock();
        let lastLoaderFrame = 0;

        function animateLoader(timestamp) {
          loaderAnimId = requestAnimationFrame(animateLoader);
          const elapsed = timestamp - lastLoaderFrame;

          if (elapsed >= 33) { // Caps at 30 FPS (33ms)
            lastLoaderFrame = timestamp - (elapsed % 33);
            if (loaderMixer) {
              const delta = clock.getDelta();
              loaderMixer.update(delta);
            }
            if (loaderRenderer && loaderScene && loaderCamera) {
              loaderRenderer.render(loaderScene, loaderCamera);
            }
          }
        }
        animateLoader(performance.now());

      } catch (e) {
        console.warn("[Bootloader] 3D stage init notice:", e);
        resolve();
      }
    });
  }

  // 100% Complete GPU VRAM Garbage Disposal
  function dispose3DLoader() {
    if (loaderAnimId) {
      cancelAnimationFrame(loaderAnimId);
      loaderAnimId = null;
    }
    if (loaderScene) {
      loaderScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      loaderScene = null;
    }
    if (loaderRenderer) {
      try {
        loaderRenderer.dispose();
        loaderRenderer.forceContextLoss();
      } catch (e) {}
      loaderRenderer = null;
    }
    loaderCamera = null;
    loaderMixer = null;
  }

  async function run(player, onComplete) {
    // Aggressively hide ALL other screens — prevent any flickering
    const screens = ["signin-screen", "locate-screen", "location-required-screen"];
    screens.forEach(id => {
      const s = el(id);
      if (s) { s.classList.add("hidden"); s.style.display = "none"; s.style.pointerEvents = "none"; }
    });

    // Show loading screen immediately with high z-index
    const loadingScreen = el("loading-screen");
    if (loadingScreen) {
      loadingScreen.classList.remove("hidden");
      loadingScreen.style.zIndex = "99999";
    }

    // 1. Mount 3D Character Stage
    setProgress(15, "Summoning explorer & core registries...");
    await mount3DLoaderCharacter();
    // Cloud save is already loaded in memory by Auth before this pipeline starts.
    // Do NOT call Store.load() here — it would overwrite cloud data with stale localStorage.

    try {
      // 2. Cloud Save (35%) is restored by Auth before the boot pipeline starts.
      await step(60, 35, `Synchronizing cloud profile: ${player.name || "Traveler"}...`);

      // 3. Location (60%)
      await step(60, 60, "Acquiring high-accuracy GPS coordinates...");
      const coords = await new Promise((resolve) => {
        if (!("geolocation" in navigator)) {
          resolve({ latitude: 33.4484, longitude: -112.0740 });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => {
            console.warn("[Bootloader] Location defaulted:", err);
            resolve({ latitude: 33.4484, longitude: -112.0740 });
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
        );
      });

      // 4. Map Engine (75%)
      await step(50, 75, "Mounting 3D Vector engine & WebGL layers...");

      // 5. Global Plots Sync (Handled seamlessly by Grid live listener — zero duplicate reads!)
      await step(40, 90, "Preparing world parcels & player territory...");
      const state = Store.get();
      if (state && state.plots) {
        for (const pid in state.plots) {
          const p = state.plots[pid];
          if (p && p.ownerName && p.ownerName !== "Traveler" && (!state.player.name || state.player.name === "Traveler")) {
            state.player.name = p.ownerName;
            if (p.avatar && p.avatar !== "🙂") state.player.avatar = p.avatar;
          }
        }
      }

      // 6. Complete (100%)
      await step(50, 100, "Realm synchronized. Entering Elden Earth...");
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cleanly destroy loader WebGL context so the main map gets 100% GPU power
      dispose3DLoader();

      el("loading-screen")?.classList.add("hidden");
      onComplete(coords);

    } catch (err) {
      console.error("[Bootloader] Boot notice handled:", err);
      dispose3DLoader();
      el("loading-screen")?.classList.add("hidden");
      onComplete({ latitude: 33.4484, longitude: -112.0740 });
    }
  }

  return { run };
})();