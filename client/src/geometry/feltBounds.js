export const getFeltRect = (feltEl) => {
  if (!feltEl) {
    return null;
  }
  return feltEl.getBoundingClientRect();
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

  const minX = feltRect.left + halfW;
  const maxX = feltRect.right - halfW;
  const minY = feltRect.top + halfH;
  const maxY = feltRect.bottom - halfH;
  return {
    x: Math.min(Math.max(px, minX), maxX),
    y: Math.min(Math.max(py, minY), maxY)
  };
};
