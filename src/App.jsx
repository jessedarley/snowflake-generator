import React, { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildSnowflake2D, mulberry32, seedFromString } from "./geometry.js";
import { buildSnowflakeMeshFromSegments } from "./snowflake/sdfOutline.js";
import logo from "./assets/logo.png";

const SHOW_HALF_ONE_BRANCH = false;
const COMPLEXITY_LABELS = ["Low", "Medium", "High"];
const THICKNESS_LABELS = ["Thin", "Medium", "Thick"];
const COMPLEXITY_VALUES = [3, 6, 9];
const THICKNESS_VALUES = [4, 10, 16];
const SIZE_VALUES_IN = [1, 2, 3, 4, 5];
const MM_PER_IN = 25.4;

function labelFromLevel(labels, index) {
  return labels[Math.max(0, Math.min(labels.length - 1, index))];
}

function sanitizeNamePart(value) {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return safe.replace(/^_+|_+$/g, "") || "anon";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angleInWedge(theta, halfAngle) {
  let t = theta;
  while (t > Math.PI) t -= Math.PI * 2;
  while (t < -Math.PI) t += Math.PI * 2;
  return Math.abs(t) <= halfAngle;
}

function distanceSegmentToOrigin(a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-12) return Math.hypot(a[0], a[1]);
  const t = clamp((-(a[0] * abx + a[1] * aby)) / ab2, 0, 1);
  const cx = a[0] + abx * t;
  const cy = a[1] + aby * t;
  return Math.hypot(cx, cy);
}

function buildCoreMaskParams(seed, thickness, complexity) {
  const coreRand = mulberry32((seed ^ 0x45d9f3b) >>> 0);
  const baseR = 1.05 + thickness * 0.04 + Math.max(0, complexity - 6) * 0.16;
  const useHex = coreRand() < 0.32;
  return {
    useHex,
    baseR,
    phase: coreRand() * Math.PI * 2,
    amp1: 0.08 + coreRand() * 0.12,
    amp2: 0.02 + coreRand() * 0.06,
    skew: (coreRand() - 0.5) * 0.22,
  };
}

function coreRadiusAtAngle(theta, params) {
  if (params.useHex) {
    const t = theta + params.phase;
    const hex = 1 / Math.max(0.4, Math.cos((Math.PI / 6) - ((t + Math.PI * 8) % (Math.PI / 3))));
    return params.baseR * (0.86 + params.amp1 * 0.7) * hex * 0.62;
  }
  const t = theta + params.phase;
  const six = Math.cos(6 * (t + params.skew));
  const twelve = Math.cos(12 * t + params.skew * 1.7);
  const scale = 1 + params.amp1 * six + params.amp2 * twelve;
  return params.baseR * 0.94 * scale;
}

function segmentOutsideCoreMask(a, b, params, margin) {
  const m = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
  const samples = [a, m, b];
  for (let i = 0; i < samples.length; i += 1) {
    const p = samples[i];
    const r = Math.hypot(p[0], p[1]);
    const theta = Math.atan2(p[1], p[0]);
    const minR = coreRadiusAtAngle(theta, params) + margin;
    if (r < minR) {
      return false;
    }
  }
  return true;
}

