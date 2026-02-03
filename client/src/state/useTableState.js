import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Phase 2 state: stacks + cardsById
 * - Initializes ONE stacked deck at center of table (when tableRect becomes known)
 * - cardsById: { [cardId]: { id, label } }
 * - stacks: [{ id, x, y, rotation, cardIds: [...] }]
 */
export function useTableState(tableRect, cardSize) {
  const [cardsById, setCardsById] = useState({});
  const [stacks, setStacks] = useState([]);
  const nextStackIdRef = useRef(1);
  const initializedRef = useRef(false);

  const createStackId = () => {
    const id = `s${nextStackIdRef.current}`;
    nextStackIdRef.current += 1;
    return id;
  };

  // Build initial cards (20 placeholder cards)
  const initialCards = useMemo(() => {
    const result = {};
    for (let i = 1; i <= 20; i += 1) {
      const id = `c${i}`;
      result[id] = { id, label: `Card ${i}` };
    }
    return result;
  }, []);

  // Initialize once when table has size
  useEffect(() => {
    if (initializedRef.current) return;
    if (!tableRect?.width || !tableRect?.height) return;

    initializedRef.current = true;

    // Set cardsById
    setCardsById(initialCards);

    // ONE stacked deck in center
    const x = Math.max(0, Math.round(tableRect.width / 2 - cardSize.width / 2));
    const y = Math.max(0, Math.round(tableRect.height / 2 - cardSize.height / 2));

    const deckStack = {
      id: createStackId(),
      x,
      y,
      rotation: 0,
      cardIds: Object.keys(initialCards) // bottom -> top order
    };

    setStacks([deckStack]);
  }, [tableRect?.width, tableRect?.height, cardSize.width, cardSize.height, initialCards]);

  const resetTable = () => {
    if (!tableRect?.width || !tableRect?.height) return;

    const x = Math.max(0, Math.round(tableRect.width / 2 - cardSize.width / 2));
    const y = Math.max(0, Math.round(tableRect.height / 2 - cardSize.height / 2));

    setStacks([
      {
        id: createStackId(),
        x,
        y,
        rotation: 0,
        cardIds: Object.keys(cardsById)
      }
    ]);
  };

  return {
    cardsById,
    stacks,
    setStacks,
    createStackId,
    resetTable
  };
}
