// ============================================================
// Elden Earth — 3D Parcel Foliage & Mushroom Landmarks (Zero-Context High-Perf)
// ============================================================
const Foliage = (() => {
  let mapInstance = null;
  let isImageLoaded = false;
  let activeMarkers = [];
  let cachedMushroomImgSrc = null;
  let cachedRedMushroomImgSrc = null;

  // Realistic stylized grass blade sprite
  function createGrassImage(callback) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
        <defs>
          <linearGradient id="bladeFront" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#a8f5ec"/>
            <stop offset="30%" stop-color="#2ecc71"/>
            <stop offset="85%" stop-color="#1b7a43"/>
            <stop offset="100%" stop-color="#0e4425"/>
          </linearGradient>

          <linearGradient id="bladeBack" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#58d68d"/>
            <stop offset="50%" stop-color="#229954"/>
            <stop offset="100%" stop-color="#0b301a"/>
          </linearGradient>

          <radialGradient id="rootShadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(0,0,0,0.6)"/>
            <stop offset="70%" stop-color="rgba(0,0,0,0.2)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
          </radialGradient>
        </defs>

        <ellipse cx="48" cy="90" rx="32" ry="5" fill="url(#rootShadow)"/>
        <path d="M 48 90 Q 24 65 18 38 Q 32 52 48 90" fill="url(#bladeBack)" opacity="0.9"/>
        <path d="M 48 90 Q 72 62 78 35 Q 64 50 48 90" fill="url(#bladeBack)" opacity="0.9"/>
        <path d="M 48 90 Q 34 50 30 20 Q 42 42 48 90" fill="url(#bladeFront)"/>
        <path d="M 48 90 Q 62 48 66 18 Q 54 40 48 90" fill="url(#bladeFront)"/>
        <path d="M 48 90 Q 45 32 48 6 Q 51 32 48 90" fill="url(#bladeFront)"/>
        <path d="M 48 90 Q 40 70 36 52 Q 44 64 48 90" fill="#a8f5ec"/>
        <path d="M 48 90 Q 56 70 60 52 Q 52 64 48 90" fill="#58d68d"/>
      </svg>
    `;

    const img = new Image(96, 96);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    img.onload = () => callback(img);
  }

  // Helper to render a GLTF scene into an image data URL
  function renderGLBToDataURL(gltf) {
    const offCanvas = document.createElement("canvas");
    offCanvas.width = 128;
    offCanvas.height = 128;

    const renderer = new THREE.WebGLRenderer({ canvas: offCanvas, alpha: true, antialias: true });
    
    // 1. Photographic tone mapping (prevents pure-white burnout)
    if (THREE.ACESFilmicToneMapping) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.9;
    }
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 1.3, 2.7);
    camera.lookAt(0, 0.35, 0);

    // 2. Soft, calibrated ambient light + keylight
    const ambLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 0.75);
    dirLight.position.set(2.5, 4, 3);
    scene.add(dirLight);

    const clone = gltf.scene.clone();

    // 3. Tame materials: remove blinding white reflection/emissive
    clone.traverse((child) => {
      if (child.isMesh && child.material) {
        if (child.material.emissive) {
          child.material.emissive.setHex(0x000000); // Kills self-illumination
        }
        if (child.material.metalness !== undefined) child.material.metalness = 0.0;
        if (child.material.roughness !== undefined) child.material.roughness = 0.7;
        child.material.needsUpdate = true;
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.2 / maxDim;
    clone.scale.set(scale, scale, scale);

    box.setFromObject(clone);
    clone.position.y = -box.min.y;
    scene.add(clone);

    renderer.render(scene, camera);
    const dataUrl = offCanvas.toDataURL();

    renderer.dispose();
    renderer.forceContextLoss();
    return dataUrl;
  }

  // Pre-render both GLB models
  function preloadMushroom() {
    if (typeof THREE === "undefined" || !THREE.GLTFLoader) return;
    const loader = new THREE.GLTFLoader();

    loader.load(
      "assets/models/RedMushroom.glb",
      (gltf) => {
        try {
          cachedRedMushroomImgSrc = renderGLBToDataURL(gltf);
          cachedMushroomImgSrc = cachedRedMushroomImgSrc;
          update();
        } catch (e) {
          console.warn("[Foliage] Red mushroom render notice:", e);
        }
      },
      undefined,
      (err) => console.warn("[Foliage] Could not load RedMushroom.glb:", err)
    );
  }

  // Dynamic Growth 3D Mushroom Billboard (Supports default & custom RedMushroom.glb)
  function create3DMushroomElement(scaleMultiplier = 1.0, isRedVariant = false) {
    const wrap = document.createElement("div");
    wrap.className = "parcel-prop-wrap";
    wrap.style.cssText = "will-change: transform; transform: translateZ(0); pointer-events: none;";

    const pxSize = Math.round(18 * scaleMultiplier);
    const fontPx = Math.round(13 * scaleMultiplier);
    const imgSrc = (isRedVariant && cachedRedMushroomImgSrc) ? cachedRedMushroomImgSrc : cachedMushroomImgSrc;

    if (imgSrc) {
      wrap.innerHTML = `<img src="${imgSrc}" style="width:${pxSize}px;height:${pxSize}px;object-fit:contain;display:block;">`;
    } else {
      wrap.innerHTML = `<span style="font-size:${fontPx}px;line-height:1;display:block;">🍄</span>`;
    }

    // 4+ Mega Cluster: Add glowing golden spore aura to giant colossal mushrooms!
    if (scaleMultiplier >= 2.0) {
      wrap.style.filter = "drop-shadow(0 0 10px rgba(240, 211, 138, 0.9))";
    }

    return wrap;
  }

  function init(map) {
    mapInstance = map;
    preloadMushroom();

    createGrassImage((img) => {
      if (!mapInstance.hasImage("foliage-grass")) {
        mapInstance.addImage("foliage-grass", img, { pixelRatio: 2 });
      }
      isImageLoaded = true;
      setupLayers();
      update();
    });
  }

  function setupLayers() {
    if (!mapInstance || mapInstance.getSource("foliage-source")) return;

    mapInstance.addSource("foliage-source", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Add layer WITHOUT a beforeId so it renders on TOP of plot fills and building floors
    mapInstance.addLayer({
      id: "foliage-layer",
      type: "symbol",
      source: "foliage-source",
      minzoom: 16.0,
      layout: {
        "icon-image": "foliage-grass",
        "icon-anchor": "bottom",
        "icon-pitch-alignment": "viewport",
        "icon-rotation-alignment": "viewport",
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          16.0, ["*", 0.12, ["get", "scale"]],
          18.0, ["*", 0.24, ["get", "scale"]],
          20.0, ["*", 0.38, ["get", "scale"]]
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          16.0, 0.2,
          17.0, 1.0
        ],
      },
    });
  }

  function seededRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  function update() {
    // Battery Saver: Skip foliage regeneration when screen is off
    if (!mapInstance || !isImageLoaded || !mapInstance.getSource("foliage-source") || document.hidden) return;

    activeMarkers.forEach(m => m.remove());
    activeMarkers = [];

    // Far-zoom cull: mushrooms are decorative DOM markers — drop them entirely
    if (mapInstance.getZoom && mapInstance.getZoom() < (CONFIG.MAP_CULL_MIN_ZOOM || 14)) {
      mapInstance.getSource("foliage-source").setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const allPlots = (typeof Grid !== "undefined" && Grid.getAllPlots) ? Grid.getAllPlots() : {};

    // --- CONNECTED LEGENDARY TERRITORY SCANNER (Flood-Fill Clustering) ---
    const visitedLegendary = new Set();
    const legendaryClusterSizeMap = {};
    const legendaryClusters = []; // 👈 Tracks full clusters for center calculation

    for (const tid in allPlots) {
      const p = allPlots[tid];
      const rKey = p.rarity?.key || p.rarity || "common";
      if (rKey !== "legendary" || visitedLegendary.has(tid)) continue;

      const ownerId = p.ownerId;
      const cluster = [];
      const queue = [p];
      visitedLegendary.add(tid);

      while (queue.length > 0) {
        const curr = queue.shift();
        cluster.push(curr);

        const cx = parseInt(curr.tx, 10);
        const cy = parseInt(curr.ty, 10);

        const neighbors = [
          `${cx + 1}_${cy}`,
          `${cx - 1}_${cy}`,
          `${cx}_${cy + 1}`,
          `${cx}_${cy - 1}`,
        ];

        for (const nId of neighbors) {
          const np = allPlots[nId];
          if (!visitedLegendary.has(nId) && np && np.ownerId === ownerId) {
            const nRarity = np.rarity?.key || np.rarity || "common";
            if (nRarity === "legendary") {
              visitedLegendary.add(nId);
              queue.push(np);
            }
          }
        }
      }

      legendaryClusters.push(cluster);

      // Record exact cluster size for all plots in this connected territory
      const clusterCount = cluster.length;
      for (const item of cluster) {
        const itemTid = `${item.tx}_${item.ty}`;
        legendaryClusterSizeMap[itemTid] = clusterCount;
      }
    }

    const tileSize = CONFIG.TILE_SIZE_METERS || 6.096;
    const grassFeatures = [];
    const zoom = mapInstance.getZoom();

    let mushroomCount = 0;
    const MAX_VISIBLE_MUSHROOMS = 150; // 👈 Raised from 15 to 150 so full farms render!

    // User's active view center (Tightly culled to 650m so distant horizon markers never bleed into top HUD)
    const mapCenter = mapInstance.getCenter();
    const userLat = mapCenter ? mapCenter.lat : 33.585;
    const userLon = mapCenter ? mapCenter.lng : -112.015;
    const MAX_FOLIAGE_DIST_METERS = 650;

    for (const tid in allPlots) {
      const p = allPlots[tid];
      const px = parseInt(p.tx, 10);
      const py = parseInt(p.ty, 10);

      const c = Geo.fromMercator(
        px * tileSize + tileSize / 2,
        py * tileSize + tileSize / 2
      );

      // TIGHT HORIZON CULLING: Only render flora near player's active view
      const distToPlayer = Geo.haversine(userLat, userLon, c.lat, c.lon);
      if (distToPlayer > MAX_FOLIAGE_DIST_METERS) {
        continue;
      }

      const rarityKey = p.rarity?.key || p.rarity || "common";
      let seed = Math.abs(px * 374761393 + py * 668265263);

      // 1. Lush 3D Grass: Dense on Legendary (4 tufts), clean on Epic (2 tufts)
      const hasGrass = (rarityKey === "epic" || rarityKey === "legendary");
      if (hasGrass) {
        const tuftCount = rarityKey === "legendary" ? 4 : 2;

        for (let i = 0; i < tuftCount; i++) {
          const offsetX = (seededRandom(seed++) - 0.5) * 0.000038;
          const offsetY = (seededRandom(seed++) - 0.5) * 0.000038;
          const scaleBase = rarityKey === "legendary" ? 1.15 : 0.85;
          const randomScale = scaleBase + seededRandom(seed++) * 0.35;

          grassFeatures.push({
            type: "Feature",
            properties: { scale: randomScale },
            geometry: {
              type: "Point",
              coordinates: [c.lon + offsetX, c.lat + offsetY]
            }
          });
        }
      }

      // 2. 3D Mushrooms on Legendary Plots (Natural ~45% cluster spawn & bigger scale)
      const spawnRoll = seededRandom(seed++);
      if (rarityKey === "legendary" && zoom >= 16.5 && spawnRoll < 0.50 && mushroomCount < MAX_VISIBLE_MUSHROOMS) {
        mushroomCount++;
        
        // Organic size variation (1.3x to 2.2x)
        const scaleVal = 1.3 + seededRandom(seed++) * 0.9;
        const mushOffsetX = (seededRandom(seed++) - 0.5) * 0.000024;
        const mushOffsetY = (seededRandom(seed++) - 0.5) * 0.000024;

        // Perspective fade/scale for distance: Shrinks mushrooms that are further away
        const distanceFactor = Math.max(0.4, 1.0 - (distToPlayer / MAX_FOLIAGE_DIST_METERS) * 0.5);
        const finalScale = scaleVal * distanceFactor;

        const m = new mapboxgl.Marker({
          element: create3DMushroomElement(finalScale, true),
          anchor: "bottom",
          pitchAlignment: "viewport",
          rotationAlignment: "viewport",
        })
          .setLngLat([c.lon + mushOffsetX, c.lat + mushOffsetY])
          .addTo(mapInstance);

        activeMarkers.push(m);
      }
    }

    // 3. 🌟 GIANT MOTHER MUSHROOM: Spawn in the center of 10+ connected legendaries!
    if (zoom >= 15.5) {
      for (const cluster of legendaryClusters) {
        if (cluster.length >= 10) {
          let sumTx = 0, sumTy = 0;
          for (const item of cluster) {
            sumTx += parseInt(item.tx, 10);
            sumTy += parseInt(item.ty, 10);
          }
          const avgTx = sumTx / cluster.length;
          const avgTy = sumTy / cluster.length;

          const centerCoord = Geo.fromMercator(
            avgTx * tileSize + tileSize / 2,
            avgTy * tileSize + tileSize / 2
          );

          // Giant scale (2.8x - 3.8x) based on cluster size, triggers the golden glowing aura
          const megaScale = Math.min(3.8, 2.8 + (cluster.length - 10) * 0.04);
          const megaEl = create3DMushroomElement(megaScale);
          megaEl.style.zIndex = "10"; // Ensures it towers over the smaller mushrooms

          const megaMarker = new mapboxgl.Marker({
            element: megaEl,
            anchor: "bottom",
            pitchAlignment: "viewport",
            rotationAlignment: "viewport",
          })
            .setLngLat([centerCoord.lon, centerCoord.lat])
            .addTo(mapInstance);

          activeMarkers.push(megaMarker);
        }
      }
    }

    mapInstance.getSource("foliage-source").setData({
      type: "FeatureCollection",
      features: grassFeatures,
    });
  }

  return { init, update };
})();