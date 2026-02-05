import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Card from './Card.jsx';
import { getFeltEllipseInTableSpace } from '../utils/geometry.js';
import {
  clampPointToFelt,
  getFeltRect,
  isPointInsideFelt
} from '../geometry/feltBounds.js';
import { useTableState } from '../state/useTableState.js';
import { loadSettings, saveSettings } from '../state/tableSettings.js';
import { MOVE_TO_HAND, MOVE_TO_TABLE } from '../state/protocol.js';

const CARD_SCALE = 0.8;
const RIGHT_PANEL_SAFE_WIDTH = 340;
const TABLETOP_MARGIN = 24;
const MIN_TABLETOP_SCALE = 0.65;
const MAX_TABLETOP_SCALE = 1;
const BASE_CARD_SIZE = { width: 72, height: 104 };
const CARD_SIZE = {
  width: BASE_CARD_SIZE.width * CARD_SCALE,
  height: BASE_CARD_SIZE.height * CARD_SCALE
};
const SEAT_POSITION = {
  radiusX: 46,
  radiusY: 38
};
const SEAT_SIZE = { width: 208, height: 132 };
const SEAT_PADDING = 24;
const SEAT_GAP_PX = Math.max(0, Math.max(SEAT_SIZE.width, SEAT_SIZE.height) / 2 + SEAT_PADDING - 20);
const RIGHT_SWEEP_HOLD_MS = 120;
const SWEEP_MIN_INTERVAL_MS = 40;
const SWEEP_MIN_DIST = 30;
const STACK_EPS = 10;
const SWEEP_JITTER = 6;
const HAND_ZONE_SIZE = {
  width: CARD_SIZE.width * 3.4,
  height: CARD_SIZE.height * 1.5
};
const HAND_ZONE_SEAT_OFFSET = 52;

const SIDE_ORDER = ['top', 'right', 'bottom', 'left'];
const SIDE_NORMALS = {
  top: { angle: -Math.PI / 2 },
  right: { angle: 0 },
  bottom: { angle: Math.PI / 2 },
  left: { angle: Math.PI }
};

const getSideSeatCounts = (seatCount) => {
  const count = Math.max(2, seatCount);
  const quarter = Math.floor(count / 4);
  const sideCounts = {
    top: Math.ceil(count / 4),
    right: quarter,
    bottom: Math.ceil(count / 4),
    left: quarter
  };
  let assigned = sideCounts.top + sideCounts.right + sideCounts.bottom + sideCounts.left;
  let sideIndex = 0;
  while (assigned < count) {
    const side = SIDE_ORDER[sideIndex % SIDE_ORDER.length];
    sideCounts[side] += 1;
    assigned += 1;
    sideIndex += 1;
  }
  return sideCounts;
};

const getSidePositions = (count) => {
  return Array.from({ length: count }, (_, index) => (index + 1) / (count + 1));
};

const getSeatAnchors = ({ seatCount, feltBounds }) => {
  if (!feltBounds || !feltBounds.width || !feltBounds.height) {
    return [];
  }

  const sideCounts = getSideSeatCounts(seatCount);
  const minSpacingBySide = {
    top: SEAT_SIZE.width,
    bottom: SEAT_SIZE.width,
    left: SEAT_SIZE.height,
    right: SEAT_SIZE.height
  };

  return SIDE_ORDER.flatMap((side) => {
    const count = sideCounts[side];
    if (!count) {
      return [];
    }
    const isHorizontal = side === 'top' || side === 'bottom';
    const availableSpan = isHorizontal ? feltBounds.width : feltBounds.height;
    const minimumSpan = minSpacingBySide[side] * (count + 1);
    const overflow = Math.max(0, minimumSpan - availableSpan);
    const start = isHorizontal ? feltBounds.left - overflow / 2 : feltBounds.top - overflow / 2;
    const span = availableSpan + overflow;
    const outwardAdjustment = overflow > 0 ? Math.min(24, overflow / (count + 1)) : 0;
    const normal = SIDE_NORMALS[side];

    return getSidePositions(count).map((t) => {
      const axisValue = start + t * span;
      if (isHorizontal) {
        return {
          x: axisValue,
          y:
            side === 'top'
              ? feltBounds.top - (SEAT_GAP_PX + outwardAdjustment)
              : feltBounds.bottom + (SEAT_GAP_PX + outwardAdjustment),
          side,
          angle: normal.angle
        };
      }
      return {
        x:
          side === 'left'
            ? feltBounds.left - (SEAT_GAP_PX + outwardAdjustment)
            : feltBounds.right + (SEAT_GAP_PX + outwardAdjustment),
        y: axisValue,
        side,
        angle: normal.angle
      };
    });
  });
};

