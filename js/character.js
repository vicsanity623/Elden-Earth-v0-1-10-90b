// ============================================================
// Elden Earth — 3D Character Model (Three.js WebGL Custom Layer)
// Zero-Allocation Garbage Collection & VRAM Leak Protection
// ============================================================
const Character3D = (() => {
  let mapInstance = null;
  let customLayer = null;
  let scene, camera, renderer;
  let mixer = null;
  let currentAction = null;
  let animationsMap = {};
  let currentModel = null;
  let playerCoords = { lng: -112.0740, lat: 33.4484 };
  let lastPosTime = Date.now();
  let lastCoords = null;
  let isWalking = false;
  // BATTERY: performance.now() deadline — while in the future the model still
  // owes the screen motion (a walk cycle, a walk<->idle crossfade, a turn).
  // Once it passes and the player is standing still, animation work stops.
  let activityUntil = 0;
  let modelHeading = 0;

  // Pre-allocated static objects (Eliminates 300+ object allocations/sec!)
  const projMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const scaleVector = new THREE.Vector3();
  const rotXMatrix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const rotYMatrix = new THREE.Matrix4();

  function init(map, initialLng, initialLat) {
    mapInstance = map;
    playerCoords = { lng: initialLng, lat: initialLat };

    // Custom WebGL Layer for Three.js
    customLayer = {
      id: "3d-player-character",
      type: "custom",
      renderingMode: "3d",
      onAdd: function (map, gl) {
        camera = new THREE.Camera();
        scene = new THREE.Scene();

        // Optimized Ambient & Directional Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xf0d38a, 2.0);
        dirLight.position.set(20, 50, 20);
        scene.add(dirLight);

        const dirLight2 = new THREE.DirectionalLight(0x4fd6c4, 1.2);
        dirLight2.position.set(-20, -50, 10);
        scene.add(dirLight2);

        renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: false,
          powerPreference: "low-power"
        });
        renderer.autoClear = false;

        const state = Store.get();
        const selectedId = state?.player?.model3d || "soldier";
        loadModel(selectedId);
      },
      render: function (gl, matrix) {
        if (!currentModel || document.hidden) return;
        // Far-zoom cull: never draw the player model when only plot tiles remain
        if (document.body.classList.contains("map-culled-far")) return;
        // Bird's Eye visibility toggle
        if (document.body.classList.contains("be-off-player")) return;

        const modelCoord = mapboxgl.MercatorCoordinate.fromLngLat(
          [playerCoords.lng, playerCoords.lat],
          0
        );

        const scale = modelCoord.meterInMercatorCoordinateUnits() * (currentModel.userData.scale || 4.8);
        scaleVector.set(scale, -scale, scale);

        // Zero-GC Matrix Calculations
        projMatrix.fromArray(matrix);
        rotYMatrix.makeRotationY(modelHeading);

        worldMatrix
          .makeTranslation(modelCoord.x, modelCoord.y, modelCoord.z)
          .scale(scaleVector)
          .multiply(rotXMatrix)
          .multiply(rotYMatrix);

        camera.projectionMatrix.copy(projMatrix).multiply(worldMatrix);

        // Clear Depth Buffer: Ensures character renders in front of 3D buildings!
        gl.clear(gl.DEPTH_BUFFER_BIT);

        renderer.resetState();
        renderer.render(scene, camera);
      },
    };

    if (mapInstance.getLayer("3d-player-character")) {
      mapInstance.removeLayer("3d-player-character");
    }
    mapInstance.addLayer(customLayer);

    // High-Efficiency Frame-Throttled Animation Loop.
    //
    // BATTERY: a standing avatar used to force a FULL MapLibre repaint at
    // 15fps forever (60fps while walking) — that is the "phone gets hot just
    // leaving the game open" cost. Now:
    //   · frozen idle (no motion owed) -> zero mixer work, ZERO map repaints;
    //     the loop degrades to a cheap 4Hz poll waiting for movement
    //   · walking / crossfades        -> 30fps (was 60) — plenty for a map
    // The custom layer's render() still draws the (frozen) model whenever the
    // map paints for other reasons (pan/zoom), so nothing ever disappears.
    let clock = new THREE.Clock();
    let animFrameId = null;
    let lastFrameTime = 0;
    const WALK_FPS = 30;
    const IDLE_POLL_MS = 250;

    function animate(timestamp) {
      if (document.hidden) {
        animFrameId = null;
        return;
      }

      animFrameId = requestAnimationFrame(animate);

      // Far-zoom cull: freeze the mixer and stop forcing map repaints
      if (document.body.classList.contains("map-culled-far")) return;
      if (document.body.classList.contains("be-off-player")) return;

      const busy = isWalking || timestamp < activityUntil;
      if (!busy) {
        // Frozen idle — poll cheaply so movement wakes the loop instantly.
        if (timestamp - lastFrameTime < IDLE_POLL_MS) return;
        lastFrameTime = timestamp;
        return;
      }

      const minInterval = 1000 / WALK_FPS;
      const elapsed = timestamp - lastFrameTime;

      if (elapsed >= minInterval) {
        lastFrameTime = timestamp - (elapsed % minInterval);

        if (mixer) {
          // Cap delta so resuming from a freeze can't jump the clip forward.
          const delta = Math.min(clock.getDelta(), 0.1);
          mixer.update(delta);
          if (mapInstance) mapInstance.triggerRepaint();
        }
      }
    }
    animate(performance.now());

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !animFrameId) {
        clock.getDelta();
        lastFrameTime = performance.now();
        animate(performance.now());
      }
    });
  }

  // Deep VRAM Memory Cleanup Helper (Prevents mobile GPU leaks)
  function disposeModel(model) {
    if (!model) return;
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    }
    model.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          } else {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
        }
      }
    });
  }

  function loadModel(characterId) {
    const config = CONFIG.AVAILABLE_CHARACTERS.find((c) => c.id === characterId) || CONFIG.AVAILABLE_CHARACTERS[0];
    const loader = new THREE.GLTFLoader();

    loader.load(
      config.file,
      (gltf) => {
        if (currentModel) {
          scene.remove(currentModel);
          disposeModel(currentModel);
        }

        currentModel = gltf.scene;
        currentModel.userData.scale = config.scale;

        // Set up skeletal animation clips
        mixer = new THREE.AnimationMixer(currentModel);
        animationsMap = {};

        gltf.animations.forEach((clip) => {
          animationsMap[clip.name.toLowerCase()] = mixer.clipAction(clip);
        });

        // Auto-detect Idle and Walk animations
        const idleKey = Object.keys(animationsMap).find((k) => k.includes("idle") || k.includes("survey") || k.includes("static")) || Object.keys(animationsMap)[0];
        const walkKey = Object.keys(animationsMap).find((k) => k.includes("walk") || k.includes("run") || k.includes("move")) || Object.keys(animationsMap)[1];

        if (idleKey && animationsMap[idleKey]) {
          currentAction = animationsMap[idleKey];
          currentAction.setEffectiveTimeScale(0.8);
          currentAction.play();
        }

        if (walkKey && animationsMap[walkKey]) {
          animationsMap[walkKey].setEffectiveTimeScale(0.55);
        }

        currentModel.userData.idleKey = idleKey;
        currentModel.userData.walkKey = walkKey;

        scene.add(currentModel);
        console.log(`[Character3D] Loaded ${config.name} successfully (VRAM optimized).`);
      },
      undefined,
      (err) => console.warn("[Character3D] Load error:", err)
    );
  }

  function setPlayerPosition(lng, lat) {
    const now = Date.now();
    playerCoords = { lng, lat };

    if (lastCoords) {
      const dist = Geo.haversine(lastCoords.lat, lastCoords.lng, lat, lng);
      const elapsed = (now - lastPosTime) / 1000;
      const speed = elapsed > 0 ? dist / elapsed : 0;

      if (dist > 0.5) {
        modelHeading = Math.atan2(lng - lastCoords.lng, lat - lastCoords.lat);
        // Position/heading changed — wake the render loop briefly so the turn
        // and step are actually shown before it freezes again.
        activityUntil = Math.max(activityUntil, performance.now() + 400);
      }

      const walkingNow = speed > 0.45;
      if (walkingNow !== isWalking && currentModel) {
        isWalking = walkingNow;
        // Render the 0.3s walk<->idle crossfade before freezing again.
        activityUntil = Math.max(activityUntil, performance.now() + 500);
        const nextKey = isWalking ? currentModel.userData.walkKey : currentModel.userData.idleKey;

        if (nextKey && animationsMap[nextKey] && currentAction !== animationsMap[nextKey]) {
          const nextAction = animationsMap[nextKey];
          nextAction.reset().fadeIn(0.3).play();
          if (currentAction) currentAction.fadeOut(0.3);
          currentAction = nextAction;
        }
      }
    }

    lastCoords = { lng, lat };
    lastPosTime = now;
  }

  function changeCharacter(characterId) {
    const state = Store.get();
    if (!state.player) state.player = {};
    state.player.model3d = characterId;
    Store.save(true);
    loadModel(characterId);
  }

  return { init, setPlayerPosition, changeCharacter, loadModel };
})();