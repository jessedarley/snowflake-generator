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

export function buildSnowflake2D(rand, complexity = 5, thickness = 10) {
  const next = typeof rand === "function" ? rand : () => 0;
  const levels = Math.max(1, Math.min(10, Math.round(complexity)));
  const clampedThickness = Math.max(2, Math.min(20, Number(thickness) || 10));
  const thicknessNorm = clampedThickness / 20;
  const minFeature = 0.06;

  const halfArm = [];
  let prev = [0, 0];
  let xCursor = 0;
  const baseStep = 0.28 + levels * 0.05;

  for (let i = 0; i < levels + 2; i += 1) {
    const step = baseStep * (0.82 + next() * 0.28);
    xCursor += step;
    const curr = [xCursor, 0];
    if (step >= minFeature) {
      addSegment(halfArm, prev, curr);
    }

    const isTip = i === levels + 1;
    const branchChance = Math.min(0.88, 0.34 + levels * 0.05 + thicknessNorm * 0.15);
    if (!isTip && next() < branchChance) {
      const branchLen = Math.max(
        minFeature,
        step * (0.7 + next() * 0.9) * (0.65 + thicknessNorm * 0.7)
      );
      const branchAngle = (Math.PI / 3) * (0.34 + next() * 0.46);
      const end = [
        curr[0] + Math.cos(branchAngle) * branchLen,
        curr[1] + Math.sin(branchAngle) * branchLen,
      ];
      addSegment(halfArm, curr, end);

      if (next() < 0.45) {
        const twigLen = Math.max(
          minFeature,
          branchLen * (0.3 + next() * 0.4)
        );
        const twigAngle = branchAngle - (Math.PI / 6) * (0.35 + next() * 0.5);
        const twigEnd = [
          end[0] + Math.cos(twigAngle) * twigLen,
          end[1] + Math.sin(twigAngle) * twigLen,
        ];
        addSegment(halfArm, end, twigEnd);
      }
    }

    prev = curr;
  }

  const arm = [];
  for (let i = 0; i < halfArm.length; i += 1) {
    const [a, b] = halfArm[i];
    addSegment(arm, a, b);
    const mirroredA = [a[0], -a[1]];
    const mirroredB = [b[0], -b[1]];
    const isAxis = a[1] === 0 && b[1] === 0;
    if (!isAxis) {
      addSegment(arm, mirroredA, mirroredB);
    }
  }

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
