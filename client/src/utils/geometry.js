export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const getFeltShape = ({ width = 0, height = 0, shape = 'rectangle' } = {}) => {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  return {
    type: shape === 'oval' ? 'ellipse' : 'rect',
    cx,
    cy,
    w,
    h,
    rx,
    ry,
    bounds: {
      left: 0,
      top: 0,
      right: w,
      bottom: h
    }
  };
};

export const getFeltEllipseInTableSpace = (tableEl, feltEl, uiScale = 1) => {
  if (!tableEl || !feltEl) {
    return null;
  }
  const scale = uiScale || 1;
  const tableRect = tableEl.getBoundingClientRect();
  const feltRect = feltEl.getBoundingClientRect();
  if (!tableRect.width || !tableRect.height || !feltRect.width || !feltRect.height) {
    return null;
  }
  const width = feltRect.width / scale;
  const height = feltRect.height / scale;
  const offsetX = (feltRect.left - tableRect.left) / scale;
  const offsetY = (feltRect.top - tableRect.top) / scale;
  const cx = offsetX + width / 2;
  const cy = offsetY + height / 2;
  return {
    type: 'ellipse',
    cx,
    cy,
    rx: width / 2,
    ry: height / 2,
    w: width,
    h: height,
    bounds: {
      left: offsetX,
      top: offsetY,
      right: offsetX + width,
      bottom: offsetY + height
    }
  };
};

export const clampStackToFeltEllipse = (x, y, stackW, stackH, feltEllipse) => {
  if (!feltEllipse || feltEllipse.rx <= 0 || feltEllipse.ry <= 0) {
    return { x, y };
  }
  const cx = feltEllipse.cx ?? 0;
  const cy = feltEllipse.cy ?? 0;
  const rx = feltEllipse.rx ?? 0;
  const ry = feltEllipse.ry ?? 0;
  const sx = x + stackW / 2;
  const sy = y + stackH / 2;
  const erx = rx - stackW / 2;
  const ery = ry - stackH / 2;
  if (erx <= 0 || ery <= 0) {
    return {
      x: cx - stackW / 2,
      y: cy - stackH / 2
    };
  }
  const dx = sx - cx;
  const dy = sy - cy;
  const normalized = (dx * dx) / (erx * erx) + (dy * dy) / (ery * ery);
  if (normalized <= 1) {
    return { x, y };
  }
  const k = 1 / Math.sqrt(normalized);
  const sx2 = cx + dx * k;
  const sy2 = cy + dy * k;
  return {
    x: sx2 - stackW / 2,
    y: sy2 - stackH / 2
  };
};

export const clampStackToFelt = (x, y, stackW, stackH, felt) => {
  if (!felt || felt.w <= 0 || felt.h <= 0) {
    return { x, y };
  }
  if (felt.type === 'ellipse') {
    const cx = felt.cx ?? 0;
    const cy = felt.cy ?? 0;
    const rx = felt.rx ?? 0;
    const ry = felt.ry ?? 0;
    const sx = x + stackW / 2;
    const sy = y + stackH / 2;
    const erx = rx - stackW / 2;
    const ery = ry - stackH / 2;
    if (erx <= 0 || ery <= 0) {
      return {
        x: cx - stackW / 2,
        y: cy - stackH / 2
      };
    }
    const dx = sx - cx;
    const dy = sy - cy;
    const normalized = (dx * dx) / (erx * erx) + (dy * dy) / (ery * ery);
    if (normalized <= 1) {
      return { x, y };
    }
    const k = 1 / Math.sqrt(normalized);
    const sx2 = cx + dx * k;
    const sy2 = cy + dy * k;
    return {
      x: sx2 - stackW / 2,
      y: sy2 - stackH / 2
    };
  }
  const bounds = felt.bounds ?? {
    left: 0,
    top: 0,
    right: (felt.w ?? 0),
    bottom: (felt.h ?? 0)
  };
  return {
    x: clamp(x, bounds.left, bounds.right - stackW),
    y: clamp(y, bounds.top, bounds.bottom - stackH)
  };
};
