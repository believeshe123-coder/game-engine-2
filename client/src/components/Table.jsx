import { useCallback, useEffect, useMemo, useRef, useState } from 'react'; 
import Card from './Card.jsx';
import { clampCardToTable } from '../utils/geometry.js';
import { useTableState } from '../state/useTableState.js';

const CARD_SIZE = { width: 72, height: 104 };
const SNAP_DISTANCE = 35;

const Table = () => {
  const tableRef = useRef(null);
  const [tableRect, setTableRect] = useState({ width: 0, height: 0 });

  // Phase 2 state (STACKS)
  const { cardsById, stacks, setStacks, createStackId, resetTable } = useTableState(
    tableRect,
    CARD_SIZE
  );

  const [dragging, setDragging] = useState({
    active: false,
    stackId: null,
    pointerId: null,
    offset: { dx: 0, dy: 0 },
    mode: 'single' // 'single' | 'stack'
  });

  const [hoveredStackId, setHoveredStackId] = useState(null);
  const rafRef = useRef(null);
  const latestPoint = useRef(null);

  // Track table size
  useEffect(() => {
    if (!tableRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry?.contentRect) return;
      setTableRect({
        width: entry.contentRect.width,
        height: entry.contentRect.height
      });
    });

    observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, []);

  // Fast lookup
  const stacksById = useMemo(() => {
    const map = {};
    for (const s of stacks) map[s.id] = s;
    return map;
  }, [stacks]);

  // Topmost stack hit test
  const hitTestStack = useCallback(
    (px, py) => {
      for (let i = stacks.length - 1; i >= 0; i -= 1) {
        const s = stacks[i];
        if (
          px >= s.x &&
          px <= s.x + CARD_SIZE.width &&
          py >= s.y &&
          py <= s.y + CARD_SIZE.height
        ) {
          return s.id;
        }
      }
      return null;
    },
    [stacks]
  );

  // Bring dragged stack to top (end of array)
  const bringStackToFront = useCallback(
    (stackId) => {
      setStacks((prev) => {
        const idx = prev.findIndex((s) => s.id === stackId);
        if (idx === -1 || idx === prev.length - 1) return prev;
        const next = [...prev];
        const [picked] = next.splice(idx, 1);
        next.push(picked);
        return next;
      });
    },
    [setStacks]
  );

  // RAF flush to avoid spammy updates
  const flushAnimation = useCallback(() => {
    if (!dragging.active || !dragging.stackId || !latestPoint.current) {
      rafRef.current = null;
      return;
    }

    const { x, y } = latestPoint.current;
    setStacks((prev) =>
      prev.map((s) => (s.id === dragging.stackId ? { ...s, x, y } : s))
    );
    rafRef.current = null;
  }, [dragging.active, dragging.stackId, setStacks]);

  // Pointer down (left=top card, right=full stack)
  const handlePointerDown = useCallback(
    (event) => {
      const table = tableRef.current;
      if (!table) return;

      // right click: prevent context menu
      if (event.button === 2) event.preventDefault();
      if (event.button !== 0 && event.button !== 2) return;

      const rect = table.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;

      const targetStackId = hitTestStack(px, py);
      if (!targetStackId) return;

      const stack = stacksById[targetStackId];
      if (!stack) return;

      const offset = { dx: px - stack.x, dy: py - stack.y };

      // capture pointer at surface
      event.currentTarget.setPointerCapture(event.pointerId);

      // Always bring the interacted stack to top (or the new split stack)
      bringStackToFront(targetStackId);

      // Right click => drag full stack
      if (event.button === 2) {
        setDragging({
          active: true,
          stackId: targetStackId,
          pointerId: event.pointerId,
          offset,
          mode: 'stack'
        });
        return;
      }

      // Left click => top card only
      if (stack.cardIds.length <= 1) {
        setDragging({
          active: true,
          stackId: targetStackId,
          pointerId: event.pointerId,
          offset,
          mode: 'single'
        });
        return;
      }

      // Split top card into a new stack, then drag the new stack
      const topCardId = stack.cardIds[stack.cardIds.length - 1];
      const newStackId = createStackId();

      setStacks((prev) => {
        const next = prev
          .map((s) =>
            s.id === targetStackId
              ? { ...s, cardIds: s.cardIds.slice(0, -1) }
              : s
          )
          .filter((s) => s.id !== targetStackId || s.cardIds.length > 0);

        next.push({
          id: newStackId,
          x: stack.x,
          y: stack.y,
          rotation: 0,
          cardIds: [topCardId]
        });

        return next;
      });

      // The new stack is topmost because it was pushed last
      setDragging({
        active: true,
        stackId: newStackId,
        pointerId: event.pointerId,
        offset,
        mode: 'single'
      });
    },
    [bringStackToFront, createStackId, hitTestStack, setStacks, stacksById]
  );

  // Pointer move (drag)
  const handlePointerMove = useCallback(
    (event) => {
      if (!dragging.active || event.pointerId !== dragging.pointerId) return;

      const table = tableRef.current;
      if (!table) return;

      const rect = table.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;

      const nextX = px - dragging.offset.dx;
      const nextY = py - dragging.offset.dy;

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
    [dragging.active, dragging.offset.dx, dragging.offset.dy, dragging.pointerId, flushAnimation, tableRect.width, tableRect.height]
  );

  // Pointer up (drop -> merge if near)
  const handlePointerUp = useCallback(
    (event) => {
      if (!dragging.active || event.pointerId !== dragging.pointerId) return;

      const dragged = stacksById[dragging.stackId];
      if (!dragged) {
        setDragging((d) => ({ ...d, active: false, stackId: null, pointerId: null }));
        return;
      }

      // Use latest point if available (more accurate than recomputing)
      const draggedX = latestPoint.current?.x ?? dragged.x;
      const draggedY = latestPoint.current?.y ?? dragged.y;

      // Find closest stack within snap distance
      let closestId = null;
      let closestDist = Infinity;

      for (const s of stacks) {
        if (s.id === dragging.stackId) continue;
        const dx = s.x - draggedX;
        const dy = s.y - draggedY;
        const dist = Math.hypot(dx, dy);
        if (dist <= SNAP_DISTANCE && dist < closestDist) {
          closestDist = dist;
          closestId = s.id;
        }
      }

      if (closestId) {
        setStacks((prev) => {
          const target = prev.find((s) => s.id === closestId);
          const moving = prev.find((s) => s.id === dragging.stackId);
          if (!target || !moving) return prev;

          const merged = {
            ...target,
            // dragged becomes the new top
            cardIds: [...target.cardIds, ...moving.cardIds]
          };

          // remove both and add merged at end (topmost)
          return prev
            .filter((s) => s.id !== closestId && s.id !== dragging.stackId)
            .concat({ ...merged, x: target.x, y: target.y });
        });
      } else {
        // Ensure final position is clamped (in case RAF didn't land)
        const finalPos = clampCardToTable(
          draggedX,
          draggedY,
          CARD_SIZE.width,
          CARD_SIZE.height,
          tableRect.width,
          tableRect.height
        );

        setStacks((prev) =>
          prev.map((s) =>
            s.id === dragging.stackId ? { ...s, x: finalPos.x, y: finalPos.y } : s
          )
        );
      }

      setDragging({
        active: false,
        stackId: null,
        pointerId: null,
        offset: { dx: 0, dy: 0 },
        mode: 'single'
      });

      latestPoint.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [dragging.active, dragging.pointerId, dragging.stackId, stacks, stacksById, setStacks, tableRect.width, tableRect.height]
  );

  // Hover tooltip
  const handlePointerMoveHover = useCallback(
    (event) => {
      if (dragging.active) return;

      const table = tableRef.current;
      if (!table) return;

      const rect = table.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;

      setHoveredStackId(hitTestStack(px, py));
    },
    [dragging.active, hitTestStack]
  );

  const handleReset = useCallback(() => {
    setDragging({
      active: false,
      stackId: null,
      pointerId: null,
      offset: { dx: 0, dy: 0 },
      mode: 'single'
    });

    latestPoint.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    resetTable();
  }, [resetTable]);

  // Window listeners while dragging
  useEffect(() => {
    if (!dragging.active) return;

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragging.active, handlePointerMove, handlePointerUp]);

  const hoveredStack = hoveredStackId ? stacksById[hoveredStackId] : null;
  const hoveredCount = hoveredStack ? hoveredStack.cardIds.length : 0;
  const showTooltip = hoveredStack && hoveredCount >= 2;

  const tooltipStyle = showTooltip
    ? { left: hoveredStack.x + CARD_SIZE.width + 8, top: hoveredStack.y - 8 }
    : null;

  return (
    <div className="table-wrapper">
      <button className="table__reset" type="button" onClick={handleReset}>
        Reset Table
      </button>
      <div className="table">
        <div
          ref={tableRef}
          className="table__surface"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMoveHover}
          onContextMenu={(e) => e.preventDefault()}
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
                rotation={stack.rotation ?? 0}
                zIndex={index + 1}
                onPointerDown={() => {}} // Card can be passive; surface handles down
              />
            );
          })}

          {showTooltip ? (
            <div className="stack-tooltip" style={tooltipStyle}>
              Stack: {hoveredCount}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Table;
