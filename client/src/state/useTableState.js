import { useEffect, useRef, useState } from 'react';

const createStack = (cardIds, centerX, centerY) => {
  return [
    {
      id: 's1',
      x: centerX,
      y: centerY,
      rotation: 0,
      cardIds
    }
  ];
};

const createCardsById = (count) => {
  return Array.from({ length: count }, (_, index) => {
    const cardId = `c${index + 1}`;
    return [cardId, { id: cardId, label: `Card ${index + 1}` }];
  }).reduce((acc, [id, card]) => {
    acc[id] = card;
    return acc;
  }, {});
};

export const useTableState = (tableRect, cardSize) => {
  const [cardsById, setCardsById] = useState({});
  const [stacks, setStacks] = useState([]);
  const initializedRef = useRef(false);
  const nextStackIdRef = useRef(2);

  useEffect(() => {
    if (!tableRect?.width || !tableRect?.height || initializedRef.current) {
      return;
    }

    const centerX = tableRect.width / 2 - cardSize.width / 2;
    const centerY = tableRect.height / 2 - cardSize.height / 2;
    const cards = createCardsById(20);
    setCardsById(cards);
    setStacks(createStack(Object.keys(cards), centerX, centerY));
    initializedRef.current = true;
  }, [cardSize.height, cardSize.width, tableRect?.height, tableRect?.width]);

  const createStackId = () => {
    const id = `s${nextStackIdRef.current}`;
    nextStackIdRef.current += 1;
    return id;
  };

  return {
    cardsById,
    stacks,
    setStacks,
    createStackId
  };
};
