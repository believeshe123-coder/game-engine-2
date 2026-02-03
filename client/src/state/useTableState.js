import { useCallback, useEffect, useRef, useState } from 'react';

const SUITS = [
  { id: 'S', name: 'Spades' },
  { id: 'C', name: 'Clubs' },
  { id: 'H', name: 'Hearts' },
  { id: 'D', name: 'Diamonds' }
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const createDeck = () => {
  const cards = [];
  SUITS.forEach((suit) => {
    RANKS.forEach((rank) => {
      const id = `${rank}${suit.id}`;
      cards.push({
        id,
        rank,
        suit: suit.name
      });
    });
  });
  cards.push(
    {
      id: 'JOKER_BLACK',
      rank: 'JOKER',
      suit: 'Joker',
      color: 'black'
    },
    {
      id: 'JOKER_RED',
      rank: 'JOKER',
      suit: 'Joker',
      color: 'red'
    }
  );
  return cards;
};

const createCardsById = () => {
  return createDeck().reduce((acc, card) => {
    acc[card.id] = card;
    return acc;
  }, {});
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

export const useTableState = (tableRect, cardSize) => {
  const [cardsById, setCardsById] = useState({});
  const [stacks, setStacks] = useState([]);
  const initializedRef = useRef(false);
  const nextStackIdRef = useRef(21);

  useEffect(() => {
    if (!tableRect?.width || !tableRect?.height || initializedRef.current) {
      return;
    }

    const centerX = tableRect.width / 2 - cardSize.width / 2;
    const centerY = tableRect.height / 2 - cardSize.height / 2;
    const nextCardsById = createCardsById();
    const cardIds = Object.keys(nextCardsById);
    setCardsById(nextCardsById);
    setStacks([
      {
        id: 's1',
        x: centerX,
        y: centerY,
        rotation: 0,
        faceUp: true,
        cardIds
      }
    ]);
    nextStackIdRef.current = 2;
    initializedRef.current = true;
  }, [cardSize.height, cardSize.width, tableRect?.height, tableRect?.width]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      validateUniqueCardIds(stacks);
    }
  }, [stacks]);

  const createStackId = useCallback(() => {
    const id = `s${nextStackIdRef.current}`;
    nextStackIdRef.current += 1;
    return id;
  }, []);

  const resetTable = useCallback(() => {
    if (!tableRect?.width || !tableRect?.height) {
      return;
    }

    const nextCardsById =
      Object.keys(cardsById).length > 0 ? cardsById : createCardsById();
    const centerX = tableRect.width / 2 - cardSize.width / 2;
    const centerY = tableRect.height / 2 - cardSize.height / 2;
    const cardIds = Object.keys(nextCardsById);

    setCardsById(nextCardsById);
    setStacks([
      {
        id: 's1',
        x: centerX,
        y: centerY,
        rotation: 0,
        faceUp: true,
        cardIds
      }
    ]);
    nextStackIdRef.current = 2;
    initializedRef.current = true;
  }, [cardSize.height, cardSize.width, cardsById, tableRect?.height, tableRect?.width]);

  return {
    cardsById,
    stacks,
    setStacks,
    createStackId,
    resetTable
  };
};
