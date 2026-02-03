import { useCallback, useEffect, useRef, useState } from 'react';

const createCardsById = (count) => {
  return Array.from({ length: count }, (_, index) => {
    const cardId = `c${index + 1}`;
    return [cardId, { id: cardId, label: `Card ${index + 1}` }];
  }).reduce((acc, [id, card]) => {
    acc[id] = card;
    return acc;
  }, {});
};

const createStacks = (count, centerX, centerY) => {
  return Array.from({ length: count }, (_, index) => {
    const spread = 80;
    const offsetX = (Math.random() - 0.5) * spread;
    const offsetY = (Math.random() - 0.5) * spread;
    const cardId = `c${index + 1}`;

    return {
      id: `s${index + 1}`,
      x: centerX + offsetX,
      y: centerY + offsetY,
      rotation: 0,
      faceUp: true,
      cardIds: [cardId]
    };
  });
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
    setCardsById(createCardsById(20));
    setStacks(createStacks(20, centerX, centerY));
    initializedRef.current = true;
  }, [cardSize.height, cardSize.width, tableRect?.height, tableRect?.width]);

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
      Object.keys(cardsById).length > 0 ? cardsById : createCardsById(20);
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
