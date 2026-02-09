const UI_PREFS_STORAGE_KEY = 'tt_uiPrefs';

const DEFAULT_UI_PREFS = {
  colorBlindMode: false
};

const normalizeUiPrefs = (prefs) => {
  const next = { ...DEFAULT_UI_PREFS, ...(prefs ?? {}) };
  next.colorBlindMode =
    typeof next.colorBlindMode === 'boolean'
      ? next.colorBlindMode
      : DEFAULT_UI_PREFS.colorBlindMode;
  return next;
};

const loadUiPrefs = () => {
  if (typeof window === 'undefined') {
    return normalizeUiPrefs(DEFAULT_UI_PREFS);
  }
  try {
    const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) {
      return normalizeUiPrefs(DEFAULT_UI_PREFS);
    }
    return normalizeUiPrefs(JSON.parse(raw));
  } catch (error) {
    return normalizeUiPrefs(DEFAULT_UI_PREFS);
  }
};

const saveUiPrefs = (prefs) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    // noop
  }
};

export { DEFAULT_UI_PREFS, loadUiPrefs, saveUiPrefs };
