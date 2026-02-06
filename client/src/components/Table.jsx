import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Card from './Card.jsx';
import InventoryPanel from './InventoryPanel.jsx';
import ActionLog from './ActionLog.jsx';
import SeatMenu from './SeatMenu.jsx';
import { clamp, getFeltEllipseInTableSpace } from '../utils/geometry.js';
import {
  clampParamBetweenNeighbors,
  paramFromPointer,
  pointFromParam
} from '../utils/tablePerimeter.js';
import {
  clampPointToFelt,
  getFeltRect,
  isPointInsideFelt
} from '../geometry/feltBounds.js';
import { useTableState } from '../state/useTableState.js';
import { loadSettings, saveSettings } from '../state/tableSettings.js';

const RIGHT_PANEL_SAFE_WIDTH = 340;
const TABLETOP_MARGIN = 24;
const MIN_TABLETOP_SCALE = 0.65;
const MAX_TABLETOP_SCALE = 1;
const TABLE_BASE_WIDTH = 1100;
const TABLE_BASE_HEIGHT = 680;
const TABLE_FOOTPRINT_SCALE = 0.9;
const BASE_CARD_SIZE = { width: 72, height: 104 };
const HAND_ZONE_WIDTH_MULT = 3.4;
const HAND_ZONE_HEIGHT_MULT = 1.5;
const SEAT_POSITION = {
  radiusX: 46,
  radiusY: 38
};
const SEAT_SIZE = { width: 208, height: 132 };
const SEAT_PADDING = 24;
const SEAT_RAIL_OFFSET_PX = Math.max(
  0,
  Math.max(SEAT_SIZE.width, SEAT_SIZE.height) / 2 + SEAT_PADDING - 20
);
const SEAT_DIAMETER_PX = Math.max(SEAT_SIZE.width, SEAT_SIZE.height);
const SEAT_DRAG_PADDING_PX = 10;
const SEAT_MIN_GAP_PX = SEAT_DIAMETER_PX + SEAT_DRAG_PADDING_PX;
const TAU = Math.PI * 2;
const RIGHT_SWEEP_HOLD_MS = 120;
const SWEEP_MIN_INTERVAL_MS = 40;
const SWEEP_MIN_DIST = 30;
const STACK_EPS_BASE = 10;
const SWEEP_JITTER = 6;
const HAND_ZONE_SEAT_OFFSET_BASE = 52;

const SIDE_ORDER = ['top', 'right', 'bottom', 'left'];
const SIDE_NORMALS = {
  top: { angle: -Math.PI / 2 },
  right: { angle: 0 },
  bottom: { angle: Math.PI / 2 },
  left: { angle: Math.PI }
};

const normalizeParam = (value, max) => {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  const wrapped = value % max;
  return wrapped < 0 ? wrapped + max : wrapped;
};

const getSeatSideFromAngle = (angle) => {
  const normalized = normalizeParam(angle, TAU);
  if (normalized < Math.PI / 4 || normalized >= (Math.PI * 7) / 4) {
    return 'right';
  }
  if (normalized < (Math.PI * 3) / 4) {
    return 'bottom';
  }
  if (normalized < (Math.PI * 5) / 4) {
    return 'left';
  }
  return 'top';
};

const computeSeatAnchorsFromParams = ({ seatParams, tableShape, seatRailBounds }) => {
  if (!seatRailBounds || !seatRailBounds.width || !seatRailBounds.height) {
    return [];
  }
  return seatParams.map((param) => {
    const point = pointFromParam(tableShape, seatRailBounds, param, SEAT_RAIL_OFFSET_PX);
    const angle = Math.atan2(point.ny, point.nx);
    return {
      x: point.x,
      y: point.y,
      side: getSeatSideFromAngle(angle),
      angle
    };
  });
};

