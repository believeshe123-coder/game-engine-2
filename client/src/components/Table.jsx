import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card.jsx';
import { clampCardToTable } from '../utils/geometry.js';
import { useTableState } from '../state/useTableState.js';

const CARD_SIZE = { width: 72, height: 104 };
const SNAP_DISTANCE = 35;

const Table = () => {
  const tableRef = useRef(null);
  const [tableRect, setTableRect] = useState({ width: 0, height: 0 });
  const { cardsById, stacks, setStacks, createStackId } = useTableState(
    tableRect,
    CARD_SIZE
  );
  const [dragging, setDragging] = useState({
    active: false,
    stackId: null,
    sourceStackId: null,
    pointerId: null,
    offset: { dx: 0, dy: 0 },
    mode: 'single'
  });
  const [hoveredStackId, setHoveredStackId] = useState(null);
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

  const stacksById = useMemo(() => {
    return stacks.reduce((acc, stack) => {
      acc[stack.id] = stack;
      return acc;
    }, {});
  }, [stacks]);

  const hitTestStack = useCallback((pointerX, pointerY) => {
    for (let i = stacks.length - 1; i >= 0; i -= 1) {
      const stack = stacks[i];
      if (
        pointerX >= stack.x &&
        pointerX <= stack.x + CARD_SIZE.width &&
        pointerY >= stack.y &&
        pointerY <= stack.y + CARD_SIZE.height
      ) {
        return stack.id;
      }
    }
    return null;
  }, [stacks]);

  const bringStackToFront = useCallback((stackId) => {
    setStacks((prev) => {
      const index = prev.findIndex((stack) => stack.id === stackId);
      if (index === -1 || index === prev.length - 1) {
        return prev;
      }
      const next = [...prev];
      const [stack] = next.splice(index, 1);
      next.push(stack);
      return next;
    });
  }, [setStacks]);

  const startDrag = useCallback((stackId, pointerId, offset, mode, sourceStackId = null) => {
    bringStackToFront(stackId);
    setDragging({
      active: true,
      stackId,
      sourceStackId,
      pointerId,
      offset,
      mode
    });
  }, [bringStackToFront]);

  const flushAnimation = useCallback(() => {
    if (!dragging.active || !dragging.stackId || !latestPoint.current) {
      rafRef.current = null;
      return;
    }

    setStacks((prev) =>
      prev.map((stack) =>
        stack.id === dragging.stackId
          ? { ...stack, x: latestPoint.current.x, y: latestPoint.current.y }
          : stack
      )
    );
    rafRef.current = null;
  }, [dragging.active, dragging.stackId, setStacks]);

  const handlePointerMove = useCallback(
    (event) => {
      if (!dragging.active || event.pointerId !== dragging.pointerId) {
        return;
      }

      const table = tableRef.current;
      if (!table) {
        return;
      }

      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      const nextX = pointerX - dragging.offset.dx;
      const nextY = pointerY - dragging.offset.dy;
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
      if (!dragging.active || event.pointerId !== dragging.pointerId) {
        return;
      }
      const table = tableRef.current;
      let finalPosition = null;
      if (table) {
        const rect = table.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const nextX = pointerX - dragging.offset.dx;
        const nextY = pointerY - dragging.offset.dy;
        finalPosition = clampCardToTable(
          nextX,
          nextY,
          CARD_SIZE.width,
          CARD_SIZE.height,
          tableRect.width,
          tableRect.height
        );
      }

      const draggedStack = stacksById[dragging.stackId];
      if (draggedStack) {
        const draggedX = finalPosition?.x ?? draggedStack?.x;
        const draggedY = finalPosition?.y ?? draggedStack?.y;

        let closestId = null;
        let closestDistance = Infinity;

        stacks.forEach((stack) => {
          if (stack.id === dragging.stackId) {
            return;
          }
          const dx = stack.x - draggedX;
          const dy = stack.y - draggedY;
          const distance = Math.hypot(dx, dy);
          if (distance < closestDistance && distance <= SNAP_DISTANCE) {
            closestDistance = distance;
            closestId = stack.id;
          }
        });

        if (closestId) {
          setStacks((prev) => {
            const target = prev.find((stack) => stack.id === closestId);
            const dragged = prev.find((stack) => stack.id === dragging.stackId);
            if (!target || !dragged) {
              return prev;
            }
            const merged = {
              ...target,
              cardIds: [...target.cardIds, ...dragged.cardIds]
            };
            return prev
              .filter(
                (stack) =>
                  stack.id !== dragging.stackId && stack.id !== closestId
              )
              .concat(merged);
          });
        } else if (finalPosition) {
          setStacks((prev) =>
            prev.map((stack) =>
              stack.id === dragging.stackId
                ? { ...stack, x: finalPosition.x, y: finalPosition.y }
                : stack
            )
          );
        }
      }

      setDragging({
        active: false,
        stackId: null,
        sourceStackId: null,
        pointerId: null,
        offset: { dx: 0, dy: 0 },
        mode: 'single'
      });
    },
    [dragging.active, dragging.pointerId, dragging.stackId, setStacks, stacks, stacksById]
  );

  useEffect(() => {
    if (!dragging.active) {
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
  }, [dragging.active, handlePointerMove, handlePointerUp]);

  const handlePointerDown = useCallback(
    (event, stackIdOverride = null) => {
      const table = tableRef.current;
      if (!table) {
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
      }
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const stackId = stackIdOverride ?? hitTestStack(pointerX, pointerY);
      if (!stackId) {
        return;
      }
      const stack = stacksById[stackId];
      if (!stack) {
        return;
      }

      const offset = { dx: pointerX - stack.x, dy: pointerY - stack.y };
      event.currentTarget.setPointerCapture(event.pointerId);

      if (event.button === 2) {
        startDrag(stackId, event.pointerId, offset, 'stack');
        return;
      }

      if (stack.cardIds.length <= 1) {
        startDrag(stackId, event.pointerId, offset, 'single');
        return;
      }

      const topCardId = stack.cardIds[stack.cardIds.length - 1];
      const newStackId = createStackId();
      setStacks((prev) => {
        const next = prev
          .map((item) =>
            item.id === stackId
              ? { ...item, cardIds: item.cardIds.slice(0, -1) }
              : item
          )
          .filter((item) => item.id !== stackId || item.cardIds.length > 0);
        next.push({
          id: newStackId,
          x: stack.x,
          y: stack.y,
          rotation: 0,
          cardIds: [topCardId]
        });
        return next;
      });
      startDrag(newStackId, event.pointerId, offset, 'single', stackId);
    },
    [createStackId, hitTestStack, setStacks, stacksById, startDrag]
  );

  const handlePointerMoveHover = useCallback(
    (event) => {
      if (dragging.active) {
        return;
      }
      const table = tableRef.current;
      if (!table) {
        return;
      }
      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const stackId = hitTestStack(pointerX, pointerY);
      setHoveredStackId(stackId);
    },
    [dragging.active, hitTestStack]
  );

  const hoveredStack = hoveredStackId ? stacksById[hoveredStackId] : null;
  const hoveredCount = hoveredStack ? hoveredStack.cardIds.length : 0;
  const hoverTooltip =
    hoveredStack && hoveredCount >= 2
      ? {
          left: hoveredStack.x + CARD_SIZE.width + 8,
          top: hoveredStack.y - 8
        }
      : null;

  return (
    <div className="table">
      <div
        ref={tableRef}
        className="table__surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMoveHover}
        onContextMenu={(event) => event.preventDefault()}
      >
        {stacks.map((stack, index) => {
          const topCardId = stack.cardIds[stack.cardIds.length - 1];
          const card = cardsById[topCardId];
          return (
            <Card
              key={stack.id}
              id={stack.id}
              label={card?.label ?? 'Card'}
              x={stack.x}
              y={stack.y}
              rotation={stack.rotation}
              zIndex={index + 1}
              onPointerDown={handlePointerDown}
            />
          );
        })}
        {hoverTooltip ? (
          <div className="stack-tooltip" style={hoverTooltip}>
            Stack: {hoveredCount}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Table;