function makeSnowflakeMeshGeometry(seed, complexity, thickness, sizeInches) {
  const rand = mulberry32(seed);
  const safeThickness = Math.max(2, Math.min(20, Number(thickness) || 10));
  const geometry2d = buildSnowflake2D(rand, complexity, safeThickness);
  const wedgeHalfAngle = Math.PI / 6;
  const wedgeMargin = 0.11;
  const coreMaskParams = buildCoreMaskParams(seed, safeThickness, complexity);
  const coreMargin = 0.22 + safeThickness * 0.01 + Math.max(0, complexity - 6) * 0.06;
  const branchHalfSegments = geometry2d.segments.filter(([a, b]) => {
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const theta = Math.atan2(my, mx);
    const inSingleBranch = angleInWedge(theta, Math.PI / 6);
    const inUpperHalf = my >= -1e-6;
    return inSingleBranch && inUpperHalf;
  });
  const branchWedgeSegments = geometry2d.segments.filter(([a, b]) => {
    const ta = Math.atan2(a[1], a[0]);
    const tb = Math.atan2(b[1], b[0]);
    const insideWedge =
      angleInWedge(ta, wedgeHalfAngle - wedgeMargin) &&
      angleInWedge(tb, wedgeHalfAngle - wedgeMargin);
    const outsideCore =
      segmentOutsideCoreMask(a, b, coreMaskParams, coreMargin) &&
      distanceSegmentToOrigin(a, b) >= 0.95;
    return insideWedge && outsideCore;
  });

  let merged;
  if (SHOW_HALF_ONE_BRANCH) {
    merged = buildSnowflakeMeshFromSegments(branchHalfSegments, safeThickness);
  } else {
    const wedgeGeometry = buildSnowflakeMeshFromSegments(branchWedgeSegments, safeThickness);
    const parts = [];
    for (let i = 0; i < 6; i += 1) {
      const part = wedgeGeometry.clone();
      part.applyMatrix4(new THREE.Matrix4().makeRotationZ((i * Math.PI) / 3));
      parts.push(part);
    }
    merged = mergeGeometries(parts, true);
    wedgeGeometry.dispose();
    parts.forEach((p) => p.dispose());
  }

  const box = merged.boundingBox || new THREE.Box3().setFromBufferAttribute(merged.attributes.position);
  const size = new THREE.Vector3();
  box.getSize(size);
  const baseDiameterXY = Math.max(size.x, size.y, 1e-6);
  const targetDiameterMm = Math.max(1, Number(sizeInches) || 3) * MM_PER_IN;
  const targetDepthMm = targetDiameterMm / 20;
  const scaleXY = targetDiameterMm / baseDiameterXY;

  merged.scale(scaleXY, scaleXY, scaleXY);
  merged.computeBoundingBox();
  const scaledSize = new THREE.Vector3();
  merged.boundingBox.getSize(scaledSize);
  const currentDepth = Math.max(scaledSize.z, 1e-6);
  const scaleZ = targetDepthMm / currentDepth;
  merged.scale(1, 1, scaleZ);
  // Keep local thickness from relief variation above 2 mm.
  const minHalfDepthMm = 1;
  const pos = merged.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const z = pos.getZ(i);
    const zSign = z >= 0 ? 1 : -1;
    pos.setZ(i, zSign * Math.max(Math.abs(z), minHalfDepthMm));
  }
  pos.needsUpdate = true;
  merged.computeVertexNormals();
  merged.computeBoundingBox();

  return merged;
}

