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

function rotatePoint(point, angle) {
  const [x, y] = point;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

function addSegment(segments, a, b) {
  segments.push([a, b]);
}

function addPolarSegment(segments, start, angle, length) {
  const end = [
    start[0] + Math.cos(angle) * length,
    start[1] + Math.sin(angle) * length,
  ];
  addSegment(segments, start, end);
  return end;
}

export function buildSnowflake2D(rand, complexity = 5, thickness = 10) {
  const next = typeof rand === "function" ? rand : () => 0;
  const levels = Math.max(1, Math.min(10, Math.round(complexity)));
  const clampedThickness = Math.max(2, Math.min(20, Number(thickness) || 10));
  const thicknessNorm = clampedThickness / 20;
  const minFeature = 0.06;

  const arm = [];
  const nodeCount = levels + 8;
  const mainLength = 3 + levels * 0.42;
  const stepBase = mainLength / (nodeCount - 1);
  const nodes = [[0, 0]];

  for (let i = 1; i < nodeCount; i += 1) {
    const prev = nodes[i - 1];
    const step = stepBase * (0.9 + next() * 0.2);
    const curr = [prev[0] + step, 0];
    addSegment(arm, prev, curr);
    nodes.push(curr);
  }

  // Reinforce the primary spine with mirrored rails so the main arms are not too spindly.
  const railOffset = 0.07 + thicknessNorm * 0.06;
  for (let i = 1; i < nodeCount; i += 1) {
    const a = nodes[i - 1];
    const b = nodes[i];
    addSegment(arm, [a[0], railOffset], [b[0], railOffset]);
    addSegment(arm, [a[0], -railOffset], [b[0], -railOffset]);
  }

  for (let i = 1; i < nodeCount - 1; i += 1) {
    const t = i / (nodeCount - 1);
    const p = nodes[i];
    if (t < 0.28 || t > 0.97) {
      continue;
    }

    const branchProbability = Math.min(0.95, 0.58 + levels * 0.024);
    if (next() > branchProbability) {
      continue;
    }

    const angleBase = (Math.PI / 3) + (0.5 - Math.min(t, 0.5)) * 0.42;
    const baseBranchAngle = angleBase + next() * (Math.PI / 15);
    const falloff = Math.max(0.32, 1 - Math.abs(t - 0.64) * 1.06);
    const branchScale = falloff * (1 + thicknessNorm * 0.14);
    const innerLengthBoost = t < 0.45 ? 0.62 : 1;
    const branchLen = Math.max(
      minFeature,
      (0.54 + levels * 0.118) * branchScale * (0.95 + next() * 0.42) * innerLengthBoost
    );

    const addTwig = next() < 0.86;
    const twigCount = addTwig ? 1 + (next() < 0.48 ? 1 : 0) : 0;
    const twigParams = [];
    for (let k = 0; k < twigCount; k += 1) {
      twigParams.push({
        dirScale: 0.42 + next() * 0.25,
        lenScale: (0.2 + next() * 0.18) * (1 - k * 0.14),
        along: 0.38 + 0.5 * next(),
      });
    }

    const addPlates = next() < 0.75;
    const plateCount = addPlates ? 1 + (levels > 6 && next() < 0.42 ? 1 : 0) : 0;
    const plateParams = [];
    for (let n = 0; n < plateCount; n += 1) {
      plateParams.push({
        baseAlong: 0.52 + n * 0.18,
        ridgeLenScale: 0.18 + next() * 0.14,
      });
    }

    const makeSide = (sideSign) => {
      const branchAngle = sideSign * baseBranchAngle;
      const branchEnd = addPolarSegment(arm, p, branchAngle, branchLen);

      if (addTwig) {
        for (let k = 0; k < twigParams.length; k += 1) {
          const params = twigParams[k];
          const dir = branchAngle + sideSign * (Math.PI / 2) * params.dirScale;
          const twigLen = Math.max(
            minFeature,
            branchLen * params.lenScale
          );
          const twigBase = [
            p[0] + (branchEnd[0] - p[0]) * params.along,
            p[1] + (branchEnd[1] - p[1]) * params.along,
          ];
          addPolarSegment(arm, twigBase, dir, twigLen);
        }
      }

      if (addPlates) {
        for (let n = 0; n < plateParams.length; n += 1) {
          const params = plateParams[n];
          const ridgeAngle = branchAngle + sideSign * (Math.PI / 2);
          const base = [
            p[0] + (branchEnd[0] - p[0]) * params.baseAlong,
            p[1] + (branchEnd[1] - p[1]) * params.baseAlong,
          ];
          const ridgeLen = Math.max(minFeature, branchLen * params.ridgeLenScale);
          addPolarSegment(arm, base, ridgeAngle, ridgeLen);
        }
      }
    };

    makeSide(1);
    makeSide(-1);
  }

  const tip = nodes[nodes.length - 1];
  const tipScale = 0.32 + levels * 0.022;
  const tipLen = Math.max(minFeature, tipScale);
  addPolarSegment(arm, tip, Math.PI * 0.74, tipLen);
  addPolarSegment(arm, tip, -Math.PI * 0.74, tipLen);
  addPolarSegment(arm, tip, Math.PI, tipLen * 0.44);

  const segments = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i * Math.PI) / 3;
    for (let j = 0; j < arm.length; j += 1) {
      const [a, b] = arm[j];
      addSegment(segments, rotatePoint(a, angle), rotatePoint(b, angle));
    }
  }

  return { segments };
}
