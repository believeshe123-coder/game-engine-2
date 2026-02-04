import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card.jsx';
import { clampCardToTable } from '../utils/geometry.js';
import { useTableState } from '../state/useTableState.js';
import { loadSettings, saveSettings } from '../state/tableSettings.js';

const CARD_SCALE = 0.8;
const BASE_CARD_SIZE = { width: 72, height: 104 };
const CARD_SIZE = {
  width: BASE_CARD_SIZE.width * CARD_SCALE,
  height: BASE_CARD_SIZE.height * CARD_SCALE
};
const SEAT_SIZE = { width: 120, height: 48 };
const SEAT_PADDING = 24;

const Table = () => {
  const tableFrameRef = useRef(null);
  const tableRef = useRef(null);
  const [tableRect, setTableRect] = useState({ width: 0, height: 0 });
  const [tableFrameRect, setTableFrameRect] = useState({ width: 0, height: 0 });
  const pendingDragRef = useRef(null);
  const [settings, setSettings] = useState(() => loadSettings());
  const [appliedSettings, setAppliedSettings] = useState(() => loadSettings());
  const {
    cardsById,
    stacks,
    setStacks,
    createStackId,
    rebuildTableFromSettings
  } = useTableState(
    tableRect,
    CARD_SIZE,
    appliedSettings
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
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [occupiedSeats, setOccupiedSeats] = useState(() => {
    const initialCount = settings.roomSettings?.seatCount ?? 8;
    return Array.from({ length: initialCount }, (_, index) => index + 1).reduce(
      (acc, seatId) => {
        acc[seatId] = false;
        return acc;
      },
      {}
    );
  });
  const rafRef = useRef(null);
  const latestPoint = useRef(null);
  const DRAG_THRESHOLD = 8;

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const seatCount = settings.roomSettings.seatCount;
  const tableStyle = settings.roomSettings.tableStyle;
  // Table shape is visual-only for now; clamp logic remains rectangular.
  const tableShape = settings.roomSettings.tableShape;

  useEffect(() => {
    setOccupiedSeats((prev) => {
      const next = {};
      for (let seatId = 1; seatId <= seatCount; seatId += 1) {
        next[seatId] = prev[seatId] ?? false;
      }
      return next;
    });
  }, [seatCount]);

  const seats = useMemo(() => {
    const count = Math.max(2, seatCount);
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      return {
        id: index + 1,
        label: `Seat ${index + 1}`,
        angle
      };
    });
  }, [seatCount]);

  const seatPositions = useMemo(() => {
    const count = seats.length;
    if (!tableFrameRect.width || !tableFrameRect.height) {
      return seats.map((seat) => ({ ...seat, x: 0, y: 0 }));
    }
    const tableCenterX = tableFrameRect.width / 2;
    const tableCenterY = tableFrameRect.height / 2;
    const ringRx =
      tableFrameRect.width / 2 + SEAT_SIZE.width / 2 + SEAT_PADDING;
    const ringRy =
      tableFrameRect.height / 2 + SEAT_SIZE.height / 2 + SEAT_PADDING;
    return seats.map((seat) => ({
      ...seat,
      x: tableCenterX + Math.cos(seat.angle) * ringRx,
      y: tableCenterY + Math.sin(seat.angle) * ringRy
    }));
  }, [seats, tableFrameRect.height, tableFrameRect.width, tableShape]);

  useEffect(() => {
    if (!tableRef.current || !tableFrameRef.current) {
      return;
    }

    const tableObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect) {
        setTableRect({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    const frameObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect) {
        setTableFrameRect({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    tableObserver.observe(tableRef.current);
    frameObserver.observe(tableFrameRef.current);
    return () => {
      tableObserver.disconnect();
      frameObserver.disconnect();
    };
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

  const dealOneFromHeld = useCallback(
    (pointerX, pointerY) => {
      if (!heldStack.active || !heldStack.stackId) {
        return;
      }
      if (heldStack.cardIds.length === 0) {
        setHeldStack({
          active: false,
          stackId: null,
          cardIds: [],
          sourceStackId: null,
          offset: { dx: 0, dy: 0 },
          origin: null,
          mode: 'stack'
        });
        return;
      }

      const placement = getHeldAnchorPosition(pointerX, pointerY);
      const newStackId = createStackId();
      let removedCardId = null;
      let remainingCardIds = [];

      setStacks((prev) => {
        const currentHeld = prev.find((stack) => stack.id === heldStack.stackId);
        if (!currentHeld || currentHeld.cardIds.length === 0) {
          return prev;
        }
        const nextCardIds = [...currentHeld.cardIds];
        removedCardId = nextCardIds.pop() ?? null;
        remainingCardIds = nextCardIds;
        if (!removedCardId) {
          return prev;
        }

        const newStack = {
          id: newStackId,
          x: placement?.x ?? currentHeld.x,
          y: placement?.y ?? currentHeld.y,
          rotation: currentHeld.rotation,
          faceUp: currentHeld.faceUp,
          cardIds: [removedCardId]
        };

        let next = prev
          .map((stack) =>
            stack.id === heldStack.stackId ? { ...stack, cardIds: nextCardIds } : stack
          )
          .filter((stack) => stack.id !== heldStack.stackId || nextCardIds.length > 0)
          .concat(newStack);

        let overlapId = null;
        for (let i = next.length - 1; i >= 0; i -= 1) {
          const stack = next[i];
          if (stack.id === newStackId || stack.id === heldStack.stackId) {
            continue;
          }
          const overlaps =
            newStack.x < stack.x + CARD_SIZE.width &&
            newStack.x + CARD_SIZE.width > stack.x &&
            newStack.y < stack.y + CARD_SIZE.height &&
            newStack.y + CARD_SIZE.height > stack.y;
          if (overlaps) {
            overlapId = stack.id;
            break;
          }
        }

        if (overlapId) {
          const target = next.find((stack) => stack.id === overlapId);
          const dealt = next.find((stack) => stack.id === newStackId);
          if (!target || !dealt) {
            return next;
          }
          const merged = {
            ...target,
            faceUp: dealt.faceUp ?? target.faceUp,
            cardIds: [...target.cardIds, ...dealt.cardIds]
          };
          next = next
            .filter((stack) => stack.id !== overlapId && stack.id !== newStackId)
            .concat(merged);
        }

        return next;
      });

      if (!removedCardId) {
        return;
      }

      if (remainingCardIds.length === 0) {
        setHeldStack({
          active: false,
          stackId: null,
          cardIds: [],
          sourceStackId: null,
          offset: { dx: 0, dy: 0 },
          origin: null,
          mode: 'stack'
        });
        latestPoint.current = null;
      } else {
        setHeldStack((prev) => ({
          ...prev,
          cardIds: remainingCardIds
        }));
      }
    },
    [createStackId, getHeldAnchorPosition, heldStack, setStacks]
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

      if (event.button === 2) {
        if (heldStack.active) {
          event.preventDefault();
          event.stopPropagation();
          const rect = table.getBoundingClientRect();
          const pointerX = event.clientX - rect.left;
          const pointerY = event.clientY - rect.top;
          dealOneFromHeld(pointerX, pointerY);
        }
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
    [dealOneFromHeld, heldStack.active, hitTestStack, placeHeldStack]
  );

  const handleSurfacePointerDown = useCallback(
    (event) => {
      const table = tableRef.current;
      if (!table) {
        return;
      }
      if (event.button === 2) {
        if (heldStack.active) {
          event.preventDefault();
          event.stopPropagation();
          const rect = table.getBoundingClientRect();
          const pointerX = event.clientX - rect.left;
          const pointerY = event.clientY - rect.top;
          dealOneFromHeld(pointerX, pointerY);
        }
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
    [dealOneFromHeld, handleStackPointerDown, heldStack.active, hitTestStack, placeHeldStack]
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

  const badgeOffset = 24;
  const visibleBadgeStackId =
    settings.stackCountDisplayMode === 'hover' ? hoveredStackId : null;

  const resetInteractionStates = useCallback(() => {
    setHeldStack({
      active: false,
      stackId: null,
      cardIds: [],
      sourceStackId: null,
      offset: { dx: 0, dy: 0 },
      origin: null,
      mode: 'stack'
    });
    setSelectedStackId(null);
    setHoveredStackId(null);
    setPickCountOpen(false);
    setPickCountValue('1');
  }, []);

  const applySettings = useCallback(() => {
    setAppliedSettings(settings);
    rebuildTableFromSettings(settings);
    resetInteractionStates();
  }, [rebuildTableFromSettings, resetInteractionStates, settings]);

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
    <div
      ref={tableFrameRef}
      className={`table-frame table-frame--${tableStyle} table-frame--${tableShape}`}
      style={{ '--card-scale': CARD_SCALE }}
    >
      <div className="table__seats" aria-label="Table seats">
        {seatPositions.map((seat) => {
          const occupied = occupiedSeats[seat.id];
          const seatStyle = {
            left: `${seat.x}px`,
            top: `${seat.y}px`
          };
          return (
            <button
              key={seat.id}
              type="button"
              className={`seat ${occupied ? 'seat--occupied' : ''}`}
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
      <div className="table__surface-wrapper">
        <div
          ref={tableRef}
          className={`table__surface table__surface--${tableStyle} table__surface--${tableShape}`}
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handlePointerMoveHover}
          onContextMenu={(event) => {
            if (heldStack.active) {
              event.preventDefault();
            }
          }}
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
                cardStyle={appliedSettings.cardStyle}
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
        </div>
        <div id="stackLabelLayer" className="stack-label-layer" aria-hidden="true">
          {stacks.map((stack) => {
            if (stack.cardIds.length <= 1) {
              return null;
            }
            const showBadge =
              settings.stackCountDisplayMode === 'always' ||
              (settings.stackCountDisplayMode === 'hover' &&
                stack.id === visibleBadgeStackId);
            if (!showBadge) {
              return null;
            }
            return (
              <div
                key={stack.id}
                className="stackCountBadge"
                style={{
                  left: stack.x + CARD_SIZE.width / 2,
                  top: stack.y - badgeOffset
                }}
              >
                Stack: {stack.cardIds.length}
              </div>
            );
          })}
        </div>
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
            <div className="table-settings__row">
              <span className="table-settings__label">Reset spawns face down</span>
              <label className="table-settings__switch">
                <input
                  type="checkbox"
                  checked={settings.resetFaceDown}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      resetFaceDown: event.target.checked
                    }))
                  }
                />
                <span>Reset Face-Down</span>
              </label>
            </div>
            <label className="table-settings__row">
              <span className="table-settings__label">Card Style</span>
              <select
                className="table-settings__select"
                value={settings.cardStyle}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    cardStyle: event.target.value
                  }))
                }
              >
                <option value="medieval">Medieval</option>
                <option value="classic">Classic</option>
              </select>
            </label>
            <div className="table-settings__row">
              <span className="table-settings__label">Include Jokers</span>
              <label className="table-settings__switch">
                <input
                  type="checkbox"
                  checked={settings.includeJokers}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      includeJokers: event.target.checked
                    }))
                  }
                />
                <span>Include Jokers</span>
              </label>
            </div>
            <label className="table-settings__row">
              <span className="table-settings__label">Deck Count</span>
              <input
                className="table-settings__input"
                type="number"
                min="1"
                max="8"
                value={settings.deckCount}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    deckCount: (() => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      if (Number.isNaN(parsed)) {
                        return 1;
                      }
                      return Math.min(8, Math.max(1, parsed));
                    })()
                  }))
                }
              />
            </label>
            <label className="table-settings__row">
              <span className="table-settings__label">Preset Layout</span>
              <select
                className="table-settings__select"
                value={settings.presetLayout}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    presetLayout: event.target.value
                  }))
                }
              >
                <option value="none">None</option>
                <option value="solitaire">Solitaire</option>
                <option value="grid">Test: Face-Up Grid</option>
              </select>
            </label>
            <button
              className="table-settings__button table-settings__button--secondary"
              type="button"
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  presetLayout: 'none'
                }))
              }
            >
              Reset Preset Settings
            </button>
            <label className="table-settings__row">
              <span className="table-settings__label">Stack Count Display</span>
              <select
                className="table-settings__select"
                value={settings.stackCountDisplayMode}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    stackCountDisplayMode: event.target.value
                  }))
                }
              >
                <option value="always">Always On</option>
                <option value="hover">Hover Only</option>
              </select>
            </label>
            <button
              className="table-settings__button"
              type="button"
              onClick={applySettings}
            >
              Reload With Changes
            </button>
            <button
              className="table-settings__button"
              type="button"
              onClick={applySettings}
            >
              Reset Table
            </button>
          </div>
        ) : null}
        <button
          className="table-settings__toggle"
          type="button"
          onClick={() => setRoomSettingsOpen((prev) => !prev)}
        >
          Room Settings
        </button>
        {roomSettingsOpen ? (
          <div className="table-settings__panel">
            <label className="table-settings__row">
              <span className="table-settings__label">Table Style</span>
              <select
                className="table-settings__select"
                value={settings.roomSettings.tableStyle}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    roomSettings: {
                      ...prev.roomSettings,
                      tableStyle: event.target.value
                    }
                  }))
                }
              >
                <option value="medieval">Medieval</option>
                <option value="plain">Plain</option>
              </select>
            </label>
            <label className="table-settings__row">
              <span className="table-settings__label">Table Shape</span>
              <select
                className="table-settings__select"
                value={settings.roomSettings.tableShape}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    roomSettings: {
                      ...prev.roomSettings,
                      tableShape: event.target.value
                    }
                  }))
                }
              >
                <option value="rectangle">Rectangle</option>
                <option value="oval">Oval</option>
              </select>
            </label>
            <label className="table-settings__row">
              <span className="table-settings__label"># of Seats</span>
              <input
                className="table-settings__input"
                type="number"
                min="2"
                max="12"
                value={settings.roomSettings.seatCount}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    roomSettings: {
                      ...prev.roomSettings,
                      seatCount: (() => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        if (Number.isNaN(parsed)) {
                          return 2;
                        }
                        return Math.min(12, Math.max(2, parsed));
                      })()
                    }
                  }))
                }
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Table;
