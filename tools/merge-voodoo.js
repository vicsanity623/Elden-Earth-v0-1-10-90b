#!/usr/bin/env node
/* ==========================================================================
   Merge the Voodoo Doll's split GLB exports into ONE animated GLB.

   Input  (models/_src/ — raw Blender/Mixamo exports, NOT shipped):
     Voodoo-Dool-Idle.glb              rig + mesh + "idle" clip
     Voodoo-Dool-Running.glb           rig + mesh + "running" clip
     Voodoo-Dool-Sad-Mad.glb           rig + mesh + "sad" clip
                                      ^^^ 7.4 MB of each is a DUPLICATE mesh

   Output (models/ — the ONLY voodoo file the game loads):
     Voodoo-Dool-Animated.glb          rig + mesh + all clips, ~7.5 MB

   Also strips the dangling external texture URIs (the .jpg files were never
   shipped — they caused "source image could not be decoded" on every load)
   and replaces them with neutral baseColorFactors so the per-buddy hue tint
   paints cleanly.

   Both clips land up named "idle" / "running" — Blender/Mixamo exports both
   as "mixamo.com", which makes them indistinguishable at runtime.

   Usage: node tools/merge-voodoo.js
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MODELS = path.join(ROOT, "models");
// Raw Blender/Mixamo exports live here — inputs to this tool, never shipped.
const SRC = path.join(MODELS, "_src");
const OUT = path.join(MODELS, "Voodoo-Dool-Animated.glb");

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB: " + file);
  const jsonLen = b.readUInt32LE(12);
  const jsonStart = 20;
  const json = JSON.parse(b.slice(jsonStart, jsonStart + jsonLen).toString("utf8"));
  const binLenOff = jsonStart + jsonLen;
  const binLen = b.readUInt32LE(binLenOff);
  const binStart = binLenOff + 8;
  return { json, bin: b.slice(binStart, binStart + binLen) };
}

function writeGlb(file, json, bin) {
  let jsonStr = JSON.stringify(json);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  jsonStr += " ".repeat(jsonPad);
  const jsonBuf = Buffer.from(jsonStr, "utf8");
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  jsonBuf.copy(out, 20);
  out.writeUInt32LE(binBuf.length, 20 + jsonBuf.length);
  out.writeUInt32LE(0x004e4942, 24 + jsonBuf.length); // 'BIN'
  binBuf.copy(out, 28 + jsonBuf.length);
  fs.writeFileSync(file, out);
  return out.length;
}

const align4 = (n) => (n + 3) & ~3;

// Each extra file contributes exactly ONE clip (Mixamo exports everything as
// "mixamo.com"), so the clip name has to come from here.
// Voodoo-Pose.glb is a single frozen Mixamo frame in a levitating stance — the
// "hover" clip is that one pose. ALL real motion is procedural (see
// BuddyPreview.createHoverState): a slow levitation bob, and a forward lean
// while travelling. The old idle/running/sad clips were Mixamo walk/run cycles
// that read as glitchy twitching, so they are deliberately NOT merged in.
const EXTRA_CLIPS = [];

function main() {
  const baseFile = path.join(SRC, "Voodoo-Pose.glb");
  const extras = EXTRA_CLIPS
    .map((e) => ({ ...e, full: path.join(SRC, e.file) }))
    .filter((e) => fs.existsSync(e.full));

  if (!fs.existsSync(baseFile)) {
    console.error("Missing base GLB: " + baseFile);
    process.exit(1);
  }
  // Zero extras is a valid configuration: a pure repack of the base pose
  // (texture fix + renamed clip), which is what Voodoo-Pose.glb needs.
  if (!extras.length) {
    console.log("No extra clips to merge — repacking the base pose only.");
  }

  const A = readGlb(baseFile); // base: mesh + skin + idle clip
  const json = A.json;

  /* ---- 1. rigs must match, or the merged clips will drive nothing ---- */
  const namesA = json.nodes.map((n) => n.name);
  for (const e of extras) {
    const namesB = readGlb(e.full).json.nodes.map((n) => n.name);
    if (JSON.stringify(namesA) !== JSON.stringify(namesB)) {
      console.error("Node trees differ between exports (" + e.file + ") — cannot merge safely.");
      process.exit(1);
    }
  }
  const nodeByName = {};
  namesA.forEach((n, i) => (nodeByName[n] = i));

  /* ---- 2. strip broken external textures, use tint-friendly colours ---- */
  // Neutral factors: light body / dark stitching / mid cap. The per-buddy hue
  // tint multiplies these, so a neutral base is what makes "Ivory" look ivory.
  const FACTORS = {
    "Material.001": [0.88, 0.88, 0.88, 1],
    "Material.002": [0.28, 0.28, 0.28, 1],
    lambert1: [0.72, 0.72, 0.72, 1],
  };
  (json.materials || []).forEach((m) => {
    const p = m.pbrMetallicRoughness || (m.pbrMetallicRoughness = {});
    delete p.baseColorTexture;
    delete p.metallicRoughnessTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    p.baseColorFactor = FACTORS[m.name] || [0.8, 0.8, 0.8, 1];
  });
  delete json.images;
  delete json.textures;

  /* ---- 3. append only the extra clips' data to the binary chunk ---- */
  const binParts = [A.bin];
  let binLen = A.bin.length;

  const viewMap = new Map(); // "srcIdx:file" -> merged bufferView index
  const accMap = new Map(); //  "srcIdx:file" -> merged accessor index

  function ensureView(srcJson, srcBin, bIdx, tag) {
    const key = bIdx + ":" + tag;
    if (viewMap.has(key)) return viewMap.get(key);
    const src = srcJson.bufferViews[bIdx];
    const data = srcBin.slice(src.byteOffset, src.byteOffset + src.byteLength);

    // 4-byte align the start of every appended view.
    const pad = align4(binLen) - binLen;
    if (pad) { binParts.push(Buffer.alloc(pad, 0)); binLen += pad; }

    const byteOffset = binLen;
    binParts.push(data);
    binLen += data.byteLength;

    const newIdx = json.bufferViews.length;
    viewMap.set(key, newIdx);
    json.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: src.byteLength,
      ...(src.target ? { target: src.target } : {}),
    });
    return newIdx;
  }

  function ensureAccessor(srcJson, srcBin, bIdx, tag) {
    const key = bIdx + ":" + tag;
    if (accMap.has(key)) return accMap.get(key);
    const src = srcJson.accessors[bIdx];
    const newView = ensureView(srcJson, srcBin, src.bufferView, tag);
    const newIdx = json.accessors.length;
    accMap.set(key, newIdx);
    json.accessors.push({
      bufferView: newView,
      byteOffset: src.byteOffset || 0,
      componentType: src.componentType,
      count: src.count,
      type: src.type,
      ...(src.min ? { min: src.min } : {}),
      ...(src.max ? { max: src.max } : {}),
    });
    return newIdx;
  }

  const mergedClips = [];
  for (const e of extras) {
    const B = readGlb(e.full);
    const srcAnim = B.json.animations && B.json.animations[0];
    if (!srcAnim) {
      console.warn("  ! no animation in " + e.file + " — skipped");
      continue;
    }
    const tag = e.name;
    mergedClips.push({
      name: e.name,
      samplers: srcAnim.samplers.map((s) => ({
        input: ensureAccessor(B.json, B.bin, s.input, tag),
        output: ensureAccessor(B.json, B.bin, s.output, tag),
        interpolation: s.interpolation || "LINEAR",
      })),
      channels: srcAnim.channels.map((c) => {
        const nodeName = B.json.nodes[c.target.node] && B.json.nodes[c.target.node].name;
        const targetNode = nodeByName[nodeName];
        if (targetNode === undefined) {
          throw new Error("Animation targets unknown node: " + nodeName);
        }
        return { sampler: c.sampler, target: { node: targetNode, path: c.target.path } };
      }),
    });
  }

  /* ---- 4. name the clips so runtime can tell them apart ---- */
  if (!json.animations || !json.animations.length) json.animations = [];
  // The base pose clip becomes "hover" — the resting levitation stance.
  json.animations[0].name = "hover";
  mergedClips.forEach((c) => json.animations.push(c));

  /* ---- 5. finalise ---- */
  if (!json.buffers || !json.buffers.length) json.buffers = [{ byteLength: 0 }];
  json.buffers[0].byteLength = binLen;

  const mergedBin = Buffer.concat(binParts);
  const size = writeGlb(OUT, json, mergedBin);

  console.log("Wrote " + path.relative(ROOT, OUT) + "  (" + (size / 1024 / 1024).toFixed(2) + " MB)");
  console.log("  clips     :", json.animations.map((a) => a.name + " (" + a.channels.length + " ch)").join(", "));
  console.log("  nodes     :", json.nodes.length, "| skins:", (json.skins || []).length);
  console.log("  materials :", (json.materials || []).map((m) => m.name).join(", "), "(textures stripped)");
  console.log("  images    :", (json.images || []).length, "(external URIs removed)");
  console.log("");
  console.log("Before: " + (extras.length + 1) + " x ~7.4 MB  = " + ((extras.length + 1) * 7.4).toFixed(1) + " MB of downloads");
  console.log("After : 1 x " + (size / 1024 / 1024).toFixed(2) + " MB with " + json.animations.length + " animations");
}

main();
