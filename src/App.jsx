import React from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { buildSnowflake2D, mulberry32, seedFromString } from "./geometry.js";

export default function App() {
  const seedText = "demo-seed";
  const boldness = 3;
  const seed = seedFromString(seedText);
  const rand = mulberry32(seed);
  const outline = buildSnowflake2D(rand, boldness);

  const points3D = outline.points.map(([x, y]) => [x, y, 0]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ margin: 0 }}>Snowflake Preview</h1>
      <div>Seed: {seedText}</div>
      <div>Boldness: {boldness}</div>
      <div style={{ width: "min(90vw, 560px)", height: "min(70vh, 560px)" }}>
        <Canvas camera={{ position: [0, 0, 4], fov: 50 }}>
          <color attach="background" args={["#f5f7fb"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[2, 3, 4]} intensity={0.8} />
          <Line points={points3D} color="#111111" lineWidth={2.5} />
          <OrbitControls enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
