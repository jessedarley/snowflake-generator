import * as THREE from "three";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-12) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function shortestAngleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function hash01(value) {
  const s = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function analyzeSegments(segments) {
  const analyzed = [];
  for (let i = 0; i < segments.length; i += 1) {
    const [a, b] = segments[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.max(1e-8, Math.hypot(dx, dy));
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const theta = Math.atan2(my, mx);
    const axisIndex = Math.round(theta / (Math.PI / 3));
    const axisAngle = axisIndex * (Math.PI / 3);
    const delta = Math.abs(shortestAngleDiff(theta, axisAngle));
    const twigness = clamp(
      Math.pow(clamp(delta / (Math.PI / 3), 0, 1), 1.15) * 0.75 +
        clamp(1 - len / 1.35, 0, 1) * 0.35,
      0,
      1
    );

    // Symmetric deterministic variation: depends on radial and local invariants, not side sign.
    const r = Math.hypot(mx, my);
    const localJitter = hash01(
      Math.round(r * 37) * 0.73 + Math.round(len * 41) * 1.13 + Math.round(delta * 500) * 0.29
    );
    const twigVariation = (localJitter - 0.5) * 0.7;
    const baseScale = 1.28 - twigness * 0.62;
    const depthScale = clamp(baseScale + twigness * twigVariation, 0.58, 1.45);
    analyzed.push({ a, b, depthScale });
  }
  return analyzed;
}

function applySurfaceRelief(geometry, segments, depth) {
  if (!geometry?.attributes?.position || segments.length === 0) {
    return;
  }
  const analyzed = analyzeSegments(segments);
  const pos = geometry.attributes.position;
  const topThreshold = depth * 0.32;
  const minHalfDepthLocal = depth * 0.18;
  const baseHalfDepth = depth * 0.5;

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(z) < topThreshold) {
      continue;
    }

    let bestDist = Infinity;
    let bestScale = 1;
    for (let s = 0; s < analyzed.length; s += 1) {
      const seg = analyzed[s];
      const d = distancePointToSegment(x, y, seg.a[0], seg.a[1], seg.b[0], seg.b[1]);
      if (d < bestDist) {
        bestDist = d;
        bestScale = seg.depthScale;
      }
    }

    const localWeight = Math.exp(-bestDist * 2.1);
    const targetHalfDepth = Math.max(
      minHalfDepthLocal,
      baseHalfDepth * (1 + (bestScale - 1) * localWeight)
    );
    const zDir = z >= 0 ? 1 : -1;
    pos.setZ(i, zDir * targetHalfDepth);
  }

  pos.needsUpdate = true;
}

function polygonArea(points) {
  if (!points || points.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    area += p0[0] * p1[1] - p1[0] * p0[1];
  }
  return area * 0.5;
}

function boundsFromSegments(segments) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < segments.length; i += 1) {
    const [a, b] = segments[i];
    minX = Math.min(minX, a[0], b[0]);
    minY = Math.min(minY, a[1], b[1]);
    maxX = Math.max(maxX, a[0], b[0]);
    maxY = Math.max(maxY, a[1], b[1]);
  }
  if (!Number.isFinite(minX)) {
    minX = -1;
    minY = -1;
    maxX = 1;
    maxY = 1;
  }
  return { minX, minY, maxX, maxY };
}

function chaikin(points, iterations, cut = 0.15) {
  let loop = points.slice();
  for (let it = 0; it < iterations; it += 1) {
    const next = [];
    for (let i = 0; i < loop.length; i += 1) {
      const p0 = loop[i];
      const p1 = loop[(i + 1) % loop.length];
      const qx = (1 - cut) * p0[0] + cut * p1[0];
      const qy = (1 - cut) * p0[1] + cut * p1[1];
      const rx = cut * p0[0] + (1 - cut) * p1[0];
      const ry = cut * p0[1] + (1 - cut) * p1[1];
      next.push([qx, qy]);
      next.push([rx, ry]);
    }
    loop = next;
  }
  return loop;
}

