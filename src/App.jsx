import React, { useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildSnowflake2D, mulberry32, seedFromString } from "./geometry.js";

function sanitizeNamePart(value) {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return safe.replace(/^_+|_+$/g, "") || "anon";
}

function makeSnowflakeMeshGeometry(seed, complexity, thickness) {
  const rand = mulberry32(seed);
  const depthRand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const safeThickness = Math.max(2, Math.min(20, Number(thickness) || 10));
  const geometry2d = buildSnowflake2D(rand, complexity, safeThickness);
  const strokeHalfWidth = 0.08 + safeThickness * 0.03;
  const baseDepth = Math.max(1.2, safeThickness * 0.75);
  const minSegmentLen = 0.06;
  const parts = [];

  for (let i = 0; i < geometry2d.segments.length; i += 1) {
    const [a, b] = geometry2d.segments[i];
    const start = new THREE.Vector3(a[0], a[1], 0);
    const end = new THREE.Vector3(b[0], b[1], 0);
    const delta = new THREE.Vector3().subVectors(end, start);
    const length = delta.length();
    if (length < minSegmentLen) {
      continue;
    }

    const dir2 = new THREE.Vector2(end.x - start.x, end.y - start.y).normalize();
    const normal2 = new THREE.Vector2(-dir2.y, dir2.x).multiplyScalar(strokeHalfWidth);

    const p0 = new THREE.Vector2(start.x + normal2.x, start.y + normal2.y);
    const p1 = new THREE.Vector2(start.x - normal2.x, start.y - normal2.y);
    const p2 = new THREE.Vector2(end.x - normal2.x, end.y - normal2.y);
    const p3 = new THREE.Vector2(end.x + normal2.x, end.y + normal2.y);

    const shape = new THREE.Shape([p0, p1, p2, p3]);
    const segmentDepth = Math.max(0.8, baseDepth * (0.7 + depthRand() * 0.8));
    const zOffset = (depthRand() - 0.5) * baseDepth * 0.45;
    const totalWidth = strokeHalfWidth * 2;
    const targetChamfer = totalWidth * 0.25;
    const bevelSize = Math.min(targetChamfer, strokeHalfWidth * 0.9);
    const bevelThickness = Math.min(targetChamfer, segmentDepth * 0.35);
    const part = new THREE.ExtrudeGeometry(shape, {
      depth: segmentDepth,
      bevelEnabled: true,
      bevelSize,
      bevelThickness,
      bevelSegments: 2,
      steps: 1,
    });
    part.translate(0, 0, -segmentDepth / 2 + zOffset);
    parts.push(part);
  }

  if (parts.length === 0) {
    const fallback = new THREE.BoxGeometry(
      strokeHalfWidth * 2,
      strokeHalfWidth * 2,
      baseDepth
    );
    parts.push(fallback);
  }

  const merged = mergeGeometries(parts, true);
  parts.forEach((g) => g.dispose());

  merged.computeBoundingBox();
  const box = merged.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);
  const baseDiameterXY = Math.max(size.x, size.y, 1e-6);
  const targetDiameterMm = 110;
  const targetDepthMm = targetDiameterMm / 10;
  const scaleXY = targetDiameterMm / baseDiameterXY;

  merged.scale(scaleXY, scaleXY, scaleXY);
  merged.computeBoundingBox();
  const scaledSize = new THREE.Vector3();
  merged.boundingBox.getSize(scaledSize);
  const currentDepth = Math.max(scaledSize.z, 1e-6);
  const scaleZ = targetDepthMm / currentDepth;
  merged.scale(1, 1, scaleZ);
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

  const handleGenerate = () => {
    setGenerated({
      firstName,
      lastName,
      complexity: Math.max(1, Math.min(10, Number(complexity) || 1)),
      thickness: Math.max(2, Math.min(20, Number(thickness) || 2)),
    });
  };

  const handleExport = () => {
    if (!meshRef.current) {
      return;
    }
    const file = `snowflake_${sanitizeNamePart(generated.firstName)}_${sanitizeNamePart(generated.lastName)}_c${generated.complexity}_t${safeThickness}.stl`;
    exportMeshToStl(meshRef.current, file);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.9rem",
        fontFamily: "sans-serif",
        padding: "1rem",
      }}
    >
      <h1 style={{ margin: 0 }}>Deterministic Snowflake</h1>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(180px, 260px))",
          gap: "0.7rem 1rem",
          width: "min(100%, 560px)",
        }}
      >
        <label>
          First Name
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Last Name
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Complexity: {complexity}
          <input
            type="range"
            min="1"
            max="10"
            value={complexity}
            onChange={(e) => setComplexity(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Thickness: {thickness}
          <input
            type="range"
            min="1"
            max="20"
            value={thickness}
            onChange={(e) => setThickness(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.6rem" }}>
        <button type="button" onClick={handleGenerate}>
          Generate
        </button>
        <button type="button" onClick={handleExport}>
          Export STL
        </button>
      </div>

      <div
        style={{
          width: "min(100%, 560px)",
          fontSize: "0.82rem",
          border: "1px solid #d9dce2",
          borderRadius: "8px",
          padding: "0.5rem 0.6rem",
          background: "#fafbfe",
        }}
      >
        <div>Export info</div>
        <div>Seed: {seedText}</div>
        <div>Estimated diameter: {info.diameter.toFixed(1)} mm</div>
        <div>Estimated depth: {info.depth.toFixed(1)} mm</div>
        <div>Thickness: {safeThickness}</div>
        <div>Triangle count: {info.triCount}</div>
      </div>

      <div style={{ width: "min(92vw, 760px)", height: "min(64vh, 620px)" }}>
        <Canvas camera={{ position: [0, 0, 190], fov: 36 }}>
          <color attach="background" args={["#f5f7fb"]} />
          <ambientLight intensity={0.72} />
          <directionalLight position={[150, 120, 120]} intensity={0.85} />
          <mesh ref={meshRef} geometry={meshGeometry}>
            <meshStandardMaterial color="#dfe8ff" metalness={0.06} roughness={0.42} />
          </mesh>
          <OrbitControls enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
