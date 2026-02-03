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
  const pendingDragRef = useRef(null);
  const { cardsById, stacks, setStacks, createStackId, resetTable } = useTableState(
    tableRect,
    CARD_SIZE
  );
  const [heldStack, setHeldStack] = useState({
    active: false,
    stackId: null,
    cardIds: [],
    sourceStackId: null,
    offset: { dx: 0, dy: 0 },
    origin: null,
    mode: 'stack'
  });
  const [hoveredStackId, setHoveredStackId] = useState(null);
  const [selectedStackId, setSelectedStackId] = useState(null);
  const [pendingDragActive, setPendingDragActive] = useState(false);
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
  const DRAG_THRESHOLD = 8;

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

  const getHeldAnchorPosition = useCallback(
    (pointerX, pointerY) => {
      const nextX = pointerX - CARD_SIZE.width / 2;
      const nextY = pointerY - CARD_SIZE.height / 2;
      const table = tableRef.current;
      const rect = table?.getBoundingClientRect();
      const boundsWidth = tableRect.width || rect?.width || 0;
      const boundsHeight = tableRect.height || rect?.height || 0;
      return clampCardToTable(
        nextX,
        nextY,
        CARD_SIZE.width,
        CARD_SIZE.height,
        boundsWidth,
        boundsHeight
      );
    },
    [tableRect.height, tableRect.width]
  );

  const flushAnimation = useCallback(() => {
    if (!heldStack.active || !heldStack.stackId || !latestPoint.current) {
      rafRef.current = null;
      return;
    }

    setStacks((prev) =>
      prev.map((stack) =>
        stack.id === heldStack.stackId
          ? { ...stack, x: latestPoint.current.x, y: latestPoint.current.y }
          : stack
      )
    );
    rafRef.current = null;
  }, [heldStack.active, heldStack.stackId, setStacks]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.repeat) {
        return;
      }
      if (event.key !== 'Escape') {
        return;
      }
      if (heldStack.active && heldStack.stackId && heldStack.origin) {
        setStacks((prev) =>
          prev.map((stack) =>
            stack.id === heldStack.stackId
              ? { ...stack, x: heldStack.origin.x, y: heldStack.origin.y }
              : stack
          )
        );
        setHeldStack({
          active: false,
          stackId: null,
          cardIds: [],
          sourceStackId: null,
          offset: { dx: 0, dy: 0 },
          origin: null,
          mode: 'stack'
        });
      }
      setSelectedStackId(null);
      setPickCountOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [heldStack.active, heldStack.origin, heldStack.stackId, setStacks]);

  useEffect(() => {
    if (!heldStack.active) {
      latestPoint.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return undefined;
    }

    const handleWindowPointerMove = (event) => {
      const table = tableRef.current;
      if (!table) {
        return;
      }
      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const clamped = getHeldAnchorPosition(pointerX, pointerY);

      latestPoint.current = clamped;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flushAnimation);
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
    };
  }, [
    flushAnimation,
    getHeldAnchorPosition,
    heldStack.active
  ]);

  const placeHeldStack = useCallback(
    (pointerX, pointerY) => {
      if (!heldStack.active || !heldStack.stackId) {
        return;
      }
      const finalPosition = getHeldAnchorPosition(pointerX, pointerY);

      const draggedStack = stacksById[heldStack.stackId];
      if (draggedStack) {
        const draggedX = finalPosition?.x ?? draggedStack?.x;
        const draggedY = finalPosition?.y ?? draggedStack?.y;

        let overlapId = null;
        for (let i = stacks.length - 1; i >= 0; i -= 1) {
          const stack = stacks[i];
          if (stack.id === heldStack.stackId) {
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
            const dragged = prev.find((stack) => stack.id === heldStack.stackId);
            if (!target || !dragged) {
              return prev;
            }
            const merged = {
              ...target,
              faceUp: dragged.faceUp ?? target.faceUp,
              cardIds: [...target.cardIds, ...dragged.cardIds]
            };
            return prev
              .filter((stack) => stack.id !== heldStack.stackId && stack.id !== overlapId)
              .concat(merged);
          });
        } else if (finalPosition) {
          setStacks((prev) =>
            prev.map((stack) =>
              stack.id === heldStack.stackId
                ? { ...stack, x: finalPosition.x, y: finalPosition.y }
                : stack
            )
          );
        }
      }

      setHeldStack({
        active: false,
        stackId: null,
        cardIds: [],
        sourceStackId: null,
        offset: { dx: 0, dy: 0 },
        origin: null,
        mode: 'stack'
      });
    },
    [getHeldAnchorPosition, heldStack, setStacks, stacks, stacksById]
  );

  const startHeldFullStack = useCallback(
    (stackId, pointerX, pointerY) => {
      const stack = stacksById[stackId];
      if (!stack) {
        return;
      }
      const heldPosition = getHeldAnchorPosition(pointerX, pointerY);
      latestPoint.current = heldPosition;
      setStacks((prev) =>
        prev.map((item) =>
          item.id === stackId
            ? { ...item, x: heldPosition.x, y: heldPosition.y }
            : item
        )
      );
      setHeldStack({
        active: true,
        stackId,
        cardIds: stack.cardIds,
        sourceStackId: stackId,
        offset: { dx: 0, dy: 0 },
        origin: { x: stack.x, y: stack.y },
        mode: 'stack'
      });
    },
    [getHeldAnchorPosition, setStacks, stacksById]
  );

  useEffect(() => {
    if (!pendingDragActive) {
      return undefined;
    }

    const handlePendingPointerMove = (event) => {
      const pending = pendingDragRef.current;
      if (!pending) {
        return;
      }
      const table = tableRef.current;
      if (!table) {
        return;
      }
      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const deltaX = pointerX - pending.startX;
      const deltaY = pointerY - pending.startY;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < DRAG_THRESHOLD) {
        return;
      }
      pendingDragRef.current = null;
      setPendingDragActive(false);
      setSelectedStackId(null);
      setPickCountOpen(false);
      bringStackToFront(pending.stackId);
      startHeldFullStack(pending.stackId, pointerX, pointerY);
    };

    const handlePendingPointerUp = () => {
      const pending = pendingDragRef.current;
      if (!pending) {
        return;
      }
      pendingDragRef.current = null;
      setPendingDragActive(false);
      bringStackToFront(pending.stackId);
      setSelectedStackId(pending.stackId);
      setPickCountOpen(false);
    };

    window.addEventListener('pointermove', handlePendingPointerMove);
    window.addEventListener('pointerup', handlePendingPointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePendingPointerMove);
      window.removeEventListener('pointerup', handlePendingPointerUp);
    };
  }, [bringStackToFront, pendingDragActive, startHeldFullStack]);

  const handleStackPointerDown = useCallback(
    (event, stackIdOverride = null) => {
      const table = tableRef.current;
      if (!table) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      if (heldStack.active) {
        placeHeldStack(pointerX, pointerY);
        setSelectedStackId(null);
        setPickCountOpen(false);
        return;
      }
      const stackId = stackIdOverride ?? hitTestStack(pointerX, pointerY);
      if (!stackId) {
        return;
      }
      pendingDragRef.current = { stackId, startX: pointerX, startY: pointerY };
      setPendingDragActive(true);
    },
    [heldStack.active, hitTestStack, placeHeldStack]
  );

  const handleSurfacePointerDown = useCallback(
    (event) => {
      const table = tableRef.current;
      if (!table) {
        return;
      }
      const rect = table.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      if (heldStack.active) {
        placeHeldStack(pointerX, pointerY);
        setSelectedStackId(null);
        setPickCountOpen(false);
        return;
      }
      const stackId = hitTestStack(pointerX, pointerY);
      if (stackId) {
        handleStackPointerDown(event, stackId);
        return;
      }
      setSelectedStackId(null);
      setPickCountOpen(false);
    },
    [handleStackPointerDown, heldStack.active, hitTestStack, placeHeldStack]
  );

  const handlePointerMoveHover = useCallback(
    (event) => {
      if (heldStack.active) {
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
    [heldStack.active, hitTestStack]
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

  const handleShuffleSelected = useCallback(() => {
    if (!selectedStackId) {
      return;
    }
    setStacks((prev) =>
      prev.map((stack) => {
        if (stack.id !== selectedStackId) {
          return stack;
        }
        const nextCardIds = [...stack.cardIds];
        for (let i = nextCardIds.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [nextCardIds[i], nextCardIds[j]] = [nextCardIds[j], nextCardIds[i]];
        }
        return { ...stack, cardIds: nextCardIds };
      })
    );
  }, [selectedStackId, setStacks]);

  const pickUpFromStack = useCallback(
    (event, stackId, requestedCount) => {
      event.preventDefault();
      const source = stacksById[stackId];
      if (!source) {
        return;
      }
      const clampedCount = Math.max(1, Math.min(requestedCount, source.cardIds.length));
      const newStackId = createStackId();
      let pickedCardIds = [];
      let origin = null;
      let heldPosition = null;
      const table = tableRef.current;
      if (table) {
        const rect = table.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        heldPosition = getHeldAnchorPosition(pointerX, pointerY);
      }

      setStacks((prev) => {
        const current = prev.find((stack) => stack.id === stackId);
        if (!current) {
          return prev;
        }
        const safeCount = Math.max(1, Math.min(clampedCount, current.cardIds.length));
        const remainingCount = current.cardIds.length - safeCount;
        const remainingCardIds = current.cardIds.slice(0, remainingCount);
        pickedCardIds = current.cardIds.slice(remainingCount);
        if (pickedCardIds.length === 0) {
          return prev;
        }
        origin = { x: current.x, y: current.y };
        const next = prev
          .map((item) =>
            item.id === stackId ? { ...item, cardIds: remainingCardIds } : item
          )
          .filter((item) => item.id !== stackId || item.cardIds.length > 0);
        next.push({
          id: newStackId,
          x: heldPosition?.x ?? current.x,
          y: heldPosition?.y ?? current.y,
          rotation: current.rotation,
          faceUp: current.faceUp,
          cardIds: pickedCardIds
        });
        return next;
      });

      if (pickedCardIds.length === 0) {
        return;
      }
      setHeldStack({
        active: true,
        stackId: newStackId,
        cardIds: pickedCardIds,
        sourceStackId: stackId,
        offset: { dx: 0, dy: 0 },
        origin,
        mode: 'stack'
      });
      setSelectedStackId(null);
      setPickCountOpen(false);
    },
    [createStackId, getHeldAnchorPosition, setStacks, stacksById]
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
          const isHeld = heldStack.active && stack.id === heldStack.stackId;
          const zIndex = isHeld ? stacks.length + 20 : index + 1;
          return (
            <Card
              key={stack.id}
              id={stack.id}
              x={stack.x}
              y={stack.y}
              rotation={stack.rotation}
              faceUp={stack.faceUp}
              zIndex={zIndex}
              rank={topCard?.rank}
              suit={topCard?.suit}
              color={topCard?.color}
              isHeld={isHeld}
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
            <button
              type="button"
              className="stack-menu__button"
              onClick={handleShuffleSelected}
            >
              Shuffle
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
