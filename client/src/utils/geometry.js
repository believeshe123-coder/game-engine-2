export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const clampCardToTable = (
  x,
  y,
  cardW,
  cardH,
  tableW,
  tableH,
  padding = 0
) => {
  const minX = padding;
  const minY = padding;
  const maxX = tableW - cardW - padding;
  const maxY = tableH - cardH - padding;

  return {
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY)
  };
};
