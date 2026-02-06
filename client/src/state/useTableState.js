import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clampStackToFelt, getFeltShape } from '../utils/geometry.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './tableSettings.js';
import { loadPlayerProfile, savePlayerProfile } from './playerProfile.js';

const SUITS = [
  { id: 'S', name: 'Spades' },
  { id: 'C', name: 'Clubs' },
  { id: 'H', name: 'Hearts' },
  { id: 'D', name: 'Diamonds' }
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

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

const validateUniqueCardIds = (stacks, hands) => {
  const counts = new Map();
  stacks.forEach((stack) => {
    stack.cardIds.forEach((cardId) => {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    });
  });
  Object.values(hands ?? {}).forEach((hand) => {
    hand?.cardIds?.forEach((cardId) => {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    });
  });
  const duplicates = [];
  counts.forEach((count, cardId) => {
    if (count > 1) {
      duplicates.push(`${cardId} appears ${count}x`);
    }
  });
  if (duplicates.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`DUPLICATE CARD IDS: ${duplicates.join(', ')}`);
  }
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
  if (tableShape === 'rectangle') {
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

const createEmptyHand = () => ({ cardIds: [], revealed: {} });

export const useTableState = (tableRect, cardSize, initialSettings, seatCount) => {
  const [cardsById, setCardsById] = useState({});
  const [stacks, setStacks] = useState([]);
  const initializedRef = useRef(false);
  const nextStackIdRef = useRef(21);
  const initialProfile = useMemo(() => loadPlayerProfile(), []);
  const playerIdRef = useRef(initialProfile.playerId);
  const [players, setPlayers] = useState(() => ({
    [playerIdRef.current]: {
      id: playerIdRef.current,
      name: 'Leahana',
      seatIndex: initialProfile.mySeatIndex ?? null,
      seatColor: initialProfile.seatColor,
      accentColor: initialProfile.accentColor
    }
  }));
  const [seatAssignments, setSeatAssignments] = useState(() => {
    const count = seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
    return Array.from({ length: count }, (_, index) =>
      index === initialProfile.mySeatIndex ? playerIdRef.current : null
    );
  });
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

  const rebuildTableFromSettings = useCallback(
    (settingsInput) => {
      if (!tableRect?.width || !tableRect?.height) {
        return;
      }
      const settings = normalizeSettings(settingsInput ?? DEFAULT_SETTINGS);
      const tableShape = settings.roomSettings?.tableShape ?? 'rectangle';
      const {
        cardsById: nextCardsById,
        deckCardIds,
        allCardIds
      } = buildDecks(settings);
      const boundsWidth = tableRect.width;
      const boundsHeight = tableRect.height;
      const feltShape = getFeltShape({
        width: boundsWidth,
        height: boundsHeight,
        shape: tableShape
      });
      const nextStacks = [];
      nextStackIdRef.current = 1;

      const pushStack = (x, y, cardIds, faceUp) => {
        const centerX = x + cardSize.width / 2;
        const centerY = y + cardSize.height / 2;
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
          ownerSeatIndex: null
        });
      };

      applyPresetLayout(settings.presetLayout, tableShape, {
        width: boundsWidth,
        height: boundsHeight
      }, {
        cardSize,
        deckCardIds,
        allCardIds,
        settings,
        pushStack
      });

      setCardsById(nextCardsById);
      setStacks(nextStacks);
      initializedRef.current = true;
    },
    [
      cardSize.height,
      cardSize.width,
      createStackId,
      tableRect?.height,
      tableRect?.width
    ]
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
    if (process.env.NODE_ENV !== 'production') {
      validateUniqueCardIds(stacks, hands);
    }
  }, [hands, stacks]);

  useEffect(() => {
    const count = seatCount ?? DEFAULT_SETTINGS.roomSettings.seatCount;
    setSeatAssignments((prev) => {
      const next = Array.from({ length: count }, (_, index) => prev?.[index] ?? null);
      const myIndex = next.findIndex((id) => id === playerIdRef.current);
      if (myIndex === -1) {
        const profileSeat = players[playerIdRef.current]?.seatIndex ?? null;
        if (profileSeat !== null && profileSeat < count) {
          next[profileSeat] = playerIdRef.current;
        }
      }
      return next;
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
    const currentSeatIndex = players[playerIdRef.current]?.seatIndex ?? null;
    if (currentSeatIndex !== null && currentSeatIndex >= count) {
      setPlayers((prev) => ({
        ...prev,
        [playerIdRef.current]: {
          ...prev[playerIdRef.current],
          seatIndex: null
        }
      }));
    }
  }, [players, seatCount]);

  useEffect(() => {
    const profile = players[playerIdRef.current];
    if (!profile) {
      return;
    }
    savePlayerProfile({
      playerId: profile.id,
      mySeatIndex: profile.seatIndex ?? null,
      seatColor: profile.seatColor,
      accentColor: profile.accentColor
    });
  }, [players]);

  const sitAtSeat = useCallback(
    (seatIndex) => {
      if (seatIndex === null || seatIndex === undefined) {
        return;
      }
      setSeatAssignments((prev) => {
        const next = Array.from({ length: prev.length }, (_, index) => prev[index] ?? null);
        const occupiedBy = next[seatIndex];
        if (occupiedBy && occupiedBy !== playerIdRef.current) {
          return prev;
        }
        const currentIndex = next.findIndex((id) => id === playerIdRef.current);
        if (currentIndex !== -1) {
          next[currentIndex] = null;
        }
        next[seatIndex] = playerIdRef.current;
        return next;
      });
      setPlayers((prev) => ({
        ...prev,
        [playerIdRef.current]: {
          ...prev[playerIdRef.current],
          seatIndex
        }
      }));
    },
    []
  );

  const standUp = useCallback(() => {
    setSeatAssignments((prev) =>
      prev.map((entry) => (entry === playerIdRef.current ? null : entry))
    );
    setPlayers((prev) => ({
      ...prev,
      [playerIdRef.current]: {
        ...prev[playerIdRef.current],
        seatIndex: null
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

  const takeTopCardFromStack = useCallback(
    (stackId) => {
      let removedCardId = null;
      setStacks((prev) => {
        const next = prev.map((stack) => {
          if (stack.id !== stackId) {
            return stack;
          }
          if (!stack.cardIds.length) {
            return stack;
          }
          const nextCardIds = [...stack.cardIds];
          removedCardId = nextCardIds.pop() ?? null;
          return { ...stack, cardIds: nextCardIds };
        });
        return next.filter((stack) => stack.cardIds.length > 0);
      });
      return removedCardId;
    },
    [setStacks]
  );

  const spawnHeldStack = useCallback(
    (cardIds, originStackId, originOverride = null) => {
      if (!cardIds?.length) {
        return null;
      }
      const newStackId = createStackId();
      let origin = null;
      let meta = null;
      setStacks((prev) => {
        const originStack =
          prev.find((stack) => stack.id === originStackId) ?? originOverride;
        if (!originStack) {
          return prev;
        }
        origin = { x: originStack.x, y: originStack.y };
        meta = { rotation: originStack.rotation, faceUp: originStack.faceUp };
        return prev.concat({
          id: newStackId,
          x: originStack.x,
          y: originStack.y,
          rotation: originStack.rotation,
          faceUp: originStack.faceUp,
          cardIds: [...cardIds],
          zone: 'table',
          ownerSeatIndex: null
        });
      });
      if (!origin || !meta) {
        return null;
      }
      return {
        stackId: newStackId,
        origin,
        rotation: meta.rotation,
        faceUp: meta.faceUp
      };
    },
    [createStackId, setStacks]
  );

  return {
    cardsById,
    stacks,
    setStacks,
    createStackId,
    rebuildTableFromSettings,
    players,
    seatAssignments,
    hands,
    myPlayerId: playerIdRef.current,
    sitAtSeat,
    standUp,
    updatePlayerColors,
    moveToHand,
    moveFromHandToTable,
    reorderHand,
    toggleReveal,
    takeTopCardFromStack,
    spawnHeldStack
  };
};
