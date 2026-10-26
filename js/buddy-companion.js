/* ==========================================================================
   Elden Earth — Buddy Companion (active buddy on the map)
   Renders the player's ACTIVE buddy as a real 3D model walking alongside the
   avatar — the same GLB, the same hue and the same cosmetic pieces the Buddy
   Bag and the detail screen show, so the map never disagrees with the list.

   Mounted as a MapLibre custom layer (identical pattern to js/pet.js), and it
   hot-swaps its model the moment the active buddy or its cosmetics change.
   ========================================================================== */
const BuddyCompanion = (() => {
  "use strict";

  const LAYER_ID = "3d-active-buddy";
  const FOLLOW_OFFSET_M = 4.2;      // metres from the player
  const LERP = 0.12;

  let mapInstance = null;
  let scene = null, camera = null, renderer = null;
  let holder = null;                // rotates/positions the model
  let modelRoot = null;
  let mixer = null;
  let clips = [];
  let currentAction = null;
  let cosmeticNodes = [];
  let animFrameId = null;
  let lastFrame = 0;
  let currentAnim = "idle";

  // Follow target (metres-based offset from the player).
  let playerCoords = { lng: 0, lat: 0 };
  let buddyCoords = { lng: 0, lat: 0 };
  let heading = 0;
  let targetHeading = 0;
  let moving = false;

  // Which buddy is mounted — lets us skip redundant reloads.
  let mountedKey = null;
  // Monotonic token so a slow GLB parse can never overwrite a newer buddy.
  let loadToken = 0;
  // Throttle map repaints — triggerRepaint() every rAF frame forces a full
  // map re-render 60x/second, which makes the map stutter and look wrong.
  let lastRepaint = 0;
  const REPAINT_INTERVAL_MS = 50;
  let layerAttached = false;

  // Reusable matrices — allocated on mount so a missing THREE (CDN failure)
  // degrades to a no-op companion instead of throwing at script parse time.
  let projMatrix = null;
  let worldMatrix = null;
  let scaleVector = null;
  let rotXMatrix = null;
  let rotYMatrix = null;

  function ensureMatrices() {
    if (projMatrix) return;
    projMatrix = new THREE.Matrix4();
    worldMatrix = new THREE.Matrix4();
    scaleVector = new THREE.Vector3();
    rotXMatrix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    rotYMatrix = new THREE.Matrix4();
  }

  /* --------------------------------------------------------- geometry */
  function buddyKey(inst) {
    if (!inst) return null;
    // Re-mount only when the visible identity actually changes.
    return [
      inst.uid, inst.speciesId, inst.hue, inst.level,
      JSON.stringify(inst.customization || {}),
    ].join("|");
  }

  function clearModel() {
    if (modelRoot && holder) {
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
    mountedKey = null;
  }

  function playAnim(name) {
    if (!mixer || !clips.length) return;
    if (currentAnim === name && currentAction) return;
    currentAnim = name;

    const lower = String(name || "idle").toLowerCase();
    let clip = clips.find(c => c.name.toLowerCase() === lower)
      || clips.find(c => c.name.toLowerCase().includes(lower))
      || clips.find(c => c.name.toLowerCase().includes("idle"))
      || clips[0];
    if (!clip) return;
    try {
      const action = mixer.clipAction(clip);
      if (currentAction && currentAction !== action) {
        currentAction.fadeOut(0.2);
        action.reset().fadeIn(0.2).play();
      } else {
        action.reset().play();
      }
      currentAction = action;
    } catch (e) {}
  }

  /**
   * Mount (or swap to) a buddy instance.
   * @param {object|null} inst  BuddyEngine instance, or null to hide.
   */
  function setActiveBuddy(inst) {
    if (typeof THREE === "undefined") return;
    ensureScene();
    const key = buddyKey(inst);
    if (key === mountedKey) return;

    if (!inst) {
      clearModel();
      removeLayerIfIdle();
      return;
    }

    const sp = (typeof BuddyData !== "undefined") ? BuddyData.getSpecies(inst.speciesId) : null;
    const modelKey = (sp && sp.model) || "robot";
    const hue = (typeof inst.hue === "number") ? inst.hue : 0.5;
    // Use the rolled colorway paint so the map buddy matches the Buddy Bag.
    const paint = inst.colorHsl || hue;
    const token = ++loadToken;

    BuddyPreview.loadRaw(modelKey, (err, buf) => {
      // Discard if the active buddy changed again while the GLB was in flight.
      if (token !== loadToken) return;
      if (err || !scene || typeof THREE === "undefined") return;

      const loader = new THREE.GLTFLoader();
      loader.parse(buf, "", (gltf) => {
        if (token !== loadToken || !scene) return;
        clearModel();

        modelRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!modelRoot) return;

        // Normalise to a consistent world size, feet on the ground.
        const box = new THREE.Box3().setFromObject(modelRoot);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 1.75 / maxDim;
        modelRoot.scale.setScalar(scale);
        modelRoot.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

        BuddyPreview.tintObject(modelRoot, paint, 0.85);

        if (!gltf.animations || !gltf.animations.length) {
          modelRoot.userData.procedural = true;
        }

        holder.add(modelRoot);

        cosmeticNodes = BuddyPreview.buildCosmetics(holder, paint, inst.customization || {}, 1);

        if (gltf.animations && gltf.animations.length) {
          mixer = new THREE.AnimationMixer(modelRoot);
          clips = gltf.animations.slice();
          currentAnim = "";
          playAnim("idle");
        }

        mountedKey = buddyKey(inst);
        // Only now is there something worth a render pass on the shared
        // MapLibre WebGL context — so only now attach the layer.
        ensureLayer();
      }, undefined, (e) => {
        console.warn("[BuddyCompanion] model parse failed:", e);
      });
    });
  }

  function currentInstance() {
    try {
      if (typeof BuddySystem !== "undefined" && BuddySystem.activeBuddy) {
        return BuddySystem.activeBuddy();
      }
    } catch (e) {}
    return null;
  }

  // Public re-sync: re-reads the active buddy from the BuddySystem.
  function refresh() {
    setActiveBuddy(currentInstance());
  }

  /* ------------------------------------------------------------ layer */
  // Scene/camera/lights are independent of the map layer and are built as soon
  // as the companion boots — a model must be able to load and be prepared
  // before (or after) the GL layer is attached. Only the renderer needs the
  // MapLibre WebGL context, so it is created in onAdd.
  function ensureScene() {
    if (scene) return;
    ensureMatrices();
    camera = new THREE.Camera();
    scene = new THREE.Scene();

    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xf0d38a, 1.5);
    key.position.set(15, 40, 15);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x4fd6c4, 0.9);
    fill.position.set(-15, -40, 10);
    scene.add(fill);

    holder = new THREE.Group();
    scene.add(holder);
  }

  function onAdd(map, gl) {
    ensureScene();
    if (renderer) return;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: false,
        powerPreference: "low-power",
      });
      renderer.autoClear = false;
    } catch (e) {
      console.warn("[BuddyCompanion] renderer create failed:", e && e.message);
      renderer = null;
    }
  }

  function render(gl, matrix) {
    if (!renderer || !scene || !holder) return;
    if (document.hidden) return;
    if (!modelRoot && cosmeticNodes.length === 0) return;

    const modelCoord = mapboxgl.MercatorCoordinate.fromLngLat(
      [buddyCoords.lng, buddyCoords.lat],
      0
    );

    const scale = modelCoord.meterInMercatorCoordinateUnits() * 1.25;
    scaleVector.set(scale, -scale, scale);

    projMatrix.fromArray(matrix);
    rotYMatrix.makeRotationY(-heading + Math.PI);

    worldMatrix
      .makeTranslation(modelCoord.x, modelCoord.y, modelCoord.z)
      .scale(scaleVector)
      .multiply(rotXMatrix)
      .multiply(rotYMatrix);

    camera.projectionMatrix.copy(projMatrix).multiply(worldMatrix);

    gl.clear(gl.DEPTH_BUFFER_BIT);
    renderer.resetState();
    renderer.render(scene, camera);
  }

  /* ------------------------------------------------------- follow loop */
  function offsetFromPlayer() {
    // Stand off to the side so the buddy never hides under the avatar or the
    // companion pet. Offset is in degrees, derived from ~metres.
    const dLat = FOLLOW_OFFSET_M / 111320;
    const dLon = FOLLOW_OFFSET_M / (111320 * Math.cos(playerCoords.lat * Math.PI / 180));
    return { lat: playerCoords.lat + dLat * 0.55, lon: playerCoords.lon + dLon };
  }

  function animate(now) {
    animFrameId = requestAnimationFrame(animate);
    if (!scene) return;

    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;

    const target = offsetFromPlayer();
    const dLat = target.lat - buddyCoords.lat;
    const dLon = target.lon - buddyCoords.lon;
    const dist = Math.hypot(dLat, dLon);

    if (dist > 0.0000025) {
      moving = true;
      buddyCoords.lat += dLat * LERP;
      buddyCoords.lon += dLon * LERP;

      targetHeading = Math.atan2(dLon, dLat);
      let diff = targetHeading - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      heading += diff * 0.12;

      playAnim("walk");
    } else {
      if (moving) {
        moving = false;
        playAnim("idle");
      }
    }

    if (mixer) mixer.update(dt);

    if (modelRoot && modelRoot.userData.procedural) {
      modelRoot.position.y = (modelRoot.userData.baseY || 0) + Math.sin(now * 0.0016) * 0.05;
      modelRoot.rotation.z = Math.sin(now * 0.0011) * 0.04;
    }

    cosmeticNodes.forEach(n => {
      if (n.userData.spin) n.rotation.z += dt * n.userData.spin;
      if (n.userData.orbit) {
        n.userData.orbit.a += dt * n.userData.orbit.speed;
        n.position.x = Math.cos(n.userData.orbit.a) * n.userData.orbit.r;
        n.position.z = Math.sin(n.userData.orbit.a) * n.userData.orbit.r;
      }
      if (n.userData.flutter) {
        n.rotation.z = n.userData.flutter * (0.3 + Math.sin(now * 0.003) * 0.15);
      }
    });

    if (mapInstance && mapInstance.triggerRepaint && (moving || cosmeticNodes.length)) {
      // Only repaint at most ~20x/second, and only while something moves.
      if (now - lastRepaint >= REPAINT_INTERVAL_MS) {
        lastRepaint = now;
        try { mapInstance.triggerRepaint(); } catch (e) {}
      }
    }
  }

  // The custom layer shares MapLibre's WebGL context. Only attach it while
  // there is actually something to draw — an idle layer still runs a render
  // pass over the shared context and is pure risk for no benefit.
  function ensureLayer() {
    if (!mapInstance || layerAttached) return;
    try {
      if (mapInstance.getLayer(LAYER_ID)) mapInstance.removeLayer(LAYER_ID);
      mapInstance.addLayer({
        id: LAYER_ID,
        type: "custom",
        renderingMode: "3d",
        onAdd,
        render,
      });
      layerAttached = true;
      // Keep the buddy above plot tiles.
      setTimeout(() => {
        try { if (mapInstance && mapInstance.getLayer(LAYER_ID)) mapInstance.moveLayer(LAYER_ID); } catch (e) {}
      }, 120);
    } catch (e) {
      console.warn("[BuddyCompanion] layer mount failed:", e.message);
      layerAttached = false;
    }
  }

  function removeLayerIfIdle() {
    if (!layerAttached || modelRoot || cosmeticNodes.length) return;
    try { if (mapInstance && mapInstance.getLayer(LAYER_ID)) mapInstance.removeLayer(LAYER_ID); } catch (e) {}
    layerAttached = false;
  }

  /* --------------------------------------------------------------- API */
  function init(map, lng, lat) {
    if (!map || typeof THREE === "undefined") return;
    mapInstance = map;
    ensureScene();

    if (typeof lat === "number" && typeof lng === "number") {
      playerCoords = { lat, lon: lng };
      const off = offsetFromPlayer();
      buddyCoords = { lat: off.lat, lon: off.lon };
    }

    // NOTE: the layer is NOT added here. setActiveBuddy()/refresh() attaches
    // it once a model is actually mounted (see ensureLayer).
    if (!animFrameId) {
      lastFrame = performance.now();
      animate(lastFrame);
    }

    try {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && mapInstance && mapInstance.triggerRepaint) {
          try { mapInstance.triggerRepaint(); } catch (e) {}
        }
      });
    } catch (e) {}

    refresh();
  }

  function setPlayerPosition(lat, lon) {
    if (typeof lat !== "number" || typeof lon !== "number") return;
    const prevLat = playerCoords.lat;
    const prevLon = playerCoords.lon;
    playerCoords = { lat, lon };

    // First fix: snap the buddy to its slot instead of animating across the map.
    if (!prevLat && !prevLon) {
      const off = offsetFromPlayer();
      buddyCoords = { lat: off.lat, lon: off.lon };
    }
  }

  function destroy() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = 0;
    clearModel();
    try { if (mapInstance && mapInstance.getLayer(LAYER_ID)) mapInstance.removeLayer(LAYER_ID); } catch (e) {}
    scene = null; camera = null; renderer = null; holder = null; mapInstance = null;
  }

  // Read-only introspection — used by the placement/regression harness and
  // handy in the console when a player reports the map buddy looking wrong.
  function debugState() {
    return {
      mounted: !!modelRoot,
      mountedKey,
      cosmetics: cosmeticNodes.length,
      hasMixer: !!mixer,
      clips: clips.length,
      anim: currentAnim,
      moving,
    };
  }

  return {
    init,
    setPlayerPosition,
    setActiveBuddy,
    refresh,
    destroy,
    debugState,
    LAYER_ID,
  };
})();
