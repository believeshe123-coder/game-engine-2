export const getFeltRect = (feltEl) => {
  if (!feltEl) {
    return null;
  }
  return feltEl.getBoundingClientRect();
};

export const isInsideCircle = (point, cx, cy, rSafe) => {
  if (!point) {
    return false;
  }
  const radius = Math.max(0, rSafe ?? 0);
  if (radius <= 0) {
    return false;
  }
  const dx = point.x - cx;
  const dy = point.y - cy;
  return dx * dx + dy * dy <= radius * radius;
};

export const clampPointToCircle = (point, cx, cy, rSafe) => {
  if (!point) {
    return { x: cx, y: cy };
  }
  const radius = Math.max(0, rSafe ?? 0);
  if (radius <= 0) {
    return { x: cx, y: cy };
  }
  const dx = point.x - cx;
  const dy = point.y - cy;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || !distance) {
    return { x: point.x, y: point.y };
  }
  const scale = radius / distance;
  return { x: cx + dx * scale, y: cy + dy * scale };
};

export const isPointInsideFelt = (px, py, feltRect, shape, cardSizePx) => {
  if (!feltRect) {
    return true;
  }
  const halfW = (cardSizePx?.width ?? 0) / 2;
  const halfH = (cardSizePx?.height ?? 0) / 2;
  if (shape === 'oval') {
    const cx = feltRect.left + feltRect.width / 2;
    const cy = feltRect.top + feltRect.height / 2;
    const rx = feltRect.width / 2 - halfW;
    const ry = feltRect.height / 2 - halfH;
    if (rx <= 0 || ry <= 0) {
      return false;
    }
    const dx = px - cx;
    const dy = py - cy;
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  }
  if (shape === 'circle') {
    const cx = feltRect.left + feltRect.width / 2;
    const cy = feltRect.top + feltRect.height / 2;
    const rFelt = Math.min(feltRect.width, feltRect.height) / 2;
    const rSafe = rFelt - Math.max(halfW, halfH);
    return isInsideCircle({ x: px, y: py }, cx, cy, rSafe);
  }

  const minX = feltRect.left + halfW;
  const maxX = feltRect.right - halfW;
  const minY = feltRect.top + halfH;
  const maxY = feltRect.bottom - halfH;
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
};

export const clampPointToFelt = (px, py, feltRect, shape, cardSizePx) => {
  if (!feltRect) {
    return { x: px, y: py };
  }
  const halfW = (cardSizePx?.width ?? 0) / 2;
  const halfH = (cardSizePx?.height ?? 0) / 2;
  if (shape === 'oval') {
    const cx = feltRect.left + feltRect.width / 2;
    const cy = feltRect.top + feltRect.height / 2;
    const rx = feltRect.width / 2 - halfW;
    const ry = feltRect.height / 2 - halfH;
    if (rx <= 0 || ry <= 0) {
      return { x: cx, y: cy };
    }
    const dx = px - cx;
    const dy = py - cy;
    const normalized = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (normalized <= 1) {
      return { x: px, y: py };
    }
    const t = 1 / Math.sqrt(normalized);
    return { x: cx + dx * t, y: cy + dy * t };
  }
  if (shape === 'circle') {
    const cx = feltRect.left + feltRect.width / 2;
    const cy = feltRect.top + feltRect.height / 2;
    const rFelt = Math.min(feltRect.width, feltRect.height) / 2;
    const rSafe = rFelt - Math.max(halfW, halfH);
    return clampPointToCircle({ x: px, y: py }, cx, cy, rSafe);
  }

  const minX = feltRect.left + halfW;
  const maxX = feltRect.right - halfW;
  const minY = feltRect.top + halfH;
  const maxY = feltRect.bottom - halfH;
  return {
    x: Math.min(Math.max(px, minX), maxX),
    y: Math.min(Math.max(py, minY), maxY)
  };
};
