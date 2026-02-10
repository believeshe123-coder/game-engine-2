const TAU = Math.PI * 2;

const normalizeParam = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

const getRectBounds = (tableRect) => ({
  left: tableRect.left ?? 0,
  top: tableRect.top ?? 0,
  width: tableRect.width ?? 0,
  height: tableRect.height ?? 0
});

const getRectPerimeter = (bounds) => Math.max(1, 2 * (bounds.width + bounds.height));

const getRectPointFromDistance = (distance, bounds) => {
  const w = bounds.width;
  const h = bounds.height;
  if (distance <= w) {
    return {
      x: bounds.left + distance,
      y: bounds.top,
      nx: 0,
      ny: -1
    };
  }
  if (distance <= w + h) {
    return {
      x: bounds.left + w,
      y: bounds.top + (distance - w),
      nx: 1,
      ny: 0
    };
  }
  if (distance <= w + h + w) {
    return {
      x: bounds.left + (w - (distance - w - h)),
      y: bounds.top + h,
      nx: 0,
      ny: 1
    };
  }
  return {
    x: bounds.left,
    y: bounds.top + (h - (distance - w - h - w)),
    nx: -1,
    ny: 0
  };
};

const getClosestPointOnRect = (position, bounds) => {
  const left = bounds.left;
  const top = bounds.top;
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const clampedX = Math.min(Math.max(position.x, left), right);
  const clampedY = Math.min(Math.max(position.y, top), bottom);
  const distances = [
    { side: 'top', distance: Math.abs(position.y - top) },
    { side: 'right', distance: Math.abs(position.x - right) },
    { side: 'bottom', distance: Math.abs(position.y - bottom) },
    { side: 'left', distance: Math.abs(position.x - left) }
  ];
  distances.sort((a, b) => a.distance - b.distance);
  const closestSide = distances[0].side;
  if (closestSide === 'top') {
    return { x: clampedX, y: top, side: 'top' };
  }
  if (closestSide === 'right') {
    return { x: right, y: clampedY, side: 'right' };
  }
  if (closestSide === 'bottom') {
    return { x: clampedX, y: bottom, side: 'bottom' };
  }
  return { x: left, y: clampedY, side: 'left' };
};

const getRectParamFromPoint = (point, bounds) => {
  const left = bounds.left;
  const top = bounds.top;
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const w = bounds.width;
  const h = bounds.height;
  const perimeter = getRectPerimeter(bounds);
  if (point.side === 'top') {
    return (point.x - left) / perimeter;
  }
  if (point.side === 'right') {
    return (w + (point.y - top)) / perimeter;
  }
  if (point.side === 'bottom') {
    return (w + h + (right - point.x)) / perimeter;
  }
  return (w + h + w + (bottom - point.y)) / perimeter;
};

const getEllipseFromRect = (tableRect) => ({
  cx: (tableRect.left ?? 0) + (tableRect.width ?? 0) / 2,
  cy: (tableRect.top ?? 0) + (tableRect.height ?? 0) / 2,
  rx: (tableRect.width ?? 0) / 2,
  ry: (tableRect.height ?? 0) / 2
});

const getCircleFromRect = (tableRect) => {
  const width = tableRect.width ?? 0;
  const height = tableRect.height ?? 0;
  const radius = Math.min(width, height) / 2;
  return {
    cx: (tableRect.left ?? 0) + width / 2,
    cy: (tableRect.top ?? 0) + height / 2,
    r: radius
  };
};

const getEllipseBoundaryPoint = (ellipse, angle) => {
  const rx = Math.max(1, ellipse.rx);
  const ry = Math.max(1, ellipse.ry);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  return {
    x: ellipse.cx + dx * rx,
    y: ellipse.cy + dy * ry
  };
};

const getEllipseNormal = (ellipse, point) => {
  const rx = Math.max(1, ellipse.rx);
  const ry = Math.max(1, ellipse.ry);
  const nx = (point.x - ellipse.cx) / (rx * rx);
  const ny = (point.y - ellipse.cy) / (ry * ry);
  const magnitude = Math.hypot(nx, ny) || 1;
  return { nx: nx / magnitude, ny: ny / magnitude };
};