const Table = () => {
  const sceneRootRef = useRef(null);
  const tableFrameRef = useRef(null);
  const tableRef = useRef(null);
  const feltRef = useRef(null);
  const seatPadRefs = useRef({});
  const seatDragRef = useRef({
    seatIndex: null,
    moved: false,
    start: null
  });
  const [tableRect, setTableRect] = useState({ width: 0, height: 0 });
  const [tableScreenRect, setTableScreenRect] = useState(null);
  const [tableScale, setTableScale] = useState(1);
  const [tableFootprintPx, setTableFootprintPx] = useState(null);
  const tableScaleRef = useRef(1);
  const pendingDragRef = useRef(null);
  const lastOwnMovementRef = useRef(null);
  const capturedPointerRef = useRef({ pointerId: null, element: null });
  const [settings, setSettings] = useState(() => loadSettings());
  const [appliedSettings, setAppliedSettings] = useState(() => loadSettings());
  const tableZoom = settings.tableZoom ?? 1;
  const cardScale = settings.cardScale ?? 1;
  const viewTransform = useMemo(
    () => ({ zoom: tableZoom, cardScale }),
    [cardScale, tableZoom]
  );
  const combinedScale = useMemo(
    () => tableScale * viewTransform.zoom,
    [tableScale, viewTransform.zoom]
  );
  const cardSize = useMemo(
    () => ({
      width: BASE_CARD_SIZE.width * viewTransform.cardScale,
      height: BASE_CARD_SIZE.height * viewTransform.cardScale
    }),
    [viewTransform.cardScale]
  );
  const handZoneSize = useMemo(
    () => ({
      width: cardSize.width * HAND_ZONE_WIDTH_MULT,
      height: cardSize.height * HAND_ZONE_HEIGHT_MULT
    }),
    [cardSize.height, cardSize.width]
  );
  const handZoneSeatOffset = useMemo(
    () => HAND_ZONE_SEAT_OFFSET_BASE * viewTransform.cardScale,
    [viewTransform.cardScale]
  );
  const stackEps = useMemo(
    () => STACK_EPS_BASE * viewTransform.cardScale,
    [viewTransform.cardScale]
  );
  const seatCount = settings.roomSettings.seatCount;
  const {
    cardsById,
    stacks,
    setStacks,
    createStackId,
    rebuildTableFromSettings,
    players,
    seatAssignments,
    hands,
    myPlayerId,
    sitAtSeat,
    standUp,
    updatePlayerColors,
    moveToHand,
    moveFromHandToTable,
    reorderHand,
    toggleReveal,
    takeTopCardFromStack,
    spawnHeldStack
  } = useTableState(
    tableRect,
    cardSize,
    appliedSettings,
    seatCount
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
  const [dragSeatIndex, setDragSeatIndex] = useState(null);
  const [seatMenuState, setSeatMenuState] = useState({
    seatIndex: null,
    open: false
  });
  const [actionLog, setActionLog] = useState([]);
  const actionLogIdRef = useRef(1);
  const [presence, setPresence] = useState(() => ({}));
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
        const centerX = adjusted.x + cardSize.width / 2;
        const centerY = adjusted.y + cardSize.height / 2;
        const blocking = stackList.find((stack) => {
          if (stack.id === excludedId) {
            return false;
          }
          const stackCenterX = stack.x + cardSize.width / 2;
          const stackCenterY = stack.y + cardSize.height / 2;
          return Math.hypot(centerX - stackCenterX, centerY - stackCenterY) < stackEps;
        });
        if (!blocking) {
          break;
        }
        const blockingCenterX = blocking.x + cardSize.width / 2;
        const blockingCenterY = blocking.y + cardSize.height / 2;
        const distance = Math.hypot(
          centerX - blockingCenterX,
          centerY - blockingCenterY
        );
        const push = stackEps - distance + 1;
        adjusted = {
          x: adjusted.x + direction.x * push,
          y: adjusted.y + direction.y * push
        };
      }
      return adjusted;
    },
    [cardSize.height, cardSize.width, stackEps]
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

  useEffect(() => {
    const sceneRootNode = sceneRootRef.current;
    if (sceneRootNode) {
      sceneRootNode.style.setProperty('--tableScale', combinedScale.toString());
    }
    tableScaleRef.current = combinedScale;
  }, [combinedScale]);

  const tableStyle = settings.roomSettings.tableStyle;
  const tableShape = settings.roomSettings.tableShape;
  const [feltBounds, setFeltBounds] = useState(null);
  const [seatRailBounds, setSeatRailBounds] = useState(null);
  const [feltEllipse, setFeltEllipse] = useState(null);
  const [feltScreenRect, setFeltScreenRect] = useState(null);
  const [debugClampPoint, setDebugClampPoint] = useState(null);
  const [showFeltDebug, setShowFeltDebug] = useState(false);
  const placementDebugEnabled =
    typeof window !== 'undefined' &&
    process.env.NODE_ENV !== 'production' &&
    window.localStorage?.getItem('placementDebug') === 'true';
  const safeFeltEllipse = useMemo(() => {
    if (!feltEllipse || !['oval', 'circle'].includes(tableShape)) {
      return null;
    }
    const rxSafe = feltEllipse.rx - cardSize.width / 2;
    const rySafe = feltEllipse.ry - cardSize.height / 2;
    if (rxSafe <= 0 || rySafe <= 0) {
      return null;
    }
    return {
      ...feltEllipse,
      rx: rxSafe,
      ry: rySafe
    };
  }, [cardSize.height, cardSize.width, feltEllipse, tableShape]);

  useEffect(() => {
    if (!showFeltDebug) {
      setDebugClampPoint(null);
    }
  }, [showFeltDebug]);

  const buildDefaultSeatParams = useCallback(
    (count) => Array.from({ length: count }, (_, index) => index / count),
    []
  );

  const normalizeSeatParams = useCallback(
    (params, count, shape) => {
      if (!Array.isArray(params) || params.length !== count) {
        return buildDefaultSeatParams(count, shape);
      }
      return params.map((value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return 0;
        }
        if (shape === 'oval' && Math.abs(numeric) > 1) {
          return ((numeric / TAU) % 1 + 1) % 1;
        }
        return ((numeric % 1) + 1) % 1;
      });
    },
    [buildDefaultSeatParams]
  );

  const seatParams = useMemo(() => {
    const paramsByShape = settings.roomSettings.seatParams ?? {};
    return normalizeSeatParams(paramsByShape[tableShape], seatCount, tableShape);
  }, [normalizeSeatParams, seatCount, settings.roomSettings.seatParams, tableShape]);

  useEffect(() => {
    setSettings((prev) => {
      const paramsByShape = prev.roomSettings.seatParams ?? {};
      const current = paramsByShape[tableShape];
      const next = normalizeSeatParams(current, seatCount, tableShape);
      const isSame =
        Array.isArray(current) &&
        current.length === next.length &&
        current.every((value, index) => value === next[index]);
      if (isSame) {
        return prev;
      }
      return {
        ...prev,
        roomSettings: {
          ...prev.roomSettings,
          seatParams: {
            ...paramsByShape,
            [tableShape]: next
          }
        }
      };
    });
  }, [normalizeSeatParams, seatCount, tableShape]);

  const seats = useMemo(() => {
    const count = Math.max(2, seatCount);
    return Array.from({ length: count }, (_, index) => {
      return {
        id: index + 1,
        seatIndex: index,
        label: `Seat ${index + 1}`,
        angle: -Math.PI / 2,
        side: 'top'
      };
    });
  }, [seatCount]);

  const [seatPositions, setSeatPositions] = useState(() =>
    seats.map((seat) => ({ ...seat, x: 0, y: 0 }))
  );
  const [handZones, setHandZones] = useState([]);


  const mySeatIndex = useMemo(
    () => players[myPlayerId]?.seatIndex ?? null,
    [myPlayerId, players]
  );
  const myPlayer = players[myPlayerId];
  const myName = myPlayer?.name ?? 'Player';

  const pushAction = useCallback((text) => {
    if (!text) {
      return;
    }
    setActionLog((prev) => {
      const next = [
        { id: actionLogIdRef.current++, ts: Date.now(), text },
        ...prev
      ];
      return next.slice(0, 30);
    });
  }, []);

  const updatePresence = useCallback(
    (updates) => {
      if (!myPlayerId) {
        return;
      }
      setPresence((prev) => ({
        ...prev,
        [myPlayerId]: {
          x: 0,
          y: 0,
          isDown: false,
          holdingCount: 0,
          ...(prev[myPlayerId] ?? {}),
          ...updates
        }
      }));
    },
    [myPlayerId]
  );

  const getCardLabel = useCallback(
    (cardId) => {
      const card = cardsById[cardId];
      if (!card) {
        return 'Card';
      }
      if (card.rank && card.suit) {
        return `${card.rank} of ${card.suit}`;
      }
      return card.rank ?? 'Card';
    },
    [cardsById]
  );

  const screenToWorld = useCallback((clientX, clientY, playfieldRect, zoom) => {
    if (!playfieldRect || !zoom) {
      return null;
    }
    return {
      x: (clientX - playfieldRect.left) / zoom,
      y: (clientY - playfieldRect.top) / zoom
    };
  }, []);

  const updateHandZonesFromDom = useCallback(() => {
    const tableNode = tableRef.current;
    if (!tableNode) {
      return;
    }
    const tableRect = tableNode.getBoundingClientRect();
    const zoom = tableScaleRef.current || 1;
    const insetScale = 0.94;
    const nextZones = seatPositions.map((seat) => {
      const seatPad = seatPadRefs.current[seat.seatIndex];
      if (seatPad) {
        const padRect = seatPad.getBoundingClientRect();
        // Convert screen rect -> table-world coordinates (playfield rect + zoom).
        const topLeft = screenToWorld(padRect.left, padRect.top, tableRect, zoom);
        const bottomRight = screenToWorld(
          padRect.right,
          padRect.bottom,
          tableRect,
          zoom
        );
        if (topLeft && bottomRight) {
          const width = Math.max(0, bottomRight.x - topLeft.x);
          const height = Math.max(0, bottomRight.y - topLeft.y);
          return {
            seatId: seat.id,
            seatIndex: seat.seatIndex,
            x: (topLeft.x + bottomRight.x) / 2,
            y: (topLeft.y + bottomRight.y) / 2,
            width: width * insetScale,
            height: height * insetScale,
            rotation: 0
          };
        }
      }
      return {
        seatId: seat.id,
        seatIndex: seat.seatIndex,
        x: seat.x - Math.cos(seat.angle) * handZoneSeatOffset,
        y: seat.y - Math.sin(seat.angle) * handZoneSeatOffset,
        width: handZoneSize.width,
        height: handZoneSize.height,
        rotation: 0
      };
    });
    setHandZones(nextZones);
  }, [
    handZoneSeatOffset,
    handZoneSize.height,
    handZoneSize.width,
    screenToWorld,
    seatPositions
  ]);

  const getHandZoneAtPoint = useCallback(
    (x, y) => {
      for (let i = 0; i < handZones.length; i += 1) {
        const zone = handZones[i];
        const left = zone.x - zone.width / 2;
        const top = zone.y - zone.height / 2;
        if (x >= left && x <= left + zone.width && y >= top && y <= top + zone.height) {
          return zone.seatIndex;
        }
      }
      return null;
    },
    [handZones]
  );

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
    const seatRailWidth = tableBounds.width / scale;
    const seatRailHeight = tableBounds.height / scale;
    const seatRailOffsetX = (tableBounds.left - frameRect.left) / scale;
    const seatRailOffsetY = (tableBounds.top - frameRect.top) / scale;
    if (
      !frameWidth ||
      !frameHeight ||
      !feltWidth ||
      !feltHeight ||
      !seatRailWidth ||
      !seatRailHeight
    ) {
      setSeatPositions(seats.map((seat) => ({ ...seat, x: 0, y: 0 })));
      setFeltBounds(null);
      setSeatRailBounds(null);
      return;
    }

    const nextFeltBounds = {
      left: feltOffsetX,
      right: feltOffsetX + feltWidth,
      top: feltOffsetY,
      bottom: feltOffsetY + feltHeight,
      width: feltWidth,
      height: feltHeight
    };
    setFeltBounds(nextFeltBounds);
    const nextSeatRailBounds = {
      left: seatRailOffsetX,
      right: seatRailOffsetX + seatRailWidth,
      top: seatRailOffsetY,
      bottom: seatRailOffsetY + seatRailHeight,
      width: seatRailWidth,
      height: seatRailHeight
    };
    setSeatRailBounds(nextSeatRailBounds);
    const anchors = computeSeatAnchorsFromParams({
      seatParams,
      tableShape,
      seatRailBounds: nextSeatRailBounds
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
  }, [seatParams, seats, tableShape]);

  const updateTabletopScale = useCallback(() => {
    const frameNode = tableFrameRef.current;
    if (!frameNode) {
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
    const nextFootprint = Math.min(availableWidth, availableHeight) * TABLE_FOOTPRINT_SCALE;
    setTableFootprintPx(nextFootprint);
    const nextScale = Math.max(
      MIN_TABLETOP_SCALE,
      Math.min(
        MAX_TABLETOP_SCALE,
        Math.min(availableWidth / baseWidth, availableHeight / baseHeight)
      )
    );

    setTableScale(nextScale);
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
    layoutSeats();
  }, [combinedScale, layoutSeats]);

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
  }, [combinedScale, recomputeFeltGeometry, tableRect.height, tableRect.width, tableShape]);

  useEffect(() => {
    const raf = requestAnimationFrame(updateHandZonesFromDom);
    return () => cancelAnimationFrame(raf);
  }, [combinedScale, seatPositions, tableRect.height, tableRect.width, updateHandZonesFromDom]);

  useEffect(() => {
    if (!myPlayerId) {
      return;
    }
    setPresence((prev) => ({
      ...prev,
      [myPlayerId]: prev[myPlayerId] ?? {
        x: 0,
        y: 0,
        isDown: false,
        holdingCount: 0
      }
    }));
  }, [myPlayerId]);

  useEffect(() => {
    updatePresence({
      holdingCount: heldStack.active ? heldStack.cardIds.length : 0
    });
  }, [heldStack.active, heldStack.cardIds.length, updatePresence]);

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
          draggedX < stack.x + cardSize.width &&
          draggedX + cardSize.width > stack.x &&
          draggedY < stack.y + cardSize.height &&
          draggedY + cardSize.height > stack.y;
        if (overlaps) {
          return stack.id;
        }
      }
      return null;
    },
    [cardSize.height, cardSize.width, tableStacks]
  );

  const interactiveStackRects = useMemo(() => {
    return tableStacks.map((stack) => ({ id: stack.id, x: stack.x, y: stack.y }));
  }, [tableStacks]);

  const hitTestStack = useCallback((pointerX, pointerY) => {
    for (let i = interactiveStackRects.length - 1; i >= 0; i -= 1) {
      const stack = interactiveStackRects[i];
      if (
        pointerX >= stack.x &&
        pointerX <= stack.x + cardSize.width &&
        pointerY >= stack.y &&
        pointerY <= stack.y + cardSize.height
      ) {
        return stack.id;
      }
    }
    return null;
  }, [cardSize.height, cardSize.width, interactiveStackRects]);

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
        width: cardSize.width * scale,
        height: cardSize.height * scale
      };
      const centerScreen = {
        x: tableScreenRect.left + (topLeft.x + cardSize.width / 2) * scale,
        y: tableScreenRect.top + (topLeft.y + cardSize.height / 2) * scale
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
    [cardSize.height, cardSize.width, feltScreenRect, tableScreenRect, tableShape]
  );

  const getTablePointerPositionFromClient = useCallback((clientX, clientY) => {
    const table = tableRef.current;
    if (!table) {
      return null;
    }
    const scale = tableScaleRef.current;
    const tableRect = table.getBoundingClientRect();
    return screenToWorld(clientX, clientY, tableRect, scale);
  }, [screenToWorld]);

  const getTablePointerPosition = useCallback(
    (event) =>
      getTablePointerPositionFromClient(event.clientX, event.clientY),
    [getTablePointerPositionFromClient]
  );

  const updateSeatParam = useCallback(
    (seatIndex, value) => {
      setSettings((prev) => {
        const paramsByShape = prev.roomSettings.seatParams ?? {};
        const params = normalizeSeatParams(paramsByShape[tableShape], seatCount, tableShape);
        const nextParams = [...params];
        nextParams[seatIndex] = value;
        return {
          ...prev,
          roomSettings: {
            ...prev.roomSettings,
            seatParams: {
              ...paramsByShape,
              [tableShape]: nextParams
            }
          }
        };
      });
    },
    [normalizeSeatParams, seatCount, tableShape]
  );

  const updateSeatParamFromPointer = useCallback(
    (event, seatIndex) => {
      if (!seatRailBounds) {
        return;
      }
      const position = getTablePointerPosition(event);
      if (!position) {
        return;
      }
      const candidate = paramFromPointer(tableShape, seatRailBounds, position);
      const nextParams = [...seatParams];
      nextParams[seatIndex] = candidate;
      const clamped = clampParamBetweenNeighbors(
        nextParams,
        seatIndex,
        SEAT_MIN_GAP_PX,
        tableShape,
        seatRailBounds
      );
      updateSeatParam(seatIndex, clamped);
    },
    [seatRailBounds, getTablePointerPosition, seatParams, tableShape, updateSeatParam]
  );

  const handleSeatPointerDown = useCallback(
    (event, seatIndex) => {
      if (heldStack.active) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      if (target?.setPointerCapture) {
        target.setPointerCapture(event.pointerId);
        capturedPointerRef.current = { pointerId: event.pointerId, element: target };
      }
      seatDragRef.current = {
        seatIndex,
        moved: false,
        start: { x: event.clientX, y: event.clientY }
      };
      setDragSeatIndex(seatIndex);
      updateSeatParamFromPointer(event, seatIndex);
    },
    [heldStack.active, updateSeatParamFromPointer]
  );

  const handleSeatPointerMove = useCallback(
    (event, seatIndex) => {
      if (dragSeatIndex !== seatIndex) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (seatDragRef.current.start && !seatDragRef.current.moved) {
        const dx = event.clientX - seatDragRef.current.start.x;
        const dy = event.clientY - seatDragRef.current.start.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          seatDragRef.current.moved = true;
        }
      }
      updateSeatParamFromPointer(event, seatIndex);
    },
    [dragSeatIndex, updateSeatParamFromPointer]
  );

  const handleSeatPointerUp = useCallback(() => {
    releaseCapturedPointer();
    setDragSeatIndex(null);
  }, [releaseCapturedPointer]);

  const openSeatMenu = useCallback((seatIndex) => {
    setSeatMenuState({ seatIndex, open: true });
  }, []);

  const closeSeatMenu = useCallback(() => {
    setSeatMenuState({ seatIndex: null, open: false });
  }, []);

  const handleSeatClick = useCallback(
    (seatIndex) => {
      if (seatDragRef.current.moved && seatDragRef.current.seatIndex === seatIndex) {
        seatDragRef.current = { seatIndex: null, moved: false, start: null };
        return;
      }
      seatDragRef.current = { seatIndex: null, moved: false, start: null };
      openSeatMenu(seatIndex);
    },
    [openSeatMenu]
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

  const getPointerPositionForHold = useCallback(
    (pointerEvent, fallbackStack) => {
      const pointerPosition = pointerEvent
        ? getTablePointerPosition(pointerEvent)
        : getTablePointerPositionFromClient(
            lastPointerRef.current.x,
            lastPointerRef.current.y
          );
      if (!pointerPosition || !fallbackStack) {
        return { pointerPosition: null, isOverStack: false };
      }
      const isOverStack =
        pointerPosition.x >= fallbackStack.x &&
        pointerPosition.x <= fallbackStack.x + cardSize.width &&
        pointerPosition.y >= fallbackStack.y &&
        pointerPosition.y <= fallbackStack.y + cardSize.height;
      return { pointerPosition, isOverStack };
    },
    [
      cardSize.height,
      cardSize.width,
      getTablePointerPosition,
      getTablePointerPositionFromClient
    ]
  );

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
      closeSeatMenu();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    closeSeatMenu,
    heldStack.active,
    heldStack.origin,
    heldStack.stackId,
    setStacks,
    undoLastOwnMovement
  ]);

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
        const handSeatIndex = pointerPosition
          ? getHandZoneAtPoint(pointerPosition.x, pointerPosition.y)
          : getHandZoneAtPoint(
              draggedX + cardSize.width / 2,
              draggedY + cardSize.height / 2
            );
        if (
          handSeatIndex !== null &&
          handSeatIndex !== undefined &&
          mySeatIndex !== null &&
          handSeatIndex === mySeatIndex
        ) {
          const draggedCards = stacksById[heldStack.stackId]?.cardIds ?? [];
          if (draggedCards.length) {
            moveToHand(mySeatIndex, draggedCards);
            pushAction(
              `${myName} moved ${draggedCards.length} ${draggedCards.length === 1 ? 'card' : 'cards'} to hand`
            );
            applyOwnMovement((prev) => prev.filter((stack) => stack.id !== heldStack.stackId));
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
          return;
        }
        if (
          handSeatIndex !== null &&
          handSeatIndex !== undefined &&
          mySeatIndex !== null &&
          handSeatIndex !== mySeatIndex
        ) {
          applyOwnMovement((prev) =>
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
      applyOwnMovement,
      cardSize.height,
      cardSize.width,
      getDropTransformFromPointer,
      heldStack,
      logPlacementDebug,
      showFeltDebug,
      stacks,
      stacksById,
      getHandZoneAtPoint,
      getTablePointerPositionFromClient,
      moveToHand,
      mySeatIndex,
      myName,
      pushAction
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
              newStack.x < stack.x + cardSize.width &&
              newStack.x + cardSize.width > stack.x &&
              newStack.y < stack.y + cardSize.height &&
              newStack.y + cardSize.height > stack.y;
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
      cardSize.height,
      cardSize.width,
      getDropTransformFromPointer,
      createStackId,
      heldStack,
      logPlacementDebug,
      setStacks,
      showFeltDebug,
      stacks
    ]
  );

  const handleInventoryDragStart = useCallback((event, cardId) => {
    if (!event.dataTransfer) {
      return;
    }
    event.dataTransfer.setData('text/plain', cardId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleInventoryReorderDrop = useCallback(
    (draggedId, targetIndex) => {
      if (mySeatIndex === null || mySeatIndex === undefined) {
        return;
      }
      reorderHand(mySeatIndex, draggedId, targetIndex);
    },
    [mySeatIndex, reorderHand]
  );

  const handleInventoryDropToEnd = useCallback(
    (draggedId) => {
      if (mySeatIndex === null || mySeatIndex === undefined) {
        return;
      }
      const seatHandCount = hands?.[mySeatIndex]?.cardIds?.length ?? 0;
      reorderHand(mySeatIndex, draggedId, seatHandCount);
    },
    [hands, mySeatIndex, reorderHand]
  );

  const handleTableDragOver = useCallback((event) => {
    if (event.dataTransfer?.types?.includes('text/plain')) {
      event.preventDefault();
    }
  }, []);

  const handleTableDrop = useCallback(
    (event) => {
      event.preventDefault();
      const cardId = event.dataTransfer?.getData('text/plain');
      if (!cardId || mySeatIndex === null || mySeatIndex === undefined) {
        return;
      }
      const seatHand = hands?.[mySeatIndex]?.cardIds ?? [];
      if (!seatHand.includes(cardId)) {
        return;
      }
      const pointer = getTablePointerPositionFromClient(event.clientX, event.clientY);
      if (!pointer) {
        return;
      }
      const handSeatIndex = getHandZoneAtPoint(pointer.x, pointer.y);
      if (handSeatIndex !== null && handSeatIndex !== undefined) {
        return;
      }
      const rawPlacement = {
        x: pointer.x - cardSize.width / 2,
        y: pointer.y - cardSize.height / 2
      };
      const clamped = clampTopLeftToFelt(rawPlacement);
      const placement = clamped.position ?? rawPlacement;
      moveFromHandToTable(mySeatIndex, cardId);
      applyOwnMovement((prev) =>
        prev.concat({
          id: createStackId(),
          x: placement.x,
          y: placement.y,
          rotation: 0,
          faceUp: true,
          cardIds: [cardId],
          zone: 'table',
          ownerSeatIndex: null
        })
      );
      pushAction(`${myName} played ${getCardLabel(cardId)}`);
    },
    [
      applyOwnMovement,
      cardSize.height,
      cardSize.width,
      clampTopLeftToFelt,
      createStackId,
      getCardLabel,
      getHandZoneAtPoint,
      getTablePointerPositionFromClient,
      hands,
      moveFromHandToTable,
      myName,
      mySeatIndex,
      pushAction
    ]
  );

  const handleToggleReveal = useCallback(
    (cardId) => {
      if (mySeatIndex === null || mySeatIndex === undefined) {
        return;
      }
      const seatHand = hands?.[mySeatIndex];
      const isRevealed = Boolean(seatHand?.revealed?.[cardId]);
      toggleReveal(mySeatIndex, cardId);
      pushAction(`${myName} ${isRevealed ? 'hid' : 'revealed'} ${getCardLabel(cardId)}`);
    },
    [getCardLabel, hands, myName, mySeatIndex, pushAction, toggleReveal]
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
      updatePresence({ x: position.x, y: position.y });
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
            const directionLength = Math.hypot(
              sweepPointer.x - lastPos.x,
              sweepPointer.y - lastPos.y
            );
            const sweepDirection =
              directionLength > 0
                ? {
                    x: (sweepPointer.x - lastPos.x) / directionLength,
                    y: (sweepPointer.y - lastPos.y) / directionLength
                  }
                : null;
            dealOneFromHeld(lastPointerRef.current.x, lastPointerRef.current.y, {
              skipMerge: true,
              applySweepSpacing: true,
              sweepDirection
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
    resetRightSweep,
    updatePresence
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
    const handlePointerUp = () => {
      updatePresence({ isDown: false });
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('blur', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('blur', handlePointerUp);
    };
  }, [updatePresence]);

  useEffect(() => {
    if (pickCountOpen || settingsOpen || roomSettingsOpen) {
      resetRightSweep();
    }
  }, [pickCountOpen, resetRightSweep, roomSettingsOpen, settingsOpen]);

  const startHeldStack = useCallback(
    (stackId, pointerX, pointerY) => {
      const stack = stacksById[stackId];
      if (!stack || !stack.cardIds.length) {
        return;
      }
      const offset = {
        dx: pointerX - stack.x,
        dy: pointerY - stack.y
      };
      const visualStack = interactiveStackRects.find((item) => item.id === stackId);
      const originX = visualStack?.x ?? stack.x ?? 0;
      const originY = visualStack?.y ?? stack.y ?? 0;
      latestPoint.current = { x: originX, y: originY };
      setHeldStack({
        active: true,
        stackId,
        cardIds: [...stack.cardIds],
        sourceStackId: null,
        offset,
        origin: { x: originX, y: originY },
        mode: 'stack'
      });
    },
    [interactiveStackRects, stacksById]
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
      if (pending.button === 2) {
        // RMB drag pulls the top card into a new held stack.
        const originStack = stacksById[pending.stackId];
        if (!originStack || originStack.cardIds.length === 0) {
          return;
        }
        const topCardId = takeTopCardFromStack(pending.stackId);
        if (!topCardId) {
          return;
        }
        const spawned = spawnHeldStack([topCardId], pending.stackId, originStack);
        if (!spawned?.stackId) {
          return;
        }
        const offset = {
          dx: pointerX - originStack.x,
          dy: pointerY - originStack.y
        };
        latestPoint.current = { x: originStack.x, y: originStack.y };
        setHeldStack({
          active: true,
          stackId: spawned.stackId,
          cardIds: [topCardId],
          sourceStackId: pending.stackId,
          offset,
          origin: { x: originStack.x, y: originStack.y },
          mode: 'singleCard'
        });
        return;
      }
      bringStackToFront(pending.stackId);
      startHeldStack(pending.stackId, pointerX, pointerY);
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
      if (pending.button !== 2) {
        bringStackToFront(pending.stackId);
        setSelectedStackId(pending.stackId);
        setPickCountOpen(false);
      }
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
    spawnHeldStack,
    stacksById,
    startHeldStack,
    takeTopCardFromStack
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
      const { pointerPosition, isOverStack } = getPointerPositionForHold(
        pointerEvent,
        source
      );
      const clampedCount = Math.max(1, Math.min(requestedCount, source.cardIds.length));
      const newStackId = createStackId();
      let pickedCardIds = [];
      let origin = null;
      let heldPosition = null;
      const offset =
        pointerPosition && isOverStack
          ? {
              dx: pointerPosition.x - source.x,
              dy: pointerPosition.y - source.y
            }
          : { dx: cardSize.width / 2, dy: cardSize.height / 2 };
      if (pointerPosition && isOverStack) {
        heldPosition = getHeldTopLeft(pointerPosition.x, pointerPosition.y, offset);
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
    [
      applyOwnMovement,
      cardSize.height,
      cardSize.width,
      createStackId,
      getHeldTopLeft,
      getPointerPositionForHold,
      stacksById
    ]
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
        if (event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
          event.currentTarget.setPointerCapture(event.pointerId);
          capturedPointerRef.current = {
            pointerId: event.pointerId,
            element: event.currentTarget
          };
        }
        pendingDragRef.current = {
          stackId,
          startX: position.x,
          startY: position.y,
          pointerId: event.pointerId,
          button: 2
        };
        setPendingDragActive(true);
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
        pointerId: event.pointerId,
        button: 0
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
      closeSeatMenu();
      updatePresence({ isDown: true });
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
      closeSeatMenu,
      dealOneFromHeld,
      getTablePointerPosition,
      handleStackPointerDown,
      heldStack.active,
      hitTestStack,
      placeHeldStack,
      updatePresence
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
      const position = getTablePointerPosition(event);
      if (position) {
        updatePresence({ x: position.x, y: position.y });
      }
      handlePointerMoveHover(event);
    },
    [getTablePointerPosition, handlePointerMoveHover, updatePresence]
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
    pushAction(`${myName} shuffled a stack`);
  }, [applyOwnMovement, myName, pushAction, selectedStackId]);

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
    pushAction(`${myName} flipped a stack`);
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
  }, [applyOwnMovement, myName, pushAction, stacksById]);

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
    pushAction(`${myName} flipped a stack`);
  }, [applyOwnMovement, myName, pushAction, selectedStackId, stacksById]);

  const handleMoveSelectedToHand = useCallback(() => {
    if (!selectedStackId || mySeatIndex === null || mySeatIndex === undefined) {
      return;
    }
    const selected = stacksById[selectedStackId];
    if (!selected) {
      return;
    }
    moveToHand(mySeatIndex, selected.cardIds);
    pushAction(
      `${myName} moved ${selected.cardIds.length} ${selected.cardIds.length === 1 ? 'card' : 'cards'} to hand`
    );
    applyOwnMovement((prev) => prev.filter((stack) => stack.id !== selectedStackId));
    setSelectedStackId(null);
    setPickCountOpen(false);
  }, [
    applyOwnMovement,
    moveToHand,
    myName,
    mySeatIndex,
    pushAction,
    selectedStackId,
    stacksById
  ]);

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
            (selectedStack.x + cardSize.width / 2) * combinedScale,
          top:
            tableScreenRect.top +
            (menuBelow
              ? selectedStack.y + cardSize.height + 10
              : selectedStack.y - 10) *
              combinedScale
        }
      : null;
  const menuStackCount = selectedStack ? selectedStack.cardIds.length : 0;
  const seatMenuSeat =
    seatMenuState.open && seatMenuState.seatIndex !== null
      ? seatPositions[seatMenuState.seatIndex]
      : null;
  const seatMenuPosition =
    seatMenuSeat && tableScreenRect
      ? {
          left: tableScreenRect.left + seatMenuSeat.x * combinedScale,
          top: tableScreenRect.top + seatMenuSeat.y * combinedScale
        }
      : null;
  const seatMenuPlayerId =
    seatMenuSeat && seatMenuSeat.seatIndex !== undefined
      ? seatAssignments[seatMenuSeat.seatIndex]
      : null;
  const seatMenuPlayer = seatMenuPlayerId ? players[seatMenuPlayerId] : null;
  const seatMenuIsMine = seatMenuPlayerId === myPlayerId;
  const seatMenuIsOccupied = Boolean(seatMenuPlayerId);
  const uiOverlayRoot =
    typeof document !== 'undefined' ? document.getElementById('ui-overlay') : null;
  const dragCardPosition =
    heldStackData && tableScreenRect
      ? {
          x: tableScreenRect.left + heldStackData.x * combinedScale,
          y: tableScreenRect.top + heldStackData.y * combinedScale
        }
      : null;
  return (
    <div className="tabletop">
      <div
        id="sceneRoot"
        ref={sceneRootRef}
        style={{
          '--tableScale': combinedScale,
          '--player-accent': players[myPlayerId]?.accentColor ?? '#efd8a0'
        }}
      >
        <div
          ref={tableFrameRef}
          className={`table-frame table-frame--${tableStyle} table-frame--${tableShape}`}
          style={{
            '--card-scale': viewTransform.cardScale,
            '--table-width': `${(() => {
              const footprint =
                tableFootprintPx ?? Math.min(TABLE_BASE_WIDTH, TABLE_BASE_HEIGHT);
              if (tableShape === 'circle') {
                return footprint;
              }
              return footprint * (TABLE_BASE_WIDTH / TABLE_BASE_HEIGHT);
            })()}px`,
            '--table-height': `${tableFootprintPx ?? Math.min(TABLE_BASE_WIDTH, TABLE_BASE_HEIGHT)}px`
          }}
        >
          <div id="seatLayer" className="table__seats" aria-label="Table seats">
            {seatPositions.map((seat) => {
              const seatPlayerId = seatAssignments[seat.seatIndex];
              const seatPlayer = seatPlayerId ? players[seatPlayerId] : null;
              const occupied = Boolean(seatPlayerId);
              const isMine = seatPlayerId === myPlayerId;
              const seatHandCount = hands?.[seat.seatIndex]?.cardIds?.length ?? 0;
              const seatStyle = {
                left: `${seat.x}px`,
                top: `${seat.y}px`,
                '--seat-color': seatPlayer?.seatColor ?? null,
                '--seat-accent': seatPlayer?.accentColor ?? null
              };
              return (
                <div
                  key={seat.id}
                  className={`seat seat--${seat.side} ${occupied ? 'seat--occupied' : ''} ${isMine ? 'seat--mine' : ''} ${seatHandCount ? 'seat--has-cards' : ''} ${dragSeatIndex === seat.seatIndex ? 'seat--dragging' : ''}`}
                  data-seat-index={seat.seatIndex}
                  style={seatStyle}
                  onClick={() => handleSeatClick(seat.seatIndex)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSeatClick(seat.seatIndex);
                    }
                  }}
                  onPointerDown={(event) => handleSeatPointerDown(event, seat.seatIndex)}
                  onPointerMove={(event) => handleSeatPointerMove(event, seat.seatIndex)}
                  onPointerUp={handleSeatPointerUp}
                  onPointerCancel={handleSeatPointerUp}
                  role="button"
                  tabIndex={0}
                >
                  <div className="seat__base" />
                  <div className="seat__bench">
                    <div className="seat__label">{seat.label.toUpperCase()}</div>

                    <div
                      ref={(el) => {
                        seatPadRefs.current[seat.seatIndex] = el;
                      }}
                      className="seat__hand"
                      aria-label={`${seat.label} hand zone`}
                    >
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
              onDragOver={handleTableDragOver}
              onDrop={handleTableDrop}
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
                const isOwnerZone = mySeatIndex === zone.seatIndex;
                const isDragHover = heldStack.active && hoverHandSeatId === zone.seatIndex;
                const isValidDropZone = isDragHover && isOwnerZone;
                const isInvalidDropZone =
                  isDragHover && mySeatIndex !== null && zone.seatIndex !== mySeatIndex;
                const seatHand = hands?.[zone.seatIndex] ?? { cardIds: [], revealed: {} };
                const count = seatHand.cardIds.length;
                const seatPlayerId = seatAssignments[zone.seatIndex];
                const seatPlayer = seatPlayerId ? players[seatPlayerId] : null;
                return (
                  <div
                    key={`hand-zone-${zone.seatId}`}
                    className={`hand-zone ${isOwnerZone ? 'hand-zone--owner' : ''} ${isDragHover ? 'hand-zone--hover' : ''} ${isValidDropZone ? 'hand-zone--valid' : ''} ${isInvalidDropZone ? 'hand-zone--invalid' : ''}`}
                    style={{
                      left: `${zone.x}px`,
                      top: `${zone.y}px`,
                      width: `${zone.width}px`,
                      height: `${zone.height}px`,
                      '--zone-rotation': `${zone.rotation ?? 0}rad`,
                      '--seat-color': seatPlayer?.seatColor ?? null,
                      '--seat-accent': seatPlayer?.accentColor ?? null
                    }}
                  >
                    <div className="hand-zone__count">
                      Hand {count ? `(${count})` : ''}
                    </div>
                  </div>
                );
              })}
              {handZones.map((zone) => {
                const seatHand = hands?.[zone.seatIndex] ?? { cardIds: [], revealed: {} };
                const count = seatHand.cardIds.length;
                const isOwnerZone = mySeatIndex === zone.seatIndex;
                const revealedIds = seatHand.cardIds.filter(
                  (cardId) => seatHand.revealed?.[cardId]
                );
                if (!count && revealedIds.length === 0) {
                  return null;
                }
                return (
                  <div key={`hand-visual-${zone.seatId}`}>
                    {!isOwnerZone && count ? (
                      <div
                        className="hand-proxy"
                        style={{ left: `${zone.x}px`, top: `${zone.y}px` }}
                      >
                        <div className="hand-proxy__cards" />
                        <div className="hand-proxy__count">{count}</div>
                      </div>
                    ) : null}
                    {revealedIds.length ? (
                      <div
                        className="hand-reveal"
                        style={{ left: `${zone.x}px`, top: `${zone.y}px` }}
                      >
                        {revealedIds.map((cardId, index) => {
                          const card = cardsById[cardId];
                          return (
                            <div
                              key={`hand-reveal-${zone.seatId}-${cardId}`}
                              className="hand-reveal__card"
                              style={{
                                transform: `translate(${index * cardSize.width * 0.35}px, 0)`
                              }}
                            >
                              <Card
                                id={`reveal-${cardId}`}
                                x={0}
                                y={0}
                                rotation={0}
                                faceUp
                                cardStyle={appliedSettings.cardStyle}
                                zIndex={1}
                                rank={card?.rank}
                                suit={card?.suit}
                                color={card?.color}
                                onPointerDown={() => {}}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {Object.entries(presence).map(([playerId, ghost]) => {
                if (!Number.isFinite(ghost?.x) || !Number.isFinite(ghost?.y)) {
                  return null;
                }
                const player = players[playerId];
                const label = player?.name ?? 'Player';
                const accent = player?.accentColor ?? '#f5b96c';
                return (
                  <div
                    key={`cursor-${playerId}`}
                    className={`cursor-ghost ${ghost.isDown ? 'cursor-ghost--down' : ''}`}
                    style={{
                      left: `${ghost.x}px`,
                      top: `${ghost.y}px`,
                      '--ghost-color': accent
                    }}
                  >
                    <div className="cursor-ghost__dot" />
                    <div className="cursor-ghost__label">{label}</div>
                    {ghost.holdingCount ? (
                      <div className="cursor-ghost__badge">+{ghost.holdingCount}</div>
                    ) : null}
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
                      onContextMenu={(event) => event.preventDefault()}
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
      {mySeatIndex !== null ? (
        <InventoryPanel
          cardIds={hands?.[mySeatIndex]?.cardIds ?? []}
          cardsById={cardsById}
          revealed={hands?.[mySeatIndex]?.revealed ?? {}}
          onToggleReveal={handleToggleReveal}
          onCardDragStart={handleInventoryDragStart}
          onCardDrop={handleInventoryReorderDrop}
          onDropToEnd={handleInventoryDropToEnd}
          accentColor={players[myPlayerId]?.accentColor}
          cardStyle={appliedSettings.cardStyle}
        />
      ) : null}
      {heldStackData && uiOverlayRoot && dragCardPosition
        ? createPortal(
            <div
                className="drag-layer"
                aria-hidden="true"
                style={{ '--card-scale': viewTransform.cardScale * combinedScale }}
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
                  onContextMenu={(event) => event.preventDefault()}
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
            <label className="table-settings__row">
              <span className="table-settings__label">Table Zoom</span>
              <div className="table-settings__range">
                <input
                  type="range"
                  min="0.5"
                  max="1.4"
                  step="0.01"
                  value={settings.tableZoom ?? 1}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      tableZoom: clamp(Number(event.target.value), 0.5, 1.4)
                    }))
                  }
                />
                <span className="table-settings__value">
                  {Math.round((settings.tableZoom ?? 1) * 100)}%
                </span>
              </div>
            </label>
            <label className="table-settings__row">
              <span className="table-settings__label">Card Size</span>
              <div className="table-settings__range">
                <input
                  type="range"
                  min="0.7"
                  max="1.6"
                  step="0.01"
                  value={settings.cardScale ?? 1}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      cardScale: clamp(Number(event.target.value), 0.7, 1.6)
                    }))
                  }
                />
                <span className="table-settings__value">
                  {Math.round((settings.cardScale ?? 1) * 100)}%
                </span>
              </div>
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
                  <option value="circle">Circle</option>
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
              {mySeatIndex !== null ? (
                <button
                  type="button"
                  className="stack-menu__button"
                  onClick={handleMoveSelectedToHand}
                >
                  Move to Hand
                </button>
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
      {seatMenuSeat && seatMenuPosition && uiOverlayRoot
        ? createPortal(
            <div
              className="seat-menu__wrapper"
              style={{
                left: `${seatMenuPosition.left}px`,
                top: `${seatMenuPosition.top}px`
              }}
            >
              <SeatMenu
                seatLabel={seatMenuSeat.label}
                isMine={seatMenuIsMine}
                isOccupied={seatMenuIsOccupied}
                seatColor={
                  seatMenuPlayer?.seatColor ?? players[myPlayerId]?.seatColor ?? '#6a8dff'
                }
                accentColor={
                  seatMenuPlayer?.accentColor ?? players[myPlayerId]?.accentColor ?? '#f5b96c'
                }
                onSit={() => {
                  sitAtSeat(seatMenuSeat.seatIndex);
                  pushAction(`${myName} sat at ${seatMenuSeat.label}`);
                  closeSeatMenu();
                }}
                onStand={() => {
                  standUp();
                  pushAction(`${myName} left ${seatMenuSeat.label}`);
                  closeSeatMenu();
                }}
                onUpdateColors={updatePlayerColors}
                onClose={closeSeatMenu}
              />
            </div>,
            uiOverlayRoot
          )
        : null}
      {uiOverlayRoot
        ? createPortal(<ActionLog entries={actionLog} />, uiOverlayRoot)
        : <ActionLog entries={actionLog} />}
    </div>
  );
};

export default Table;
