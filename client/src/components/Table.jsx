import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card.jsx';
import { clampCardToTable } from '../utils/geometry.js';
import { useTableState } from '../state/useTableState.js';

const CARD_SIZE = { width: 72, height: 104 };
const SEATS = [
  { id: 1, label: 'Seat 1', side: 'top', offset: '33%' },
  { id: 2, label: 'Seat 2', side: 'top', offset: '67%' },
  { id: 3, label: 'Seat 3', side: 'right', offset: '33%' },
  { id: 4, label: 'Seat 4', side: 'right', offset: '67%' },
  { id: 5, label: 'Seat 5', side: 'bottom', offset: '33%' },
  { id: 6, label: 'Seat 6', side: 'bottom', offset: '67%' },
  { id: 7, label: 'Seat 7', side: 'left', offset: '33%' },
  { id: 8, label: 'Seat 8', side: 'left', offset: '67%' }
];

const Table = () => {
  const tableRef = useRef(null);
  const [tableRect, setTableRect] = useState({ width: 0, height: 0 });
  const { cardsById, stacks, setStacks, createStackId, resetTable } = useTableState(
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
  const [selectedStackId, setSelectedStackId] = useState(null);
  const [pickCountOpen, setPickCountOpen] = useState(false);
  const [pickCountValue, setPickCountValue] = useState('1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [occupiedSeats, setOccupiedSeats] = useState(() =>
    SEATS.reduce((acc, seat) => {
      acc[seat.id] = false;
      return acc;
    }, {})
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

  const getPointerOffset = useCallback(
    (event, stack) => {
      const table = tableRef.current;
      if (!table) {
        return { dx: 0, dy: 0 };
      }
      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      return { dx: pointerX - stack.x, dy: pointerY - stack.y };
    },
    []
  );

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

        let overlapId = null;
        for (let i = stacks.length - 1; i >= 0; i -= 1) {
          const stack = stacks[i];
          if (stack.id === dragging.stackId) {
            continue;
          }
          const overlaps =
            draggedX < stack.x + CARD_SIZE.width &&
            draggedX + CARD_SIZE.width > stack.x &&
            draggedY < stack.y + CARD_SIZE.height &&
            draggedY + CARD_SIZE.height > stack.y;
          if (overlaps) {
            overlapId = stack.id;
            break;
          }
        }

        if (overlapId) {
          setStacks((prev) => {
            const target = prev.find((stack) => stack.id === overlapId);
            const dragged = prev.find((stack) => stack.id === dragging.stackId);
            if (!target || !dragged) {
              return prev;
            }
            const merged = {
              ...target,
              faceUp: dragged.faceUp ?? target.faceUp,
              cardIds: [...target.cardIds, ...dragged.cardIds]
            };
            return prev
              .filter(
                (stack) =>
                  stack.id !== dragging.stackId && stack.id !== overlapId
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
    const handleKeyDown = (event) => {
      if (event.repeat) {
        return;
      }
      if (event.key !== 'Escape') {
        return;
      }
      setSelectedStackId(null);
      setPickCountOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  const handleStackPointerDown = useCallback(
    (event, stackIdOverride = null) => {
      if (dragging.active) {
        return;
      }
      const table = tableRef.current;
      if (!table) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const stackId = stackIdOverride ?? hitTestStack(pointerX, pointerY);
      if (!stackId) {
        return;
      }
      bringStackToFront(stackId);
      setSelectedStackId(stackId);
      setPickCountOpen(false);
    },
    [bringStackToFront, dragging.active, hitTestStack]
  );

  const handleSurfacePointerDown = useCallback(
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
      if (stackId) {
        handleStackPointerDown(event, stackId);
        return;
      }
      setSelectedStackId(null);
      setPickCountOpen(false);
    },
    [dragging.active, handleStackPointerDown, hitTestStack]
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

  const handleResetTable = useCallback(() => {
    resetTable();
  }, [resetTable]);

  const toggleSeat = useCallback((seatId) => {
    setOccupiedSeats((prev) => ({
      ...prev,
      [seatId]: !prev[seatId]
    }));
  }, []);

  const pickUpFromStack = useCallback(
    (event, stackId, requestedCount) => {
      event.preventDefault();
      const source = stacksById[stackId];
      if (!source) {
        return;
      }
      const clampedCount = Math.max(1, Math.min(requestedCount, source.cardIds.length));
      const newStackId = createStackId();
      let created = false;

      setStacks((prev) => {
        const current = prev.find((stack) => stack.id === stackId);
        if (!current) {
          return prev;
        }
        const safeCount = Math.max(1, Math.min(clampedCount, current.cardIds.length));
        const remainingCount = current.cardIds.length - safeCount;
        const remainingCardIds = current.cardIds.slice(0, remainingCount);
        const pickedCardIds = current.cardIds.slice(remainingCount);
        if (pickedCardIds.length === 0) {
          return prev;
        }
        created = true;
        const next = prev
          .map((item) =>
            item.id === stackId ? { ...item, cardIds: remainingCardIds } : item
          )
          .filter((item) => item.id !== stackId || item.cardIds.length > 0);
        next.push({
          id: newStackId,
          x: current.x,
          y: current.y,
          rotation: current.rotation,
          faceUp: current.faceUp,
          cardIds: pickedCardIds
        });
        return next;
      });

      if (!created) {
        return;
      }
      const offset = getPointerOffset(event, source);
      startDrag(newStackId, event.pointerId, offset, 'stack', stackId);
      setSelectedStackId(null);
      setPickCountOpen(false);
    },
    [createStackId, getPointerOffset, setStacks, stacksById, startDrag]
  );

  const handleFlipSelected = useCallback(() => {
    if (!selectedStackId) {
      return;
    }
    setStacks((prev) =>
      prev.map((stack) =>
        stack.id === selectedStackId ? { ...stack, faceUp: !stack.faceUp } : stack
      )
    );
  }, [selectedStackId, setStacks]);

  const selectedStack = selectedStackId ? stacksById[selectedStackId] : null;
  const menuBelow = selectedStack ? selectedStack.y < 140 : false;
  const menuPosition = selectedStack
    ? {
        left: selectedStack.x + CARD_SIZE.width / 2,
        top: menuBelow
          ? selectedStack.y + CARD_SIZE.height + 10
          : selectedStack.y - 10
      }
    : null;
  const menuStackCount = selectedStack ? selectedStack.cardIds.length : 0;

  return (
    <div className="table-frame">
      <div className="table__seats" aria-label="Table seats">
        {SEATS.map((seat) => {
          const occupied = occupiedSeats[seat.id];
          const seatStyle =
            seat.side === 'top' || seat.side === 'bottom'
              ? { left: seat.offset }
              : { top: seat.offset };
          return (
            <button
              key={seat.id}
              type="button"
              className={`seat seat--${seat.side} ${
                occupied ? 'seat--occupied' : ''
              }`}
              style={seatStyle}
              onClick={() => toggleSeat(seat.id)}
            >
              <span className="seat__label">
                {occupied ? 'You' : seat.label}
              </span>
            </button>
          );
        })}
      </div>
      <div
        ref={tableRef}
        className="table__surface"
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handlePointerMoveHover}
        onContextMenu={(event) => event.preventDefault()}
      >
        {stacks.map((stack, index) => {
          const topCardId = stack.cardIds[stack.cardIds.length - 1];
          const topCard = cardsById[topCardId];
          return (
            <Card
              key={stack.id}
              id={stack.id}
              x={stack.x}
              y={stack.y}
              rotation={stack.rotation}
              faceUp={stack.faceUp}
              zIndex={index + 1}
              rank={topCard?.rank}
              suit={topCard?.suit}
              isSelected={stack.id === selectedStackId}
              onPointerDown={handleStackPointerDown}
            />
          );
        })}
        {selectedStack && menuPosition ? (
          <div
            className={`stack-menu ${menuBelow ? 'stack-menu--below' : 'stack-menu--above'}`}
            style={menuPosition}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="stack-menu__button"
              onPointerDown={(event) =>
                pickUpFromStack(event, selectedStack.id, selectedStack.cardIds.length)
              }
            >
              Pick up full stack
            </button>
            <button
              type="button"
              className="stack-menu__button"
              onPointerDown={(event) => {
                const halfCount = Math.floor(selectedStack.cardIds.length / 2);
                if (halfCount < 1) {
                  return;
                }
                pickUpFromStack(event, selectedStack.id, halfCount);
              }}
            >
              Pick up half stack
            </button>
            <button
              type="button"
              className="stack-menu__button"
              onPointerDown={(event) => pickUpFromStack(event, selectedStack.id, 1)}
            >
              Pick up 1 card
            </button>
            <button
              type="button"
              className="stack-menu__button"
              onClick={() => {
                setPickCountOpen(true);
                setPickCountValue('1');
              }}
            >
              Pick up N cards...
            </button>
            {pickCountOpen ? (
              <div className="stack-menu__picker">
                <label className="stack-menu__label" htmlFor="pick-count-input">
                  Cards to pick up
                </label>
                <input
                  id="pick-count-input"
                  className="stack-menu__input"
                  type="number"
                  min="1"
                  max={menuStackCount}
                  value={pickCountValue}
                  onChange={(event) => setPickCountValue(event.target.value)}
                />
                <div className="stack-menu__actions">
                  <button
                    type="button"
                    className="stack-menu__button stack-menu__button--primary"
                    onPointerDown={(event) => {
                      const parsed = Number.parseInt(pickCountValue, 10);
                      const count = Number.isNaN(parsed) ? 1 : parsed;
                      pickUpFromStack(event, selectedStack.id, count);
                    }}
                  >
                    Pick up
                  </button>
                  <button
                    type="button"
                    className="stack-menu__button stack-menu__button--secondary"
                    onClick={() => setPickCountOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className="stack-menu__button"
              onClick={handleFlipSelected}
            >
              Flip
            </button>
          </div>
        ) : null}
        {hoverTooltip ? (
          <div className="stack-tooltip" style={hoverTooltip}>
            Stack: {hoveredCount}
          </div>
        ) : null}
      </div>
      <div className="table-settings">
        <button
          className="table-settings__toggle"
          type="button"
          onClick={() => setSettingsOpen((prev) => !prev)}
        >
          Table Settings
        </button>
        {settingsOpen ? (
          <div className="table-settings__panel">
            <button
              className="table-settings__button"
              type="button"
              onClick={handleResetTable}
            >
              Reset Table
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Table;
