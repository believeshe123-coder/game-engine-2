import { useCallback, useEffect, useRef, useState } from 'react';
import Card from './Card.jsx';
import { clampCardToTable } from '../utils/geometry.js';
import { useTableState } from '../state/useTableState.js';

const CARD_SIZE = { width: 72, height: 104 };

const Table = () => {
  const tableRef = useRef(null);
  const [tableRect, setTableRect] = useState({ width: 0, height: 0 });
  const { cards, dragging, startDrag, endDrag, updateCardPosition } = useTableState(
    tableRect,
    CARD_SIZE
  );
  const rafRef = useRef(null);
  const latestPoint = useRef(null);

  useEffect(() => {
    if (!tableRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect) {
        setTableRect({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, []);

  const handlePointerDown = useCallback(
    (cardId, event) => {
      const table = tableRef.current;
      if (!table) {
        return;
      }

      const card = cards.find((item) => item.id === cardId);
      if (!card) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const dx = pointerX - card.x;
      const dy = pointerY - card.y;

      startDrag(cardId, event.pointerId, { dx, dy });
    },
    [cards, startDrag]
  );

  const flushAnimation = useCallback(() => {
    if (!dragging.cardId || !latestPoint.current) {
      rafRef.current = null;
      return;
    }

    updateCardPosition(dragging.cardId, latestPoint.current.x, latestPoint.current.y);
    rafRef.current = null;
  }, [dragging.cardId, updateCardPosition]);

  const handlePointerMove = useCallback(
    (event) => {
      if (!dragging.cardId || event.pointerId !== dragging.pointerId) {
        return;
      }

      const table = tableRef.current;
      if (!table) {
        return;
      }

      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      const nextX = pointerX - dragging.pointerOffset.dx;
      const nextY = pointerY - dragging.pointerOffset.dy;
      const clamped = clampCardToTable(
        nextX,
        nextY,
        CARD_SIZE.width,
        CARD_SIZE.height,
        tableRect.width,
        tableRect.height
      );

      latestPoint.current = clamped;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flushAnimation);
      }
    },
    [dragging, flushAnimation, tableRect.height, tableRect.width]
  );

  const handlePointerUp = useCallback(
    (event) => {
      if (event.pointerId !== dragging.pointerId) {
        return;
      }

      endDrag();
    },
    [dragging.pointerId, endDrag]
  );

  useEffect(() => {
    if (!dragging.cardId) {
      latestPoint.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return undefined;
    }

    const handleWindowPointerUp = (event) => handlePointerUp(event);
    const handleWindowPointerMove = (event) => handlePointerMove(event);

    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointermove', handleWindowPointerMove);

    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointermove', handleWindowPointerMove);
    };
  }, [dragging.cardId, handlePointerMove, handlePointerUp]);

  return (
    <div className="table">
      <div ref={tableRef} className="table__surface">
        {cards.map((card, index) => (
          <Card
            key={card.id}
            id={card.id}
            label={card.label}
            x={card.x}
            y={card.y}
            rotation={card.rotation}
            zIndex={index + 1}
            onPointerDown={handlePointerDown}
          />
        ))}
      </div>
    </div>
  );
};

export default Table;
