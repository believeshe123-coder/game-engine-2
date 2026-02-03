const STORAGE_KEY = 'tableSettings';

const DEFAULT_SETTINGS = {
  resetFaceDown: true,
  cardStyle: 'medieval',
  includeJokers: true,
  deckCount: 1,
  presetLayout: 'none',
  stackCountDisplayMode: 'always'
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
  if (!['medieval', 'classic'].includes(next.cardStyle)) {
    next.cardStyle = DEFAULT_SETTINGS.cardStyle;
  }
  if (!['none', 'solitaire', 'grid'].includes(next.presetLayout)) {
    next.presetLayout = DEFAULT_SETTINGS.presetLayout;
  }
  if (!['always', 'hover'].includes(next.stackCountDisplayMode)) {
    next.stackCountDisplayMode = DEFAULT_SETTINGS.stackCountDisplayMode;
  }
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