function exportMeshToStl(mesh, filename) {
  mesh.updateWorldMatrix(true, false);
  const baked = mesh.clone();
  baked.geometry = mesh.geometry.clone();
  baked.geometry.applyMatrix4(mesh.matrixWorld);
  baked.position.set(0, 0, 0);
  baked.rotation.set(0, 0, 0);
  baked.scale.set(1, 1, 1);
  baked.updateMatrixWorld(true);

  const exporter = new STLExporter();
  const data = exporter.parse(baked, { binary: true });
  const blob = new Blob([data], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  baked.geometry.dispose();
}

function CameraHeadlight() {
  const lightRef = useRef(null);
  const { camera } = useThree();
  useFrame(() => {
    if (!lightRef.current) return;
    lightRef.current.position.copy(camera.position);
  });
  return <pointLight ref={lightRef} intensity={2.2} distance={0} decay={0} />;
}

export default function App() {
  const meshRef = useRef(null);
  const snowParticles = useMemo(
    () =>
      Array.from({ length: 128 }, (_, i) => ({
        id: i,
        left: ((i * 37) % 100) + "%",
        size: 4 + (i % 5),
        duration: 8 + (i % 7) * 1.2,
        delay: -(i % 9) * 0.8,
        drift: (i % 2 === 0 ? 1 : -1) * (8 + (i % 6) * 3),
        opacity: 0.16 + (i % 4) * 0.08,
      })),
    []
  );

  const [nameOrPhrase, setNameOrPhrase] = useState("Ice to meet you");
  const [complexityLevel, setComplexityLevel] = useState(1);
  const [thicknessLevel, setThicknessLevel] = useState(1);
  const [sizeLevel, setSizeLevel] = useState(2);

  const [generated, setGenerated] = useState({
    nameOrPhrase: "Ice to meet you",
    complexity: COMPLEXITY_VALUES[1],
    thickness: THICKNESS_VALUES[1],
    complexityLevel: 1,
    thicknessLevel: 1,
    sizeInches: SIZE_VALUES_IN[2],
  });

  const safeThickness = Math.max(2, Math.min(20, generated.thickness));
  const seedText = `${generated.nameOrPhrase.trim()}|${generated.complexity}|${safeThickness}`;
  const seed = useMemo(() => seedFromString(seedText), [seedText]);

  const meshGeometry = useMemo(
    () =>
      makeSnowflakeMeshGeometry(
        seed,
        generated.complexity,
        safeThickness,
        generated.sizeInches
      ),
    [seed, generated.complexity, safeThickness, generated.sizeInches]
  );

  const info = useMemo(() => {
    const box =
      meshGeometry.boundingBox ||
      new THREE.Box3().setFromBufferAttribute(meshGeometry.attributes.position);
    const size = new THREE.Vector3();
    box.getSize(size);
    const diameter = Math.max(size.x, size.y);
    const depth = size.z;
    const triCount = meshGeometry.index
      ? Math.floor(meshGeometry.index.count / 3)
      : Math.floor(meshGeometry.attributes.position.count / 3);
    return { diameter, depth, triCount };
  }, [meshGeometry]);

  const handleRegenerate = () => {
    setGenerated({
      nameOrPhrase,
      complexity: COMPLEXITY_VALUES[complexityLevel],
      thickness: THICKNESS_VALUES[thicknessLevel],
      complexityLevel,
      thicknessLevel,
      sizeInches: SIZE_VALUES_IN[sizeLevel],
    });
  };

  const handleNameKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRegenerate();
      e.currentTarget.blur();
    }
  };

  const handleExport = () => {
    if (!meshRef.current) {
      return;
    }
    const complexityLevel = Math.max(1, Math.min(3, (generated.complexityLevel ?? 1) + 1));
    const thicknessLevel = Math.max(1, Math.min(3, (generated.thicknessLevel ?? 1) + 1));
    const sizeSuffix = `${Math.round(generated.sizeInches || 3)}in`;
    const file = `snowflake_${sanitizeNamePart(generated.nameOrPhrase)}_c${complexityLevel}_t${thicknessLevel}_${sizeSuffix}.stl`;
    exportMeshToStl(meshRef.current, file);
  };

  return (
    <div className="app-shell">
      <style>{`
        :root {
          --ice-0: #0f3b66;
          --ice-1: #2f5f8f;
          --ice-2: #d6e8f7;
          --ice-3: #96adc2;
          --night-0: #0d1c2a;
          --night-1: #143247;
          --frost: #f7fbff;
          --logo-blue: #33429b;
        }
        * { box-sizing: border-box; }
        .app-shell {
          min-height: 100vh;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.1rem;
          padding: 1.2rem;
          color: var(--logo-blue);
          font-family: "Cinzel", "Palatino Linotype", "Book Antiqua", serif;
          background:
            radial-gradient(circle at 20% 10%, rgba(255,255,255,0.18), transparent 34%),
            radial-gradient(circle at 84% 6%, rgba(200, 230, 255, 0.2), transparent 28%),
            repeating-linear-gradient(115deg, rgba(255,255,255,0.1) 0, rgba(255,255,255,0.1) 1px, transparent 1px, transparent 12px),
            linear-gradient(155deg, var(--ice-0) 0%, var(--ice-1) 42%, var(--ice-2) 100%);
        }
        .title {
          margin: 0;
          text-align: center;
          letter-spacing: 0.04em;
          font-size: clamp(1.7rem, 4.2vw, 2.5rem);
          font-weight: 650;
          color: var(--logo-blue);
          text-transform: uppercase;
          font-family: "Cinzel", "Palatino Linotype", "Book Antiqua", serif;
        }
        .brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
        }
        .brand-logo {
          width: clamp(56px, 8vw, 84px);
          height: clamp(56px, 8vw, 84px);
          object-fit: cover;
          object-position: 50% 24%;
          border-radius: 0;
          border: none;
          background: transparent;
          box-shadow: none;
        }
        .controls {
          width: min(94vw, 860px);
          padding: 0.95rem;
          border: 1px solid rgba(20, 50, 71, 0.12);
          border-radius: 16px;
          backdrop-filter: blur(2px);
          background: linear-gradient(180deg, rgba(247, 251, 255, 0.84), rgba(247, 251, 255, 0.62));
          box-shadow: 0 8px 26px rgba(7, 27, 43, 0.08);
        }
        .controls .brand {
          justify-content: center;
          margin-bottom: 0.8rem;
        }
        .control-grid {
          display: grid;
          grid-template-columns: minmax(260px, 520px);
          justify-content: center;
          gap: 0.8rem;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          font-size: clamp(1rem, 2.2vw, 1.16rem);
          color: var(--logo-blue);
          text-align: center;
          align-items: center;
        }
        .field-inline {
          flex-direction: row;
          justify-content: center;
          align-items: center;
          gap: 0.7rem;
        }
        .field-inline .field-label {
          min-width: 120px;
          text-align: right;
        }
        .field input[type="text"] {
          width: min(100%, 195px);
          border: 1px solid rgba(28, 67, 95, 0.24);
          border-radius: 10px;
          padding: 0.52rem 0.62rem;
          background: rgba(255,255,255,0.86);
          color: var(--logo-blue);
          font-family: inherit;
          font-size: clamp(1rem, 2.1vw, 1.12rem);
          outline: none;
        }
        .field input[type="text"]:focus {
          border-color: #6f95b3;
          box-shadow: 0 0 0 2px rgba(111, 149, 179, 0.18);
        }
        .field input[type="range"] {
          width: min(100%, 520px);
          -webkit-appearance: none;
          appearance: none;
          height: 22px;
          background: transparent;
          cursor: pointer;
        }
        .field input[type="range"]::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(90deg, #33429b, #33429b);
          border: 1px solid rgba(51, 66, 155, 0.25);
        }
        .field input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 22px;
          margin-top: -9px;
          border: none;
          background: #33429b;
          clip-path: polygon(
            50% 0%,
            58% 34%,
            93% 50%,
            58% 66%,
            50% 100%,
            42% 66%,
            7% 50%,
            42% 34%
          );
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55);
        }
        .field input[type="range"]::-moz-range-track {
          height: 6px;
          border-radius: 999px;
          background: #33429b;
          border: 1px solid rgba(51, 66, 155, 0.25);
        }
        .field input[type="range"]::-moz-range-thumb {
          width: 22px;
          height: 22px;
          border: none;
          border-radius: 0;
          background: #33429b;
          clip-path: polygon(
            50% 0%,
            58% 34%,
            93% 50%,
            58% 66%,
            50% 100%,
            42% 66%,
            7% 50%,
            42% 34%
          );
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55);
        }
        .btn {
          border: none;
          border-radius: 999px;
          padding: 0.55rem 0.98rem;
          font-weight: 650;
          letter-spacing: 0.01em;
          font-size: clamp(1rem, 2.2vw, 1.12rem);
          font-family: inherit;
          cursor: pointer;
        }
        .btn-export {
          color: #ffffff;
          background: linear-gradient(145deg, #33429b, #3f53b5);
          border: 1px solid rgba(20, 34, 120, 0.35);
        }
        .button-note {
          margin-top: 0.35rem;
          text-align: center;
          font-size: 0.9rem;
          color: var(--logo-blue);
          opacity: 0.85;
        }
        .scene-wrap {
          width: min(94vw, 860px);
          height: min(66vh, 640px);
          position: relative;
          border-radius: 20px;
          overflow: hidden;
          border: none;
          background: transparent;
          box-shadow: none;
        }
        .scene-snow {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          overflow: hidden;
        }
        .snow-dot {
          position: absolute;
          top: -8%;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.9);
          filter: blur(0.2px);
          animation-name: snowfall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          will-change: transform;
        }
        @keyframes snowfall {
          0% { transform: translate3d(0, -10%, 0); }
          100% { transform: translate3d(var(--drift), 115vh, 0); }
        }
        .scene-canvas {
          position: absolute;
          inset: 0;
          z-index: 2;
        }
        .scene-export-btn {
          position: absolute;
          left: 0.8rem;
          top: 0.8rem;
          z-index: 4;
        }
        .export-ghost {
          position: absolute;
          left: 0.8rem;
          bottom: 0.72rem;
          z-index: 3;
          pointer-events: none;
          font-size: clamp(0.9rem, 1.8vw, 1.05rem);
          line-height: 1.35;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
          user-select: none;
          display: flex;
          flex-direction: column;
          gap: 0.08rem;
        }
        .export-row {
          display: grid;
          grid-template-columns: auto auto 1fr;
          align-items: baseline;
          justify-items: center;
          column-gap: 0.2rem;
        }
        .export-key {
          justify-self: end;
          letter-spacing: 0.02em;
        }
        .export-colon {
          width: 0.5rem;
          text-align: center;
        }
        .export-value {
          justify-self: start;
        }
        @media (max-width: 740px) {
          .control-grid { grid-template-columns: minmax(220px, 1fr); }
          .field-inline {
            flex-direction: column;
            gap: 0.3rem;
          }
          .field-inline .field-label {
            min-width: 0;
            text-align: center;
          }
          .scene-wrap { height: min(60vh, 520px); }
          .export-ghost { font-size: 0.95rem; max-width: 72vw; }
        }
      `}</style>

      <section className="controls">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="Snowflake Generator logo" />
          <h1 className="title">Snowflake Studio</h1>
        </div>
        <div className="control-grid">
          <label className="field field-inline">
            <span className="field-label">Name or Phrase</span>
            <input
              type="text"
              value={nameOrPhrase}
              onChange={(e) => setNameOrPhrase(e.target.value)}
              onFocus={() => setNameOrPhrase("")}
              onKeyDown={handleNameKeyDown}
            />
          </label>
          <label className="field">
            Complexity: {COMPLEXITY_LABELS[complexityLevel]}
            <input
              type="range"
              min="0"
              max="2"
              step="1"
              value={complexityLevel}
              onChange={(e) => setComplexityLevel(Number(e.target.value))}
            />
          </label>
          <label className="field">
            Thickness: {THICKNESS_LABELS[thicknessLevel]}
            <input
              type="range"
              min="0"
              max="2"
              step="1"
              value={thicknessLevel}
              onChange={(e) => setThicknessLevel(Number(e.target.value))}
            />
          </label>
          <label className="field">
            Size: {SIZE_VALUES_IN[sizeLevel]} in
            <input
              type="range"
              min="0"
              max="4"
              step="1"
              value={sizeLevel}
              onChange={(e) => setSizeLevel(Number(e.target.value))}
            />
          </label>
        </div>
        <div style={{ marginTop: "0.72rem", display: "flex", justifyContent: "center" }}>
          <button className="btn btn-export" type="button" onClick={handleRegenerate}>
            Let it snow!
          </button>
        </div>
        <div className="button-note">Click to rebuild</div>
      </section>

      <div className="scene-wrap">
        <button className="btn btn-export scene-export-btn" type="button" onClick={handleExport}>
          Export STL
        </button>
        <div className="scene-snow" aria-hidden="true">
          {snowParticles.map((flake) => (
            <span
              key={flake.id}
              className="snow-dot"
              style={{
                left: flake.left,
                width: `${flake.size}px`,
                height: `${flake.size}px`,
                opacity: flake.opacity,
                animationDuration: `${flake.duration}s`,
                animationDelay: `${flake.delay}s`,
                "--drift": `${flake.drift}px`,
              }}
            />
          ))}
        </div>
        <div className="export-ghost">
          <div className="export-row">
            <span className="export-key">NAME OR PHRASE</span>
            <span className="export-colon">:</span>
            <span className="export-value">{generated.nameOrPhrase.trim() || "—"}</span>
          </div>
          <div className="export-row">
            <span className="export-key">COMPLEXITY</span>
            <span className="export-colon">:</span>
            <span className="export-value">
              {labelFromLevel(COMPLEXITY_LABELS, generated.complexityLevel)}
            </span>
          </div>
          <div className="export-row">
            <span className="export-key">THICKNESS</span>
            <span className="export-colon">:</span>
            <span className="export-value">
              {labelFromLevel(THICKNESS_LABELS, generated.thicknessLevel)}
            </span>
          </div>
          <div className="export-row">
            <span className="export-key">SIZE</span>
            <span className="export-colon">:</span>
            <span className="export-value">{(info.diameter / MM_PER_IN).toFixed(2)} in</span>
          </div>
          <div className="export-row">
            <span className="export-key">DEPTH</span>
            <span className="export-colon">:</span>
            <span className="export-value">{(info.depth / MM_PER_IN).toFixed(2)} in</span>
          </div>
          <div className="export-row">
            <span className="export-key">TRIANGLES</span>
            <span className="export-colon">:</span>
            <span className="export-value">
              {info.triCount}
            </span>
          </div>
        </div>
        <Canvas className="scene-canvas" gl={{ alpha: true }} camera={{ position: [0, 0, 190], fov: 36 }}>
          <ambientLight intensity={0.95} />
          <hemisphereLight intensity={0.55} color="#ffffff" groundColor="#dbe7ff" />
          <CameraHeadlight />
          <directionalLight position={[0, 0, 220]} intensity={0.3} />
          <mesh ref={meshRef} geometry={meshGeometry}>
            <meshPhongMaterial
              color="#ffffff"
              specular="#ffffff"
              shininess={85}
              emissive="#4a4a4a"
              emissiveIntensity={0.18}
            />
          </mesh>
          <OrbitControls enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
