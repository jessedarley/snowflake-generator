export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSnowflake2D(rand, boldness) {
  const radius = 1 + Math.max(0, Number(boldness) || 0) * 0.1;
  const rotation = (typeof rand === "function" ? rand() : 0) * Math.PI * 2;
  const points = [];

  for (let i = 0; i < 6; i += 1) {
    const a = rotation + (i * Math.PI) / 3;
    points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }

  points.push(points[0]);

  return {
    type: "outline",
    shape: "hexagon",
    points,
  };
}
