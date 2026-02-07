const PROFILE_STORAGE_KEY = 'tt_playerProfile';
const SEAT_STORAGE_KEY = 'tt_mySeatIndex';
const LEGACY_STORAGE_KEY = 'playerProfile';

const DEFAULT_PROFILE = {
  id: null,
  name: 'Leahana',
  seatColor: '#6aa9ff',
  accentColor: '#ffd36a'
};

const createPlayerId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `player_${Date.now().toString(36)}_${rand}`;
};

const normalizeName = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim().slice(0, 20);
  if (!trimmed) {
    return fallback;
  }
  return trimmed;
};

const normalizeColor = (value, fallback) => {
  if (typeof value !== 'string' || value.length < 3) {
    return fallback;
  }
  return value;
};

const loadPlayerProfile = () => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PROFILE, id: createPlayerId() };
  }
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw && !legacyRaw) {
      return { ...DEFAULT_PROFILE, id: createPlayerId() };
    }
    const parsed = JSON.parse(raw || legacyRaw);
    const playerId = parsed?.id || parsed?.playerId || createPlayerId();
    return {
      id: playerId,
      name: normalizeName(parsed?.name, DEFAULT_PROFILE.name),
      seatColor: normalizeColor(parsed?.seatColor, DEFAULT_PROFILE.seatColor),
      accentColor: normalizeColor(parsed?.accentColor, DEFAULT_PROFILE.accentColor)
    };
  } catch (error) {
    return { ...DEFAULT_PROFILE, id: createPlayerId() };
  }
};

const savePlayerProfile = (profile) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    // noop
  }
};

const loadMySeatIndex = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SEAT_STORAGE_KEY);
    const parsed = raw === null ? null : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
};

const saveMySeatIndex = (seatIndex) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (seatIndex === null || seatIndex === undefined) {
      window.localStorage.removeItem(SEAT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SEAT_STORAGE_KEY, String(seatIndex));
  } catch (error) {
    // noop
  }
};

export { loadMySeatIndex, loadPlayerProfile, saveMySeatIndex, savePlayerProfile };
