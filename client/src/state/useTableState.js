import { useEffect, useRef, useState } from 'react';

const createStacks = (count, centerX, centerY) => {
import { useCallback, useEffect, useRef, useState } from 'react';

const createCards = (count, centerX, centerY) => {
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
      cardIds: [cardId]
    };
  });
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
  const nextStackIdRef = useRef(21);

    return {
      id: `c${index + 1}`,
      label: `Card ${index + 1}`,
      x: centerX + offsetX,
      y: centerY + offsetY,
      rotation: 0
    };
  });
};

export const useTableState = (tableRect, cardSize) => {
  const [cards, setCards] = useState([]);
  const [dragging, setDragging] = useState({
    cardId: null,
    pointerOffset: { dx: 0, dy: 0 },
    pointerId: null
  });
  const initializedRef = useRef(false);

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
    setCards(createCards(20, centerX, centerY));
    initializedRef.current = true;
  }, [cardSize.height, cardSize.width, tableRect?.height, tableRect?.width]);

  const bringToFront = useCallback((cardId) => {
    setCards((prev) => {
      const index = prev.findIndex((card) => card.id === cardId);
      if (index === -1 || index === prev.length - 1) {
        return prev;
      }

      const next = [...prev];
      const [card] = next.splice(index, 1);
      next.push(card);
      return next;
    });
  }, []);

  const startDrag = useCallback((cardId, pointerId, pointerOffset) => {
    bringToFront(cardId);
    setDragging({ cardId, pointerOffset, pointerId });
  }, [bringToFront]);

  const endDrag = useCallback(() => {
    setDragging({ cardId: null, pointerOffset: { dx: 0, dy: 0 }, pointerId: null });
  }, []);

  const updateCardPosition = useCallback((cardId, x, y) => {
    setCards((prev) =>
      prev.map((card) => (card.id === cardId ? { ...card, x, y } : card))
    );
  }, []);

  return {
    cards,
    dragging,
    startDrag,
    endDrag,
    updateCardPosition
  };
};
