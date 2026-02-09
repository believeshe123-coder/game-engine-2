import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clampStackToFelt, getFeltShape } from '../utils/geometry.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './tableSettings.js';
import {
  loadMySeatIndex,
  loadPlayerProfile,
  loadSeatAssignments,
  saveMySeatIndex,
  savePlayerProfile,
  saveSeatAssignments
} from './playerProfile.js';

const SUITS = [
  { id: 'S', name: 'Spades' },
  { id: 'C', name: 'Clubs' },
  { id: 'H', name: 'Hearts' },
  { id: 'D', name: 'Diamonds' }
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const MAX_NAME_LENGTH = 20;
const FALLBACK_NAME = 'Player';
const TAU = Math.PI * 2;

const normalizeName = (value) => {
  if (typeof value !== 'string') {
    return FALLBACK_NAME;
  }
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || FALLBACK_NAME;
};

const createDeck = ({ includeJokers, deckIndex }) => {
  const cards = [];
  SUITS.forEach((suit) => {
    RANKS.forEach((rank) => {
      const baseId = `${rank}${suit.id}`;
      const id = deckIndex ? `${baseId}-${deckIndex}` : baseId;
      cards.push({
        id,
        rank,
        suit: suit.name
      });
    });
  });
  if (includeJokers) {
    const blackId = deckIndex ? `JOKER_BLACK-${deckIndex}` : 'JOKER_BLACK';
    const redId = deckIndex ? `JOKER_RED-${deckIndex}` : 'JOKER_RED';
    cards.push(
      {
        id: blackId,
        rank: 'JOKER',
        suit: 'Joker',
        color: 'black'
      },
      {
        id: redId,
        rank: 'JOKER',
        suit: 'Joker',
        color: 'red'
      }
    );
  }
  return cards;
};

const buildDecks = (settings) => {
  const deckCount = settings.deckCount;
  const includeJokers = settings.includeJokers;
  const cardsById = {};
  const deckCardIds = [];
  for (let i = 0; i < deckCount; i += 1) {
    const deckIndex = i + 1;
    const cards = createDeck({ includeJokers, deckIndex });
    deckCardIds.push(cards.map((card) => card.id));
    cards.forEach((card) => {
      cardsById[card.id] = card;
    });
  }
  return {
    cardsById,
    deckCardIds,
    allCardIds: deckCardIds.flat()
  };
};

const applyRectangleLayout = ({
  preset,
  feltBounds,
  cardSize,
  deckCardIds,
  allCardIds,
  settings,
  pushStack
}) => {
  const boundsWidth = feltBounds.width;
  const boundsHeight = feltBounds.height;
  if (preset === 'solitaire') {
    const columnCount = 7;
    const columnGap = 22;
    const totalWidth =
      columnCount * cardSize.width + (columnCount - 1) * columnGap;
    const startX = (boundsWidth - totalWidth) / 2;
    const startY = Math.max(140, boundsHeight * 0.32);
    let remaining = [...allCardIds];

    for (let col = 0; col < columnCount; col += 1) {
      const cardCount = col + 1;
      const columnCards = remaining.slice(0, cardCount);
      remaining = remaining.slice(cardCount);
      const x = startX + col * (cardSize.width + columnGap);
      const y = startY;
      pushStack(x, y, columnCards, true);
    }

    const stockX = Math.max(24, boundsWidth * 0.12);
    const stockY = Math.max(24, boundsHeight * 0.12);
    if (remaining.length > 0) {
      pushStack(stockX, stockY, remaining, false);
    }
    return;
  }

  if (preset === 'grid') {
    const padding = 24;
    const gap = 12;
    const cols = Math.max(
      1,
      Math.floor((boundsWidth - padding * 2 + gap) / (cardSize.width + gap))
    );
    const startX = padding;
    const startY = padding;
    allCardIds.forEach((cardId, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (cardSize.width + gap);
      const y = startY + row * (cardSize.height + gap);
      pushStack(x, y, [cardId], true);
    });
    return;
  }

  const deckGap = 18;
  const totalWidth =
    settings.deckCount * cardSize.width + (settings.deckCount - 1) * deckGap;
  const startX = (boundsWidth - totalWidth) / 2;
  const startY = boundsHeight / 2 - cardSize.height / 2;
  const faceUp = !settings.resetFaceDown;
  deckCardIds.forEach((deckIds, index) => {
    const x = startX + index * (cardSize.width + deckGap);
    const y = startY;
    pushStack(x, y, deckIds, faceUp);
  });
};

const applyOvalLayout = ({
  preset,
  feltBounds,
  cardSize,
  deckCardIds,
  allCardIds,
  settings,
  pushStack
}) => {
  const boundsWidth = feltBounds.width;
  const boundsHeight = feltBounds.height;
  if (preset === 'solitaire') {
    const columnCount = 7;
    const columnGap = 22;
    const totalWidth =
      columnCount * cardSize.width + (columnCount - 1) * columnGap;
    const startX = (boundsWidth - totalWidth) / 2;
    const startY = Math.max(140, boundsHeight * 0.32);
    let remaining = [...allCardIds];

    for (let col = 0; col < columnCount; col += 1) {
      const cardCount = col + 1;
      const columnCards = remaining.slice(0, cardCount);
      remaining = remaining.slice(cardCount);
      const x = startX + col * (cardSize.width + columnGap);
      const y = startY;
      pushStack(x, y, columnCards, true);
    }

    const stockX = Math.max(24, boundsWidth * 0.12);
    const stockY = Math.max(24, boundsHeight * 0.12);
    if (remaining.length > 0) {
      pushStack(stockX, stockY, remaining, false);
    }
    return;
  }

  if (preset === 'grid') {
    const padding = 24;
    const gap = 12;
    const cols = Math.max(
      1,
      Math.floor((boundsWidth - padding * 2 + gap) / (cardSize.width + gap))
    );
    const startX = padding;
    const startY = padding;
    allCardIds.forEach((cardId, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (cardSize.width + gap);
      const y = startY + row * (cardSize.height + gap);
      pushStack(x, y, [cardId], true);
    });
    return;
  }

  const deckGap = 18;
  const totalWidth =
    settings.deckCount * cardSize.width + (settings.deckCount - 1) * deckGap;
  const startX = (boundsWidth - totalWidth) / 2;
  const startY = boundsHeight / 2 - cardSize.height / 2;
  const faceUp = !settings.resetFaceDown;
  deckCardIds.forEach((deckIds, index) => {
    const x = startX + index * (cardSize.width + deckGap);
    const y = startY;
    pushStack(x, y, deckIds, faceUp);
  });
};

const applyPresetLayout = (preset, tableShape, feltBounds, layout) => {
  if (tableShape === 'rectangle' || tableShape === 'endless') {
    applyRectangleLayout({
      preset,
      feltBounds,
      ...layout
    });
    return;
  }
  applyOvalLayout({
    preset,
    feltBounds,
    ...layout
  });
};

const DEFAULT_SPAWN_PADDING = 32;

const getSpawnAnchor = (rule, bounds, cardSize, index, total) => {
  const padding = Math.max(DEFAULT_SPAWN_PADDING, cardSize.width * 0.35);
  const centerX = bounds.width / 2 - cardSize.width / 2;
  const centerY = bounds.height / 2 - cardSize.height / 2;
  const cornerX = bounds.width - cardSize.width - padding;
  const cornerY = bounds.height - cardSize.height - padding;
  switch (rule) {
    case 'center':
      return { x: centerX, y: centerY };
    case 'nearSeat1':
      return { x: centerX, y: padding };
    case 'topLeft':
      return { x: padding, y: padding };
    case 'topRight':
      return { x: cornerX, y: padding };
    case 'bottomLeft':
      return { x: padding, y: cornerY };
    case 'bottomRight':
      return { x: cornerX, y: cornerY };
    case 'perSeat': {
      const count = Math.max(1, total);
      const radius = Math.max(0, Math.min(bounds.width, bounds.height) / 2 - padding * 2);
      const angle = (TAU / count) * index - Math.PI / 2;
      return {
        x: bounds.width / 2 + Math.cos(angle) * radius - cardSize.width / 2,
        y: bounds.height / 2 + Math.sin(angle) * radius - cardSize.height / 2
      };
    }
    default:
      return { x: centerX, y: centerY };
  }
};

const buildDeckStacks = (allCardIds, quantity) => {
  if (!allCardIds.length || quantity <= 0) {
    return [];
  }
  const count = Math.max(1, quantity);
  const chunkSize = Math.ceil(allCardIds.length / count);
  return Array.from({ length: count }, (_, index) =>
    allCardIds.slice(index * chunkSize, (index + 1) * chunkSize)
  ).filter((chunk) => chunk.length > 0);
};

const createEmptyHand = () => ({ cardIds: [], revealed: {} });

export const useTableState = (
  tableRect,
  cardSize,
  initialSettings,
  seatCount,
  getEndlessSpawnPoint
) => {
  const [cardsById, setCardsById] = useState({});
  const [allCardIds, setAllCardIds] = useState([]);
  const [stacks, setStacks] = useState([]);
  const initializedRef = useRef(false);
  const nextStackIdRef = useRef(21);
  const initialProfile = useMemo(() => loadPlayerProfile(), []);
  const playerIdRef = useRef(initialProfile.id);
  const initialSeatState = useMemo(() => {
    const count = seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
    const storedSeatIndex = loadMySeatIndex();
    const storedAssignments = loadSeatAssignments();
    const seatAssignments = Array.from({ length: count }, (_, index) =>
      storedAssignments?.[index] ?? null
    );
    let mySeatIndex =
      Number.isFinite(storedSeatIndex) && storedSeatIndex >= 0 && storedSeatIndex < count
        ? storedSeatIndex
        : null;
    const existingIndex = seatAssignments.findIndex((id) => id === playerIdRef.current);
    if (existingIndex !== -1) {
      mySeatIndex = existingIndex;
    } else if (mySeatIndex !== null) {
      const occupant = seatAssignments[mySeatIndex];
      if (occupant && occupant !== playerIdRef.current) {
        mySeatIndex = null;
      } else {
        seatAssignments[mySeatIndex] = playerIdRef.current;
      }
    }
    return { seatAssignments, mySeatIndex };
  }, [seatCount]);
  const [actionLog, setActionLog] = useState([]);
  const actionLogIdRef = useRef(1);
  const [presence, setPresence] = useState(() => ({}));
  const [players, setPlayers] = useState(() => ({
    [playerIdRef.current]: {
      id: playerIdRef.current,
      name: initialProfile.name,
      seatIndex: initialSeatState.mySeatIndex,
      seatColor: initialProfile.seatColor
    }
  }));
  const [seatState, setSeatState] = useState(() => ({
    mySeatIndex: initialSeatState.mySeatIndex,
    seatAssignments: initialSeatState.seatAssignments
  }));
  const [hands, setHands] = useState(() => {
    const count = seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
    return Array.from({ length: count }, (_, index) => index).reduce((acc, index) => {
      acc[index] = createEmptyHand();
      return acc;
    }, {});
  });

  const createStackId = useCallback(() => {
    const id = `s${nextStackIdRef.current}`;
    nextStackIdRef.current += 1;
    return id;
  }, []);

  const buildTableSurface = useCallback(
    (settingsInput) => {
      const settings = normalizeSettings(settingsInput ?? DEFAULT_SETTINGS);
      const tableShape = settings.roomSettings?.tableShape ?? 'rectangle';
      if (!tableRect?.width || !tableRect?.height) {
        if (tableShape !== 'endless') {
          return null;
        }
      }
      const customPreset = settings.customPresets?.[settings.presetLayout];
      const spawnSettings = customPreset
        ? {
            ...settings,
            includeJokers: customPreset.includeJokers ?? settings.includeJokers,
            deckCount: customPreset.deckCount ?? settings.deckCount
          }
        : settings;
      const {
        cardsById: nextCardsById,
        deckCardIds,
        allCardIds
      } = buildDecks(spawnSettings);
      const boundsWidth = tableRect.width ?? 0;
      const boundsHeight = tableRect.height ?? 0;
      const isEndless = tableShape === 'endless';
      const spawnPoint = isEndless ? getEndlessSpawnPoint?.() : null;
      const spawnOffset = isEndless
        ? {
            x: (spawnPoint?.x ?? 0) - boundsWidth / 2,
            y: (spawnPoint?.y ?? 0) - boundsHeight / 2
          }
        : { x: 0, y: 0 };
      const feltShape =
        isEndless
          ? null
          : getFeltShape({
              width: boundsWidth,
              height: boundsHeight,
              shape: tableShape
            });
      const nextStacks = [];
      nextStackIdRef.current = 1;

      const pushStack = (x, y, cardIds, faceUp, options = {}) => {
        if (!cardIds?.length) {
          if (!options.token) {
            return;
          }
        }
        const adjustedX = x + spawnOffset.x;
        const adjustedY = y + spawnOffset.y;
        const centerX = adjustedX + cardSize.width / 2;
        const centerY = adjustedY + cardSize.height / 2;
        const clampedCenter = clampStackToFelt(
          centerX,
          centerY,
          cardSize.width,
          cardSize.height,
          feltShape
        );
        const clamped = {
          x: clampedCenter.x - cardSize.width / 2,
          y: clampedCenter.y - cardSize.height / 2
        };
        nextStacks.push({
          id: createStackId(),
          x: clamped.x,
          y: clamped.y,
          rotation: 0,
          faceUp,
          cardIds,
          zone: 'table',
          ownerSeatIndex: null,
          token: options.token ?? null
        });
      };

      if (customPreset) {
        const spawnItems = Array.isArray(customPreset.spawnItems)
          ? customPreset.spawnItems
          : [];
        const deckStacks = buildDeckStacks(
          allCardIds,
          spawnItems.find((item) => item.type === 'standardDeck')?.quantity ?? 1
        );
        let deckIndex = 0;
        const seatCount = settings.roomSettings?.seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
        spawnItems.forEach((item) => {
          if (item?.enabled === false) {
            return;
          }
          const quantity = Math.max(1, Number.parseInt(item.quantity, 10) || 1);
          const positionRule = item.positionRule ?? 'center';
          if (item.type === 'standardDeck') {
            for (let index = 0; index < quantity; index += 1) {
              const nextDeck = deckStacks[deckIndex];
              if (!nextDeck) {
                continue;
              }
              const anchor = getSpawnAnchor(positionRule, {
                width: boundsWidth,
                height: boundsHeight
              }, cardSize, index, quantity);
              pushStack(anchor.x, anchor.y, nextDeck, !settings.resetFaceDown);
              deckIndex += 1;
            }
            return;
          }
          if (item.type === 'handTokens') {
            const perSeat = Math.max(1, seatCount);
            for (let index = 0; index < perSeat; index += 1) {
              const anchor = getSpawnAnchor(
                positionRule,
                { width: boundsWidth, height: boundsHeight },
                cardSize,
                index,
                perSeat
              );
              pushStack(anchor.x, anchor.y, [], true, {
                token: { type: 'handToken', label: `Seat ${index + 1}` }
              });
            }
            return;
          }
          for (let index = 0; index < quantity; index += 1) {
            const anchor = getSpawnAnchor(
              positionRule,
              { width: boundsWidth, height: boundsHeight },
              cardSize,
              index,
              quantity
            );
            const tokenLabel = (() => {
              if (item.type === 'discardPile') {
                return 'Discard';
              }
              if (item.type === 'drawPile') {
                return 'Draw';
              }
              if (item.type === 'dealerButton') {
                return 'Dealer';
              }
              return 'Token';
            })();
            pushStack(anchor.x, anchor.y, [], true, {
              token: { type: item.type, label: tokenLabel }
            });
          }
        });
      } else {
        applyPresetLayout(
          settings.presetLayout,
          tableShape,
          {
            width: boundsWidth,
            height: boundsHeight
          },
          {
            cardSize,
            deckCardIds,
            allCardIds,
            settings,
            pushStack
          }
        );
      }

      return {
        nextCardsById,
        allCardIds,
        nextStacks
      };
    },
    [
      cardSize.height,
      cardSize.width,
      createStackId,
      getEndlessSpawnPoint,
      tableRect?.height,
      tableRect?.width
    ]
  );

  const rebuildTableFromSettings = useCallback(
    (settingsInput) => {
      const built = buildTableSurface(settingsInput);
      if (!built) {
        return;
      }
      setCardsById(built.nextCardsById);
      setAllCardIds(built.allCardIds);
      setStacks(built.nextStacks);
      initializedRef.current = true;
    },
    [buildTableSurface]
  );

  const resetTableSurface = useCallback(
    (settingsInput) => {
      const built = buildTableSurface(settingsInput);
      if (!built) {
        return;
      }
      setCardsById(built.nextCardsById);
      setAllCardIds(built.allCardIds);
      setStacks(built.nextStacks);
      setHands(() => {
        const count = seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
        const next = {};
        for (let index = 0; index < count; index += 1) {
          next[index] = {
            cardIds: [],
            revealed: {}
          };
        }
        return next;
      });
      initializedRef.current = true;
    },
    [buildTableSurface, seatCount]
  );

  const hardResetTableState = useCallback(
    (settingsInput) => {
      const settings = normalizeSettings(settingsInput ?? DEFAULT_SETTINGS);
      const built = buildTableSurface(settings);
      if (!built) {
        return;
      }
      const count = settings.roomSettings?.seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
      const nextHands = {};
      for (let index = 0; index < count; index += 1) {
        nextHands[index] = createEmptyHand();
      }
      setCardsById(built.nextCardsById);
      setAllCardIds(built.allCardIds);
      setStacks(built.nextStacks);
      setHands(nextHands);
      setSeatState({
        mySeatIndex: null,
        seatAssignments: Array.from({ length: count }, () => null)
      });
      initializedRef.current = true;
    },
    [buildTableSurface]
  );

  const rebuildTableSurfacePreservingHands = useCallback(
    (settingsInput) => {
      const built = buildTableSurface(settingsInput);
      if (!built) {
        return;
      }
      const validCardIds = new Set(Object.keys(built.nextCardsById));
      const count = seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
      const nextHands = {};
      const preservedCardIds = new Set();
      for (let index = 0; index < count; index += 1) {
        const entry = hands?.[index] ?? createEmptyHand();
        const filteredCardIds = (entry.cardIds ?? []).filter((cardId) =>
          validCardIds.has(cardId)
        );
        const filteredRevealed = {};
        Object.keys(entry.revealed ?? {}).forEach((cardId) => {
          if (validCardIds.has(cardId)) {
            filteredRevealed[cardId] = entry.revealed[cardId];
          }
        });
        filteredCardIds.forEach((cardId) => preservedCardIds.add(cardId));
        nextHands[index] = {
          cardIds: filteredCardIds,
          revealed: filteredRevealed
        };
      }
      const nextStacks = built.nextStacks
        .map((stack) => ({
          ...stack,
          cardIds: stack.cardIds.filter((cardId) => !preservedCardIds.has(cardId))
        }))
        .filter((stack) => stack.cardIds.length > 0);
      setCardsById(built.nextCardsById);
      setAllCardIds(built.allCardIds);
      setStacks(nextStacks);
      setHands(nextHands);
      initializedRef.current = true;
    },
    [buildTableSurface, hands, seatCount]
  );

  useEffect(() => {
    if (!tableRect?.width || !tableRect?.height || initializedRef.current) {
      return;
    }
    rebuildTableFromSettings(initialSettings ?? DEFAULT_SETTINGS);
  }, [
    initialSettings,
    rebuildTableFromSettings,
    tableRect?.height,
    tableRect?.width
  ]);

  useEffect(() => {
    const count = seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
    setSeatState((prev) => {
      const nextAssignments = Array.from({ length: count }, (_, index) =>
        prev.seatAssignments?.[index] ?? null
      );
      let nextSeatIndex = prev.mySeatIndex;
      if (nextSeatIndex !== null && nextSeatIndex >= count) {
        if (nextAssignments[nextSeatIndex] === playerIdRef.current) {
          nextAssignments[nextSeatIndex] = null;
        }
        nextSeatIndex = null;
      }
      return {
        ...prev,
        mySeatIndex: nextSeatIndex,
        seatAssignments: nextAssignments
      };
    });
    setHands((prev) => {
      const next = {};
      for (let index = 0; index < count; index += 1) {
        const entry = prev?.[index] ?? createEmptyHand();
        next[index] = {
          cardIds: [...(entry.cardIds ?? [])],
          revealed: { ...(entry.revealed ?? {}) }
        };
      }
      return next;
    });
  }, [seatCount]);

  useEffect(() => {
    const profile = players[playerIdRef.current];
    if (!profile) {
      return;
    }
    savePlayerProfile({
      id: profile.id,
      name: normalizeName(profile.name),
      seatColor: profile.seatColor
    });
  }, [players]);

  useEffect(() => {
    saveMySeatIndex(seatState.mySeatIndex ?? null);
    saveSeatAssignments(seatState.seatAssignments);
  }, [seatState.mySeatIndex, seatState.seatAssignments]);

  useEffect(() => {
    setPlayers((prev) => {
      const current = prev[playerIdRef.current];
      if (!current || current.seatIndex === seatState.mySeatIndex) {
        return prev;
      }
      return {
        ...prev,
        [playerIdRef.current]: {
          ...current,
          seatIndex: seatState.mySeatIndex
        }
      };
    });
  }, [seatState.mySeatIndex]);

  const logAction = useCallback((text) => {
    if (!text) {
      return;
    }
    setActionLog((prev) => {
      const next = [
        { id: actionLogIdRef.current++, ts: Date.now(), text },
        ...prev
      ];
      return next.slice(0, 30);
    });
  }, []);

  const updatePresence = useCallback((updates) => {
    if (!playerIdRef.current) {
      return;
    }
    setPresence((prev) => ({
      ...prev,
      [playerIdRef.current]: {
        x: 0,
        y: 0,
        isDown: false,
        holdingCount: 0,
        ...(prev[playerIdRef.current] ?? {}),
        ...updates
      }
    }));
  }, []);

  const sitAtSeat = useCallback((seatIndex) => {
    setSeatState((prev) => {
      const count = prev.seatAssignments.length;
      console.log('sitAtSeat before', {
        seatIndex,
        mySeatIndex: prev.mySeatIndex,
        seatAssignments: prev.seatAssignments
      });
      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= count) {
        return prev;
      }
      const nextAssignments = [...prev.seatAssignments];
      if (prev.mySeatIndex !== null) {
        nextAssignments[prev.mySeatIndex] = null;
      }
      const occupant = nextAssignments[seatIndex];
      if (occupant && occupant !== playerIdRef.current) {
        return prev;
      }
      nextAssignments[seatIndex] = playerIdRef.current;
      const nextState = {
        ...prev,
        mySeatIndex: seatIndex,
        seatAssignments: nextAssignments
      };
      console.log('sitAtSeat after', nextState);
      return nextState;
    });
    setPlayers((prev) => ({
      ...prev,
      [playerIdRef.current]: {
        ...prev[playerIdRef.current],
        seatIndex
      }
    }));
  }, []);

  const standUp = useCallback(() => {
    setSeatState((prev) => {
      const nextAssignments = [...prev.seatAssignments];
      if (prev.mySeatIndex !== null) {
        nextAssignments[prev.mySeatIndex] = null;
      }
      return {
        ...prev,
        mySeatIndex: null,
        seatAssignments: nextAssignments
      };
    });
    setPlayers((prev) => ({
      ...prev,
      [playerIdRef.current]: {
        ...prev[playerIdRef.current],
        seatIndex: null
      }
    }));
  }, []);

  const setSeatColor = useCallback(
    (seatColor) => {
      if (!seatColor) {
        return;
      }
      setPlayers((prev) => ({
        ...prev,
        [playerIdRef.current]: {
          ...prev[playerIdRef.current],
          seatColor
        }
      }));
    },
    []
  );

  const setPlayerName = useCallback((name) => {
    const normalized = normalizeName(name);
    setPlayers((prev) => ({
      ...prev,
      [playerIdRef.current]: {
        ...prev[playerIdRef.current],
        name: normalized
      }
    }));
  }, []);

  const updatePlayerColors = useCallback((colors) => {
    setPlayers((prev) => ({
      ...prev,
      [playerIdRef.current]: {
        ...prev[playerIdRef.current],
        ...colors
      }
    }));
  }, []);

  const moveToHand = useCallback((seatIndex, cardIds) => {
    if (!cardIds?.length) {
      return;
    }
    setHands((prev) => {
      const next = { ...prev };
      const current = prev?.[seatIndex] ?? createEmptyHand();
      next[seatIndex] = {
        ...current,
        cardIds: [...current.cardIds, ...cardIds]
      };
      return next;
    });
  }, []);

  const moveCardIdsToHand = useCallback(
    (seatIndex, cardIds) => {
      moveToHand(seatIndex, cardIds);
    },
    [moveToHand]
  );

  const moveFromHandToTable = useCallback((seatIndex, cardId) => {
    setHands((prev) => {
      const current = prev?.[seatIndex];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [seatIndex]: {
          ...current,
          cardIds: current.cardIds.filter((id) => id !== cardId),
          revealed: Object.keys(current.revealed ?? {}).reduce((acc, id) => {
            if (id !== cardId) {
              acc[id] = current.revealed[id];
            }
            return acc;
          }, {})
        }
      };
    });
  }, []);

  const reorderHand = useCallback((seatIndex, cardId, targetIndex) => {
    setHands((prev) => {
      const current = prev?.[seatIndex];
      if (!current) {
        return prev;
      }
      const currentIndex = current.cardIds.indexOf(cardId);
      if (currentIndex === -1) {
        return prev;
      }
      const nextCardIds = [...current.cardIds];
      nextCardIds.splice(currentIndex, 1);
      const clampedTarget = Math.max(0, Math.min(targetIndex, nextCardIds.length));
      nextCardIds.splice(clampedTarget, 0, cardId);
      return {
        ...prev,
        [seatIndex]: {
          ...current,
          cardIds: nextCardIds
        }
      };
    });
  }, []);

  const toggleReveal = useCallback((seatIndex, cardId) => {
    setHands((prev) => {
      const current = prev?.[seatIndex];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [seatIndex]: {
          ...current,
          revealed: {
            ...current.revealed,
            [cardId]: !current.revealed?.[cardId]
          }
        }
      };
    });
  }, []);

  const player = players[playerIdRef.current];
  const mySeatIndex = seatState.mySeatIndex;
  const seatAssignments = seatState.seatAssignments;

  return {
    cardsById,
    allCardIds,
    stacks,
    setStacks,
    createStackId,
    rebuildTableFromSettings,
    players,
    player,
    mySeatIndex,
    seatAssignments,
    handsBySeat: hands,
    myPlayerId: playerIdRef.current,
    actionLog,
    presence,
    sitAtSeat,
    standUp,
    setPlayerName,
    setSeatColor,
    updatePlayerColors,
    logAction,
    updatePresence,
    moveCardIdsToHand,
    moveToHand,
    moveFromHandToTable,
    reorderHand,
    toggleReveal,
    resetTableSurface,
    rebuildTableSurfacePreservingHands,
    hardResetTableState
  };
};
