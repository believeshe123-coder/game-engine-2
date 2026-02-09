const STORAGE_KEY = 'tableSettings';

const BASE_DEFAULTS = {
  resetFaceDown: true,
  cardStyle: 'medieval',
  includeJokers: true,
  deckCount: 1,
  presetLayout: 'none',
  customPresetCodes: [],
  customPresets: {},
  stackCountDisplayMode: 'always',
  tableZoom: 1,
  cardScale: 1,
  tableStyle: 'medieval',
  colorBlindMode: false,
  inventoryDragEnabled: true,
  roomSettings: {
    tableShape: 'rectangle',
    seatCount: 8,
    seatLock: false,
    seatParams: {
      rectangle: [],
      oval: [],
      circle: []
    },
    seatPositions: {
      endless: []
    }
  }
};

const DEFAULT_SETTINGS = BASE_DEFAULTS;

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
  if (!['medieval', 'classic'].includes(next.tableStyle)) {
    next.tableStyle = DEFAULT_SETTINGS.tableStyle;
  }
  const presetCodes = Array.isArray(next.customPresetCodes)
    ? next.customPresetCodes.filter((code) => typeof code === 'string')
    : [];
  next.customPresetCodes = presetCodes;
  next.customPresets =
    next.customPresets && typeof next.customPresets === 'object'
      ? next.customPresets
      : {};
  const allowedPresets = new Set(['none', 'solitaire', 'grid', ...presetCodes]);
  if (!allowedPresets.has(next.presetLayout)) {
    next.presetLayout = DEFAULT_SETTINGS.presetLayout;
  }
  if (!['always', 'hover', 'off'].includes(next.stackCountDisplayMode)) {
    next.stackCountDisplayMode = DEFAULT_SETTINGS.stackCountDisplayMode;
  }
  next.colorBlindMode =
    typeof next.colorBlindMode === 'boolean'
      ? next.colorBlindMode
      : DEFAULT_SETTINGS.colorBlindMode;
  next.inventoryDragEnabled =
    typeof next.inventoryDragEnabled === 'boolean'
      ? next.inventoryDragEnabled
      : DEFAULT_SETTINGS.inventoryDragEnabled;
  const roomSettings = {
    ...DEFAULT_SETTINGS.roomSettings,
    ...(next.roomSettings ?? {})
  };
  if (!['rectangle', 'oval', 'circle', 'endless'].includes(roomSettings.tableShape)) {
    roomSettings.tableShape = DEFAULT_SETTINGS.roomSettings.tableShape;
  }
  roomSettings.seatLock =
    typeof roomSettings.seatLock === 'boolean'
      ? roomSettings.seatLock
      : DEFAULT_SETTINGS.roomSettings.seatLock;
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
  const seatPositions = roomSettings.seatPositions ?? {};
  const normalizeSeatPositions = (positions) =>
    Array.isArray(positions)
      ? positions
          .map((entry) => ({
            x: Number(entry?.x ?? entry?.[0]),
            y: Number(entry?.y ?? entry?.[1])
          }))
          .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))
      : [];
  roomSettings.seatParams = {
    rectangle: normalizeSeatParamList(seatParams.rectangle),
    oval: normalizeSeatParamList(seatParams.oval),
    circle: normalizeSeatParamList(seatParams.circle)
  };
  roomSettings.seatPositions = {
    endless: normalizeSeatPositions(seatPositions.endless)
  };
  next.roomSettings = roomSettings;
  next.resetFaceDown = Boolean(next.resetFaceDown);
  next.includeJokers = Boolean(next.includeJokers);
  return next;
};

const loadSettings = () => {
  if (typeof window === 'undefined') {
    return normalizeSettings(BASE_DEFAULTS);
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return normalizeSettings(BASE_DEFAULTS);
    }
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (error) {
    return normalizeSettings(BASE_DEFAULTS);
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

export {
  BASE_DEFAULTS,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings
};