const Table = () => {
  const sceneRootRef = useRef(null);
  const tableFrameRef = useRef(null);
  const tableRef = useRef(null);
  const feltRef = useRef(null);
  const [tableRect, setTableRect] = useState({ width: 0, height: 0 });
  const [tableScreenRect, setTableScreenRect] = useState(null);
  const [tableScale, setTableScale] = useState(1);
  const tableScaleRef = useRef(1);
  const pendingDragRef = useRef(null);
  const lastOwnMovementRef = useRef(null);
  const capturedPointerRef = useRef({ pointerId: null, element: null });
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
  const [cardFaceOverrides, setCardFaceOverrides] = useState({});
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
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const rightSweepRef = useRef({
    isRightDown: false,
    sweepActive: false,
    downAtMs: 0,
    downPos: null,
    lastDropAtMs: 0,
    lastDropPos: null
  });
  const DRAG_THRESHOLD = 8;
  const applySweepJitter = useCallback((position, direction) => {
    if (!direction) {
      return position;
    }
    const jitter = (Math.random() * 2 - 1) * SWEEP_JITTER;
    const perpX = -direction.y;
    const perpY = direction.x;
    return {
      x: position.x + perpX * jitter,
      y: position.y + perpY * jitter
    };
  }, []);

  const pushOutOfStackEps = useCallback(
    (position, direction, stackList, excludedId) => {
      if (!direction) {
        return position;
      }
      let adjusted = { ...position };
      const maxAttempts = 12;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const centerX = adjusted.x + CARD_SIZE.width / 2;
        const centerY = adjusted.y + CARD_SIZE.height / 2;
        const blocking = stackList.find((stack) => {
          if (stack.id === excludedId) {
            return false;
          }
          const stackCenterX = stack.x + CARD_SIZE.width / 2;
          const stackCenterY = stack.y + CARD_SIZE.height / 2;
          return Math.hypot(centerX - stackCenterX, centerY - stackCenterY) < STACK_EPS;
        });
        if (!blocking) {
          break;
        }
        const blockingCenterX = blocking.x + CARD_SIZE.width / 2;
        const blockingCenterY = blocking.y + CARD_SIZE.height / 2;
        const distance = Math.hypot(
          centerX - blockingCenterX,
          centerY - blockingCenterY
        );
        const push = STACK_EPS - distance + 1;
        adjusted = {
          x: adjusted.x + direction.x * push,
          y: adjusted.y + direction.y * push
        };
      }
      return adjusted;
    },
    []
  );

  const resetRightSweep = useCallback(() => {
    rightSweepRef.current = {
      isRightDown: false,
      sweepActive: false,
      downAtMs: 0,
      downPos: null,
      lastDropAtMs: 0,
      lastDropPos: null
    };
  }, []);

  const releaseCapturedPointer = useCallback(() => {
    const { pointerId, element } = capturedPointerRef.current;
    if (element && pointerId !== null && element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    capturedPointerRef.current = { pointerId: null, element: null };
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const seatCount = settings.roomSettings.seatCount;
  const tableStyle = settings.roomSettings.tableStyle;
  const tableShape = settings.roomSettings.tableShape;
  const [feltEllipse, setFeltEllipse] = useState(null);
  const [feltScreenRect, setFeltScreenRect] = useState(null);
  const [debugClampPoint, setDebugClampPoint] = useState(null);
  const [showFeltDebug, setShowFeltDebug] = useState(false);
  const placementDebugEnabled =
    typeof window !== 'undefined' &&
    process.env.NODE_ENV !== 'production' &&
    window.localStorage?.getItem('placementDebug') === 'true';
  const safeFeltEllipse = useMemo(() => {
    if (!feltEllipse || tableShape !== 'oval') {
      return null;
    }
    const rxSafe = feltEllipse.rx - CARD_SIZE.width / 2;
    const rySafe = feltEllipse.ry - CARD_SIZE.height / 2;
    if (rxSafe <= 0 || rySafe <= 0) {
      return null;
    }
    return {
      ...feltEllipse,
      rx: rxSafe,
      ry: rySafe
    };
  }, [feltEllipse, tableShape]);

  useEffect(() => {
    if (!showFeltDebug) {
      setDebugClampPoint(null);
    }
  }, [showFeltDebug]);

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
      return {
        id: index + 1,
        label: `Seat ${index + 1}`,
        angle: -Math.PI / 2,
        side: 'top'
      };
    });
  }, [seatCount]);

  const [seatPositions, setSeatPositions] = useState(() =>
    seats.map((seat) => ({ ...seat, x: 0, y: 0 }))
  );


  const playerSeatId = useMemo(() => {
    const occupiedSeat = Object.entries(occupiedSeats)
      .find(([, occupied]) => occupied)?.[0];
    return occupiedSeat ? Number(occupiedSeat) : null;
  }, [occupiedSeats]);

  const handZones = useMemo(() => {
    return seatPositions.map((seat) => ({
      seatId: seat.id,
      x: seat.x - Math.cos(seat.angle) * HAND_ZONE_SEAT_OFFSET,
      y: seat.y - Math.sin(seat.angle) * HAND_ZONE_SEAT_OFFSET,
      width: HAND_ZONE_SIZE.width,
      height: HAND_ZONE_SIZE.height,
      angle: seat.angle
    }));
  }, [seatPositions]);

  const getHandZoneAtPoint = useCallback((x, y) => {
    for (let i = 0; i < handZones.length; i += 1) {
      const zone = handZones[i];
      const left = zone.x - zone.width / 2;
      const top = zone.y - zone.height / 2;
      if (x >= left && x <= left + zone.width && y >= top && y <= top + zone.height) {
        return zone.seatId;
      }
    }
    return null;
  }, [handZones]);

  const layoutSeats = useCallback(() => {
    const frameNode = tableFrameRef.current;
    const tableNode = tableRef.current;
    if (!frameNode || !tableNode) {
      return;
    }
    const frameRect = frameNode.getBoundingClientRect();
    const feltNode = feltRef.current;
    const tableBounds = tableNode.getBoundingClientRect();
    const feltBounds = feltNode?.getBoundingClientRect() ?? tableBounds;
    const scale = tableScaleRef.current;
    const frameWidth = frameRect.width / scale;
    const frameHeight = frameRect.height / scale;
    const feltWidth = feltBounds.width / scale;
    const feltHeight = feltBounds.height / scale;
    const feltOffsetX = (feltBounds.left - frameRect.left) / scale;
    const feltOffsetY = (feltBounds.top - frameRect.top) / scale;
    if (
      !frameWidth ||
      !frameHeight ||
      !feltWidth ||
      !feltHeight
    ) {
      setSeatPositions(seats.map((seat) => ({ ...seat, x: 0, y: 0 })));
      return;
    }

    const anchors = getSeatAnchors({
      seatCount: seats.length,
      feltBounds: {
        left: feltOffsetX,
        right: feltOffsetX + feltWidth,
        top: feltOffsetY,
        bottom: feltOffsetY + feltHeight,
        width: feltWidth,
        height: feltHeight
      }
    });

    setSeatPositions(
      seats.map((seat, index) => {
        const anchor = anchors[index];
        return {
          ...seat,
          angle: anchor?.angle ?? -Math.PI / 2,
          side: anchor?.side ?? 'top',
          x: anchor?.x ?? 0,
          y: anchor?.y ?? 0
        };
      })
    );
  }, [seats, tableShape]);

  const updateTabletopScale = useCallback(() => {
    const frameNode = tableFrameRef.current;
    const sceneRootNode = sceneRootRef.current;
    if (!frameNode || !sceneRootNode) {
      return;
    }
    const baseWidth = frameNode.offsetWidth;
    const baseHeight = frameNode.offsetHeight;
    if (!baseWidth || !baseHeight) {
      return;
    }

    const availableWidth = Math.max(
      0,
      window.innerWidth - RIGHT_PANEL_SAFE_WIDTH - TABLETOP_MARGIN * 2
    );
    const availableHeight = Math.max(
      0,
      window.innerHeight - TABLETOP_MARGIN * 2
    );
    const nextScale = Math.max(
      MIN_TABLETOP_SCALE,
      Math.min(
        MAX_TABLETOP_SCALE,
        Math.min(availableWidth / baseWidth, availableHeight / baseHeight)
      )
    );

    tableScaleRef.current = nextScale;
    setTableScale(nextScale);
    sceneRootNode.style.setProperty('--tableScale', nextScale.toString());
  }, []);

  const recomputeFeltGeometry = useCallback(() => {
    const tableNode = tableRef.current;
    const feltNode = feltRef.current;
    const scale = tableScaleRef.current;
    if (tableNode && feltNode) {
      setFeltEllipse(getFeltEllipseInTableSpace(tableNode, feltNode, scale));
      setFeltScreenRect(getFeltRect(feltNode));
      setTableScreenRect(tableNode.getBoundingClientRect());
    }
  }, []);

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
        layoutSeats();
        updateTabletopScale();
      }
    });

    tableObserver.observe(tableRef.current);
    const frameObserver = new ResizeObserver(() => {
      layoutSeats();
      updateTabletopScale();
    });
    frameObserver.observe(tableFrameRef.current);
    return () => {
      tableObserver.disconnect();
      frameObserver.disconnect();
    };
  }, [layoutSeats]);

  useEffect(() => {
    layoutSeats();
    updateTabletopScale();
  }, [layoutSeats, updateTabletopScale]);

  useEffect(() => {
    const handleResize = () => {
      layoutSeats();
      updateTabletopScale();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [layoutSeats, updateTabletopScale]);

  useEffect(() => {
    updateTabletopScale();
  }, [seatCount, tableShape, updateTabletopScale]);

  useEffect(() => {
    recomputeFeltGeometry();
  }, [recomputeFeltGeometry, tableRect.height, tableRect.width, tableScale, tableShape]);

  const getCardFace = useCallback((stack, cardId) => {
    if (!stack || !cardId) {
      return true;
    }
    const override = cardFaceOverrides[cardId];
    if (typeof override === 'boolean') {
      return override;
    }
    return stack.faceUp;
  }, [cardFaceOverrides]);

  const stacksById = useMemo(() => {
    return stacks.reduce((acc, stack) => {
      acc[stack.id] = stack;
      return acc;
    }, {});
  }, [stacks]);

  const tableStacks = useMemo(
    () => stacks.filter((stack) => (stack.zone ?? 'table') === 'table'),
    [stacks]
  );

  const findTableOverlapStackId = useCallback(
    (draggedX, draggedY, excludedId) => {
      for (let i = tableStacks.length - 1; i >= 0; i -= 1) {
        const stack = tableStacks[i];
        if (stack.id === excludedId) {
          continue;
        }
        const overlaps =
          draggedX < stack.x + CARD_SIZE.width &&
          draggedX + CARD_SIZE.width > stack.x &&
          draggedY < stack.y + CARD_SIZE.height &&
          draggedY + CARD_SIZE.height > stack.y;
        if (overlaps) {
          return stack.id;
        }
      }
      return null;
    },
    [tableStacks]
  );

  const handStacksBySeat = useMemo(() => {
    return stacks
      .filter((stack) => stack.zone === 'hand' && stack.ownerSeatIndex)
      .reduce((acc, stack) => {
        const seatId = stack.ownerSeatIndex;
        if (!acc[seatId]) {
          acc[seatId] = [];
        }
        acc[seatId].push(stack);
        return acc;
      }, {});
  }, [stacks]);

  const ownerHandRenderStacks = useMemo(() => {
    if (!playerSeatId) {
      return [];
    }
    const ownerStacks = handStacksBySeat[playerSeatId] ?? [];
    const zone = handZones.find((entry) => entry.seatId === playerSeatId);
    if (!zone) {
      return [];
    }
    const fanStep = Math.max(16, CARD_SIZE.width * 0.35);
    const startX = zone.x - ((ownerStacks.length - 1) * fanStep) / 2;
    const y = zone.y - CARD_SIZE.height / 2;
    return ownerStacks.map((stack, index) => ({
      ...stack,
      renderX: startX + index * fanStep,
      renderY: y
    }));
  }, [handStacksBySeat, handZones, playerSeatId]);

  const interactiveStackRects = useMemo(() => {
    const rects = tableStacks.map((stack) => ({ id: stack.id, x: stack.x, y: stack.y }));
    ownerHandRenderStacks.forEach((stack) => {
      rects.push({ id: stack.id, x: stack.renderX, y: stack.renderY });
    });
    return rects;
  }, [ownerHandRenderStacks, tableStacks]);

  const hitTestStack = useCallback((pointerX, pointerY) => {
    for (let i = interactiveStackRects.length - 1; i >= 0; i -= 1) {
      const stack = interactiveStackRects[i];
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
  }, [interactiveStackRects]);

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

  const getHeldTopLeft = useCallback((pointerX, pointerY, offset) => {
    return {
      x: pointerX - offset.dx,
      y: pointerY - offset.dy
    };
  }, []);

  const cloneStacksSnapshot = useCallback(
    (stackList) => stackList.map((stack) => ({ ...stack, cardIds: [...stack.cardIds] })),
    []
  );

  const stacksAreEqual = useCallback((a, b) => {
    if (a === b) {
      return true;
    }
    if (!a || !b || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      const left = a[i];
      const right = b[i];
      if (
        left.id !== right.id ||
        left.x !== right.x ||
        left.y !== right.y ||
        left.rotation !== right.rotation ||
        left.faceUp !== right.faceUp ||
        left.zone !== right.zone ||
        left.ownerSeatIndex !== right.ownerSeatIndex ||
        left.cardIds.length !== right.cardIds.length
      ) {
        return false;
      }
      for (let j = 0; j < left.cardIds.length; j += 1) {
        if (left.cardIds[j] !== right.cardIds[j]) {
          return false;
        }
      }
    }
    return true;
  }, []);

  const applyOwnMovement = useCallback(
    (updater) => {
      setStacks((prev) => {
        const next = updater(prev);
        if (stacksAreEqual(prev, next)) {
          return prev;
        }
        lastOwnMovementRef.current = cloneStacksSnapshot(prev);
        return next;
      });
    },
    [cloneStacksSnapshot, setStacks, stacksAreEqual]
  );

  const undoLastOwnMovement = useCallback(() => {
    const snapshot = lastOwnMovementRef.current;
    if (!snapshot) {
      return;
    }
    setStacks(cloneStacksSnapshot(snapshot));
    lastOwnMovementRef.current = null;
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
    setPickCountOpen(false);
  }, [cloneStacksSnapshot, setStacks]);

  const clampTopLeftToFelt = useCallback(
    (topLeft) => {
      if (!feltScreenRect || !tableScreenRect) {
        return { position: topLeft, inside: true, clampedCenter: null };
      }
      const scale = tableScaleRef.current;
      const cardSizePx = {
        width: CARD_SIZE.width * scale,
        height: CARD_SIZE.height * scale
      };
      const centerScreen = {
        x: tableScreenRect.left + (topLeft.x + CARD_SIZE.width / 2) * scale,
        y: tableScreenRect.top + (topLeft.y + CARD_SIZE.height / 2) * scale
      };
      const inside = isPointInsideFelt(
        centerScreen.x,
        centerScreen.y,
        feltScreenRect,
        tableShape,
        cardSizePx
      );
      const clampedCenter = clampPointToFelt(
        centerScreen.x,
        centerScreen.y,
        feltScreenRect,
        tableShape,
        cardSizePx
      );
      const clampedTopLeft = {
        x: (clampedCenter.x - cardSizePx.width / 2 - tableScreenRect.left) / scale,
        y: (clampedCenter.y - cardSizePx.height / 2 - tableScreenRect.top) / scale
      };
      const clampedCenterLocal = {
        x: (clampedCenter.x - tableScreenRect.left) / scale,
        y: (clampedCenter.y - tableScreenRect.top) / scale
      };
      return {
        position: inside ? topLeft : clampedTopLeft,
        inside,
        clampedCenter: clampedCenterLocal
      };
    },
    [feltScreenRect, tableScreenRect, tableShape]
  );

  const getTablePointerPositionFromClient = useCallback((clientX, clientY) => {
    const sceneRoot = sceneRootRef.current;
    const table = tableRef.current;
    if (!sceneRoot || !table) {
      return null;
    }
    const scale = tableScaleRef.current;
    const sceneRect = sceneRoot.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const offsetX = (tableRect.left - sceneRect.left) / scale;
    const offsetY = (tableRect.top - sceneRect.top) / scale;
    return {
      x: (clientX - sceneRect.left) / scale - offsetX,
      y: (clientY - sceneRect.top) / scale - offsetY
    };
  }, []);

  const getTablePointerPosition = useCallback(
    (event) =>
      getTablePointerPositionFromClient(event.clientX, event.clientY),
    [getTablePointerPositionFromClient]
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

  const getDropTransformFromPointer = useCallback(
    (clientX, clientY, heldStackState, options = {}) => {
      const { sweepDirection = null, applySweepSpacing = false } = options;
      if (!heldStackState?.active || !heldStackState?.stackId) {
        return null;
      }
      const pointerPosition = getTablePointerPositionFromClient(clientX, clientY);
      if (!pointerPosition) {
        return null;
      }
      const {
        rotation = 0,
        scale = 1
      } = stacksById[heldStackState.stackId] ?? {};
      const rawPlacement = getHeldTopLeft(
        pointerPosition.x,
        pointerPosition.y,
        heldStackState.offset
      );
      const clampedInitial = clampTopLeftToFelt(rawPlacement);
      let placement = clampedInitial.position ?? rawPlacement;
      let clampedFinal = clampedInitial;
      if (applySweepSpacing) {
        placement = applySweepJitter(placement, sweepDirection);
        const clampedJitter = clampTopLeftToFelt(placement);
        placement = clampedJitter.position ?? placement;
        placement = pushOutOfStackEps(
          placement,
          sweepDirection,
          stacks,
          heldStackState.stackId
        );
        clampedFinal = clampTopLeftToFelt(placement);
        placement = clampedFinal.position ?? placement;
      }
      return {
        x: placement.x,
        y: placement.y,
        rot: rotation,
        scale,
        clampedInitial,
        clampedFinal
      };
    },
    [
      applySweepJitter,
      clampTopLeftToFelt,
      getHeldTopLeft,
      getTablePointerPositionFromClient,
      pushOutOfStackEps,
      stacks,
      stacksById
    ]
  );

  const logPlacementDebug = useCallback(
    (context, previewTransform, actualTransform) => {
      if (!placementDebugEnabled) {
        return;
      }
      console.log(`[placement-debug] ${context} preview`, previewTransform);
      console.log(`[placement-debug] ${context} actual`, actualTransform);
      console.assert(
        previewTransform.x === actualTransform.x &&
          previewTransform.y === actualTransform.y &&
          previewTransform.rotation === actualTransform.rotation,
        `[placement-debug] ${context} mismatch`,
        { previewTransform, actualTransform }
      );
    },
    [placementDebugEnabled]
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.repeat) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoLastOwnMovement();
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
  }, [heldStack.active, heldStack.origin, heldStack.stackId, setStacks, undoLastOwnMovement]);

  const placeHeldStack = useCallback(
    (clientX, clientY) => {
      if (!heldStack.active || !heldStack.stackId) {
        return;
      }
      const placementResult = getDropTransformFromPointer(
        clientX,
        clientY,
        heldStack
      );
      if (!placementResult) {
        return;
      }
      const { x: finalX, y: finalY, clampedInitial, rot } = placementResult;
      const { inside, clampedCenter } = clampedInitial;
      if (showFeltDebug && !inside && clampedCenter) {
        setDebugClampPoint(clampedCenter);
      } else if (showFeltDebug) {
        setDebugClampPoint(null);
      }

      const draggedStack = stacksById[heldStack.stackId];
      if (draggedStack) {
        const draggedX = finalX ?? draggedStack?.x ?? heldStack.origin?.x ?? 0;
        const draggedY = finalY ?? draggedStack?.y ?? heldStack.origin?.y ?? 0;
        const pointerPosition = getTablePointerPositionFromClient(clientX, clientY);
        const handSeatId = pointerPosition
          ? getHandZoneAtPoint(pointerPosition.x, pointerPosition.y)
          : getHandZoneAtPoint(
              draggedX + CARD_SIZE.width / 2,
              draggedY + CARD_SIZE.height / 2
            );
        if (handSeatId && playerSeatId && handSeatId === playerSeatId) {
          const moveIntent = { type: MOVE_TO_HAND, stackId: heldStack.stackId, seatIndex: handSeatId };
          void moveIntent;
          applyOwnMovement((prev) =>
            prev.map((stack) =>
              stack.id === heldStack.stackId
                ? {
                    ...stack,
                    zone: 'hand',
                    ownerSeatIndex: handSeatId,
                    x: undefined,
                    y: undefined
                  }
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
          return;
        }
        if (handSeatId && handSeatId !== playerSeatId) {
          setStacks((prev) =>
            prev.map((stack) =>
              stack.id === heldStack.stackId
                ? { ...stack, x: heldStack.origin?.x ?? stack.x, y: heldStack.origin?.y ?? stack.y }
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
          return;
        }
        logPlacementDebug(
          'placeStack',
          {
            x: finalX ?? draggedStack?.x,
            y: finalY ?? draggedStack?.y,
            rotation: rot
          },
          {
            x: draggedX,
            y: draggedY,
            rotation: rot
          }
        );

        const overlapId = findTableOverlapStackId(
          draggedX,
          draggedY,
          heldStack.stackId
        );

        if (overlapId) {
          applyOwnMovement((prev) => {
            const target = prev.find((stack) => stack.id === overlapId);
            const dragged = prev.find((stack) => stack.id === heldStack.stackId);
            if (!target || !dragged) {
              return prev;
            }
            const merged = {
              ...target,
              cardIds: [...target.cardIds, ...dragged.cardIds]
            };
            return prev
              .filter((stack) => stack.id !== heldStack.stackId && stack.id !== overlapId)
              .concat(merged);
          });
        } else if (finalX !== null && finalX !== undefined) {
          const moveIntent = { type: MOVE_TO_TABLE, stackId: heldStack.stackId, dropX: finalX, dropY: finalY };
          void moveIntent;
          applyOwnMovement((prev) =>
            prev.map((stack) =>
              stack.id === heldStack.stackId
                ? { ...stack, x: finalX, y: finalY, zone: 'table', ownerSeatIndex: null }
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
    [
      getDropTransformFromPointer,
      heldStack,
      logPlacementDebug,
      setStacks,
      showFeltDebug,
      stacks,
      stacksById,
      getHandZoneAtPoint,
      getTablePointerPositionFromClient,
      playerSeatId
    ]
  );

  const dealOneFromHeld = useCallback(
    (clientX, clientY, options = {}) => {
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

      const { sweepDirection = null, applySweepSpacing = false, skipMerge = false } =
        options;
      const dropResult = getDropTransformFromPointer(
        clientX,
        clientY,
        heldStack,
        { sweepDirection, applySweepSpacing }
      );
      if (!dropResult) {
        return;
      }
      const { x: placementX, y: placementY, clampedInitial, clampedFinal, rot } =
        dropResult;
      if (applySweepSpacing) {
        if (showFeltDebug && !clampedFinal.inside && clampedFinal.clampedCenter) {
          setDebugClampPoint(clampedFinal.clampedCenter);
        } else if (showFeltDebug) {
          setDebugClampPoint(null);
        }
      } else if (showFeltDebug) {
        if (!clampedInitial.inside && clampedInitial.clampedCenter) {
          setDebugClampPoint(clampedInitial.clampedCenter);
        } else {
          setDebugClampPoint(null);
        }
      }
      const newStackId = createStackId();
      let removedCardId = null;
      let remainingCardIds = [];

      applyOwnMovement((prev) => {
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
          x: placementX ?? currentHeld.x,
          y: placementY ?? currentHeld.y,
          rotation: currentHeld.rotation,
          faceUp: currentHeld.faceUp,
          cardIds: [removedCardId],
          zone: 'table',
          ownerSeatIndex: null
        };

        logPlacementDebug(
          'dealOne',
          {
            x: placementX ?? currentHeld.x,
            y: placementY ?? currentHeld.y,
            rotation: rot
          },
          {
            x: newStack.x,
            y: newStack.y,
            rotation: newStack.rotation
          }
        );

        let next = prev
          .map((stack) =>
            stack.id === heldStack.stackId
              ? { ...stack, cardIds: nextCardIds, zone: 'table', ownerSeatIndex: null }
              : stack
          )
          .filter((stack) => stack.id !== heldStack.stackId || nextCardIds.length > 0)
          .concat(newStack);

        if (!skipMerge) {
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
              cardIds: [...target.cardIds, ...dealt.cardIds]
            };
            next = next
              .filter((stack) => stack.id !== overlapId && stack.id !== newStackId)
              .concat(merged);
          }
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
    [
      getDropTransformFromPointer,
      createStackId,
      heldStack,
      logPlacementDebug,
      setStacks,
      showFeltDebug,
      stacks
    ]
  );

  useEffect(() => {
    if (!heldStack.active) {
      latestPoint.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      resetRightSweep();
      return undefined;
    }

    const handleWindowPointerMove = (event) => {
      const position = getTablePointerPosition(event);
      if (!position) {
        return;
      }
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const clamped = getHeldTopLeft(position.x, position.y, heldStack.offset);

      latestPoint.current = clamped;
      if (rightSweepRef.current.isRightDown && heldStack.cardIds.length > 0) {
        const now = performance.now();
        const sweep = rightSweepRef.current;
        const sweepPointer = lastPointerRef.current
          ? getTablePointerPositionFromClient(
              lastPointerRef.current.x,
              lastPointerRef.current.y
            )
          : null;
        if (!sweepPointer) {
          return;
        }
        if (!sweep.sweepActive) {
          const downPos = sweep.downPos ?? sweepPointer;
          const moved = Math.hypot(
            sweepPointer.x - downPos.x,
            sweepPointer.y - downPos.y
          );
          if (now - sweep.downAtMs >= RIGHT_SWEEP_HOLD_MS || moved >= SWEEP_MIN_DIST) {
            sweep.sweepActive = true;
          }
        }
        if (sweep.sweepActive) {
          const lastPos = sweep.lastDropPos ?? sweep.downPos ?? sweepPointer;
          const distance = Math.hypot(
            sweepPointer.x - lastPos.x,
            sweepPointer.y - lastPos.y
          );
          const elapsed = now - sweep.lastDropAtMs;
          if (distance >= SWEEP_MIN_DIST && elapsed >= SWEEP_MIN_INTERVAL_MS) {
            dealOneFromHeld(lastPointerRef.current.x, lastPointerRef.current.y, {
              skipMerge: true
            });
            sweep.lastDropAtMs = now;
            sweep.lastDropPos = sweepPointer;
          }
        }
      }
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flushAnimation);
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
    };
  }, [
    dealOneFromHeld,
    flushAnimation,
    getTablePointerPosition,
    getTablePointerPositionFromClient,
    getHeldTopLeft,
    heldStack.active,
    heldStack.cardIds.length,
    heldStack.offset,
    resetRightSweep
  ]);

  useEffect(() => {
    if (!heldStack.active) {
      return undefined;
    }
    const handlePointerUp = (event) => {
      if (event.button === 2 || rightSweepRef.current.isRightDown) {
        resetRightSweep();
      }
    };
    const handlePointerCancel = () => {
      if (rightSweepRef.current.isRightDown) {
        resetRightSweep();
      }
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handlePointerCancel);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handlePointerCancel);
    };
  }, [heldStack.active, resetRightSweep]);

  useEffect(() => {
    if (pickCountOpen || settingsOpen || roomSettingsOpen) {
      resetRightSweep();
    }
  }, [pickCountOpen, resetRightSweep, roomSettingsOpen, settingsOpen]);

  const startHeldTopCard = useCallback(
    (stackId, pointerX, pointerY) => {
      const stack = stacksById[stackId];
      const topCardId = stack?.cardIds?.length
        ? stack.cardIds[stack.cardIds.length - 1]
        : null;
      if (!stack || !topCardId) {
        return;
      }
      const heldStackId = createStackId();
      const offset = {
        dx: pointerX - stack.x,
        dy: pointerY - stack.y
      };
      const visualStack = interactiveStackRects.find((item) => item.id === stackId);
      const originX = visualStack?.x ?? stack.x ?? 0;
      const originY = visualStack?.y ?? stack.y ?? 0;
      latestPoint.current = { x: originX, y: originY };
      applyOwnMovement((prev) => {
        const current = prev.find((item) => item.id === stackId);
        if (!current) {
          return prev;
        }
        const nextCardIds = current.cardIds.slice(0, -1);
        const next = prev
          .map((item) =>
            item.id === stackId ? { ...item, cardIds: nextCardIds } : item
          )
          .filter((item) => item.id !== stackId || item.cardIds.length > 0);
        next.push({
          id: heldStackId,
          x: originX,
          y: originY,
          rotation: current.rotation,
          faceUp: getCardFace(current, topCardId),
          cardIds: [topCardId],
          zone: 'table',
          ownerSeatIndex: null
        });
        return next;
      });
      setHeldStack({
        active: true,
        stackId: heldStackId,
        cardIds: [topCardId],
        sourceStackId: stackId,
        offset,
        origin: { x: originX, y: originY },
        mode: 'stack'
      });
    },
    [applyOwnMovement, createStackId, getCardFace, interactiveStackRects, stacksById]
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
      if (pending.pointerId !== undefined && event.pointerId !== pending.pointerId) {
        return;
      }
      const position = getTablePointerPosition(event);
      if (!position) {
        return;
      }
      const pointerX = position.x;
      const pointerY = position.y;
      const deltaX = pointerX - pending.startX;
      const deltaY = pointerY - pending.startY;
      const distance = Math.hypot(deltaX, deltaY);
      // A small threshold avoids turning plain clicks into accidental drags.
      if (distance < DRAG_THRESHOLD) {
        return;
      }
      pendingDragRef.current = null;
      setPendingDragActive(false);
      releaseCapturedPointer();
      setSelectedStackId(null);
      setPickCountOpen(false);
      bringStackToFront(pending.stackId);
      startHeldTopCard(pending.stackId, pointerX, pointerY);
    };

    const handlePendingPointerUp = (event) => {
      const pending = pendingDragRef.current;
      if (!pending) {
        return;
      }
      if (pending.pointerId !== undefined && event.pointerId !== pending.pointerId) {
        return;
      }
      pendingDragRef.current = null;
      setPendingDragActive(false);
      releaseCapturedPointer();
      bringStackToFront(pending.stackId);
      setSelectedStackId(pending.stackId);
      setPickCountOpen(false);
    };

    const handlePendingPointerCancel = (event) => {
      const pending = pendingDragRef.current;
      if (!pending) {
        return;
      }
      if (pending.pointerId !== undefined && event.pointerId !== pending.pointerId) {
        return;
      }
      pendingDragRef.current = null;
      setPendingDragActive(false);
      releaseCapturedPointer();
    };

    window.addEventListener('pointermove', handlePendingPointerMove);
    window.addEventListener('pointerup', handlePendingPointerUp);
    window.addEventListener('pointercancel', handlePendingPointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePendingPointerMove);
      window.removeEventListener('pointerup', handlePendingPointerUp);
      window.removeEventListener('pointercancel', handlePendingPointerCancel);
    };
  }, [
    bringStackToFront,
    getTablePointerPosition,
    pendingDragActive,
    releaseCapturedPointer,
    startHeldTopCard
  ]);

  const pickUpStack = useCallback(
    (stackId, requestedCount, pointerEvent = null) => {
      if (pointerEvent) {
        pointerEvent.preventDefault();
        lastPointerRef.current = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      }
      const source = stacksById[stackId];
      if (!source) {
        return;
      }
      const clampedCount = Math.max(1, Math.min(requestedCount, source.cardIds.length));
      const newStackId = createStackId();
      let pickedCardIds = [];
      let origin = null;
      let heldPosition = null;
      const position = pointerEvent ? getTablePointerPosition(pointerEvent) : null;
      const offset = { dx: CARD_SIZE.width / 2, dy: CARD_SIZE.height / 2 };
      if (position) {
        heldPosition = getHeldTopLeft(position.x, position.y, offset);
      }

      applyOwnMovement((prev) => {
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
          cardIds: pickedCardIds,
          zone: 'table',
          ownerSeatIndex: null
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
        offset,
        origin,
        mode: 'stack'
      });
      setSelectedStackId(null);
      setPickCountOpen(false);
    },
    [applyOwnMovement, createStackId, getHeldTopLeft, getTablePointerPosition, stacksById]
  );

  const handleStackPointerDown = useCallback(
    (event, stackIdOverride = null) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (event.button === 2) {
        if (heldStack.active) {
          event.preventDefault();
          event.stopPropagation();
          const position = getTablePointerPosition(event);
          if (position) {
            const now = performance.now();
            rightSweepRef.current = {
              isRightDown: true,
              sweepActive: false,
              downAtMs: now,
              downPos: position,
              lastDropAtMs: now,
              lastDropPos: position
            };
            dealOneFromHeld(lastPointerRef.current.x, lastPointerRef.current.y, {
              skipMerge: true
            });
          }
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const position = getTablePointerPosition(event);
        if (!position) {
          return;
        }
        const stackId = stackIdOverride ?? hitTestStack(position.x, position.y);
        if (!stackId) {
          return;
        }
        const stack = stacksById[stackId];
        if (!stack) {
          return;
        }
        pickUpStack(stackId, stack.cardIds.length, event);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const position = getTablePointerPosition(event);
      if (!position) {
        return;
      }
      const pointerX = position.x;
      const pointerY = position.y;
      const stackId = stackIdOverride ?? hitTestStack(pointerX, pointerY);
      if (!stackId) {
        return;
      }

      if (heldStack.active) {
        placeHeldStack(lastPointerRef.current.x, lastPointerRef.current.y);
        setSelectedStackId(null);
        setPickCountOpen(false);
        return;
      }

      // Capture the pointer during press-to-grab so move/up still reach us even if
      // the pointer leaves the card while dragging.
      if (event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
        event.currentTarget.setPointerCapture(event.pointerId);
        capturedPointerRef.current = {
          pointerId: event.pointerId,
          element: event.currentTarget
        };
      }
      pendingDragRef.current = {
        stackId,
        startX: pointerX,
        startY: pointerY,
        pointerId: event.pointerId
      };
      setPendingDragActive(true);
    },
    [
      dealOneFromHeld,
      getTablePointerPosition,
      heldStack.active,
      hitTestStack,
      pickUpStack,
      stacksById,
      placeHeldStack
    ]
  );

  const handleSurfacePointerDown = useCallback(
    (event) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (event.button === 2) {
        if (heldStack.active) {
          event.preventDefault();
          event.stopPropagation();
          const position = getTablePointerPosition(event);
          if (position) {
            const now = performance.now();
            rightSweepRef.current = {
              isRightDown: true,
              sweepActive: false,
              downAtMs: now,
              downPos: position,
              lastDropAtMs: now,
              lastDropPos: position
            };
            dealOneFromHeld(lastPointerRef.current.x, lastPointerRef.current.y, {
              skipMerge: true
            });
          }
        }
        return;
      }
      const position = getTablePointerPosition(event);
      if (!position) {
        return;
      }
      const pointerX = position.x;
      const pointerY = position.y;
      if (heldStack.active) {
        placeHeldStack(lastPointerRef.current.x, lastPointerRef.current.y);
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
    [
      dealOneFromHeld,
      getTablePointerPosition,
      handleStackPointerDown,
      heldStack.active,
      hitTestStack,
      placeHeldStack
    ]
  );

  const handlePointerMoveHover = useCallback(
    (event) => {
      const position = getTablePointerPosition(event);
      if (!position) {
        return;
      }
      if (heldStack.active) {
        return;
      }
      const pointerX = position.x;
      const pointerY = position.y;
      const stackId = hitTestStack(pointerX, pointerY);
      setHoveredStackId(stackId);
    },
    [getTablePointerPosition, heldStack.active, hitTestStack]
  );

  const handleSurfacePointerMove = useCallback(
    (event) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      handlePointerMoveHover(event);
    },
    [handlePointerMoveHover]
  );

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
    lastOwnMovementRef.current = null;
    setSelectedStackId(null);
    setHoveredStackId(null);
    setPickCountOpen(false);
    setPickCountValue('1');
  }, []);

  const applySettings = useCallback(() => {
    setAppliedSettings(settings);
    rebuildTableFromSettings(settings);
    resetInteractionStates();
    setCardFaceOverrides({});
    updateTabletopScale();
  }, [rebuildTableFromSettings, resetInteractionStates, settings, updateTabletopScale]);

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
    applyOwnMovement((prev) =>
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
  }, [applyOwnMovement, selectedStackId]);

  const pickUpFromStack = useCallback(
    (stackId, requestedCount) => {
      pickUpStack(stackId, requestedCount);
    },
    [pickUpStack]
  );

  const handleStackDoubleClick = useCallback((event, stackId) => {
    event.preventDefault();
    event.stopPropagation();
    applyOwnMovement((prev) =>
      prev.map((stack) =>
        stack.id === stackId ? { ...stack, faceUp: !stack.faceUp } : stack
      )
    );
    setCardFaceOverrides((prev) => {
      const stack = stacksById[stackId];
      if (!stack) {
        return prev;
      }
      const next = { ...prev };
      stack.cardIds.forEach((cardId) => {
        const currentFace = typeof next[cardId] === 'boolean' ? next[cardId] : stack.faceUp;
        next[cardId] = !currentFace;
      });
      return next;
    });
  }, [applyOwnMovement, stacksById]);

  const handleFlipSelected = useCallback(() => {
    if (!selectedStackId) {
      return;
    }
    const selected = stacksById[selectedStackId];
    applyOwnMovement((prev) =>
      prev.map((stack) =>
        stack.id === selectedStackId ? { ...stack, faceUp: !stack.faceUp } : stack
      )
    );
    if (selected) {
      setCardFaceOverrides((prev) => {
        const next = { ...prev };
        selected.cardIds.forEach((cardId) => {
          const currentFace = typeof next[cardId] === 'boolean' ? next[cardId] : selected.faceUp;
          next[cardId] = !currentFace;
        });
        return next;
      });
    }
  }, [applyOwnMovement, selectedStackId, stacksById]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.repeat) {
        return;
      }
      const isFormElement =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' ||
          event.target.tagName === 'TEXTAREA' ||
          event.target.tagName === 'SELECT' ||
          event.target.isContentEditable);
      if (isFormElement || !selectedStackId || heldStack.active) {
        return;
      }
      const lowerKey = event.key.toLowerCase();
      if (lowerKey === 'f') {
        event.preventDefault();
        handleFlipSelected();
        return;
      }
      if (lowerKey === 's') {
        event.preventDefault();
        handleShuffleSelected();
        return;
      }
      if (event.key === '1' || event.key === '5' || event.key === '0') {
        event.preventDefault();
        const pickCount = event.key === '0' ? 10 : Number(event.key);
        pickUpStack(selectedStackId, pickCount);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleFlipSelected,
    handleShuffleSelected,
    heldStack.active,
    pickUpStack,
    selectedStackId
  ]);

  const selectedStack = selectedStackId ? stacksById[selectedStackId] : null;
  const heldStackData =
    heldStack.active && heldStack.stackId ? stacksById[heldStack.stackId] : null;
  const heldTopCardId = heldStackData?.cardIds[heldStackData.cardIds.length - 1];
  const heldTopCard = heldTopCardId ? cardsById[heldTopCardId] : null;
  const placementPointer = heldStackData ? lastPointerRef.current : null;
  const placementGhost =
    heldStack.active && heldStackData && placementPointer
      ? getDropTransformFromPointer(
          placementPointer.x,
          placementPointer.y,
          heldStack
        )
      : null;

  const hoverHandSeatId =
    heldStack.active && placementPointer
      ? (() => {
          const pointerPosition = getTablePointerPositionFromClient(
            placementPointer.x,
            placementPointer.y
          );
          return pointerPosition
            ? getHandZoneAtPoint(pointerPosition.x, pointerPosition.y)
            : null;
        })()
      : null;
  const mergeHighlightStackId =
    heldStack.active &&
    placementGhost &&
    !hoverHandSeatId
      ? findTableOverlapStackId(placementGhost.x, placementGhost.y, heldStack.stackId)
      : null;
  const menuBelow = selectedStack ? selectedStack.y < 140 : false;
  const menuPosition =
    selectedStack && tableScreenRect
      ? {
          left:
            tableScreenRect.left +
            (selectedStack.x + CARD_SIZE.width / 2) * tableScale,
          top:
            tableScreenRect.top +
            (menuBelow
              ? selectedStack.y + CARD_SIZE.height + 10
              : selectedStack.y - 10) *
              tableScale
        }
      : null;
  const menuStackCount = selectedStack ? selectedStack.cardIds.length : 0;
  const uiOverlayRoot =
    typeof document !== 'undefined' ? document.getElementById('ui-overlay') : null;
  const dragCardPosition =
    heldStackData && tableScreenRect
      ? {
          x: tableScreenRect.left + heldStackData.x * tableScale,
          y: tableScreenRect.top + heldStackData.y * tableScale
        }
      : null;
  return (
    <div className="tabletop">
      <div
        id="sceneRoot"
        ref={sceneRootRef}
        style={{ '--tableScale': tableScale }}
      >
        <div
          ref={tableFrameRef}
          className={`table-frame table-frame--${tableStyle} table-frame--${tableShape}`}
          style={{ '--card-scale': CARD_SCALE }}
        >
          <div id="seatLayer" className="table__seats" aria-label="Table seats">
            {seatPositions.map((seat, i) => {
              const occupied = occupiedSeats[seat.id];
              const seatHandCount = (handStacksBySeat[seat.id] ?? []).reduce(
                (acc, stack) => acc + stack.cardIds.length,
                0
              );
              const seatStyle = {
                left: `${seat.x}px`,
                top: `${seat.y}px`
              };
              return (
                <div
                  key={seat.id}
                  className={`seat seat--${seat.side} ${occupied ? 'seat--occupied' : ''} ${seatHandCount ? 'seat--has-cards' : ''}`}
                  data-seat-index={i}
                  style={seatStyle}
                  onClick={() => toggleSeat(seat.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleSeat(seat.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="seat__base" />
                  <div className="seat__bench">
                    <div className="seat__label">SEAT {i + 1}</div>

                    <div className="seat__hand" aria-label={`Seat ${i + 1} hand zone`}>
                      {/* hand contents render here if needed */}
                    </div>

                    <div className="seat__handIndicator" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="table__surface-wrapper">
            <div
              ref={tableRef}
              className={`table__surface table__surface--${tableStyle} table__surface--${tableShape}`}
              onPointerDown={handleSurfacePointerDown}
              onPointerMove={handleSurfacePointerMove}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div
                ref={feltRef}
                className={`table__felt ${showFeltDebug ? 'table__felt--debug' : ''}`}
                aria-hidden="true"
              />
              {showFeltDebug && feltEllipse && tableRect.width && tableRect.height ? (
                <svg
                  className="table__felt-debug"
                  viewBox={`0 0 ${tableRect.width} ${tableRect.height}`}
                  aria-hidden="true"
                >
                  {tableShape === 'rectangle' ? (
                    <rect
                      className="table__felt-debug-rect"
                      x={feltEllipse.bounds?.left ?? 0}
                      y={feltEllipse.bounds?.top ?? 0}
                      width={feltEllipse.w}
                      height={feltEllipse.h}
                    />
                  ) : (
                    <>
                      <ellipse
                        className="table__felt-debug-ellipse"
                        cx={feltEllipse.cx}
                        cy={feltEllipse.cy}
                        rx={feltEllipse.rx}
                        ry={feltEllipse.ry}
                      />
                      {safeFeltEllipse ? (
                        <ellipse
                          className="table__felt-debug-safe-ellipse"
                          cx={safeFeltEllipse.cx}
                          cy={safeFeltEllipse.cy}
                          rx={safeFeltEllipse.rx}
                          ry={safeFeltEllipse.ry}
                        />
                      ) : null}
                    </>
                  )}
                  {debugClampPoint ? (
                    <circle
                      className="table__felt-debug-clamp"
                      cx={debugClampPoint.x}
                      cy={debugClampPoint.y}
                      r="8"
                    />
                  ) : null}
                </svg>
              ) : null}
              {handZones.map((zone) => {
                const isOwnerZone = playerSeatId === zone.seatId;
                const isDragHover = heldStack.active && hoverHandSeatId === zone.seatId;
                const isValidDropZone = isDragHover && isOwnerZone;
                const isInvalidDropZone =
                  isDragHover && playerSeatId !== null && zone.seatId !== playerSeatId;
                return (
                  <div
                    key={`hand-zone-${zone.seatId}`}
                    className={`hand-zone ${isOwnerZone ? 'hand-zone--owner' : ''} ${isDragHover ? 'hand-zone--hover' : ''} ${isValidDropZone ? 'hand-zone--valid' : ''} ${isInvalidDropZone ? 'hand-zone--invalid' : ''}`}
                    style={{
                      left: `${zone.x}px`,
                      top: `${zone.y}px`,
                      width: `${zone.width}px`,
                      height: `${zone.height}px`,
                      '--zone-rotation': `${zone.angle + Math.PI / 2}rad`
                    }}
                  />
                );
              })}
              {(playerSeatId ? ownerHandRenderStacks : []).map((stack, index) => {
                const topCardId = stack.cardIds[stack.cardIds.length - 1];
                const topCard = cardsById[topCardId];
                const isHeld = heldStack.active && stack.id === heldStack.stackId;
                if (isHeld && heldStackData) {
                  return null;
                }
                return (
                  <div
                    key={`hand-stack-${stack.id}`}
                    className="stack-entity"
                    style={{
                      transform: `translate(${stack.renderX}px, ${stack.renderY}px) rotate(${stack.rotation}deg)`,
                      zIndex: 120 + index
                    }}
                  >
                    <Card
                      id={stack.id}
                      x={0}
                      y={0}
                      rotation={0}
                      faceUp={getCardFace(stack, topCardId)}
                      cardStyle={appliedSettings.cardStyle}
                      zIndex={1}
                      rank={topCard?.rank}
                      suit={topCard?.suit}
                      color={topCard?.color}
                      isHeld={isHeld}
                      isSelected={stack.id === selectedStackId}
                      onPointerDown={handleStackPointerDown}
                      onDoubleClick={handleStackDoubleClick}
                    />
                  </div>
                );
              })}
              {handZones
                .filter((zone) => zone.seatId !== playerSeatId)
                .map((zone) => {
                  const seatStacks = handStacksBySeat[zone.seatId] ?? [];
                  const count = seatStacks.reduce((acc, stack) => acc + stack.cardIds.length, 0);
                  if (!count) {
                    return null;
                  }
                  return (
                    <div
                      key={`hand-proxy-${zone.seatId}`}
                      className="hand-proxy"
                      style={{ left: `${zone.x}px`, top: `${zone.y}px` }}
                    >
                      <div className="hand-proxy__cards" />
                      <div className="hand-proxy__count">{count}</div>
                    </div>
                  );
                })}

              {placementGhost ? (
                <div
                  className="placement-ghost"
                  aria-hidden="true"
                  style={{
                    transform: `translate(${placementGhost.x}px, ${placementGhost.y}px) rotate(${placementGhost.rot}deg)`,
                    zIndex: 0
                  }}
                />
              ) : null}
              {tableStacks.map((stack, index) => {
                const topCardId = stack.cardIds[stack.cardIds.length - 1];
                const topCard = cardsById[topCardId];
                const isHeld = heldStack.active && stack.id === heldStack.stackId;
                if (isHeld && heldStackData) {
                  return null;
                }
                const zIndex = index + 1;
                const showBadge =
                  stack.cardIds.length > 1 &&
                  (settings.stackCountDisplayMode === 'always' ||
                    (settings.stackCountDisplayMode === 'hover' &&
                      stack.id === visibleBadgeStackId));
                return (
                  <div
                    key={stack.id}
                    className={`stack-entity ${stack.id === mergeHighlightStackId ? 'stack-entity--merge-target' : ''}`}
                    style={{
                      transform: `translate(${stack.x}px, ${stack.y}px) rotate(${stack.rotation}deg)`,
                      zIndex
                    }}
                  >
                    <Card
                      id={stack.id}
                      x={0}
                      y={0}
                      rotation={0}
                      faceUp={getCardFace(stack, topCardId)}
                      cardStyle={appliedSettings.cardStyle}
                      zIndex={1}
                      rank={topCard?.rank}
                      suit={topCard?.suit}
                      color={topCard?.color}
                      isHeld={isHeld}
                      isSelected={stack.id === selectedStackId}
                      onPointerDown={handleStackPointerDown}
                      onDoubleClick={handleStackDoubleClick}
                    />
                    {showBadge ? (
                      <div className="stackCountBadge">Stack: {stack.cardIds.length}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {heldStackData && uiOverlayRoot && dragCardPosition
          ? createPortal(
              <div
                className="drag-layer"
                aria-hidden="true"
                style={{ '--card-scale': CARD_SCALE * tableScale }}
              >
                <Card
                  id={heldStackData.id}
                  x={dragCardPosition.x}
                  y={dragCardPosition.y}
                  rotation={heldStackData.rotation}
                  faceUp={getCardFace(heldStackData, heldTopCardId)}
                  cardStyle={appliedSettings.cardStyle}
                  zIndex={2000}
                  rank={heldTopCard?.rank}
                  suit={heldTopCard?.suit}
                  color={heldTopCard?.color}
                  isHeld
                  isSelected={false}
                  onPointerDown={handleStackPointerDown}
                />
              </div>,
              uiOverlayRoot
            )
          : null}
      </div>
      <div id="uiLayer">
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
            <div className="table-settings__row">
              <span className="table-settings__label">Show felt debug</span>
              <label className="table-settings__switch">
                <input
                  type="checkbox"
                  checked={showFeltDebug}
                  onChange={(event) => setShowFeltDebug(event.target.checked)}
                />
                <span>Felt Debug</span>
              </label>
            </div>
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
      {selectedStack && menuPosition && uiOverlayRoot
        ? createPortal(
            <div
              className={`stack-menu ${menuBelow ? 'stack-menu--below' : 'stack-menu--above'}`}
              style={menuPosition}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="stack-menu__button"
                onClick={() => pickUpFromStack(selectedStack.id, selectedStack.cardIds.length)}
              >
                Pick up full stack
              </button>
              <button
                type="button"
                className="stack-menu__button"
                onClick={() => {
                  const halfCount = Math.floor(selectedStack.cardIds.length / 2);
                  if (halfCount < 1) {
                    return;
                  }
                  pickUpFromStack(selectedStack.id, halfCount);
                }}
              >
                Pick up half stack
              </button>
              <button
                type="button"
                className="stack-menu__button"
                onClick={() => pickUpFromStack(selectedStack.id, 1)}
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
                      onClick={() => {
                        const parsed = Number.parseInt(pickCountValue, 10);
                        const count = Number.isNaN(parsed) ? 1 : parsed;
                        pickUpFromStack(selectedStack.id, count);
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
            </div>,
            uiOverlayRoot
          )
        : null}
    </div>
  );
};

export default Table;
