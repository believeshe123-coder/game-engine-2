import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Card from './Card.jsx';
import InventoryPanel from './InventoryPanel.jsx';
import ActionLog from './ActionLog.jsx';
import CursorGhost from './CursorGhost.jsx';
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
const SLIDE_MAX_DROPS_PER_TICK = 6;
const HOLD_DELAY_MS = 140;
const HOLD_MOVE_PX = 10;
const SLIDE_SPACING_PX = 60;
const SLIDE_JITTER_PX = 3;
const SLIDE_MIN_SEPARATION_PX = 40;
const SLIDE_START_DIR_THRESHOLD_PX = 10;
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
  const seatCount = settings.roomSettings.seatCount;
  const {
    cardsById,
    allCardIds,
    stacks,
    setStacks,
    createStackId,
    rebuildTableFromSettings,
    players,
    player,
    mySeatIndex,
    seatAssignments,
    handsBySeat,
    myPlayerId,
    actionLog,
    presence,
    sitAtSeat,
    standUp,
    setPlayerName,
    setSeatColor,
    setAccentColor,
    logAction,
    updatePresence,
    moveCardIdsToHand,
    moveFromHandToTable,
    reorderHand,
    toggleReveal
  } = useTableState(
    tableRect,
    cardSize,
    appliedSettings,
    seatCount
  );
  const hands = handsBySeat;
  const [cardFaceOverrides, setCardFaceOverrides] = useState({});
  const [interaction, setInteraction] = useState({
    mode: 'idle',
    pointerId: null,
    source: null,
    held: null,
    drag: null,
    rmbDown: false,
    rmbDownAt: 0,
    isSliding: false,
    rmbStartWorld: { x: 0, y: 0 },
    slideOrigin: null,
    slideDir: null,
    slidePerp: null,
    slideIndex: 0,
    slideTrail: [],
    lastSlidePlace: null,
    slideLastPos: null,
    slideCarryDist: 0,
    selectedStackId: null,
    menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
  });
  const [hoveredStackId, setHoveredStackId] = useState(null);
  const pointerDownRef = useRef(null);
  const rmbHoldTimerRef = useRef(null);
  const lastPointerWorldRef = useRef(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const [pickCountOpen, setPickCountOpen] = useState(false);
  const [pickCountValue, setPickCountValue] = useState('1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [dragSeatIndex, setDragSeatIndex] = useState(null);
  const [seatMenuState, setSeatMenuState] = useState({
    seatIndex: null,
    open: false
  });
  const myName = player?.name ?? 'Player';

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    const counts = new Map();
    const addCard = (cardId) => {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    };
    stacks.forEach((stack) => {
      stack.cardIds.forEach(addCard);
    });
    Object.values(hands ?? {}).forEach((hand) => {
      (hand?.cardIds ?? []).forEach(addCard);
    });
    interaction.held?.cardIds?.forEach(addCard);

    const duplicates = [];
    counts.forEach((count, cardId) => {
      if (count > 1) {
        duplicates.push(`${cardId} appears ${count}x`);
      }
    });
    const expectedTotal =
      allCardIds?.length ?? Object.keys(cardsById ?? {}).length;
    const actualTotal = counts.size
      ? Array.from(counts.values()).reduce((sum, value) => sum + value, 0)
      : 0;
    const missing =
      expectedTotal > 0
        ? (allCardIds ?? Object.keys(cardsById ?? {})).filter(
            (cardId) => !counts.has(cardId)
          )
        : [];
    if (duplicates.length || (expectedTotal && actualTotal !== expectedTotal) || missing.length) {
      // eslint-disable-next-line no-console
      console.error('[card-invariant] card conservation violated', {
        duplicates,
        missing,
        expectedTotal,
        actualTotal
      });
    }
  }, [allCardIds, cardsById, hands, interaction.held, stacks]);
  const adjustSlideSeparation = useCallback((position, direction, trail) => {
    if (!direction || trail.length === 0) {
      return position;
    }
    let adjusted = { ...position };
    const maxAttempts = 12;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let nearestDistance = Infinity;
      for (let i = 0; i < trail.length; i += 1) {
        const point = trail[i];
        const distance = Math.hypot(adjusted.x - point.x, adjusted.y - point.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
        }
      }
      if (nearestDistance >= SLIDE_MIN_SEPARATION_PX) {
        break;
      }
      adjusted = {
        x: adjusted.x + direction.x * SLIDE_SPACING_PX,
        y: adjusted.y + direction.y * SLIDE_SPACING_PX
      };
    }
    return adjusted;
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
            width,
            height,
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
    updatePresence({});
  }, [updatePresence]);

  useEffect(() => {
    updatePresence({
      holdingCount: interaction.held ? interaction.held.cardIds.length : 0
    });
  }, [interaction.held, updatePresence]);

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

  useEffect(() => {
    if (!interaction.selectedStackId) {
      return;
    }
    if (stacksById[interaction.selectedStackId]) {
      return;
    }
    setInteraction((prev) => ({
      ...prev,
      selectedStackId: null,
      menu: { ...prev.menu, open: false, stackId: null }
    }));
  }, [interaction.selectedStackId, setInteraction, stacksById]);

  useEffect(() => {
    if (!hoveredStackId) {
      return;
    }
    if (stacksById[hoveredStackId]) {
      return;
    }
    setHoveredStackId(null);
  }, [hoveredStackId, stacksById]);

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
      if (interaction.mode !== 'idle') {
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
    [interaction.mode, updateSeatParamFromPointer]
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

  const DRAG_THRESHOLD = 6;
  const defaultRmbState = useMemo(
    () => ({
      rmbDown: false,
      rmbDownAt: 0,
      isSliding: false,
      rmbStartWorld: { x: 0, y: 0 },
      slideOrigin: null,
      slideDir: null,
      slidePerp: null,
      slideIndex: 0,
      slideTrail: [],
      lastSlidePlace: null,
      slideLastPos: null,
      slideCarryDist: 0
    }),
    []
  );

  const getHeldTopLeft = useCallback((pointerPosition, offset) => {
    if (!pointerPosition) {
      return null;
    }
    return {
      x: pointerPosition.x - offset.x,
      y: pointerPosition.y - offset.y
    };
  }, []);

  const clearRmbHoldTimer = useCallback(() => {
    if (rmbHoldTimerRef.current) {
      clearTimeout(rmbHoldTimerRef.current);
      rmbHoldTimerRef.current = null;
    }
  }, []);

  const clearInteraction = useCallback((options = {}) => {
    clearRmbHoldTimer();
    const { nextSelectedStackId = null, preserveSelection = true } = options;
    setInteraction((prev) => ({
      ...prev,
      mode: 'idle',
      pointerId: null,
      source: null,
      held: null,
      drag: null,
      ...defaultRmbState,
      selectedStackId: preserveSelection
        ? nextSelectedStackId ?? prev.selectedStackId
        : nextSelectedStackId,
      menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
    }));
  }, [clearRmbHoldTimer, defaultRmbState]);

  const closeMenu = useCallback(() => {
    setPickCountOpen(false);
    setInteraction((prev) => ({
      ...prev,
      menu: { ...prev.menu, open: false, stackId: null }
    }));
  }, []);

  const selectStack = useCallback((stackId, screenXY) => {
    setPickCountOpen(false);
    setInteraction((prev) => ({
      ...prev,
      ...defaultRmbState,
      selectedStackId: stackId,
      menu: {
        open: true,
        stackId,
        screenX: screenXY?.x ?? 0,
        screenY: screenXY?.y ?? 0
      }
    }));
  }, [defaultRmbState]);

  const restoreHeldToOrigin = useCallback(() => {
    if (!interaction.held) {
      return;
    }
    const held = interaction.held;
    const origin = held.origin ?? {};
    setStacks((prev) => {
      if (origin.stackId) {
        const source = prev.find((stack) => stack.id === origin.stackId);
        if (source) {
          return prev.map((stack) =>
            stack.id === origin.stackId
              ? {
                  ...stack,
                  cardIds: origin.cardIdsBefore ?? [...stack.cardIds, ...held.cardIds]
                }
              : stack
          );
        }
      }
      return prev.concat({
        id: origin.stackId ?? held.stackId,
        x: origin.x ?? 0,
        y: origin.y ?? 0,
        rotation: 0,
        faceUp: held.faceUp ?? true,
        cardIds: origin.cardIdsBefore ?? held.cardIds,
        zone: 'table',
        ownerSeatIndex: null
      });
    });
    clearInteraction();
  }, [clearInteraction, interaction.held, setStacks]);

  const pickupFromStack = useCallback(
    (stackId, count, pointerId = null) => {
      const pointerPosition = lastPointerWorldRef.current;
      setStacks((prev) => {
        const source = prev.find((stack) => stack.id === stackId);
        if (!source) {
          return prev;
        }
        const total = source.cardIds.length;
        if (!total) {
          return prev;
        }
        const requested =
          count === 'all' ? total : Math.max(1, Number.parseInt(count, 10) || 1);
        const clamped = Math.min(requested, total);
        const remaining = source.cardIds.slice(0, total - clamped);
        const pickedIds = source.cardIds.slice(total - clamped);
        if (!pickedIds.length) {
          return prev;
        }
        const heldStackId = createStackId();
        const origin = {
          stackId: source.id,
          x: source.x,
          y: source.y,
          faceUp: source.faceUp,
          cardIdsBefore: source.cardIds
        };
        const originX = origin.x ?? 0;
        const originY = origin.y ?? 0;
        const offset = pointerPosition
          ? { x: pointerPosition.x - originX, y: pointerPosition.y - originY }
          : { x: cardSize.width / 2, y: cardSize.height / 2 };
        setInteraction((prevInteraction) => ({
          ...prevInteraction,
          mode: 'holdStack',
          pointerId,
          source: { stackId },
          held: {
            stackId: heldStackId,
            cardIds: pickedIds,
            faceUp: source.faceUp,
            origin
          },
          drag: {
            stackId: heldStackId,
            startWorld: pointerPosition ?? { x: originX, y: originY },
            offset,
            originXY: { x: originX, y: originY }
          },
          ...defaultRmbState,
          selectedStackId:
            remaining.length === 0 && prevInteraction.selectedStackId === stackId
              ? null
              : prevInteraction.selectedStackId,
          menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
        }));
        return prev
          .map((stack) =>
            stack.id === stackId ? { ...stack, cardIds: remaining } : stack
          )
          .filter((stack) => stack.id !== stackId || remaining.length > 0);
      });
    },
    [cardSize.height, cardSize.width, createStackId, defaultRmbState, setStacks]
  );

  const startDragStack = useCallback(
    (stackId, pointerWorld, pointerId) => {
      if (!pointerWorld) {
        return;
      }
      const stack = stacksById[stackId];
      if (!stack) {
        return;
      }
      bringStackToFront(stackId);
      setInteraction((prev) => ({
        ...prev,
        mode: 'dragStack',
        pointerId,
        source: { stackId },
        drag: {
          stackId,
          startWorld: pointerWorld,
          offset: { x: pointerWorld.x - stack.x, y: pointerWorld.y - stack.y },
          originXY: { x: stack.x, y: stack.y }
        },
        ...defaultRmbState,
        menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
      }));
    },
    [bringStackToFront, defaultRmbState, stacksById]
  );

  const updateDrag = useCallback(
    (pointerWorld) => {
      if (!pointerWorld || !interaction.drag) {
        return;
      }
      const nextTopLeft = getHeldTopLeft(pointerWorld, interaction.drag.offset);
      if (!nextTopLeft) {
        return;
      }
      const clamped = clampTopLeftToFelt(nextTopLeft);
      const position = clamped.position ?? nextTopLeft;
      if (interaction.mode === 'dragStack') {
        setStacks((prev) =>
          prev.map((stack) =>
            stack.id === interaction.drag.stackId
              ? { ...stack, x: position.x, y: position.y }
              : stack
          )
        );
      }
      setInteraction((prev) => ({
        ...prev,
        drag: prev.drag
          ? {
              ...prev.drag,
              startWorld: pointerWorld
            }
          : prev.drag
      }));
    },
    [clampTopLeftToFelt, getHeldTopLeft, interaction.drag, interaction.mode, setStacks]
  );

  const mergeStacks = useCallback(
    (sourceId, targetId) => {
      setStacks((prev) => {
        const source = prev.find((stack) => stack.id === sourceId);
        const target = prev.find((stack) => stack.id === targetId);
        if (!source || !target) {
          return prev;
        }
        const merged = {
          ...target,
          cardIds: [...target.cardIds, ...source.cardIds]
        };
        return prev.filter((stack) => stack.id !== sourceId && stack.id !== targetId).concat(merged);
      });
    },
    [setStacks]
  );

  const dropHeld = useCallback(
    (pointerWorld) => {
      const held = interaction.held;
      if (!held || !interaction.drag) {
        return;
      }
      const pointerPosition = pointerWorld ?? lastPointerWorldRef.current;
      if (!pointerPosition) {
        return;
      }
      const nextTopLeft = getHeldTopLeft(pointerPosition, interaction.drag.offset);
      if (!nextTopLeft) {
        return;
      }
      const clamped = clampTopLeftToFelt(nextTopLeft);
      const placement = clamped.position ?? nextTopLeft;
      const handSeatIndex = getHandZoneAtPoint(
        placement.x + cardSize.width / 2,
        placement.y + cardSize.height / 2
      );
      if (
        handSeatIndex !== null &&
        handSeatIndex !== undefined &&
        mySeatIndex !== null &&
        handSeatIndex === mySeatIndex
      ) {
        moveCardIdsToHand(mySeatIndex, held.cardIds);
        logAction(
          `${myName} moved ${held.cardIds.length} ${held.cardIds.length === 1 ? 'card' : 'cards'} to hand`
        );
        clearInteraction({ preserveSelection: false });
        return;
      }
      if (
        handSeatIndex !== null &&
        handSeatIndex !== undefined &&
        mySeatIndex !== null &&
        handSeatIndex !== mySeatIndex
      ) {
        restoreHeldToOrigin();
        return;
      }
      const overlapId = findTableOverlapStackId(placement.x, placement.y, null);
      if (overlapId) {
        setStacks((prev) => {
          const target = prev.find((stack) => stack.id === overlapId);
          if (!target) {
            return prev;
          }
          const merged = {
            ...target,
            cardIds: [...target.cardIds, ...held.cardIds]
          };
          return prev.filter((stack) => stack.id !== overlapId).concat(merged);
        });
        clearInteraction({
          preserveSelection: true,
          nextSelectedStackId:
            interaction.selectedStackId === held.origin?.stackId ||
            interaction.selectedStackId === held.stackId
              ? overlapId
              : interaction.selectedStackId
        });
        return;
      } else {
        setStacks((prev) =>
          prev.concat({
            id: held.stackId,
            x: placement.x,
            y: placement.y,
            rotation: 0,
            faceUp: held.faceUp ?? true,
            cardIds: held.cardIds,
            zone: 'table',
            ownerSeatIndex: null
          })
        );
      }
      clearInteraction({ preserveSelection: true });
    },
    [
      cardSize.height,
      cardSize.width,
      clampTopLeftToFelt,
      clearInteraction,
      findTableOverlapStackId,
      getHandZoneAtPoint,
      getHeldTopLeft,
      interaction.drag,
      interaction.held,
      interaction.selectedStackId,
      moveCardIdsToHand,
      myName,
      mySeatIndex,
      logAction,
      restoreHeldToOrigin,
      setStacks
    ]
  );

  const endDrag = useCallback(
    (pointerWorld) => {
      if (interaction.mode !== 'dragStack' || !interaction.drag) {
        return;
      }
      const draggedId = interaction.drag.stackId;
      const draggedStack = stacksById[draggedId];
      if (!draggedStack) {
        clearInteraction({ preserveSelection: false });
        return;
      }
      const placement = { x: draggedStack.x, y: draggedStack.y };
      const handSeatIndex = getHandZoneAtPoint(
        placement.x + cardSize.width / 2,
        placement.y + cardSize.height / 2
      );
      if (
        handSeatIndex !== null &&
        handSeatIndex !== undefined &&
        mySeatIndex !== null &&
        handSeatIndex === mySeatIndex
      ) {
        moveCardIdsToHand(mySeatIndex, draggedStack.cardIds);
        logAction(
          `${myName} moved ${draggedStack.cardIds.length} ${draggedStack.cardIds.length === 1 ? 'card' : 'cards'} to hand`
        );
        setStacks((prev) => prev.filter((stack) => stack.id !== draggedId));
        clearInteraction();
        return;
      }
      if (
        handSeatIndex !== null &&
        handSeatIndex !== undefined &&
        mySeatIndex !== null &&
        handSeatIndex !== mySeatIndex
      ) {
        setStacks((prev) =>
          prev.map((stack) =>
            stack.id === draggedId
              ? { ...stack, x: interaction.drag.originXY.x, y: interaction.drag.originXY.y }
              : stack
          )
        );
        clearInteraction({ preserveSelection: true });
        return;
      }
      const overlapId = findTableOverlapStackId(placement.x, placement.y, draggedId);
      if (overlapId) {
        mergeStacks(draggedId, overlapId);
        clearInteraction({
          preserveSelection: true,
          nextSelectedStackId:
            interaction.selectedStackId === draggedId
              ? overlapId
              : interaction.selectedStackId
        });
        return;
      }
      clearInteraction({ preserveSelection: true });
    },
    [
      cardSize.height,
      cardSize.width,
      clearInteraction,
      findTableOverlapStackId,
      getHandZoneAtPoint,
      interaction.drag,
      interaction.mode,
      interaction.selectedStackId,
      mergeStacks,
      moveCardIdsToHand,
      myName,
      mySeatIndex,
      logAction,
      setStacks,
      stacksById
    ]
  );

  const cancelDrag = useCallback(() => {
    if (interaction.mode === 'dragStack' && interaction.drag) {
      setStacks((prev) =>
        prev.map((stack) =>
          stack.id === interaction.drag.stackId
            ? { ...stack, x: interaction.drag.originXY.x, y: interaction.drag.originXY.y }
            : stack
        )
      );
    } else if (interaction.held) {
      restoreHeldToOrigin();
      return;
    }
    pointerDownRef.current = null;
    clearInteraction({ preserveSelection: true });
  }, [clearInteraction, interaction.drag, interaction.held, interaction.mode, restoreHeldToOrigin, setStacks]);

  const placeOneFromHeld = useCallback(
    (pointerWorld) => {
      if (!interaction.held || !interaction.drag) {
        return;
      }
      const pointerPosition = pointerWorld ?? lastPointerWorldRef.current;
      if (!pointerPosition) {
        return;
      }
      const nextTopLeft = getHeldTopLeft(pointerPosition, interaction.drag.offset);
      if (!nextTopLeft) {
        return;
      }
      const placement = clampTopLeftToFelt(nextTopLeft).position ?? nextTopLeft;
      const remaining = [...interaction.held.cardIds];
      const placedCard = remaining.pop();
      if (!placedCard) {
        clearInteraction({ preserveSelection: true });
        return;
      }
      const placedStackId = createStackId();
      setStacks((prev) => {
        let next = prev.concat({
          id: placedStackId,
          x: placement.x,
          y: placement.y,
          rotation: 0,
          faceUp: interaction.held.faceUp ?? true,
          cardIds: [placedCard],
          zone: 'table',
          ownerSeatIndex: null
        });
        const overlapId = findTableOverlapStackId(placement.x, placement.y, placedStackId);
        if (overlapId) {
          const target = next.find((stack) => stack.id === overlapId);
          if (target) {
            const merged = {
              ...target,
              cardIds: [...target.cardIds, placedCard]
            };
            next = next.filter((stack) => stack.id !== overlapId && stack.id !== placedStackId).concat(merged);
          }
        }
        return next;
      });
      logAction(`${myName} placed 1 card`);
      if (remaining.length === 0) {
        clearInteraction({ preserveSelection: true });
      } else {
        setInteraction((prev) => ({
          ...prev,
          held: prev.held ? { ...prev.held, cardIds: remaining } : prev.held
        }));
      }
    },
    [
      clampTopLeftToFelt,
      clearInteraction,
      createStackId,
      findTableOverlapStackId,
      getHeldTopLeft,
      interaction.drag,
      interaction.held,
      myName,
      logAction,
      setStacks
    ]
  );

  const slidePlaceFromHeld = useCallback(
    (pointerWorld) => {
      if (!interaction.held || !interaction.drag || !interaction.isSliding) {
        return;
      }
      const pointerPosition = pointerWorld ?? lastPointerWorldRef.current;
      if (!pointerPosition) {
        return;
      }
      const nextTopLeft = getHeldTopLeft(pointerPosition, interaction.drag.offset);
      if (!nextTopLeft) {
        return;
      }
      const currentTopLeft = clampTopLeftToFelt(nextTopLeft).position ?? nextTopLeft;
      const lastPos = interaction.slideLastPos;
      if (!lastPos) {
        setInteraction((prev) => ({
          ...prev,
          slideLastPos: currentTopLeft
        }));
        return;
      }

      const dx = currentTopLeft.x - lastPos.x;
      const dy = currentTopLeft.y - lastPos.y;
      const travelDistance = Math.hypot(dx, dy);
      if (travelDistance <= 0) {
        setInteraction((prev) => ({
          ...prev,
          slideLastPos: currentTopLeft
        }));
        return;
      }

      const movementDir = { x: dx / travelDistance, y: dy / travelDistance };
      const shouldLockDirection = travelDistance >= SLIDE_START_DIR_THRESHOLD_PX;
      const lockedDir = shouldLockDirection ? movementDir : interaction.slideDir;
      const placementDir = movementDir ?? interaction.slideDir;
      // Accumulate travel distance so drops are gated by actual movement, not pointer events.
      const updatedCarry = (interaction.slideCarryDist ?? 0) + travelDistance;
      let drops = Math.floor(updatedCarry / SLIDE_SPACING_PX);
      if (drops <= 0) {
        setInteraction((prev) => ({
          ...prev,
          slideLastPos: currentTopLeft,
          slideCarryDist: updatedCarry,
          slideDir: lockedDir
        }));
        return;
      }

      drops = Math.min(drops, interaction.held.cardIds.length, SLIDE_MAX_DROPS_PER_TICK);
      const remaining = [...interaction.held.cardIds];
      const placements = [];
      let trail = interaction.slideTrail;

      for (let i = 0; i < drops; i += 1) {
        const placedCard = remaining.pop();
        if (!placedCard) {
          break;
        }
        const dropsRemaining = drops - i;
        let placement = currentTopLeft;
        if (placementDir) {
          const jitter = (Math.random() * 2 - 1) * SLIDE_JITTER_PX;
          const backOffset = SLIDE_SPACING_PX * 0.9 * dropsRemaining;
          placement = {
            x: currentTopLeft.x - placementDir.x * backOffset + -placementDir.y * jitter,
            y: currentTopLeft.y - placementDir.y * backOffset + placementDir.x * jitter
          };
        }
        placement = clampTopLeftToFelt(placement).position ?? placement;
        placement = adjustSlideSeparation(placement, placementDir, trail);
        placement = clampTopLeftToFelt(placement).position ?? placement;
        const placedStackId = createStackId();
        placements.push({
          id: placedStackId,
          x: placement.x,
          y: placement.y,
          rotation: 0,
          faceUp: interaction.held.faceUp ?? true,
          cardIds: [placedCard],
          zone: 'table',
          ownerSeatIndex: null
        });
        trail = trail.concat(placement);
      }

      if (placements.length === 0) {
        clearInteraction({ preserveSelection: true });
        return;
      }

      setStacks((prev) => prev.concat(placements));
      logAction(`${myName} placed ${placements.length} card${placements.length === 1 ? '' : 's'}`);

      if (remaining.length === 0) {
        clearInteraction({ preserveSelection: true });
      } else {
        const carryRemainder = Math.max(
          0,
          updatedCarry - placements.length * SLIDE_SPACING_PX
        );
        setInteraction((prev) => ({
          ...prev,
          held: prev.held ? { ...prev.held, cardIds: remaining } : prev.held,
          slideLastPos: currentTopLeft,
          slideCarryDist: carryRemainder,
          slideDir: lockedDir,
          lastSlidePlace: placements[placements.length - 1]
            ? { x: placements[placements.length - 1].x, y: placements[placements.length - 1].y }
            : prev.lastSlidePlace,
          slideTrail: trail
        }));
      }
    },
    [
      adjustSlideSeparation,
      clampTopLeftToFelt,
      clearInteraction,
      createStackId,
      getHeldTopLeft,
      interaction.drag,
      interaction.held,
      interaction.slideDir,
      interaction.slideCarryDist,
      interaction.slideLastPos,
      interaction.slideTrail,
      interaction.isSliding,
      myName,
      logAction,
      setStacks
    ]
  );

  const beginRmbSlide = useCallback(
    (pointerWorld) => {
      if (!pointerWorld) {
        return;
      }
      if (!interaction.drag) {
        return;
      }
      clearRmbHoldTimer();
      setInteraction((prev) => ({
        ...prev,
        isSliding: true,
        slideOrigin: null,
        slideDir: null,
        slidePerp: null,
        slideIndex: 0,
        slideTrail: [],
        lastSlidePlace: null,
        slideLastPos: null,
        slideCarryDist: 0
      }));
    },
    [clearRmbHoldTimer, interaction.drag]
  );

  const sweepPlaceFromHeld = useCallback(
    (pointerWorld) => {
      if (!interaction.held || !interaction.drag || !interaction.isSliding) {
        return;
      }
      if (!pointerWorld) {
        return;
      }
      slidePlaceFromHeld(pointerWorld);
    },
    [
      interaction.drag,
      interaction.held,
      interaction.isSliding,
      slidePlaceFromHeld
    ]
  );

  const moveHeldWithPointer = useCallback(
    (pointerWorld) => {
      if (!pointerWorld) {
        return;
      }
      if (!interaction.held || !interaction.drag) {
        return;
      }
      setInteraction((prev) => ({
        ...prev,
        drag: prev.drag
          ? {
              ...prev.drag,
              startWorld: pointerWorld
            }
          : prev.drag
      }));
    },
    [interaction.drag, interaction.held]
  );

  // --- handlers (must be declared before menus/hotkeys) ---
  const handleFlipSelected = useCallback(() => {
    if (!interaction.selectedStackId) {
      return;
    }
    const selected = stacksById[interaction.selectedStackId];
    setStacks((prev) =>
      prev.map((stack) =>
        stack.id === interaction.selectedStackId
          ? { ...stack, faceUp: !stack.faceUp }
          : stack
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
    logAction(`${myName} flipped a stack`);
  }, [interaction.selectedStackId, myName, logAction, setStacks, stacksById]);

  const handleShuffleSelected = useCallback(() => {
    if (!interaction.selectedStackId) {
      return;
    }
    setStacks((prev) =>
      prev.map((stack) => {
        if (stack.id !== interaction.selectedStackId) {
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
    logAction(`${myName} shuffled a stack`);
  }, [interaction.selectedStackId, myName, logAction, setStacks]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.repeat) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelDrag();
        closeSeatMenu();
        return;
      }
      const isFormElement =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' ||
          event.target.tagName === 'TEXTAREA' ||
          event.target.tagName === 'SELECT' ||
          event.target.isContentEditable);
      if (isFormElement || !interaction.selectedStackId) {
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
        pickupFromStack(interaction.selectedStackId, pickCount);
      }
    },
    [
      cancelDrag,
      closeSeatMenu,
      handleFlipSelected,
      handleShuffleSelected,
      interaction.selectedStackId,
      pickupFromStack
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleCancel = () => {
      if (interaction.mode !== 'idle') {
        cancelDrag();
      }
    };
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('blur', handleCancel);
    return () => {
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('blur', handleCancel);
    };
  }, [cancelDrag, interaction.mode]);

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

  const handlePointerMoveHover = useCallback(
    (pointerWorld) => {
      if (interaction.mode !== 'idle') {
        return;
      }
      const stackId = pointerWorld ? hitTestStack(pointerWorld.x, pointerWorld.y) : null;
      setHoveredStackId(stackId);
    },
    [hitTestStack, interaction.mode]
  );

  const handleSurfacePointerDown = useCallback(
    (event) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const pointerWorld = getTablePointerPosition(event);
      if (!pointerWorld) {
        return;
      }
      event.preventDefault();
      lastPointerWorldRef.current = pointerWorld;
      updatePresence({ isDown: true, x: pointerWorld.x, y: pointerWorld.y });
      closeSeatMenu();
      if (interaction.menu.open) {
        closeMenu();
      }
      const stackId = hitTestStack(pointerWorld.x, pointerWorld.y);
      if (event.button === 2) {
        event.preventDefault();
        if (interaction.held) {
          if (event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
            event.currentTarget.setPointerCapture(event.pointerId);
            capturedPointerRef.current = {
              pointerId: event.pointerId,
              element: event.currentTarget
            };
          }
          setInteraction((prev) => ({
            ...prev,
            rmbDown: true,
            rmbDownAt: performance.now(),
            isSliding: false,
            rmbStartWorld: pointerWorld,
            slideTrail: [],
            lastSlidePlace: null,
            slideLastPos: null,
            slideCarryDist: 0
          }));
          clearRmbHoldTimer();
          rmbHoldTimerRef.current = setTimeout(() => {
            const pointerPosition = lastPointerWorldRef.current ?? pointerWorld;
            setInteraction((prev) => {
              if (!prev.rmbDown || prev.isSliding || !prev.held) {
                return prev;
              }
              return {
                ...prev,
                isSliding: true,
                slideTrail: [],
                lastSlidePlace: null,
                slideLastPos: null,
                slideCarryDist: 0
              };
            });
            if (pointerPosition) {
              setInteraction((prev) => ({
                ...prev,
                slideLastPos: null,
                slideCarryDist: 0
              }));
            }
          }, HOLD_DELAY_MS);
          return;
        }
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
        pointerDownRef.current = {
          stackId,
          pointerId: event.pointerId,
          button: 2,
          startWorld: pointerWorld,
          startScreen: { x: event.clientX, y: event.clientY },
          dragStarted: false
        };
        return;
      }

      if (event.button !== 0) {
        return;
      }
      if (interaction.held) {
        setInteraction((prev) => ({
          ...prev,
          pointerId: event.pointerId
        }));
        pointerDownRef.current = {
          stackId: null,
          pointerId: event.pointerId,
          button: 0,
          startWorld: pointerWorld,
          startScreen: { x: event.clientX, y: event.clientY },
          dragStarted: true
        };
        if (event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
          event.currentTarget.setPointerCapture(event.pointerId);
          capturedPointerRef.current = {
            pointerId: event.pointerId,
            element: event.currentTarget
          };
        }
        return;
      }
      if (stackId) {
        if (event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
          event.currentTarget.setPointerCapture(event.pointerId);
          capturedPointerRef.current = {
            pointerId: event.pointerId,
            element: event.currentTarget
          };
        }
        pointerDownRef.current = {
          stackId,
          pointerId: event.pointerId,
          button: 0,
          startWorld: pointerWorld,
          startScreen: { x: event.clientX, y: event.clientY },
          dragStarted: false
        };
        return;
      }
      setInteraction((prev) => ({
        ...prev,
        selectedStackId: null,
        menu: { ...prev.menu, open: false, stackId: null }
      }));
    },
    [
      clearRmbHoldTimer,
      closeMenu,
      closeSeatMenu,
      getTablePointerPosition,
      hitTestStack,
      interaction.held,
      interaction.menu.open,
      setInteraction,
      updatePresence
    ]
  );

  const handleSurfacePointerMove = useCallback(
    (event) => {
      const pointerWorld = getTablePointerPosition(event);
      if (!pointerWorld) {
        return;
      }
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      lastPointerWorldRef.current = pointerWorld;
      updatePresence({ x: pointerWorld.x, y: pointerWorld.y });

      if (interaction.mode === 'dragStack') {
        updateDrag(pointerWorld);
        return;
      }
      if (interaction.mode === 'holdStack') {
        moveHeldWithPointer(pointerWorld);
        if (interaction.held && interaction.rmbDown) {
          const now = performance.now();
          const distanceFromStart = Math.hypot(
            pointerWorld.x - interaction.rmbStartWorld.x,
            pointerWorld.y - interaction.rmbStartWorld.y
          );
          if (
            !interaction.isSliding &&
            (now - interaction.rmbDownAt > HOLD_DELAY_MS || distanceFromStart > HOLD_MOVE_PX)
          ) {
            if (interaction.held.cardIds.length <= 1) {
              placeOneFromHeld(pointerWorld);
              setInteraction((prev) => ({
                ...prev,
                ...defaultRmbState
              }));
              return;
            }
            beginRmbSlide(pointerWorld);
          } else if (interaction.isSliding) {
            sweepPlaceFromHeld(pointerWorld);
          }
        }
      }

      const pending = pointerDownRef.current;
      if (pending && pending.pointerId === event.pointerId && !pending.dragStarted) {
        const distance = Math.hypot(
          pointerWorld.x - pending.startWorld.x,
          pointerWorld.y - pending.startWorld.y
        );
        if (distance >= DRAG_THRESHOLD) {
          pending.dragStarted = true;
          if (pending.button === 0 && pending.stackId) {
            pickupFromStack(pending.stackId, 1, event.pointerId);
          }
          if (pending.button === 2 && pending.stackId) {
            pickupFromStack(pending.stackId, 'all', event.pointerId);
          }
        }
      }

      handlePointerMoveHover(pointerWorld);
    },
    [
      DRAG_THRESHOLD,
      beginRmbSlide,
      defaultRmbState,
      getTablePointerPosition,
      handlePointerMoveHover,
      interaction.held,
      interaction.mode,
      interaction.rmbDown,
      interaction.rmbDownAt,
      interaction.isSliding,
      interaction.rmbStartWorld,
      moveHeldWithPointer,
      pickupFromStack,
      placeOneFromHeld,
      sweepPlaceFromHeld,
      updateDrag,
      updatePresence
    ]
  );

  const handleSurfacePointerUp = useCallback(
    (event) => {
      clearRmbHoldTimer();
      const pointerWorld = getTablePointerPosition(event);
      if (pointerWorld) {
        lastPointerWorldRef.current = pointerWorld;
      }
      const pending = pointerDownRef.current;
      if (pending && pending.pointerId === event.pointerId) {
        if (!pending.dragStarted && pending.button === 0 && pending.stackId) {
          selectStack(pending.stackId, {
            x: event.clientX,
            y: event.clientY
          });
        } else if (!pending.dragStarted && pending.button === 2 && pending.stackId) {
          pickupFromStack(pending.stackId, 'all', event.pointerId);
        }
        pointerDownRef.current = null;
      }

      const isRightButton = event.button === 2;
      const isBlurEvent = event.type === 'blur' || event.type === 'pointercancel';
      if (interaction.rmbDown && (isRightButton || isBlurEvent)) {
        if (!interaction.isSliding && isRightButton) {
          placeOneFromHeld(pointerWorld);
        }
        setInteraction((prev) => ({
          ...prev,
          ...defaultRmbState
        }));
      }

      if (interaction.mode === 'dragStack' && interaction.pointerId === event.pointerId) {
        endDrag(pointerWorld);
      } else if (
        interaction.mode === 'holdStack' &&
        interaction.pointerId === event.pointerId &&
        event.button === 0
      ) {
        dropHeld(pointerWorld);
      }
      releaseCapturedPointer();
    },
    [
      clearRmbHoldTimer,
      defaultRmbState,
      dropHeld,
      endDrag,
      getTablePointerPosition,
      interaction.mode,
      interaction.pointerId,
      interaction.rmbDown,
      interaction.isSliding,
      placeOneFromHeld,
      pickupFromStack,
      releaseCapturedPointer,
      selectStack
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

  const playFromHand = useCallback(
    (cardId, pointerWorld) => {
      if (mySeatIndex === null || mySeatIndex === undefined) {
        return;
      }
      if (!pointerWorld) {
        return;
      }
      const handSeatIndex = getHandZoneAtPoint(pointerWorld.x, pointerWorld.y);
      if (handSeatIndex !== null && handSeatIndex !== undefined) {
        return;
      }
      const rawPlacement = {
        x: pointerWorld.x - cardSize.width / 2,
        y: pointerWorld.y - cardSize.height / 2
      };
      const clamped = clampTopLeftToFelt(rawPlacement);
      const placement = clamped.position ?? rawPlacement;
      moveFromHandToTable(mySeatIndex, cardId);
      setStacks((prev) =>
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
      logAction(`${myName} played ${getCardLabel(cardId)}`);
    },
    [
      cardSize.height,
      cardSize.width,
      clampTopLeftToFelt,
      createStackId,
      getCardLabel,
      getHandZoneAtPoint,
      moveFromHandToTable,
      myName,
      mySeatIndex,
      logAction,
      setStacks
    ]
  );

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
      playFromHand(cardId, pointer);
    },
    [
      getTablePointerPositionFromClient,
      hands,
      mySeatIndex,
      playFromHand
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
      logAction(`${myName} ${isRevealed ? 'hid' : 'revealed'} ${getCardLabel(cardId)}`);
    },
    [getCardLabel, hands, myName, mySeatIndex, logAction, toggleReveal]
  );

  const visibleBadgeStackId =
    settings.stackCountDisplayMode === 'hover' ? hoveredStackId : null;

  const resetInteractionStates = useCallback(() => {
    clearInteraction({ preserveSelection: false });
    setHoveredStackId(null);
    setPickCountOpen(false);
    setPickCountValue('1');
  }, [clearInteraction]);

  const applySettings = useCallback(() => {
    setAppliedSettings(settings);
    rebuildTableFromSettings(settings);
    resetInteractionStates();
    setCardFaceOverrides({});
    updateTabletopScale();
  }, [rebuildTableFromSettings, resetInteractionStates, settings, updateTabletopScale]);

  const handleStackDoubleClick = useCallback((event, stackId) => {
    event.preventDefault();
    event.stopPropagation();
    setStacks((prev) =>
      prev.map((stack) =>
        stack.id === stackId ? { ...stack, faceUp: !stack.faceUp } : stack
      )
    );
    logAction(`${myName} flipped a stack`);
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
  }, [myName, logAction, setStacks, stacksById]);

  const handleMoveSelectedToHand = useCallback(() => {
    if (
      !interaction.selectedStackId ||
      mySeatIndex === null ||
      mySeatIndex === undefined
    ) {
      return;
    }
    const selected = stacksById[interaction.selectedStackId];
    if (!selected) {
      return;
    }
    moveCardIdsToHand(mySeatIndex, selected.cardIds);
    logAction(
      `${myName} moved ${selected.cardIds.length} ${selected.cardIds.length === 1 ? 'card' : 'cards'} to hand`
    );
    setStacks((prev) =>
      prev.filter((stack) => stack.id !== interaction.selectedStackId)
    );
    setInteraction((prev) => ({
      ...prev,
      selectedStackId: null,
      menu: { ...prev.menu, open: false, stackId: null }
    }));
    setPickCountOpen(false);
  }, [
    interaction.selectedStackId,
    moveCardIdsToHand,
    myName,
    mySeatIndex,
    logAction,
    setInteraction,
    setStacks,
    stacksById
  ]);

  const selectedStack = interaction.selectedStackId
    ? stacksById[interaction.selectedStackId]
    : null;
  const heldTopCardId = interaction.held?.cardIds?.[
    (interaction.held?.cardIds?.length ?? 1) - 1
  ];
  const heldTopCard = heldTopCardId ? cardsById[heldTopCardId] : null;
  const heldWorldPosition = (() => {
    if (!interaction.held || !interaction.drag) {
      return null;
    }
    const pointerWorld = lastPointerWorldRef.current ?? interaction.drag.startWorld;
    if (!pointerWorld) {
      return interaction.drag.originXY;
    }
    const raw = getHeldTopLeft(pointerWorld, interaction.drag.offset);
    if (!raw) {
      return interaction.drag.originXY;
    }
    const clamped = clampTopLeftToFelt(raw);
    return clamped.position ?? raw;
  })();
  const placementGhost =
    interaction.held && heldWorldPosition
      ? { x: heldWorldPosition.x, y: heldWorldPosition.y, rot: 0 }
      : null;
  const hoverHandSeatId =
    interaction.held && heldWorldPosition
      ? getHandZoneAtPoint(
          heldWorldPosition.x + cardSize.width / 2,
          heldWorldPosition.y + cardSize.height / 2
        )
      : null;
  const mergeHighlightStackId =
    interaction.held &&
    heldWorldPosition &&
    !hoverHandSeatId
      ? findTableOverlapStackId(heldWorldPosition.x, heldWorldPosition.y, null)
      : null;
  const menuBelow = selectedStack ? selectedStack.y < 140 : false;
  const menuPosition =
    interaction.menu.open
      ? {
          left: interaction.menu.screenX,
          top: interaction.menu.screenY
        }
      : null;
  const menuStackCount = selectedStack ? selectedStack.cardIds.length : 0;
  const seatMenuIndex =
    seatMenuState.open && seatMenuState.seatIndex !== null
      ? seatMenuState.seatIndex
      : null;
  const seatMenuSeat =
    seatMenuIndex !== null
      ? seatPositions[seatMenuIndex]
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
    interaction.held && heldWorldPosition && tableScreenRect
      ? {
          x: tableScreenRect.left + heldWorldPosition.x * combinedScale,
          y: tableScreenRect.top + heldWorldPosition.y * combinedScale
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
                      className="seatPad seat__hand"
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
              onPointerUp={handleSurfacePointerUp}
              onPointerCancel={handleSurfacePointerUp}
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
                const isDragHover = Boolean(interaction.held) && hoverHandSeatId === zone.seatIndex;
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
                const presencePlayer = players[playerId];
                return (
                  <CursorGhost
                    key={`cursor-${playerId}`}
                    ghost={ghost}
                    label={presencePlayer?.name ?? 'Player'}
                    accentColor={presencePlayer?.accentColor ?? '#ffd36a'}
                  />
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
                const isSelectedStack = stack.id === interaction.selectedStackId;
                const isHeldStack =
                  interaction.mode === 'dragStack' &&
                  interaction.drag?.stackId === stack.id;
                const isHoveredStack = stack.id === hoveredStackId;
                const isMenuTarget =
                  interaction.menu.open && interaction.menu.stackId === stack.id;
                const isMergeTarget = stack.id === mergeHighlightStackId;
                const highlightState = isHeldStack
                  ? 'held'
                  : isSelectedStack
                    ? 'selected'
                    : isMenuTarget
                      ? 'menu-target'
                      : isHoveredStack
                        ? 'hovered'
                        : isMergeTarget
                          ? 'merge-target'
                          : '';
                const zIndex = index + 1;
                const showBadge =
                  stack.cardIds.length > 1 &&
                  (settings.stackCountDisplayMode === 'always' ||
                    (settings.stackCountDisplayMode === 'hover' &&
                      stack.id === visibleBadgeStackId));
                return (
                  <div
                    key={stack.id}
                    className={`stack-entity ${highlightState}`}
                    data-selected={isSelectedStack}
                    data-held={isHeldStack}
                    data-hovered={isHoveredStack}
                    data-menu-target={isMenuTarget}
                    data-merge-target={isMergeTarget}
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
                      isHeld={false}
                      isSelected={false}
                      onPointerDown={() => {}}
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
      {interaction.held && uiOverlayRoot && dragCardPosition
        ? createPortal(
            <div
                className="drag-layer"
                aria-hidden="true"
                style={{ '--card-scale': viewTransform.cardScale * combinedScale }}
              >
                <Card
                  id={interaction.held.stackId}
                  x={dragCardPosition.x}
                  y={dragCardPosition.y}
                  rotation={0}
                  faceUp={interaction.held.faceUp ?? true}
                  cardStyle={appliedSettings.cardStyle}
                  zIndex={2000}
                  rank={heldTopCard?.rank}
                  suit={heldTopCard?.suit}
                  color={heldTopCard?.color}
                  isHeld
                  isSelected={false}
                  onPointerDown={() => {}}
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
                onClick={() => {
                  pickupFromStack(selectedStack.id, 'all');
                  closeMenu();
                }}
              >
                Pick up full stack
              </button>
              <button
                type="button"
                className="stack-menu__button"
                onClick={() => {
                  if (selectedStack.cardIds.length < 2) {
                    return;
                  }
                  pickupFromStack(
                    selectedStack.id,
                    Math.ceil(selectedStack.cardIds.length / 2)
                  );
                  closeMenu();
                }}
              >
                Pick up half stack
              </button>
              <button
                type="button"
                className="stack-menu__button"
                onClick={() => {
                  pickupFromStack(selectedStack.id, 1);
                  closeMenu();
                }}
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
                        pickupFromStack(selectedStack.id, count);
                        closeMenu();
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
                onClick={() => {
                  handleMoveSelectedToHand();
                  closeMenu();
                }}
              >
                Move to Hand
              </button>
            ) : null}
            <button
              type="button"
              className="stack-menu__button"
              onClick={() => {
                handleFlipSelected();
                closeMenu();
              }}
            >
              Flip
            </button>
            <button
              type="button"
              className="stack-menu__button"
              onClick={() => {
                handleShuffleSelected();
                closeMenu();
              }}
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
                playerName={players[myPlayerId]?.name ?? 'Player'}
                seatColor={
                  seatMenuPlayer?.seatColor ?? players[myPlayerId]?.seatColor ?? '#6aa9ff'
                }
                accentColor={
                  seatMenuPlayer?.accentColor ?? players[myPlayerId]?.accentColor ?? '#ffd36a'
                }
                onSit={() => {
                  // eslint-disable-next-line no-console
                  console.log('Sit click', seatMenuIndex, myPlayerId);
                  sitAtSeat(seatMenuIndex);
                  logAction(`${myName} sat at ${seatMenuSeat.label}`);
                  closeSeatMenu();
                }}
                onStand={() => {
                  standUp();
                  logAction(`${myName} left ${seatMenuSeat.label}`);
                  closeSeatMenu();
                }}
                onUpdateColors={(colors) => {
                  if (colors?.seatColor) {
                    setSeatColor(colors.seatColor);
                  }
                  if (colors?.accentColor) {
                    setAccentColor(colors.accentColor);
                  }
                }}
                onUpdateName={setPlayerName}
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