export const paramFromPointer = (shape, tableRect, pointerXY) => {
  if (!tableRect || !pointerXY) {
    return 0;
  }
  if (shape === 'circle') {
    const circle = getCircleFromRect(tableRect);
    const dx = pointerXY.x - circle.cx;
    const dy = pointerXY.y - circle.cy;
    const angle = Math.atan2(dy, dx);
    return normalizeParam(angle / TAU);
  }
  if (shape === 'oval') {
    const ellipse = getEllipseFromRect(tableRect);
    const dx = pointerXY.x - ellipse.cx;
    const dy = pointerXY.y - ellipse.cy;
    const rx = Math.max(1, ellipse.rx);
    const ry = Math.max(1, ellipse.ry);
    const angle = Math.atan2(dy / ry, dx / rx);
    return normalizeParam(angle / TAU);
  }
  const bounds = getRectBounds(tableRect);
  if (!bounds.width || !bounds.height) {
    return 0;
  }
  const closest = getClosestPointOnRect(pointerXY, bounds);
  return normalizeParam(getRectParamFromPoint(closest, bounds));
};

export const pointFromParam = (shape, tableRect, param, railOffsetPx = 0) => {
  if (!tableRect) {
    return { x: 0, y: 0, nx: 0, ny: -1 };
  }
  const normalizedParam = normalizeParam(param);
  if (shape === 'circle') {
    const circle = getCircleFromRect(tableRect);
    const angle = normalizedParam * TAU;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const r = Math.max(1, circle.r);
    const boundaryX = circle.cx + nx * r;
    const boundaryY = circle.cy + ny * r;
    return {
      x: boundaryX + nx * railOffsetPx,
      y: boundaryY + ny * railOffsetPx,
      nx,
      ny
    };
  }
  if (shape === 'oval') {
    const ellipse = getEllipseFromRect(tableRect);
    const angle = normalizedParam * TAU;
    const boundary = getEllipseBoundaryPoint(ellipse, angle);
    const normal = getEllipseNormal(ellipse, boundary);
    return {
      x: boundary.x + normal.nx * railOffsetPx,
      y: boundary.y + normal.ny * railOffsetPx,
      nx: normal.nx,
      ny: normal.ny
    };
  }

  const bounds = getRectBounds(tableRect);
  const perimeter = getRectPerimeter(bounds);
  const distance = normalizedParam * perimeter;
  const point = getRectPointFromDistance(distance, bounds);
  return {
    x: point.x + point.nx * railOffsetPx,
    y: point.y + point.ny * railOffsetPx,
    nx: point.nx,
    ny: point.ny
  };
};

export const perimeterLength = (shape, tableRect) => {
  if (!tableRect) {
    return 1;
  }
  const width = Math.max(0, tableRect.width ?? 0);
  const height = Math.max(0, tableRect.height ?? 0);
  if (shape === 'circle') {
    const radius = Math.max(1, Math.min(width, height) / 2);
    return TAU * radius;
  }
  if (shape === 'oval') {
    const a = Math.max(1, width / 2);
    const b = Math.max(1, height / 2);
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  }
  return Math.max(1, 2 * (width + height));
};

export const clampParamBetweenNeighbors = (params, index, minGapPx, shape, tableRect) => {
  const count = params.length;
  if (count < 2) {
    return normalizeParam(params[index] ?? 0);
  }
  const perimeter = perimeterLength(shape, tableRect);
  const minGapParam = Math.max(0, minGapPx / Math.max(1, perimeter));
  const sorted = params
    .map((value, idx) => ({ idx, value: normalizeParam(value) }))
    .sort((a, b) => a.value - b.value);
  const position = sorted.findIndex((entry) => entry.idx === index);
  const prevEntry = sorted[(position - 1 + count) % count];
  const nextEntry = sorted[(position + 1) % count];
  const prevValue = prevEntry.value;
  const nextValue = nextEntry.value <= prevValue ? nextEntry.value + 1 : nextEntry.value;
  let candidate = normalizeParam(params[index]);
  if (candidate <= prevValue) {
    candidate += 1;
  }
  const min = prevValue + minGapParam;
  const max = nextValue - minGapParam;
  const clamped = max < min ? min : Math.min(Math.max(candidate, min), max);
  return normalizeParam(clamped);
};
