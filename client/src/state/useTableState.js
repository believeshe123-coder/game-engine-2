import { useCallback, useEffect, useRef, useState } from 'react';
import { clampStackToFelt, getFeltShape } from '../utils/geometry.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './tableSettings.js';

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

const validateUniqueCardIds = (stacks) => {
  const counts = new Map();
  stacks.forEach((stack) => {
    stack.cardIds.forEach((cardId) => {
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

export const useTableState = (tableRect, cardSize, initialSettings) => {
  const [cardsById, setCardsById] = useState({});
  const [stacks, setStacks] = useState([]);
  const initializedRef = useRef(false);
  const nextStackIdRef = useRef(21);

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
      const {
        cardsById: nextCardsById,
        deckCardIds,
        allCardIds
      } = buildDecks(settings);
      const boundsWidth = tableRect.width;
      const boundsHeight = tableRect.height;
      const felt = getFeltShape({
        width: boundsWidth,
        height: boundsHeight,
        shape: settings.roomSettings?.tableShape ?? 'rectangle'
      });
      const deckGap = 18;
      const nextStacks = [];
      nextStackIdRef.current = 1;

      const pushStack = (x, y, cardIds, faceUp) => {
        const clamped = clampStackToFelt(
          x,
          y,
          cardSize.width,
          cardSize.height,
          felt
        );
        nextStacks.push({
          id: createStackId(),
          x: clamped.x,
          y: clamped.y,
          rotation: 0,
          faceUp,
          cardIds
        });
      };

      if (settings.presetLayout === 'solitaire') {
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
      } else if (settings.presetLayout === 'grid') {
        const padding = 24;
        const gap = 12;
        const cols = Math.max(
          1,
          Math.floor(
            (boundsWidth - padding * 2 + gap) / (cardSize.width + gap)
          )
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
      } else {
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
      }

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
      validateUniqueCardIds(stacks);
    }
  }, [stacks]);

  return {
    cardsById,
    stacks,
    setStacks,
    createStackId,
    rebuildTableFromSettings
  };
};
