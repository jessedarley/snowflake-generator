import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { buildSnowflake2D, mulberry32, seedFromString } from "./geometry.js";
import { buildSnowflakeMeshFromSegments } from "./snowflake/sdfOutline.js";
import logo from "./assets/logo.png";

const SHOW_HALF_ONE_BRANCH = false;

function sanitizeNamePart(value) {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return safe.replace(/^_+|_+$/g, "") || "anon";
}

function makeSnowflakeMeshGeometry(seed, complexity, thickness) {
  const rand = mulberry32(seed);
  const safeThickness = Math.max(2, Math.min(20, Number(thickness) || 10));
  const geometry2d = buildSnowflake2D(rand, complexity, safeThickness);
  const branchHalfSegments = geometry2d.segments.filter(([a, b]) => {
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const theta = Math.atan2(my, mx);
    const inSingleBranch = Math.abs(theta) <= Math.PI / 6;
    const inUpperHalf = my >= -1e-6;
    return inSingleBranch && inUpperHalf;
  });
  const sourceSegments = SHOW_HALF_ONE_BRANCH ? branchHalfSegments : geometry2d.segments;
  const merged = buildSnowflakeMeshFromSegments(sourceSegments, safeThickness);
  const box = merged.boundingBox || new THREE.Box3().setFromBufferAttribute(merged.attributes.position);
  const size = new THREE.Vector3();
  box.getSize(size);
  const baseDiameterXY = Math.max(size.x, size.y, 1e-6);
  const targetDiameterMm = 110;
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

export default function App() {
  const meshRef = useRef(null);

  const [firstName, setFirstName] = useState("Ada");
  const [lastName, setLastName] = useState("Lovelace");
  const [complexity, setComplexity] = useState(6);
  const [thickness, setThickness] = useState(10);

  const [generated, setGenerated] = useState({
    firstName: "Ada",
    lastName: "Lovelace",
    complexity: 6,
    thickness: 10,
  });

  const safeThickness = Math.max(2, Math.min(20, generated.thickness));
  const seedText = `${generated.firstName.trim()}|${generated.lastName.trim()}|${generated.complexity}|${safeThickness}`;
  const seed = useMemo(() => seedFromString(seedText), [seedText]);

  const meshGeometry = useMemo(
    () => makeSnowflakeMeshGeometry(seed, generated.complexity, safeThickness),
    [seed, generated.complexity, safeThickness]
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

  const commitNames = () => {
    setGenerated((prev) => ({
      ...prev,
      firstName,
      lastName,
    }));
  };

  const handleNameKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitNames();
      e.currentTarget.blur();
    }
  };

  useEffect(() => {
    setGenerated((prev) => ({
      ...prev,
      complexity: Math.max(1, Math.min(10, Number(complexity) || 1)),
      thickness: Math.max(2, Math.min(20, Number(thickness) || 2)),
    }));
  }, [complexity, thickness]);

  const handleExport = () => {
    if (!meshRef.current) {
      return;
    }
    const file = `snowflake_${sanitizeNamePart(generated.firstName)}_${sanitizeNamePart(generated.lastName)}_c${generated.complexity}_t${safeThickness}.stl`;
    exportMeshToStl(meshRef.current, file);
  };

  return (
    <div className="app-shell">
      <style>{`
        :root {
          --ice-0: #f4f9ff;
          --ice-1: #e8f1fb;
          --ice-2: #d8e8f5;
          --ice-3: #96adc2;
          --night-0: #0d1c2a;
          --night-1: #143247;
          --frost: #f7fbff;
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
          color: var(--night-0);
          font-family: "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif;
          background:
            radial-gradient(circle at 18% 16%, rgba(255,255,255,0.75), transparent 28%),
            radial-gradient(circle at 86% 4%, rgba(180, 208, 232, 0.36), transparent 26%),
            repeating-linear-gradient(115deg, rgba(255,255,255,0.26) 0, rgba(255,255,255,0.26) 1px, transparent 1px, transparent 10px),
            linear-gradient(155deg, var(--ice-0) 0%, var(--ice-1) 44%, var(--ice-2) 100%);
        }
        .title {
          margin: 0.1rem 0 0;
          text-align: center;
          letter-spacing: 0.04em;
          font-size: clamp(1.35rem, 2.4vw, 2rem);
          font-weight: 650;
          color: var(--night-1);
          text-transform: uppercase;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.8rem;
        }
        .brand-logo {
          width: clamp(56px, 8vw, 84px);
          height: clamp(56px, 8vw, 84px);
          object-fit: cover;
          object-position: 50% 24%;
          border-radius: 14px;
          border: 1px solid rgba(14, 58, 85, 0.18);
          background: rgba(255, 255, 255, 0.7);
          box-shadow: 0 6px 16px rgba(6, 31, 48, 0.1);
        }
        .controls {
          width: min(100%, 760px);
          padding: 0.95rem;
          border: 1px solid rgba(20, 50, 71, 0.12);
          border-radius: 16px;
          backdrop-filter: blur(2px);
          background: linear-gradient(180deg, rgba(247, 251, 255, 0.84), rgba(247, 251, 255, 0.62));
          box-shadow: 0 8px 26px rgba(7, 27, 43, 0.08);
        }
        .control-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.8rem 0.95rem;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          font-size: 0.86rem;
          color: #27475e;
        }
        .field input[type="text"] {
          width: 100%;
          border: 1px solid rgba(28, 67, 95, 0.24);
          border-radius: 10px;
          padding: 0.52rem 0.62rem;
          background: rgba(255,255,255,0.86);
          color: #10283c;
          outline: none;
        }
        .field input[type="text"]:focus {
          border-color: #6f95b3;
          box-shadow: 0 0 0 2px rgba(111, 149, 179, 0.18);
        }
        .field input[type="range"] {
          width: 100%;
          accent-color: #4e7593;
        }
        .btn {
          border: none;
          border-radius: 999px;
          padding: 0.55rem 0.98rem;
          font-weight: 650;
          letter-spacing: 0.01em;
          cursor: pointer;
        }
        .btn-export {
          color: #153147;
          background: linear-gradient(145deg, #d8e8f5, #ecf5fc);
          border: 1px solid rgba(21, 49, 71, 0.15);
        }
        .scene-wrap {
          width: min(94vw, 860px);
          height: min(66vh, 640px);
          position: relative;
          border-radius: 20px;
          overflow: hidden;
          border: 1px solid rgba(19, 53, 77, 0.15);
          background: linear-gradient(165deg, rgba(247, 251, 255, 0.58), rgba(230, 240, 250, 0.36));
          box-shadow: inset 0 0 50px rgba(255,255,255,0.36), 0 10px 34px rgba(8, 32, 49, 0.12);
        }
        .export-ghost {
          position: absolute;
          right: 0.8rem;
          bottom: 0.72rem;
          z-index: 2;
          pointer-events: none;
          font-size: 0.74rem;
          line-height: 1.35;
          color: rgba(13, 28, 42, 0.34);
          text-align: right;
          text-shadow: 0 1px rgba(255,255,255,0.35);
          user-select: none;
        }
        @media (max-width: 740px) {
          .control-grid { grid-template-columns: 1fr; }
          .scene-wrap { height: min(60vh, 520px); }
          .export-ghost { font-size: 0.69rem; max-width: 68vw; }
        }
      `}</style>

      <div className="brand">
        <img className="brand-logo" src={logo} alt="Snowflake Generator logo" />
        <h1 className="title">Winter Snowflake Studio</h1>
      </div>

      <section className="controls">
        <div className="control-grid">
          <label className="field">
            First Name
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onBlur={commitNames}
              onKeyDown={handleNameKeyDown}
            />
          </label>
          <label className="field">
            Last Name
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              onBlur={commitNames}
              onKeyDown={handleNameKeyDown}
            />
          </label>
          <label className="field">
            Complexity: {complexity}
            <input
              type="range"
              min="1"
              max="10"
              value={complexity}
              onChange={(e) => setComplexity(Number(e.target.value))}
            />
          </label>
          <label className="field">
            Thickness: {thickness}
            <input
              type="range"
              min="1"
              max="20"
              value={thickness}
              onChange={(e) => setThickness(Number(e.target.value))}
            />
          </label>
        </div>
      </section>

      <div className="scene-wrap">
        <div className="export-ghost">
          <div>SEED {seedText}</div>
          <div>DIAMETER {info.diameter.toFixed(1)} MM</div>
          <div>DEPTH {info.depth.toFixed(1)} MM</div>
          <div>THICKNESS {safeThickness}</div>
          <div>TRIANGLES {info.triCount}</div>
        </div>
        <Canvas camera={{ position: [0, 0, 190], fov: 36 }}>
          <color attach="background" args={["#f3f8fd"]} />
          <ambientLight intensity={0.72} />
          <directionalLight position={[150, 120, 120]} intensity={0.85} />
          <mesh ref={meshRef} geometry={meshGeometry}>
            <meshStandardMaterial color="#dfe8ff" metalness={0.06} roughness={0.42} />
          </mesh>
          <OrbitControls enablePan={false} />
        </Canvas>
      </div>

      <button className="btn btn-export" type="button" onClick={handleExport}>
        Export STL
      </button>
    </div>
  );
}
