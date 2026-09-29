/**
 * Measure the shortest center-to-center distance between grid spaces occupied by
 * two rectangular tokens. This treats a token's entire footprint as its space,
 * rather than measuring from the token document's center.
 */
export function tokenFootprintDistanceFeet(a, b, { gridSize = 100, gridDistance = 5 } = {}) {
  const size = Number(gridSize);
  const distance = Number(gridDistance);
  if (!a || !b || !Number.isFinite(size) || size <= 0 || !Number.isFinite(distance) || distance <= 0) return NaN;

  const ax = Number(a.x ?? 0);
  const ay = Number(a.y ?? 0);
  const bx = Number(b.x ?? 0);
  const by = Number(b.y ?? 0);
  const aWidth = Math.max(0, Number(a.width ?? 1)) * size;
  const aHeight = Math.max(0, Number(a.height ?? 1)) * size;
  const bWidth = Math.max(0, Number(b.width ?? 1)) * size;
  const bHeight = Math.max(0, Number(b.height ?? 1)) * size;
  if (![ax, ay, bx, by, aWidth, aHeight, bWidth, bHeight].every(Number.isFinite)) return NaN;

  const horizontalSeparation = Math.max(bx - (ax + aWidth), ax - (bx + bWidth));
  const verticalSeparation = Math.max(by - (ay + aHeight), ay - (by + bHeight));
  const epsilon = size * 1e-6;

  // Touching footprints occupy adjacent grid spaces, whose centers are one grid
  // interval apart. Overlapping axes contribute no distance on that axis.
  const dx = horizontalSeparation >= -epsilon ? Math.max(0, horizontalSeparation) + size : 0;
  const dy = verticalSeparation >= -epsilon ? Math.max(0, verticalSeparation) + size : 0;

  return (Math.hypot(dx, dy) / size) * distance;
}

/**
 * Return a stable nearest-first copy of a token list. Tokens whose distance
 * cannot be measured remain at the end in their original order.
 */
export function sortTokensByDistance(tokens = [], source = null, grid = {}) {
  if (!source) return Array.from(tokens);
  return Array.from(tokens)
    .map((token, index) => ({
      token,
      index,
      distance: tokenFootprintDistanceFeet(source, token, grid)
    }))
    .sort((left, right) => {
      const leftDistance = Number.isFinite(left.distance) ? left.distance : Number.POSITIVE_INFINITY;
      const rightDistance = Number.isFinite(right.distance) ? right.distance : Number.POSITIVE_INFINITY;
      return (leftDistance - rightDistance) || (left.index - right.index);
    })
    .map((entry) => entry.token);
}
