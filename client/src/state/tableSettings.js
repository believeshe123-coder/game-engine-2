const STORAGE_KEY = 'tableSettings';

const DEFAULT_SETTINGS = {
  resetFaceDown: true,
  cardStyle: 'medieval',
  includeJokers: true,
  deckCount: 1,
  presetLayout: 'none',
  stackCountDisplayMode: 'always',
  tableZoom: 1,
  cardScale: 1,
  roomSettings: {
    tableStyle: 'medieval',
    tableShape: 'rectangle',
    seatCount: 8,
    seatParams: {
      rectangle: [],
      oval: [],
      circle: []
    }
  }
};

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
};

const normalizeDeckCount = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_SETTINGS.deckCount;
  }
  return Math.min(8, Math.max(1, parsed));
};

const normalizeSettings = (settings) => {
  const next = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  next.deckCount = normalizeDeckCount(next.deckCount);
  next.tableZoom = clampNumber(next.tableZoom, 0.5, 1.4, DEFAULT_SETTINGS.tableZoom);
  next.cardScale = clampNumber(next.cardScale, 0.7, 1.6, DEFAULT_SETTINGS.cardScale);
  if (!['medieval', 'classic'].includes(next.cardStyle)) {
    next.cardStyle = DEFAULT_SETTINGS.cardStyle;
  }
  if (!['none', 'solitaire', 'grid'].includes(next.presetLayout)) {
    next.presetLayout = DEFAULT_SETTINGS.presetLayout;
  }
  if (!['always', 'hover'].includes(next.stackCountDisplayMode)) {
    next.stackCountDisplayMode = DEFAULT_SETTINGS.stackCountDisplayMode;
  }
  const roomSettings = {
    ...DEFAULT_SETTINGS.roomSettings,
    ...(next.roomSettings ?? {})
  };
  if (!['medieval', 'plain'].includes(roomSettings.tableStyle)) {
    roomSettings.tableStyle = DEFAULT_SETTINGS.roomSettings.tableStyle;
  }
  if (!['rectangle', 'oval', 'circle'].includes(roomSettings.tableShape)) {
    roomSettings.tableShape = DEFAULT_SETTINGS.roomSettings.tableShape;
  }
  const seatCount = Number.parseInt(roomSettings.seatCount, 10);
  if (Number.isNaN(seatCount)) {
    roomSettings.seatCount = DEFAULT_SETTINGS.roomSettings.seatCount;
  } else {
    roomSettings.seatCount = Math.min(12, Math.max(2, seatCount));
  }
  const normalizeSeatParamList = (list) =>
    Array.isArray(list)
      ? list
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];
  const seatParams = roomSettings.seatParams ?? {};
  roomSettings.seatParams = {
    rectangle: normalizeSeatParamList(seatParams.rectangle),
    oval: normalizeSeatParamList(seatParams.oval),
    circle: normalizeSeatParamList(seatParams.circle)
  };
  next.roomSettings = roomSettings;
  next.resetFaceDown = Boolean(next.resetFaceDown);
  next.includeJokers = Boolean(next.includeJokers);
  return next;
};

const loadSettings = () => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
};

const saveSettings = (settings) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // noop
  }
};

export { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings };
