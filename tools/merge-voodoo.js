#!/usr/bin/env node
/* ==========================================================================
   Merge the Voodoo Doll's split GLB exports into ONE animated GLB.

   Input  (as exported):
     models/Voodoo-Dool.glb            static mesh (legacy fallback)
     models/Voodoo-Dool-Idle.glb       rig + mesh + "idle" clip
     models/Voodoo-Dool-Running.glb    rig + mesh + "running" clip
                                      ^^^ 7.4 MB of this is a DUPLICATE mesh

   Output:
     models/Voodoo-Dool-Animated.glb   rig + mesh + both clips, ~7.5 MB

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

function main() {
  const baseFile = path.join(MODELS, "Voodoo-Dool-Idle.glb");
  const extraFile = path.join(MODELS, "Voodoo-Dool-Running.glb");
  if (!fs.existsSync(baseFile) || !fs.existsSync(extraFile)) {
    console.error("Missing input GLBs in models/");
    process.exit(1);
  }

  const A = readGlb(baseFile); // base: mesh + skin + idle clip
  const B = readGlb(extraFile); // extra: running clip
  const json = A.json;

  /* ---- 1. rigs must match, or the merged clips will drive nothing ---- */
  const namesA = json.nodes.map((n) => n.name);
  const namesB = B.json.nodes.map((n) => n.name);
  if (JSON.stringify(namesA) !== JSON.stringify(namesB)) {
    console.error("Node trees differ between exports — cannot merge safely.");
    process.exit(1);
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

  /* ---- 3. append only the extra clip's data to the binary chunk ---- */
  const binParts = [A.bin];
  let binLen = A.bin.length;

  const viewMap = {}; // B bufferView index -> merged bufferView index
  const accMap = {}; //  B accessor   index -> merged accessor   index

  function ensureView(bIdx) {
    if (viewMap[bIdx] !== undefined) return viewMap[bIdx];
    const src = B.json.bufferViews[bIdx];
    const data = B.bin.slice(src.byteOffset, src.byteOffset + src.byteLength);

    // 4-byte align the start of every appended view.
    const pad = align4(binLen) - binLen;
    if (pad) { binParts.push(Buffer.alloc(pad, 0)); binLen += pad; }

    const byteOffset = binLen;
    binParts.push(data);
    binLen += data.byteLength;

    const newIdx = json.bufferViews.length;
    viewMap[bIdx] = newIdx;
    json.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: src.byteLength,
      ...(src.target ? { target: src.target } : {}),
    });
    return newIdx;
  }

  function ensureAccessor(bIdx) {
    if (accMap[bIdx] !== undefined) return accMap[bIdx];
    const src = B.json.accessors[bIdx];
    const newView = ensureView(src.bufferView);
    const newIdx = json.accessors.length;
    accMap[bIdx] = newIdx;
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

  const runAnim = B.json.animations && B.json.animations[0];
  if (!runAnim) {
    console.error("No animation found in " + extraFile);
    process.exit(1);
  }

  const merged = {
    name: "running",
    samplers: runAnim.samplers.map((s) => ({
      input: ensureAccessor(s.input),
      output: ensureAccessor(s.output),
      interpolation: s.interpolation || "LINEAR",
    })),
    channels: runAnim.channels.map((c) => {
      const nodeName = B.json.nodes[c.target.node] && B.json.nodes[c.target.node].name;
      const targetNode = nodeByName[nodeName];
      if (targetNode === undefined) {
        throw new Error("Animation targets unknown node: " + nodeName);
      }
      return {
        sampler: c.sampler,
        target: { node: targetNode, path: c.target.path },
      };
    }),
  };

  /* ---- 4. name the clips so runtime can tell them apart ---- */
  if (!json.animations || !json.animations.length) {
    json.animations = [];
  }
  json.animations[0].name = "idle";
  json.animations.push(merged);

  /* ---- 5. finalise ---- */
  if (!json.buffers || !json.buffers.length) json.buffers = [{ byteLength: 0 }];
  json.buffers[0].byteLength = binLen;

  const mergedBin = Buffer.concat(binParts);
  const size = writeGlb(OUT, json, mergedBin);

  const animBytes = merged.samplers.reduce((n, s) => {
    return n + (json.accessors[s.input].count * 8);
  }, 0);

  console.log("Wrote " + path.relative(ROOT, OUT) + "  (" + (size / 1024 / 1024).toFixed(2) + " MB)");
  console.log("  clips     :", json.animations.map((a) => a.name + " (" + a.channels.length + " ch)").join(", "));
  console.log("  nodes     :", json.nodes.length, "| skins:", (json.skins || []).length);
  console.log("  materials :", (json.materials || []).map((m) => m.name).join(", "), "(textures stripped)");
  console.log("  images    :", (json.images || []).length, "(external URIs removed)");
  console.log("");
  console.log("Before: 2 x ~7.4 MB  = 14.9 MB of downloads");
  console.log("After : 1 x " + (size / 1024 / 1024).toFixed(2) + " MB with both animations");
}

main();
