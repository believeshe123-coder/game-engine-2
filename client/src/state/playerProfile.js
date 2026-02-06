const STORAGE_KEY = 'playerProfile';

const DEFAULT_PROFILE = {
  playerId: null,
  mySeatIndex: null,
  seatColor: '#6a8dff',
  accentColor: '#f5b96c'
};

const createPlayerId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `player_${Date.now().toString(36)}_${rand}`;
};

const normalizeColor = (value, fallback) => {
  if (typeof value !== 'string' || value.length < 3) {
    return fallback;
  }
  return value;
};

const loadPlayerProfile = () => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PROFILE, playerId: createPlayerId() };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PROFILE, playerId: createPlayerId() };
    }
    const parsed = JSON.parse(raw);
    const playerId = parsed?.playerId || createPlayerId();
    const mySeatIndex = Number.isFinite(parsed?.mySeatIndex)
      ? parsed.mySeatIndex
      : DEFAULT_PROFILE.mySeatIndex;
    return {
      playerId,
      mySeatIndex,
      seatColor: normalizeColor(parsed?.seatColor, DEFAULT_PROFILE.seatColor),
      accentColor: normalizeColor(parsed?.accentColor, DEFAULT_PROFILE.accentColor)
    };
  } catch (error) {
    return { ...DEFAULT_PROFILE, playerId: createPlayerId() };
  }
};

const savePlayerProfile = (profile) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    // noop
  }
};

export { loadPlayerProfile, savePlayerProfile };