function simplifyLoop(points, minEdge, collinearEps) {
  if (points.length < 6) {
    return points.slice();
  }
  const loop = points.slice();
  let changed = true;
  while (changed && loop.length > 6) {
    changed = false;
    for (let i = 0; i < loop.length; i += 1) {
      const prev = loop[(i - 1 + loop.length) % loop.length];
      const curr = loop[i];
      const next = loop[(i + 1) % loop.length];

      const vx0 = curr[0] - prev[0];
      const vy0 = curr[1] - prev[1];
      const vx1 = next[0] - curr[0];
      const vy1 = next[1] - curr[1];
      const l0 = Math.hypot(vx0, vy0);
      const l1 = Math.hypot(vx1, vy1);
      if (l0 < minEdge || l1 < minEdge) {
        loop.splice(i, 1);
        changed = true;
        break;
      }

      const cross = Math.abs(vx0 * vy1 - vy0 * vx1);
      if (cross < collinearEps * l0 * l1) {
        loop.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return loop;
}

function interpolateEdgeNode(ix, iy, x, y, cellSize, edgeId, v0, v1, v2, v3) {
  const interp = (a, b) => {
    const denom = b - a;
    if (Math.abs(denom) < 1e-12) {
      return 0.5;
    }
    return clamp(-a / denom, 0, 1);
  };
  switch (edgeId) {
    case 0: {
      const t = interp(v0, v1);
      return { key: `h_${ix}_${iy}`, point: [x + t * cellSize, y] };
    }
    case 1: {
      const t = interp(v1, v2);
      return { key: `v_${ix + 1}_${iy}`, point: [x + cellSize, y + t * cellSize] };
    }
    case 2: {
      const t = interp(v3, v2);
      return { key: `h_${ix}_${iy + 1}`, point: [x + t * cellSize, y + cellSize] };
    }
    case 3: {
      const t = interp(v0, v3);
      return { key: `v_${ix}_${iy}`, point: [x, y + t * cellSize] };
    }
    default:
      return { key: `p_${ix}_${iy}`, point: [x, y] };
  }
}

function caseToEdgePairs(mask, centerValue) {
  switch (mask) {
    case 0:
    case 15:
      return [];
    case 1:
      return [[3, 0]];
    case 2:
      return [[0, 1]];
    case 3:
      return [[3, 1]];
    case 4:
      return [[1, 2]];
    case 5:
      return centerValue < 0 ? [[3, 0], [1, 2]] : [[3, 2], [0, 1]];
    case 6:
      return [[0, 2]];
    case 7:
      return [[3, 2]];
    case 8:
      return [[2, 3]];
    case 9:
      return [[0, 2]];
    case 10:
      return centerValue < 0 ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
    case 11:
      return [[1, 2]];
    case 12:
      return [[1, 3]];
    case 13:
      return [[0, 1]];
    case 14:
      return [[3, 0]];
    default:
      return [];
  }
}

function buildLoopsFromSegments(contourSegments) {
  const byKey = new Map();
  const keyToPoint = new Map();

  for (let i = 0; i < contourSegments.length; i += 1) {
    const seg = contourSegments[i];
    const k0 = seg.a.key;
    const k1 = seg.b.key;
    if (!byKey.has(k0)) byKey.set(k0, []);
    if (!byKey.has(k1)) byKey.set(k1, []);
    byKey.get(k0).push({ segmentIndex: i });
    byKey.get(k1).push({ segmentIndex: i });
    if (!keyToPoint.has(k0)) keyToPoint.set(k0, seg.a.point);
    if (!keyToPoint.has(k1)) keyToPoint.set(k1, seg.b.point);
  }

  const used = new Array(contourSegments.length).fill(false);
  const loops = [];

  for (let i = 0; i < contourSegments.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;

    const seg = contourSegments[i];
    const startKey = seg.a.key;
    const loopKeys = [seg.a.key, seg.b.key];
    let currentKey = seg.b.key;
    let currentSegIndex = i;
    let safety = contourSegments.length * 3;

    while (safety > 0) {
      safety -= 1;
      if (currentKey === startKey) {
        break;
      }

      const neighbors = byKey.get(currentKey) || [];
      let found = null;
      for (let j = 0; j < neighbors.length; j += 1) {
        const n = neighbors[j];
        if (n.segmentIndex === currentSegIndex || used[n.segmentIndex]) continue;
        found = n;
        break;
      }
      if (!found) {
        break;
      }

      used[found.segmentIndex] = true;
      const s = contourSegments[found.segmentIndex];
      const nextKey = s.a.key === currentKey ? s.b.key : s.a.key;
      loopKeys.push(nextKey);
      currentKey = nextKey;
      currentSegIndex = found.segmentIndex;
    }

    if (loopKeys.length >= 4 && loopKeys[0] === loopKeys[loopKeys.length - 1]) {
      loopKeys.pop();
      const loop = loopKeys.map((k) => keyToPoint.get(k));
      loops.push(loop);
    }
  }

  return loops;
}

function fallbackPolygon(segments) {
  const { minX, minY, maxX, maxY } = boundsFromSegments(segments);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const r = Math.max(maxX - minX, maxY - minY, 1) * 0.5 * 1.05;
  const points = [];
  const n = 24;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return points;
}

export function segmentsToPolygon(segments, options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return fallbackPolygon([]);
  }

  const resolution = clamp(options.gridResolution ?? 200, 160, 240);
  const smoothingIterations = clamp(options.smoothingIterations ?? 2, 1, 3);
  const radiusMm = clamp(options.radiusMm ?? 2.5, 0.8, 12);

  const bounds = boundsFromSegments(segments);
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const diameterLocal = Math.max(width, height, 1e-6);
  const targetDiameterMm = options.targetDiameterMm ?? 110;
  const localPerMm = diameterLocal / targetDiameterMm;
  const radius = Math.max(0.02, radiusMm * localPerMm);
  const pad = radius * 2.5;

  const minX = bounds.minX - pad;
  const maxX = bounds.maxX + pad;
  const minY = bounds.minY - pad;
  const maxY = bounds.maxY + pad;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const cells = resolution;
  const cellSize = Math.max(spanX, spanY) / cells;
  const nx = Math.max(2, Math.ceil(spanX / cellSize));
  const ny = Math.max(2, Math.ceil(spanY / cellSize));

  const field = new Float32Array((nx + 1) * (ny + 1));
  const idx = (ix, iy) => iy * (nx + 1) + ix;

  for (let iy = 0; iy <= ny; iy += 1) {
    const y = minY + iy * cellSize;
    for (let ix = 0; ix <= nx; ix += 1) {
      const x = minX + ix * cellSize;
      let minDist = Infinity;
      for (let s = 0; s < segments.length; s += 1) {
        const [a, b] = segments[s];
        const d = distancePointToSegment(x, y, a[0], a[1], b[0], b[1]);
        if (d < minDist) minDist = d;
      }
      field[idx(ix, iy)] = minDist - radius;
    }
  }

  const contourSegments = [];
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const x = minX + ix * cellSize;
      const y = minY + iy * cellSize;
      const v0 = field[idx(ix, iy)];
      const v1 = field[idx(ix + 1, iy)];
      const v2 = field[idx(ix + 1, iy + 1)];
      const v3 = field[idx(ix, iy + 1)];
      const centerValue = 0.25 * (v0 + v1 + v2 + v3);

      let mask = 0;
      if (v0 < 0) mask |= 1;
      if (v1 < 0) mask |= 2;
      if (v2 < 0) mask |= 4;
      if (v3 < 0) mask |= 8;
      if (mask === 0 || mask === 15) continue;

      const pairs = caseToEdgePairs(mask, centerValue);
      for (let p = 0; p < pairs.length; p += 1) {
        const [e0, e1] = pairs[p];
        const a = interpolateEdgeNode(ix, iy, x, y, cellSize, e0, v0, v1, v2, v3);
        const b = interpolateEdgeNode(ix, iy, x, y, cellSize, e1, v0, v1, v2, v3);
        contourSegments.push({ a, b });
      }
    }
  }

  if (contourSegments.length < 3) {
    return fallbackPolygon(segments);
  }

  const loops = buildLoopsFromSegments(contourSegments);
  if (loops.length === 0) {
    return fallbackPolygon(segments);
  }

  let mainLoop = loops[0];
  let bestArea = Math.abs(polygonArea(mainLoop));
  for (let i = 1; i < loops.length; i += 1) {
    const area = Math.abs(polygonArea(loops[i]));
    if (area > bestArea) {
      bestArea = area;
      mainLoop = loops[i];
    }
  }

  let loop = chaikin(mainLoop, smoothingIterations, 0.12);
  const simplifyEdge = cellSize * 0.22;
  loop = simplifyLoop(loop, simplifyEdge, 0.012);

  if (loop.length < 8) {
    return fallbackPolygon(segments);
  }
  if (polygonArea(loop) < 0) {
    loop.reverse();
  }
  const first = loop[0];
  const last = loop[loop.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > cellSize * 0.25) {
    loop.push([first[0], first[1]]);
  }

  return loop;
}

export function buildSnowflakeMeshFromSegments(segments, thickness) {
  const safeThickness = clamp(Number(thickness) || 10, 2, 20);
  const effectiveThickness = safeThickness / 3;
  const radiusMm = clamp(0.16 + effectiveThickness * 0.03, 0.2, 0.9);
  const polygon = segmentsToPolygon(segments, {
    gridResolution: 200,
    smoothingIterations: 2,
    radiusMm,
    targetDiameterMm: 110,
  });

  const points = polygon.map((p) => new THREE.Vector2(p[0], p[1]));
  let shape;
  try {
    shape = new THREE.Shape(points);
  } catch (e) {
    const fallback = fallbackPolygon(segments).map((p) => new THREE.Vector2(p[0], p[1]));
    shape = new THREE.Shape(fallback);
  }

  const depth = Math.max(1.4, effectiveThickness * 0.72);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 18,
  });
  geometry.translate(0, 0, -depth * 0.5);
  applySurfaceRelief(geometry, segments, depth);
  geometry.computeBoundingBox();

  if (geometry.boundingBox) {
    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
