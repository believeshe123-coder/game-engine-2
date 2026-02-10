import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Card from './Card.jsx';
import InventoryPanel from './InventoryPanel.jsx';
import ActionLog from './ActionLog.jsx';
import CursorGhost from './CursorGhost.jsx';
import SeatMenu from './SeatMenu.jsx';
import {
  clamp,
  clampStackToFelt,
  getFeltEllipseInTableSpace,
  getFeltShape
} from '../utils/geometry.js';
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
import { loadUiPrefs, saveUiPrefs } from '../state/uiPrefs.js';
import {
  arr,
  normalizeCustomLayout,
  normalizeTableState
} from '../state/tableStateNormalizer.js';

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
const HELD_STACK_ID = '__HELD__';
const CAMERA_ZOOM_MIN = 0.25;
const UNDO_HISTORY_LIMIT = 50;
const CAMERA_ZOOM_MAX = 2.5;

const CUSTOM_LAYOUT_STORAGE_PREFIX = 'tt_layout_';
const CUSTOM_LAYOUT_INDEX_KEY = 'tt_layouts_index';

const SIDE_ORDER = ['top', 'right', 'bottom', 'left'];
const SIDE_NORMALS = {
  top: { angle: -Math.PI / 2 },
  right: { angle: 0 },
  bottom: { angle: Math.PI / 2 },
  left: { angle: Math.PI }
};

const normalizeTableShape = (shape) =>
  ['rectangle', 'oval', 'circle'].includes(shape) ? shape : 'oval';

const normalizeParam = (value, max) => {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  const wrapped = value % max;
  return wrapped < 0 ? wrapped + max : wrapped;
};

const ITEM_SPAWNER_ITEMS = [
  {
    id: 'classicDeckWithJokers',
    label: 'Classic Poker Deck (with jokers)',
    style: 'classic',
    type: 'deckWithJokers',
    usage: 'Standard 54-card deck with jokers for poker variants and wild-card games.'
  },
  {
    id: 'classicDeckNoJokers',
    label: 'Classic Poker Deck (no jokers)',
    style: 'classic',
    type: 'deckNoJokers',
    usage: 'Standard 52-card deck for most poker and trick-taking games.'
  },
  {
    id: 'classicJokersOnly',
    label: 'Classic Jokers Only',
    style: 'classic',
    type: 'jokersOnly',
    usage: 'Two jokers only, useful as markers or wild cards.'
  },
  {
    id: 'medievalDeckWithJokers',
    label: 'Medieval Poker Deck (with jokers)',
    style: 'medieval',
    type: 'deckWithJokers',
    usage: 'Themed 54-card deck with jokers.'
  },
  {
    id: 'medievalDeckNoJokers',
    label: 'Medieval Poker Deck (no jokers)',
    style: 'medieval',
    type: 'deckNoJokers',
    usage: 'Themed 52-card deck without jokers.'
  },
  {
    id: 'medievalJokersOnly',
    label: 'Medieval Jokers Only',
    style: 'medieval',
    type: 'jokersOnly',
    usage: 'Themed joker pair for variant rules.'
  },
  {
    id: 'chips1',
    label: 'Poker Chips — $1',
    type: 'chips',
    denom: 1,
    usage: 'Low-value chips for small bets, blinds/antes, and making change.'
  },
  {
    id: 'chips5',
    label: 'Poker Chips — $5',
    type: 'chips',
    denom: 5,
    usage: 'Common chip for normal betting and mid-sized pots.'
  },
  {
    id: 'chips25',
    label: 'Poker Chips — $25',
    type: 'chips',
    denom: 25,
    usage: 'Higher-value chip for larger bets.'
  },
  {
    id: 'chips100',
    label: 'Poker Chips — $100',
    type: 'chips',
    denom: 100,
    usage: 'High-value chip for big bets and buy-ins.'
  },
  {
    id: 'dieD6',
    label: 'Die (d6)',
    type: 'die',
    sides: 6,
    usage: 'Roll for simple random outcomes (1–6).'
  },
  {
    id: 'dieD20',
    label: 'Die (d20)',
    type: 'die',
    sides: 20,
    usage: 'Roll for broader random outcomes (1–20).'
  }
];


const CUSTOM_LAYOUT_MAX_QTY = 20;

const SPAWN_CARD_SUITS = [
  { id: 'S', name: 'Spades' },
  { id: 'C', name: 'Clubs' },
  { id: 'H', name: 'Hearts' },
  { id: 'D', name: 'Diamonds' }
];
const SPAWN_CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const buildSpawnCardsForItem = (item, prefix) => {
  const cards = [];
  const includeStandard = item.type === 'deckWithJokers' || item.type === 'deckNoJokers';
  if (includeStandard) {
    SPAWN_CARD_SUITS.forEach((suit) => {
      SPAWN_CARD_RANKS.forEach((rank) => {
        cards.push({
          id: `${prefix}-${rank}${suit.id}`,
          rank,
          suit: suit.name
        });
      });
    });
  }
  const includeJokers = item.type === 'deckWithJokers' || item.type === 'jokersOnly';
  if (includeJokers) {
    cards.push(
      {
        id: `${prefix}-JOKER_BLACK`,
        rank: 'JOKER',
        suit: 'Joker',
        color: 'black'
      },
      {
        id: `${prefix}-JOKER_RED`,
        rank: 'JOKER',
        suit: 'Joker',
        color: 'red'
      }
    );
  }
  return cards;
};

const CHIP_COLORS = {
  1: '#f4f5f7',
  5: '#d94444',
  25: '#2f9c57',
  100: '#1f2438'
};

const isCardStack = (entity) =>
  entity?.kind === 'cardStack' || (entity?.kind == null && Array.isArray(entity?.cardIds));
const isChipStack = (entity) => entity?.kind === 'chipStack' || entity?.kind === 'chips';
const isDieStack = (entity) => entity?.kind === 'dice' || entity?.kind === 'die';

const getStackBounds = (stack, cardSize) => {
  if (isChipStack(stack)) {
    const size = cardSize.width * 0.38;
    return { width: size, height: size };
  }
  if (isDieStack(stack)) {
    const size = cardSize.width * 0.55;
    return { width: size, height: size };
  }
  return { width: cardSize.width, height: cardSize.height };
};

const getChipStackLabel = (stack) => {
  const count = Math.max(0, Number(stack?.count) || 0);
  const denom = Number(stack?.denom) || 0;
  return `${count} × $${denom} = $${count * denom}`;
};

const formatSpawnSummaryItem = (item, qty) => {
  if (item.type === 'chips') {
    return `${qty}× $${item.denom} Chips`;
  }
  if (item.type === 'die') {
    return `${qty}× d${item.sides}`;
  }
  return `${qty}× ${item.label}`;
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

const loadCustomLayoutByCode = (code) => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${CUSTOM_LAYOUT_STORAGE_PREFIX}${code}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeCustomLayout(parsed, code);
    window.localStorage.setItem(`${CUSTOM_LAYOUT_STORAGE_PREFIX}${code}`, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    return null;
  }
};

const loadCustomLayoutsIndex = () => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(CUSTOM_LAYOUT_INDEX_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    const normalized = arr(parsed)
      .map((entry, index) => normalizeCustomLayout(entry, entry?.code ?? `layout-${index + 1}`))
      .map((entry) => ({ code: entry.code, name: entry.name }));
    window.localStorage.setItem(CUSTOM_LAYOUT_INDEX_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    return [];
  }
};

const saveCustomLayoutsIndex = (list) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CUSTOM_LAYOUT_INDEX_KEY, JSON.stringify(list));
};

const generateLayoutCode = () => `${Math.floor(100000 + Math.random() * 90000000)}`.slice(0, 8);

const getViewportFromRect = (rect) => ({
  cx: (rect?.width ?? 0) / 2,
  cy: (rect?.height ?? 0) / 2
});

function worldToScreen(wx, wy, cam, viewport) {
  const camera = cam ?? { x: 0, y: 0, zoom: 1 };
  const view = viewport ?? { cx: 0, cy: 0 };
  return {
    x: (wx - camera.x) * camera.zoom + view.cx,
    y: (wy - camera.y) * camera.zoom + view.cy
  };
}

function screenToWorld(sx, sy, cam, viewport) {
  const camera = cam ?? { x: 0, y: 0, zoom: 1 };
  const view = viewport ?? { cx: 0, cy: 0 };
  return {
    x: (sx - view.cx) / camera.zoom + camera.x,
    y: (sy - view.cy) / camera.zoom + camera.y
  };
}

const ENDLESS_SEAT_PATTERN = [
  'left',
  'left',
  'left',
  'top',
  'top',
  'right',
  'right',
  'right',
  'bottom',
  'bottom'
];

const getLegacyDisabledShapeDefaultSeatPositions = (seatCount, viewportW, viewportH) => {
  const count = Math.max(1, seatCount);
  const width = Math.max(1, viewportW);
  const height = Math.max(1, viewportH);
  const padding = Math.max(60, Math.min(width, height) * 0.08);
  const sideAssignments = Array.from({ length: count }, (_, index) =>
    ENDLESS_SEAT_PATTERN[index % ENDLESS_SEAT_PATTERN.length]
  );
  const sideCounts = sideAssignments.reduce(
    (acc, side) => {
      acc[side] += 1;
      return acc;
    },
    {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0
    }
  );
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  const sidePositions = {
    left: Array.from({ length: sideCounts.left }, (_, index) => ({
      x: padding,
      y: padding + (usableHeight / (sideCounts.left + 1)) * (index + 1)
    })),
    right: Array.from({ length: sideCounts.right }, (_, index) => ({
      x: width - padding,
      y: padding + (usableHeight / (sideCounts.right + 1)) * (index + 1)
    })),
    top: Array.from({ length: sideCounts.top }, (_, index) => ({
      x: padding + (usableWidth / (sideCounts.top + 1)) * (index + 1),
      y: padding
    })),
    bottom: Array.from({ length: sideCounts.bottom }, (_, index) => ({
      x: padding + (usableWidth / (sideCounts.bottom + 1)) * (index + 1),
      y: height - padding
    }))
  };
  const sideOffsets = { left: 0, right: 0, top: 0, bottom: 0 };
  return sideAssignments.map((side) => {
    const index = sideOffsets[side] ?? 0;
    sideOffsets[side] += 1;
    const entry = sidePositions[side][index] ?? { x: width / 2, y: height / 2 };
    return {
      ...entry,
      side
    };
  });
};

const getLegacyDisabledShapeSeatAngleFromLocal = (x, y, viewportW, viewportH) =>
  Math.atan2(y - viewportH / 2, x - viewportW / 2);

const getLegacyDisabledShapeSeatAngleFromWorld = (x, y, camera, viewport, viewportW, viewportH) => {
  if (!viewportW || !viewportH) {
    return Math.atan2(y, x);
  }
  const centerWorld = localToWorld(viewportW / 2, viewportH / 2, camera, viewport, true);
  return Math.atan2(y - centerWorld.y, x - centerWorld.x);
};

const formatCardName = (card) => {
  if (!card) {
    return 'Card';
  }
  if (card.rank === 'JOKER') {
    if (card.color) {
      return `${card.color.charAt(0).toUpperCase()}${card.color.slice(1)} Joker`;
    }
    return 'Joker';
  }
  const rankNames = {
    A: 'Ace',
    J: 'Jack',
    Q: 'Queen',
    K: 'King'
  };
  const rankName = rankNames[card.rank] ?? card.rank;
  if (rankName && card.suit) {
    return `${rankName} of ${card.suit}`;
  }
  return rankName ?? card.suit ?? 'Card';
};

function localToWorld(localX, localY, camera, viewport, isLegacyDisabledShape) {
  if (!isLegacyDisabledShape || !camera || !viewport) {
    return { x: localX, y: localY };
  }
  return screenToWorld(localX, localY, camera, viewport);
}

function worldToLocal(worldX, worldY, camera, viewport, isLegacyDisabledShape) {
  if (!isLegacyDisabledShape || !camera || !viewport) {
    return { x: worldX, y: worldY };
  }
  return worldToScreen(worldX, worldY, camera, viewport);
}

function clientToWorld(
  clientX,
  clientY,
  playfieldRect,
  zoom,
  camera,
  viewport,
  isLegacyDisabledShape
) {
  if (!playfieldRect || !zoom) {
    return null;
  }
  const localX = (clientX - playfieldRect.left) / zoom;
  const localY = (clientY - playfieldRect.top) / zoom;
  return localToWorld(localX, localY, camera, viewport, isLegacyDisabledShape);
}

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

const buildDefaultSeatParams = (count) =>
  Array.from({ length: count }, (_, index) => index / count);

const normalizeSeatParams = (params, count, shape) => {
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
};


const buildSeatLayout = ({
  shape,
  seatCount,
  viewportW,
  viewportH,
  tableRect,
  seatRailBounds,
  seatParams,
  camera,
  viewport
}) => {
  const count = Math.max(2, Number(seatCount) || 2);
  if (shape === 'legacyDisabledShape') {
    const width = Math.max(1, viewportW || tableRect?.width || 1);
    const height = Math.max(1, viewportH || tableRect?.height || 1);
    const localPositions = getLegacyDisabledShapeDefaultSeatPositions(count, width, height);
    return localPositions.map((entry) => {
      const world = localToWorld(entry.x, entry.y, camera, viewport, true);
      const angle = getLegacyDisabledShapeSeatAngleFromLocal(entry.x, entry.y, width, height);
      return {
        x: world.x,
        y: world.y,
        side: entry.side,
        angle
      };
    });
  }

  const fallbackBounds = seatRailBounds
    ? { ...seatRailBounds }
    : {
        left: 0,
        top: 0,
        width: Math.max(1, tableRect?.width || viewportW || 1),
        height: Math.max(1, tableRect?.height || viewportH || 1)
      };
  fallbackBounds.right = fallbackBounds.left + fallbackBounds.width;
  fallbackBounds.bottom = fallbackBounds.top + fallbackBounds.height;

  const params = normalizeSeatParams(seatParams, count, shape);
  const anchors = computeSeatAnchorsFromParams({
    seatParams: params,
    tableShape: shape,
    seatRailBounds: fallbackBounds
  });
  return anchors;
};

const adjustSlideSeparation = (position, direction, trail) => {
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
};

const clampInventoryPosition = (position, rect) => {
  if (!rect || typeof window === 'undefined') {
    return position;
  }
  const maxX = Math.max(0, window.innerWidth - rect.width);
  const maxY = Math.max(0, window.innerHeight - rect.height);
  return {
    x: Math.min(maxX, Math.max(0, position.x)),
    y: Math.min(maxY, Math.max(0, position.y))
  };
};

const getHeldTopLeft = (pointerPosition, offset) => {
  if (!pointerPosition) {
    return null;
  }
  return {
    x: pointerPosition.x - offset.x,
    y: pointerPosition.y - offset.y
  };
};

const preventNativeDrag = (event) => {
  event.preventDefault();
  event.stopPropagation();
};


const Table = () => {
  // Refs
  const sceneRootRef = useRef(null);
  const tableFrameRef = useRef(null);
  const tableRef = useRef(null);
  const feltRef = useRef(null);
  const seatRefs = useRef({});
  const seatPadRefs = useRef({});
  const actionsRef = useRef({});
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
  // Local player settings live in `settings`, room-config values are nested under `roomSettings`.
  const [settings, setSettings] = useState(() => loadSettings());
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
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  const viewportRef = useRef(getViewportFromRect(tableRect));
  const getLegacyDisabledShapeSpawnPoint = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport?.cx && !viewport?.cy) {
      return { x: 0, y: 0 };
    }
    return localToWorld(
      viewport.cx,
      viewport.cy,
      cameraRef.current,
      viewportRef.current,
      true
    );
  }, []);
  const {
    cardsById,
    setCardsById,
    allCardIds,
    stacks,
    setStacks,
    createStackId,
    players,
    player,
    mySeatIndex,
    seatAssignments,
    handsBySeat,
    setHands,
    myPlayerId,
    actionLog,
    presence,
    sitAtSeat,
    setPlayerName,
    setSeatColor,
    logAction,
    updatePresence,
    moveCardIdsToHand,
    moveFromHandToTable,
    toggleReveal,
    resetTableSurface
  } = useTableState(
    tableRect,
    cardSize,
    settings,
    seatCount,
    getLegacyDisabledShapeSpawnPoint
  );

  // Derived data
  const stacksById = useMemo(() => {
    return stacks.reduce((acc, stack) => {
      acc[stack.id] = stack;
      return acc;
    }, {});
  }, [stacks]);

  // State
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
    selected: null,
    menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
  });
  const [hoveredStackId, setHoveredStackId] = useState(null);
  const pointerDownRef = useRef(null);
  const rmbHoldTimerRef = useRef(null);
  const lastPointerWorldRef = useRef(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const [pickCountOpen, setPickCountOpen] = useState(false);
  const [pickCountValue, setPickCountValue] = useState('1');
  const [splitCountOpen, setSplitCountOpen] = useState(false);
  const [splitCountValue, setSplitCountValue] = useState('1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('player');
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [itemSpawnerOpen, setItemSpawnerOpen] = useState(false);
  const [itemSpawnerSearchQuery, setItemSpawnerSearchQuery] = useState('');
  const [itemSpawnerSelected, setItemSpawnerSelected] = useState(() =>
    ITEM_SPAWNER_ITEMS.reduce((acc, item) => {
      acc[item.id] = { checked: false, qty: 1 };
      return acc;
    }, {})
  );
  const [customLayoutsIndex, setCustomLayoutsIndex] = useState(() => loadCustomLayoutsIndex());
  const [selectedLayoutCode, setSelectedLayoutCode] = useState('');
  const [layoutImportCode, setLayoutImportCode] = useState('');
  const [layoutImportStatus, setLayoutImportStatus] = useState(null);
  const [saveLayoutOpen, setSaveLayoutOpen] = useState(false);
  const [saveLayoutName, setSaveLayoutName] = useState('');
  const [saveLayoutNotes, setSaveLayoutNotes] = useState('');
  const [saveLayoutCode, setSaveLayoutCode] = useState('');
  const [saveLayoutInclude, setSaveLayoutInclude] = useState({
    shape: false,
    seatCount: false,
    seatPositions: false,
    tableStyle: false,
    spawnFaceDown: false,
    deckDefaults: false
  });
  const [dragSeatIndex, setDragSeatIndex] = useState(null);
  const inventoryPanelRef = useRef(null);
  const [inventoryPos, setInventoryPos] = useState(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const saved = window.localStorage.getItem('tt_inventoryPos');
    if (!saved) {
      return null;
    }
    try {
      const parsed = JSON.parse(saved);
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        return { x: parsed.x, y: parsed.y };
      }
    } catch (error) {
      return null;
    }
    return null;
  });
  const [inventoryDrag, setInventoryDrag] = useState(null);
  const [inventoryCardDrag, setInventoryCardDrag] = useState(null);
  const [heldScreenPos, setHeldScreenPos] = useState(null);
  const [seatMenuState, setSeatMenuState] = useState({
    seatIndex: null,
    open: false
  });
  const [hoverSeatDropIndex, setHoverSeatDropIndex] = useState(null);
  const [hoverSeatCard, setHoverSeatCard] = useState(null);
  const myName = player?.name ?? 'Player';
  const tableStyle = settings.tableStyle;
  const tableShape = settings.roomSettings.tableShape;
  const isLegacyDisabledShape = tableShape === 'legacyDisabledShape';
  const [uiPrefs, setUiPrefs] = useState(loadUiPrefs);
  const [cardPreview, setCardPreview] = useState(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const lastSnapshotRef = useRef(null);
  const restoringFromUndoRef = useRef(false);
  const suppressNextHistoryRef = useRef(false);
  const wasLegacyDisabledShapeRef = useRef(false);
  const isModalOpen =
    resetConfirmOpen ||
    itemSpawnerOpen ||
    saveLayoutOpen ||
    Boolean(cardPreview) ||
    removeConfirmOpen;
  const closeCardPreview = useCallback((event) => {
    if (event?.preventDefault) {
      event.preventDefault();
    }
    if (event?.stopPropagation) {
      event.stopPropagation();
    }
    setCardPreview(null);
  }, []);

  const actions = useMemo(() => ({}), []);
  const interactionRef = useRef(interaction);

  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  // Interaction helpers (keep before any configs/effects that reference them).
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

  actions.clearRmbHoldTimer = useCallback(() => {
    if (rmbHoldTimerRef.current) {
      clearTimeout(rmbHoldTimerRef.current);
      rmbHoldTimerRef.current = null;
    }
  }, [actions]);

  actions.clearInteraction = useCallback((options = {}) => {
    actions.clearRmbHoldTimer();
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
      selected: preserveSelection
        ? (nextSelectedStackId ? { kind: 'stack', id: nextSelectedStackId } : prev.selected)
        : (nextSelectedStackId ? { kind: 'stack', id: nextSelectedStackId } : null),
      menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
    }));
  }, [actions, defaultRmbState]);

  actions.resetInteractionStates = useCallback(() => {
    actions.clearInteraction({ preserveSelection: false });
    setHoveredStackId(null);
    setPickCountOpen(false);
    setPickCountValue('1');
    setSplitCountOpen(false);
    setSplitCountValue('1');
    setSeatMenuState({ seatIndex: null, open: false });
    setHoverSeatDropIndex(null);
    setHoverSeatCard(null);
    setDragSeatIndex(null);
    setInventoryDrag(null);
    setHeldScreenPos(null);
  }, [actions]);

  actions.resetInteractionToDefaults = useCallback(() => {
    setInteraction({
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
      selected: null,
      menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
    });
  }, [actions]);

  actions.openSeatMenu = useCallback((seatIndex) => {
    setSeatMenuState({ seatIndex, open: true });
  }, [actions]);

  actions.closeSeatMenu = useCallback(() => {
    setSeatMenuState({ seatIndex: null, open: false });
  }, []);

  actions.closeMenu = useCallback(() => {
    setPickCountOpen(false);
    setSplitCountOpen(false);
    setInteraction((prev) => ({
      ...prev,
      menu: { ...prev.menu, open: false, stackId: null }
    }));
  }, []);

  actions.selectStack = useCallback((stackId, screenXY) => {
    const selectedStack = stacksById[stackId];
    const selectedKind = isChipStack(selectedStack)
      ? 'chips'
      : isDieStack(selectedStack)
        ? 'die'
        : 'stack';
    setPickCountOpen(false);
    setInteraction((prev) => ({
      ...prev,
      ...defaultRmbState,
      selectedStackId: stackId,
      selected: selectedKind && stackId ? { kind: selectedKind, id: stackId } : null,
      menu: {
        open: true,
        stackId,
        screenX: screenXY?.x ?? 0,
        screenY: screenXY?.y ?? 0
      }
    }));
  }, [defaultRmbState, stacksById]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    const counts = new Map();
    const addCard = (cardId) => {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    };
    arr(stacks).forEach((stack) => {
      arr(stack?.cardIds).forEach(addCard);
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
  actions.releaseCapturedPointer = useCallback(() => {
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
    saveUiPrefs(uiPrefs);
  }, [uiPrefs]);

  useEffect(() => {
    const sceneRootNode = sceneRootRef.current;
    if (sceneRootNode) {
      sceneRootNode.style.setProperty('--tableScale', combinedScale.toString());
    }
    tableScaleRef.current = combinedScale;
  }, [combinedScale]);

  useEffect(() => {
    if (!interaction.held && interaction.mode !== 'dragStack' && hoverSeatDropIndex !== null) {
      setHoverSeatDropIndex(null);
    }
  }, [hoverSeatDropIndex, interaction.held, interaction.mode]);

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

  const seatsDerived = useMemo(() => {
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

  const buildLegacyDisabledShapeSeatLayout = useCallback(() => {
    const layout = buildSeatLayout({
      shape: 'legacyDisabledShape',
      seatCount: seatsDerived.length,
      viewportW: tableRect?.width ?? 0,
      viewportH: tableRect?.height ?? 0,
      tableRect,
      camera: cameraRef.current,
      viewport: viewportRef.current
    });
    return seatsDerived.map((seat, index) => {
      const anchor = layout[index] ?? { x: 0, y: 0, angle: -Math.PI / 2, side: 'top' };
      return {
        ...seat,
        x: anchor.x,
        y: anchor.y,
        side: anchor.side ?? 'top',
        angle: anchor.angle ?? -Math.PI / 2
      };
    });
  }, [seatsDerived, tableRect]);

  const seatParams = useMemo(() => {
    const paramsByShape = settings.roomSettings.seatParams ?? {};
    if (isLegacyDisabledShape) {
      return [];
    }
    return normalizeSeatParams(paramsByShape[tableShape], seatCount, tableShape);
  }, [
    isLegacyDisabledShape,
    seatCount,
    settings.roomSettings.seatParams,
    tableShape
  ]);

  useEffect(() => {
    if (isLegacyDisabledShape) {
      return;
    }
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
  }, [isLegacyDisabledShape, seatCount, tableShape]);

  const [seatPositions, setSeatPositions] = useState(() =>
    seatsDerived.map((seat) => ({ ...seat, x: 0, y: 0 }))
  );
  const [handZones, setHandZones] = useState([]);
  const panRef = useRef({ pointerId: null, start: null, camera: null });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);

  const cloneState = useCallback((value) => {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }, []);

  const buildUndoSnapshot = useCallback(
    () => normalizeTableState({
      stacks: cloneState(stacks),
      hands: cloneState(hands),
      seats: cloneState(seatPositions),
      selectedStackId: interaction.selectedStackId ?? null,
      held: interaction.held ? cloneState(interaction.held) : null
    }),
    [cloneState, hands, interaction.held, interaction.selectedStackId, seatPositions, stacks]
  );

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    if (isLegacyDisabledShape && !wasLegacyDisabledShapeRef.current) {
      const resetCamera = { x: 0, y: 0, zoom: 1 };
      setCamera(resetCamera);
      cameraRef.current = resetCamera;
    }
    wasLegacyDisabledShapeRef.current = isLegacyDisabledShape;
  }, [isLegacyDisabledShape]);

  useEffect(() => {
    viewportRef.current = getViewportFromRect(tableRect);
  }, [tableRect]);

  useEffect(() => {
    const currentSnapshot = buildUndoSnapshot();
    if (!lastSnapshotRef.current) {
      lastSnapshotRef.current = currentSnapshot;
      return;
    }
    const changed =
      JSON.stringify(currentSnapshot) !== JSON.stringify(lastSnapshotRef.current);
    if (!changed) {
      return;
    }
    if (restoringFromUndoRef.current || suppressNextHistoryRef.current) {
      suppressNextHistoryRef.current = false;
      lastSnapshotRef.current = currentSnapshot;
      return;
    }
    const previousSnapshot = lastSnapshotRef.current;
    const nextHistory = [...historyRef.current, previousSnapshot].slice(-UNDO_HISTORY_LIMIT);
    historyRef.current = nextHistory;
    setCanUndo(nextHistory.length > 0);
    lastSnapshotRef.current = currentSnapshot;
  }, [buildUndoSnapshot]);


  const getCardLabel = useCallback(
    (cardId) => formatCardName(cardsById[cardId]),
    [cardsById]
  );

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
        const topLeft = clientToWorld(
          padRect.left,
          padRect.top,
          tableRect,
          zoom,
          cameraRef.current,
          viewportRef.current,
          isLegacyDisabledShape
        );
        const bottomRight = clientToWorld(
          padRect.right,
          padRect.bottom,
          tableRect,
          zoom,
          cameraRef.current,
          viewportRef.current,
          isLegacyDisabledShape
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
    isLegacyDisabledShape,
    seatPositions
  ]);

  const cameraTransformStyle = useMemo(() => {
    if (!isLegacyDisabledShape || !tableRect?.width || !tableRect?.height) {
      return undefined;
    }
    return {
      transform: `translate(${tableRect.width / 2}px, ${tableRect.height / 2}px) scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
      transformOrigin: '0 0'
    };
  }, [camera.x, camera.y, camera.zoom, isLegacyDisabledShape, tableRect?.height, tableRect?.width]);

  const getHandZoneAtPoint = useCallback(
    (x, y) => {
      let closestSeatIndex = null;
      let closestDistance = Infinity;
      for (let i = 0; i < handZones.length; i += 1) {
        const zone = handZones[i];
        const left = zone.x - zone.width / 2;
        const top = zone.y - zone.height / 2;
        if (x >= left && x <= left + zone.width && y >= top && y <= top + zone.height) {
          const distance = Math.hypot(x - zone.x, y - zone.y);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestSeatIndex = zone.seatIndex;
          }
        }
      }
      return closestSeatIndex;
    },
    [handZones]
  );

  const getSeatIndexAtScreenPoint = useCallback((clientX, clientY) => {
    let closestSeatIndex = null;
    let closestDistance = Infinity;
    seatsDerived.forEach((seat) => {
      const seatElement = seatRefs.current[seat.seatIndex];
      if (!seatElement) {
        return;
      }
      const rect = seatElement.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(clientX - centerX, clientY - centerY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestSeatIndex = seat.seatIndex;
        }
      }
    });
    return closestSeatIndex;
  }, [seatsDerived]);

  const layoutSeats = useCallback(() => {
    if (isLegacyDisabledShape) {
      setFeltBounds(null);
      setSeatRailBounds(null);
      return;
    }
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
      setSeatPositions(seatsDerived.map((seat) => ({ ...seat, x: 0, y: 0 })));
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
    const anchors = buildSeatLayout({
      shape: tableShape,
      seatCount: seatsDerived.length,
      tableRect,
      seatRailBounds: nextSeatRailBounds,
      seatParams
    });

    setSeatPositions(
      seatsDerived.map((seat, index) => {
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
  }, [isLegacyDisabledShape, seatParams, seatsDerived, tableRect, tableShape]);

  useEffect(() => {
    if (!isLegacyDisabledShape) {
      return;
    }
    const stored = settings.roomSettings.seatPositions?.legacyDisabledShape ?? [];
    const hasValid =
      Array.isArray(stored) &&
      stored.length === seatsDerived.length &&
      stored.every((entry) => Number.isFinite(entry?.x) && Number.isFinite(entry?.y));
    const layout = hasValid
      ? seatsDerived.map((seat, index) => {
          const entry = stored[index];
          const angle = getLegacyDisabledShapeSeatAngleFromWorld(
            entry.x,
            entry.y,
            cameraRef.current,
            viewportRef.current,
            tableRect?.width ?? 0,
            tableRect?.height ?? 0
          );
          return {
            ...seat,
            x: entry.x,
            y: entry.y,
            angle,
            side: getSeatSideFromAngle(angle)
          };
        })
      : buildLegacyDisabledShapeSeatLayout();
    setSeatPositions(layout);
    if (!hasValid) {
      const nextPositions = layout.map((seat) => ({ x: seat.x, y: seat.y }));
      setSettings((prev) => ({
        ...prev,
        roomSettings: {
          ...prev.roomSettings,
          seatPositions: {
            ...(prev.roomSettings.seatPositions ?? {}),
            legacyDisabledShape: nextPositions
          }
        }
      }));
    }
  }, [
    buildLegacyDisabledShapeSeatLayout,
    isLegacyDisabledShape,
    seatsDerived,
    setSettings,
    settings.roomSettings.seatPositions
  ]);

  actions.updateTabletopScale = useCallback(() => {
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
        actions.updateTabletopScale?.();
      }
    });

    tableObserver.observe(tableRef.current);
    const frameObserver = new ResizeObserver(() => {
      layoutSeats();
      actions.updateTabletopScale?.();
    });
    frameObserver.observe(tableFrameRef.current);
    return () => {
      tableObserver.disconnect();
      frameObserver.disconnect();
    };
  }, [actions, layoutSeats]);

  useEffect(() => {
    layoutSeats();
    actions.updateTabletopScale?.();
  }, [actions, layoutSeats]);

  useEffect(() => {
    layoutSeats();
  }, [combinedScale, layoutSeats]);

  useEffect(() => {
    const handleResize = () => {
      layoutSeats();
      actionsRef.current.updateTabletopScale?.();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [layoutSeats]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.code === 'Space') {
        if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') {
          return;
        }
        setIsSpaceDown(true);
      }
    };
    const handleKeyUp = (event) => {
      if (event.code === 'Space') {
        setIsSpaceDown(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    actions.updateTabletopScale?.();
  }, [actions, seatCount, tableShape]);

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
      holdingCount: interaction.held ? (interaction.held.cardIds?.length ?? 0) : 0
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

  const openCardPreview = useCallback(
    (cardId, faceUp = true) => {
      const card = cardsById?.[cardId];
      if (!card) {
        return;
      }
      setCardPreview({
        cardId,
        faceUp,
        card
      });
    },
    [cardsById]
  );

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
      selected: null,
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
    (draggedX, draggedY, excludedId, draggedBounds = { width: cardSize.width, height: cardSize.height }) => {
      for (let i = tableStacks.length - 1; i >= 0; i -= 1) {
        const stack = tableStacks[i];
        if (stack.id === excludedId) {
          continue;
        }
        const stackBounds = getStackBounds(stack, cardSize);
        const overlaps =
          draggedX < stack.x + stackBounds.width &&
          draggedX + draggedBounds.width > stack.x &&
          draggedY < stack.y + stackBounds.height &&
          draggedY + draggedBounds.height > stack.y;
        if (overlaps) {
          return stack.id;
        }
      }
      return null;
    },
    [cardSize.height, cardSize.width, tableStacks]
  );

  const interactiveStackRects = useMemo(() => {
    return tableStacks.map((stack) => {
      const bounds = getStackBounds(stack, cardSize);
      return { id: stack.id, x: stack.x, y: stack.y, width: bounds.width, height: bounds.height };
    });
  }, [cardSize, tableStacks]);

  const hitTestStack = useCallback((pointerX, pointerY) => {
    for (let i = interactiveStackRects.length - 1; i >= 0; i -= 1) {
      const stack = interactiveStackRects[i];
      if (
        pointerX >= stack.x &&
        pointerX <= stack.x + stack.width &&
        pointerY >= stack.y &&
        pointerY <= stack.y + stack.height
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

  const clampTopLeftToFelt = useCallback(
    (topLeft) => {
      if (isLegacyDisabledShape) {
        return { position: topLeft, inside: true, clampedCenter: null };
      }
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
    [
      cardSize.height,
      cardSize.width,
      feltScreenRect,
      isLegacyDisabledShape,
      tableScreenRect,
      tableShape
    ]
  );

  const getPointerLocalFromClient = useCallback((clientX, clientY) => {
    const table = tableRef.current;
    if (!table) {
      return null;
    }
    const scale = tableScaleRef.current || 1;
    const tableRect = table.getBoundingClientRect();
    return {
      x: (clientX - tableRect.left) / scale,
      y: (clientY - tableRect.top) / scale,
      tableRect,
      scale
    };
  }, []);

  const getTablePointerPositionFromClient = useCallback((clientX, clientY) => {
    const pointerLocal = getPointerLocalFromClient(clientX, clientY);
    if (!pointerLocal) {
      return null;
    }
    return clientToWorld(
      clientX,
      clientY,
      pointerLocal.tableRect,
      pointerLocal.scale,
      cameraRef.current,
      viewportRef.current,
      isLegacyDisabledShape
    );
  }, [getPointerLocalFromClient, isLegacyDisabledShape]);

  const getTablePointerPosition = useCallback(
    (event) =>
      getTablePointerPositionFromClient(event.clientX, event.clientY),
    [getTablePointerPositionFromClient]
  );

  const getStackIdFromEventTarget = useCallback((event) => {
    const node = event.target?.closest?.('.stack-entity');
    const id = node?.getAttribute?.('data-stack-id');
    return id || null;
  }, []);

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
    [seatCount, tableShape]
  );

  const updateSeatPosition = useCallback(
    (seatIndex, nextPosition) => {
      setSeatPositions((prev) => {
        if (!prev[seatIndex]) {
          return prev;
        }
        const angle = Math.atan2(nextPosition.y, nextPosition.x);
        const side = getSeatSideFromAngle(angle);
        const collides = prev.some(
          (seat, index) =>
            index !== seatIndex &&
            Math.hypot(nextPosition.x - seat.x, nextPosition.y - seat.y) < SEAT_DIAMETER_PX
        );
        if (collides) {
          return prev;
        }
        const next = prev.map((seat, index) =>
          index === seatIndex
            ? { ...seat, x: nextPosition.x, y: nextPosition.y, angle, side }
            : seat
        );
        const nextPositions = next.map((seat) => ({ x: seat.x, y: seat.y }));
        setSettings((prevSettings) => ({
          ...prevSettings,
          roomSettings: {
            ...prevSettings.roomSettings,
            seatPositions: {
              ...(prevSettings.roomSettings.seatPositions ?? {}),
              legacyDisabledShape: nextPositions
            }
          }
        }));
        return next;
      });
    },
    [setSettings]
  );

  const updateSeatParamFromPointer = useCallback(
    (event, seatIndex) => {
      if (isLegacyDisabledShape) {
        const position = getTablePointerPosition(event);
        if (!position) {
          return;
        }
        updateSeatPosition(seatIndex, position);
        return;
      }
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
    [
      getTablePointerPosition,
      isLegacyDisabledShape,
      seatParams,
      seatRailBounds,
      tableShape,
      updateSeatParam,
      updateSeatPosition
    ]
  );

  actions.updateSeatDropHover = useCallback(
    (clientX, clientY) => {
      if (!interaction.held && interaction.mode !== 'dragStack') {
        if (hoverSeatDropIndex !== null) {
          setHoverSeatDropIndex(null);
        }
        return;
      }
      const seatIndex = getSeatIndexAtScreenPoint(clientX, clientY);
      setHoverSeatDropIndex(seatIndex);
    },
    [getSeatIndexAtScreenPoint, hoverSeatDropIndex, interaction.held, interaction.mode]
  );

  actions.handleInventoryHeaderPointerDown = useCallback(
    (event) => {
      if (!settings.inventoryDragEnabled) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const panel = inventoryPanelRef.current;
      if (!panel) {
        return;
      }
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const startPosition = inventoryPos ?? { x: rect.left, y: rect.top };
      setInventoryPos(startPosition);
      setInventoryDrag({
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height
      });
    },
    [inventoryPos, settings.inventoryDragEnabled]
  );

  useEffect(() => {
    if (!inventoryDrag) {
      return;
    }
    const handleMove = (event) => {
      const next = {
        x: event.clientX - inventoryDrag.offsetX,
        y: event.clientY - inventoryDrag.offsetY
      };
      const rect = { width: inventoryDrag.width, height: inventoryDrag.height };
      const clamped = clampInventoryPosition(next, rect);
      setInventoryPos(clamped);
    };
    const handleUp = () => {
      setInventoryDrag(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [inventoryDrag]);

  actions.handleInventoryCardPointerDown = useCallback(
    (event, cardId) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target.closest?.('button')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setInventoryCardDrag({
        cardId,
        pointerId: event.pointerId
      });
    },
    []
  );

  useEffect(() => {
    if (!inventoryPos || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('tt_inventoryPos', JSON.stringify(inventoryPos));
  }, [inventoryPos]);

  actions.resetInventoryPosition = useCallback(() => {
    setInventoryPos(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('tt_inventoryPos');
    }
  }, []);

  useEffect(() => {
    if (!inventoryPos) {
      return;
    }
    const panel = inventoryPanelRef.current;
    if (!panel) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const clamped = clampInventoryPosition(inventoryPos, rect);
    if (clamped.x !== inventoryPos.x || clamped.y !== inventoryPos.y) {
      setInventoryPos(clamped);
    }
  }, [inventoryPos]);

  const logDealt = useCallback(
    (seatIndex, count) => {
      const seatLabel = `Seat ${seatIndex + 1}`;
      logAction(`Dealt ${count} ${count === 1 ? 'card' : 'cards'} to ${seatLabel}`);
    },
    [logAction]
  );

  const logRevealChange = useCallback(
    (playerName, isRevealed) => {
      logAction(`${playerName} ${isRevealed ? 'hid' : 'revealed'} a card`);
    },
    [logAction]
  );

  const logPublicReveal = useCallback(
    (cardId) => {
      logAction(`${myName} revealed ${getCardLabel(cardId)}`);
    },
    [getCardLabel, logAction, myName]
  );

  actions.handleSeatPointerDown = useCallback(
    (event, seatIndex) => {
      if (interaction.mode !== 'idle' || settings.roomSettings.seatLock || isModalOpen) {
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
    [interaction.mode, isModalOpen, settings.roomSettings.seatLock, updateSeatParamFromPointer]
  );

  actions.handleSeatPointerMove = useCallback(
    (event, seatIndex) => {
      if (settings.roomSettings.seatLock || isModalOpen) {
        return;
      }
      if (interaction.held && dragSeatIndex !== seatIndex) {
        actions.updateSeatDropHover?.(event.clientX, event.clientY);
        return;
      }
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
    [
      actions,
      dragSeatIndex,
      interaction.held,
      isModalOpen,
      settings.roomSettings.seatLock,
      updateSeatParamFromPointer
    ]
  );

  actions.handleSeatPointerUp = useCallback(() => {
    actions.releaseCapturedPointer();
    setDragSeatIndex(null);
  }, [actions]);

  const DRAG_THRESHOLD = 6;

  actions.handleSeatClick = useCallback(
    (seatIndex) => {
      if (seatDragRef.current.moved && seatDragRef.current.seatIndex === seatIndex) {
        seatDragRef.current = { seatIndex: null, moved: false, start: null };
        return;
      }
      seatDragRef.current = { seatIndex: null, moved: false, start: null };
      if (interaction.held || interaction.mode === 'holdStack') {
        if (interaction.held) {
          moveCardIdsToHand(seatIndex, interaction.held.cardIds);
          logDealt(seatIndex, interaction.held.cardIds?.length ?? 0);
          actions.clearInteraction({ preserveSelection: false });
        }
        return;
      }
      actions.openSeatMenu?.(seatIndex);
    },
    [actions, interaction.held, interaction.mode, logDealt, moveCardIdsToHand]
  );

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
          return prev.map((stack) => {
            if (stack.id !== origin.stackId) {
              return stack;
            }
            if (isChipStack(held) || isChipStack(origin)) {
              return {
                ...stack,
                kind: 'chipStack',
                denom: origin.denom ?? held.denom ?? stack.denom,
                count: origin.countBefore ?? ((stack.count ?? 0) + (held.count ?? 0))
              };
            }
            return {
              ...stack,
              cardIds: origin.cardIdsBefore ?? [...stack.cardIds, ...(held.cardIds ?? [])]
            };
          });
        }
      }
      if (isChipStack(held)) {
        return prev.concat({
          id: origin.stackId ?? held.stackId,
          kind: 'chipStack',
          denom: held.denom,
          count: origin.countBefore ?? held.count,
          x: origin.x ?? 0,
          y: origin.y ?? 0,
          z: 0,
          zone: 'table',
          ownerSeatIndex: null,
          rotation: 0
        });
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
    actions.clearInteraction();
  }, [actions, interaction.held, setStacks]);

  actions.pickupFromStack = useCallback(
    (stackId, count, pointerId = null) => {
      const pointerPosition = lastPointerWorldRef.current;
      setStacks((prev) => {
        const source = prev.find((stack) => stack.id === stackId);
        if (!source) {
          return prev;
        }
        const isChips = isChipStack(source);
        const isCards = isCardStack(source);
        if (!isChips && !isCards) {
          return prev;
        }
        const total = isChips ? (source.count ?? 0) : (source.cardIds?.length ?? 0);
        if (!total) {
          return prev;
        }
        const requested =
          count === 'all' ? total : Math.max(1, Number.parseInt(count, 10) || 1);
        const clamped = Math.min(requested, total);
        if (clamped <= 0) {
          return prev;
        }

        const heldStackId = createStackId();
        const origin = {
          stackId: source.id,
          x: source.x,
          y: source.y,
          faceUp: source.faceUp,
          cardIdsBefore: source.cardIds,
          countBefore: source.count,
          denom: source.denom,
          kind: source.kind
        };
        const originX = origin.x ?? 0;
        const originY = origin.y ?? 0;
        const bounds = getStackBounds(source, cardSize);
        const offset = { x: bounds.width / 2, y: bounds.height / 2 };

        if (isChips) {
          const remaining = (source.count ?? 0) - clamped;
          setInteraction((prevInteraction) => ({
            ...prevInteraction,
            mode: 'holdStack',
            pointerId,
            source: { stackId },
            held: {
              stackId: heldStackId,
              kind: 'chipStack',
              denom: source.denom,
              count: clamped,
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
              remaining === 0 && prevInteraction.selectedStackId === stackId
                ? null
                : prevInteraction.selectedStackId,
            menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
          }));
          return prev
            .map((stack) =>
              stack.id === stackId ? { ...stack, count: remaining } : stack
            )
            .filter((stack) => stack.id !== stackId || (stack.count ?? 0) > 0);
        }

        const remaining = source.cardIds.slice(0, total - clamped);
        const pickedIds = source.cardIds.slice(total - clamped);
        if (!pickedIds.length) {
          return prev;
        }
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
    [cardSize, createStackId, defaultRmbState, setStacks]
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
    [clampTopLeftToFelt, interaction.drag, interaction.mode, setStacks]
  );

  const mergeStacks = useCallback(
    (sourceId, targetId) => {
      let mergedChips = null;
      setStacks((prev) => {
        const source = prev.find((stack) => stack.id === sourceId);
        const target = prev.find((stack) => stack.id === targetId);
        if (!source || !target) {
          return prev;
        }
        if (isChipStack(source) || isChipStack(target)) {
          if (!isChipStack(source) || !isChipStack(target) || source.denom !== target.denom) {
            return prev;
          }
          mergedChips = { denom: source.denom, added: source.count ?? 0 };
          const merged = {
            ...target,
            count: (target.count ?? 0) + (source.count ?? 0)
          };
          return prev.filter((stack) => stack.id !== sourceId && stack.id !== targetId).concat(merged);
        }
        if (!isCardStack(source) || !isCardStack(target)) {
          return prev;
        }
        const merged = {
          ...target,
          cardIds: [...target.cardIds, ...source.cardIds]
        };
        return prev.filter((stack) => stack.id !== sourceId && stack.id !== targetId).concat(merged);
      });
      if (mergedChips) {
        logAction(`${myName} combined $${mergedChips.denom} chips (+${mergedChips.added})`);
      }
    },
    [logAction, myName, setStacks]
  );

  const dropHeld = useCallback(
    (pointerWorld, clientX, clientY) => {
      const held = interaction.held;
      if (!held || !interaction.drag) {
        return;
      }
      if (!isCardStack(held)) {
        const pointerPosition = pointerWorld ?? lastPointerWorldRef.current;
        if (!pointerPosition) {
          return;
        }
        const nextTopLeft = getHeldTopLeft(pointerPosition, interaction.drag.offset);
        const clamped = clampTopLeftToFelt(nextTopLeft);
        const placement = clamped.position ?? nextTopLeft;
        const overlapId = findTableOverlapStackId(
          placement.x,
          placement.y,
          null,
          getStackBounds(held, cardSize)
        );
        if (overlapId) {
          mergeStacks(held.stackId, overlapId);
          actions.clearInteraction({ preserveSelection: true, nextSelectedStackId: overlapId });
          return;
        }
        setStacks((prev) =>
          prev.concat({
            id: held.stackId,
            kind: held.kind,
            denom: held.denom,
            count: held.count,
            sides: held.sides,
            value: held.value,
            x: placement.x,
            y: placement.y,
            rotation: 0,
            zone: 'table',
            ownerSeatIndex: null
          })
        );
        actions.clearInteraction({ preserveSelection: true, nextSelectedStackId: held.stackId });
        return;
      }

      const seatDropIndex =
        clientX !== undefined && clientY !== undefined
          ? getSeatIndexAtScreenPoint(clientX, clientY)
          : null;
      if (seatDropIndex !== null && seatDropIndex !== undefined) {
        moveCardIdsToHand(seatDropIndex, held.cardIds);
        logDealt(seatDropIndex, held.cardIds?.length ?? 0);
        actions.clearInteraction({ preserveSelection: false });
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
      if (handSeatIndex !== null && handSeatIndex !== undefined) {
        moveCardIdsToHand(handSeatIndex, held.cardIds);
        logDealt(handSeatIndex, held.cardIds?.length ?? 0);
        actions.clearInteraction({ preserveSelection: false });
        return;
      }
      const overlapId = findTableOverlapStackId(placement.x, placement.y, null);
      if (overlapId) {
        setStacks((prev) => {
          const target = prev.find((stack) => stack.id === overlapId);
          if (!target || !isCardStack(target)) {
            return prev;
          }
          const merged = {
            ...target,
            cardIds: [...target.cardIds, ...held.cardIds]
          };
          return prev.filter((stack) => stack.id !== overlapId).concat(merged);
        });
        actions.clearInteraction({
          preserveSelection: true,
          nextSelectedStackId: overlapId
        });
        return;
      }
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
      actions.clearInteraction({
        preserveSelection: true,
        nextSelectedStackId: held.stackId
      });
    },
    [
      cardSize.height,
      cardSize.width,
      clampTopLeftToFelt,
      actions.clearInteraction,
      findTableOverlapStackId,
      getHandZoneAtPoint,
      getSeatIndexAtScreenPoint,
      interaction.drag,
      interaction.held,
      logDealt,
      mergeStacks,
      moveCardIdsToHand,
      setStacks
    ]
  );

  const endDrag = useCallback(
    (pointerWorld, clientX, clientY) => {
      if (interaction.mode !== 'dragStack' || !interaction.drag) {
        return;
      }
      const draggedId = interaction.drag.stackId;
      const draggedStack = stacksById[draggedId];
      if (!draggedStack) {
        actions.clearInteraction({ preserveSelection: false });
        return;
      }
      if (isCardStack(draggedStack)) {
        const seatDropIndex =
          clientX !== undefined && clientY !== undefined
            ? getSeatIndexAtScreenPoint(clientX, clientY)
            : null;
        if (seatDropIndex !== null && seatDropIndex !== undefined) {
          moveCardIdsToHand(seatDropIndex, draggedStack.cardIds);
          logDealt(seatDropIndex, draggedStack.cardIds?.length ?? 0);
          setStacks((prev) => prev.filter((stack) => stack.id !== draggedId));
          actions.clearInteraction();
          return;
        }
        const placement = { x: draggedStack.x, y: draggedStack.y };
        const handSeatIndex = getHandZoneAtPoint(
          placement.x + cardSize.width / 2,
          placement.y + cardSize.height / 2
        );
        if (handSeatIndex !== null && handSeatIndex !== undefined) {
          moveCardIdsToHand(handSeatIndex, draggedStack.cardIds);
          logDealt(handSeatIndex, draggedStack.cardIds?.length ?? 0);
          setStacks((prev) => prev.filter((stack) => stack.id !== draggedId));
          actions.clearInteraction();
          return;
        }
      }
      const placement = { x: draggedStack.x, y: draggedStack.y };
      const overlapId = findTableOverlapStackId(
        placement.x,
        placement.y,
        draggedId,
        getStackBounds(draggedStack, cardSize)
      );
      if (overlapId) {
        mergeStacks(draggedId, overlapId);
        actions.clearInteraction({
          preserveSelection: true,
          nextSelectedStackId:
            interaction.selectedStackId === draggedId
              ? overlapId
              : interaction.selectedStackId
        });
        return;
      }
      actions.clearInteraction({ preserveSelection: true });
    },
    [
      cardSize.height,
      cardSize.width,
      actions.clearInteraction,
      findTableOverlapStackId,
      getHandZoneAtPoint,
      getSeatIndexAtScreenPoint,
      interaction.drag,
      interaction.mode,
      interaction.selectedStackId,
      logDealt,
      mergeStacks,
      moveCardIdsToHand,
      setStacks,
      stacksById
    ]
  );

  actions.cancelDrag = useCallback(() => {
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
    actions.clearInteraction({ preserveSelection: true });
  }, [
    actions,
    interaction.drag,
    interaction.held,
    interaction.mode,
    restoreHeldToOrigin,
    setStacks
  ]);

  const placeOneFromHeld = useCallback(
    (pointerWorld) => {
      if (!interaction.held || !interaction.drag || !isCardStack(interaction.held)) {
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
        actions.clearInteraction({ preserveSelection: true });
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
        actions.clearInteraction({ preserveSelection: true });
      } else {
        setInteraction((prev) => ({
          ...prev,
          held: prev.held ? { ...prev.held, cardIds: remaining } : prev.held
        }));
      }
    },
    [
      clampTopLeftToFelt,
      actions.clearInteraction,
      createStackId,
      findTableOverlapStackId,
      interaction.drag,
      interaction.held,
      myName,
      logAction,
      setStacks
    ]
  );


  const placeOneChipFromHeld = useCallback(
    (pointerWorld) => {
      if (!interaction.held || !interaction.drag || !isChipStack(interaction.held)) {
        return;
      }
      const pointerPosition = pointerWorld ?? lastPointerWorldRef.current;
      if (!pointerPosition) {
        return;
      }
      const nextTopLeft = getHeldTopLeft(pointerPosition, interaction.drag.offset);
      const placement = clampTopLeftToFelt(nextTopLeft).position ?? nextTopLeft;
      const overlapId = findTableOverlapStackId(placement.x, placement.y, null, { width: 88, height: 88 });
      const placedStackId = createStackId();
      setStacks((prev) => {
        const next = prev.concat({
          id: placedStackId,
          kind: 'chipStack',
          denom: interaction.held.denom,
          count: 1,
          x: placement.x,
          y: placement.y,
          z: 0,
          zone: 'table',
          ownerSeatIndex: null,
          rotation: 0
        });
        if (!overlapId) {
          return next;
        }
        const target = next.find((stack) => stack.id === overlapId);
        if (!target || !isChipStack(target) || target.denom !== interaction.held.denom) {
          return next;
        }
        return next
          .filter((stack) => stack.id !== overlapId && stack.id !== placedStackId)
          .concat({ ...target, count: (target.count ?? 0) + 1 });
      });
      const remaining = (interaction.held.count ?? 0) - 1;
      if (remaining <= 0) {
        actions.clearInteraction({ preserveSelection: true });
        return;
      }
      setInteraction((prev) => ({
        ...prev,
        held: prev.held ? { ...prev.held, count: remaining } : prev.held
      }));
    },
    [
      actions.clearInteraction,
      clampTopLeftToFelt,
      createStackId,
      findTableOverlapStackId,
      interaction.drag,
      interaction.held,
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

      drops = Math.min(drops, interaction.held.cardIds?.length ?? 0, SLIDE_MAX_DROPS_PER_TICK);
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
        actions.clearInteraction({ preserveSelection: true });
        return;
      }
      setStacks((prev) => prev.concat(placements));
      logAction(`${myName} placed ${placements.length} card${placements.length === 1 ? '' : 's'}`);

      if (remaining.length === 0) {
        actions.clearInteraction({ preserveSelection: true });
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
      clampTopLeftToFelt,
      actions.clearInteraction,
      createStackId,
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
      actions.clearRmbHoldTimer();
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
    [actions, interaction.drag]
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
  actions.handleUndo = useCallback(() => {
    if (isModalOpen) {
      return;
    }
    const previousSnapshot = historyRef.current[historyRef.current.length - 1];
    if (!previousSnapshot) {
      return;
    }
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    const normalizedSnapshot = normalizeTableState(previousSnapshot);
    restoringFromUndoRef.current = true;
    setStacks(cloneState(normalizedSnapshot.stacks));
    setHands(cloneState(normalizedSnapshot.hands ?? {}));
    setSeatPositions(cloneState(normalizedSnapshot.seats));
    setInteraction((prev) => ({
      ...prev,
      mode: 'idle',
      pointerId: null,
      source: null,
      drag: null,
      held: cloneState(previousSnapshot.held ?? null),
      selectedStackId: previousSnapshot.selectedStackId ?? null,
      selected: previousSnapshot.selectedStackId ? { kind: 'stack', id: previousSnapshot.selectedStackId } : null,
      menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
    }));
    setTimeout(() => {
      restoringFromUndoRef.current = false;
    }, 0);
    logAction(`${myName} undid an action`);
  }, [cloneState, isModalOpen, logAction, myName, setHands, setSeatPositions, setStacks]);

  actions.promptRemoveSelected = useCallback(() => {
    if (!interaction.selectedStackId || isModalOpen) {
      return;
    }
    setRemoveConfirmOpen(true);
  }, [interaction.selectedStackId, isModalOpen]);

  actions.handleRemoveSelected = useCallback(() => {
    const stackId = interaction.selectedStackId;
    if (!stackId) {
      setRemoveConfirmOpen(false);
      return;
    }
    setStacks((prev) => {
      if (!prev.some((stack) => stack.id === stackId)) {
        return prev;
      }
      return prev.filter((stack) => stack.id !== stackId);
    });
    setInteraction((prev) => {
      const shouldClearHeld = prev.held?.stackId === stackId;
      return {
        ...prev,
        mode: shouldClearHeld ? 'idle' : prev.mode,
        pointerId: shouldClearHeld ? null : prev.pointerId,
        source: shouldClearHeld ? null : prev.source,
        drag: shouldClearHeld ? null : prev.drag,
        held: shouldClearHeld ? null : prev.held,
        selectedStackId: prev.selectedStackId === stackId ? null : prev.selectedStackId,
        selected: prev.selectedStackId === stackId ? null : prev.selected,
        menu: { open: false, stackId: null, screenX: 0, screenY: 0 }
      };
    });
    setPickCountOpen(false);
    setRemoveConfirmOpen(false);
    logAction(`${myName} removed a stack`);
  }, [interaction.selectedStackId, logAction, myName, setStacks]);


  actions.splitSelectedChipStack = useCallback((count) => {
    if (!interaction.selectedStackId) {
      return;
    }
    const parsed = Math.max(1, Number.parseInt(count, 10) || 1);
    let nextSelected = null;
    setStacks((prev) => {
      const source = prev.find((stack) => stack.id === interaction.selectedStackId);
      if (!source || !isChipStack(source)) {
        return prev;
      }
      if (parsed >= source.count) {
        return prev;
      }
      const splitId = createStackId();
      nextSelected = splitId;
      const sourceBounds = getStackBounds(source, cardSize);
      const splitStack = {
        id: splitId,
        kind: 'chipStack',
        denom: source.denom,
        count: parsed,
        x: source.x + sourceBounds.width + 18,
        y: source.y,
        z: 0,
        rotation: 0,
        zone: 'table',
        ownerSeatIndex: null
      };
      return prev
        .map((stack) =>
          stack.id === source.id ? { ...stack, count: source.count - parsed } : stack
        )
        .concat(splitStack);
    });
    if (nextSelected) {
      setInteraction((prev) => ({
        ...prev,
        selectedStackId: nextSelected,
        selected: nextSelected ? { kind: 'chips', id: nextSelected } : prev.selected,
        menu: { ...prev.menu, open: false, stackId: null }
      }));
      logAction(`${myName} split ${parsed} chips`);
    }
  }, [cardSize, createStackId, interaction.selectedStackId, logAction, myName, setStacks]);

  actions.handleFlipSelected = useCallback(() => {
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
        arr(selected.cardIds).forEach((cardId) => {
          const currentFace = typeof next[cardId] === 'boolean' ? next[cardId] : selected.faceUp;
          next[cardId] = !currentFace;
        });
        return next;
      });
    }
    logAction(`${myName} flipped a stack`);
  }, [interaction.selectedStackId, myName, logAction, setStacks, stacksById]);

  actions.handleShuffleSelected = useCallback(() => {
    if (!interaction.selectedStackId) {
      return;
    }
    setStacks((prev) =>
      prev.map((stack) => {
        if (stack.id !== interaction.selectedStackId) {
          return stack;
        }
        const nextCardIds = [...arr(stack.cardIds)];
        for (let i = nextCardIds.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [nextCardIds[i], nextCardIds[j]] = [nextCardIds[j], nextCardIds[i]];
        }
        return { ...stack, cardIds: nextCardIds };
      })
    );
    logAction(`${myName} shuffled a stack`);
  }, [interaction.selectedStackId, myName, logAction, setStacks]);


  actions.handleRollSelectedDie = useCallback(() => {
    if (!interaction.selectedStackId) {
      return;
    }
    let rolled = null;
    setStacks((prev) =>
      prev.map((stack) => {
        if (stack.id !== interaction.selectedStackId || !isDieStack(stack)) {
          return stack;
        }
        const value = Math.floor(Math.random() * stack.sides) + 1;
        rolled = { sides: stack.sides, value };
        return { ...stack, value };
      })
    );
    if (rolled) {
      logAction(`${myName} rolled d${rolled.sides} → ${rolled.value}`);
    }
  }, [interaction.selectedStackId, logAction, myName, setStacks]);

  actions.updateSelectedEntity = useCallback((updates) => {
    if (!interaction.selectedStackId || !updates || typeof updates !== 'object') {
      return;
    }
    setStacks((prev) =>
      prev.map((stack) =>
        stack.id === interaction.selectedStackId ? { ...stack, ...updates } : stack
      )
    );
  }, [interaction.selectedStackId, setStacks]);

  actions.handleKeyDown = useCallback(
    (event) => {
      if (event.repeat) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isModalOpen) {
          setResetConfirmOpen(false);
          setItemSpawnerOpen(false);
          setSaveLayoutOpen(false);
          setCardPreview(null);
          setRemoveConfirmOpen(false);
        }
        actions.cancelDrag?.();
        actions.closeSeatMenu?.();
        return;
      }
      const isFormElement =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' ||
          event.target.tagName === 'TEXTAREA' ||
          event.target.tagName === 'SELECT' ||
          event.target.isContentEditable);
      const lowerKey = event.key.toLowerCase();
      const isUndoShortcut = (event.ctrlKey || event.metaKey) && lowerKey === 'z';
      if (isUndoShortcut && !isFormElement && !isModalOpen) {
        event.preventDefault();
        actions.handleUndo?.();
        return;
      }
      if (isModalOpen || isFormElement || !interaction.selectedStackId) {
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        actions.promptRemoveSelected?.();
        return;
      }
      if (lowerKey === 'f') {
        event.preventDefault();
        actions.handleFlipSelected?.();
        return;
      }
      if (lowerKey === 's') {
        event.preventDefault();
        actions.handleShuffleSelected?.();
        return;
      }
      if (lowerKey === 'r') {
        event.preventDefault();
        actions.handleRollSelectedDie?.();
        return;
      }
      if (event.key === '1' || event.key === '5' || event.key === '0') {
        event.preventDefault();
        const pickCount = event.key === '0' ? 10 : Number(event.key);
        actions.pickupFromStack?.(interaction.selectedStackId, pickCount);
      }
    },
    [actions, interaction.selectedStackId, isModalOpen]
  );

  useEffect(() => {
    const handleKeyDownEvent = (event) => actionsRef.current.handleKeyDown?.(event);
    window.addEventListener('keydown', handleKeyDownEvent);
    return () => window.removeEventListener('keydown', handleKeyDownEvent);
  }, []);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setResetConfirmOpen(false);
        setItemSpawnerOpen(false);
        setSaveLayoutOpen(false);
        setCardPreview(null);
        setRemoveConfirmOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isModalOpen]);

  useEffect(() => {
    const handleCancelEvent = () => {
      const currentInteraction = interactionRef.current;
      if (currentInteraction?.mode !== 'idle') {
        actionsRef.current.cancelDrag?.();
      }
    };
    window.addEventListener('pointercancel', handleCancelEvent);
    window.addEventListener('blur', handleCancelEvent);
    return () => {
      window.removeEventListener('pointercancel', handleCancelEvent);
      window.removeEventListener('blur', handleCancelEvent);
    };
  }, []);

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
    const handlePointerMoveEvent = (event) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const currentInteraction = interactionRef.current;
      if (currentInteraction?.held) {
        setHeldScreenPos({ x: event.clientX, y: event.clientY });
      }
      if (currentInteraction?.held || currentInteraction?.mode === 'dragStack') {
        actionsRef.current.updateSeatDropHover?.(event.clientX, event.clientY);
      }
    };
    window.addEventListener('pointermove', handlePointerMoveEvent);
    return () => {
      window.removeEventListener('pointermove', handlePointerMoveEvent);
    };
  }, []);

  useEffect(() => {
    if (!interaction.held) {
      setHeldScreenPos(null);
      return;
    }
    if (!heldScreenPos && lastPointerRef.current) {
      setHeldScreenPos(lastPointerRef.current);
    }
  }, [heldScreenPos, interaction.held]);

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

  actions.handleSurfaceWheel = useCallback(
    (event) => {
      if (!isLegacyDisabledShape) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const zoomFactor = 1 + direction * 0.08;
      setCamera((prev) => ({
        ...prev,
        zoom: clamp(prev.zoom * zoomFactor, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX)
      }));
    },
    [isLegacyDisabledShape]
  );

  actions.handleSurfacePointerDown = useCallback(
    (event) => {
      if (isModalOpen) {
        return;
      }
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const pointerWorld = getTablePointerPosition(event);
      if (!pointerWorld) {
        return;
      }
      event.preventDefault();
      lastPointerWorldRef.current = pointerWorld;
      updatePresence({ isDown: true, x: pointerWorld.x, y: pointerWorld.y });
      actions.closeSeatMenu?.();
      if (interaction.menu.open) {
        actions.closeMenu?.();
      }
      const stackIdFromTarget = getStackIdFromEventTarget(event);
      const stackId = stackIdFromTarget ?? hitTestStack(pointerWorld.x, pointerWorld.y);
      const shouldPan =
        isLegacyDisabledShape &&
        !interaction.held &&
        ((event.button === 2 && !stackId) || (event.button === 0 && isSpaceDown));
      if (shouldPan) {
        if (event.currentTarget?.setPointerCapture && event.pointerId !== undefined) {
          event.currentTarget.setPointerCapture(event.pointerId);
          capturedPointerRef.current = {
            pointerId: event.pointerId,
            element: event.currentTarget
          };
        }
        panRef.current = {
          pointerId: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          camera: { ...cameraRef.current }
        };
        setIsPanning(true);
        return;
      }
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
          actions.clearRmbHoldTimer();
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
      actions,
      getStackIdFromEventTarget,
      isLegacyDisabledShape,
      isSpaceDown,
      getTablePointerPosition,
      hitTestStack,
      interaction.held,
      interaction.menu.open,
      isModalOpen,
      setInteraction,
      updatePresence
    ]
  );

  actions.handleStackPointerDown = useCallback((_event, stackId) => {
    if (!stackId) {
      return;
    }
    // Keep stack IDs available from event targets so surface handlers can avoid hit-test drift.
  }, []);

  actions.handleSurfacePointerMove = useCallback(
    (event) => {
      if (isModalOpen) {
        return;
      }
      if (isPanning && panRef.current.pointerId === event.pointerId) {
        event.preventDefault();
        const start = panRef.current.start;
        const startCamera = panRef.current.camera ?? cameraRef.current;
        if (!start || !startCamera) {
          return;
        }
        const scale = tableScaleRef.current || 1;
        const zoom = startCamera.zoom || 1;
        const dx = (event.clientX - start.x) / scale;
        const dy = (event.clientY - start.y) / scale;
        setCamera({
          ...startCamera,
          x: startCamera.x - dx / zoom,
          y: startCamera.y - dy / zoom
        });
        return;
      }
      const pointerWorld = getTablePointerPosition(event);
      if (!pointerWorld) {
        return;
      }
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      lastPointerWorldRef.current = pointerWorld;
      updatePresence({ x: pointerWorld.x, y: pointerWorld.y });
      actions.updateSeatDropHover?.(event.clientX, event.clientY);

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
            if ((interaction.held.cardIds?.length ?? 0) <= 1) {
              if (isChipStack(interaction.held)) {
                placeOneChipFromHeld(pointerWorld);
              } else {
                placeOneFromHeld(pointerWorld);
              }
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
            const pendingStack = stacksById[pending.stackId];
            if (isDieStack(pendingStack) || isChipStack(pendingStack)) {
              startDragStack(pending.stackId, pointerWorld, event.pointerId);
            } else {
              actions.pickupFromStack?.(pending.stackId, 1, event.pointerId);
            }
          }
          if (pending.button === 2 && pending.stackId) {
            actions.pickupFromStack?.(pending.stackId, 'all', event.pointerId);
          }
        }
      }

      handlePointerMoveHover(pointerWorld);
    },
    [
      DRAG_THRESHOLD,
      actions,
      stacksById,
      startDragStack,
      beginRmbSlide,
      isPanning,
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
      placeOneFromHeld,
      sweepPlaceFromHeld,
      updateDrag,
      updatePresence,
      isModalOpen
    ]
  );

  actions.handleSurfacePointerUp = useCallback(
    (event) => {
      if (isModalOpen) {
        return;
      }
      if (isPanning && panRef.current.pointerId === event.pointerId) {
        setIsPanning(false);
        panRef.current = { pointerId: null, start: null, camera: null };
        actions.releaseCapturedPointer();
        return;
      }
      actions.clearRmbHoldTimer();
      const pointerWorld = getTablePointerPosition(event);
      if (pointerWorld) {
        lastPointerWorldRef.current = pointerWorld;
      }
      const pending = pointerDownRef.current;
      if (pending && pending.pointerId === event.pointerId) {
        if (!pending.dragStarted && pending.button === 0 && pending.stackId) {
          actions.selectStack?.(pending.stackId, {
            x: event.clientX,
            y: event.clientY
          });
        } else if (!pending.dragStarted && pending.button === 2 && pending.stackId) {
          actions.pickupFromStack?.(pending.stackId, 'all', event.pointerId);
        }
        pointerDownRef.current = null;
      }

      const isRightButton = event.button === 2;
      const isBlurEvent = event.type === 'blur' || event.type === 'pointercancel';
      if (interaction.rmbDown && (isRightButton || isBlurEvent)) {
        if (!interaction.isSliding && isRightButton) {
          if (isChipStack(interaction.held)) {
            placeOneChipFromHeld(pointerWorld);
          } else {
            placeOneFromHeld(pointerWorld);
          }
        }
        setInteraction((prev) => ({
          ...prev,
          ...defaultRmbState
        }));
      }

      if (interaction.mode === 'dragStack' && interaction.pointerId === event.pointerId) {
        endDrag(pointerWorld, event.clientX, event.clientY);
      } else if (
        interaction.mode === 'holdStack' &&
        interaction.pointerId === event.pointerId &&
        event.button === 0
      ) {
        dropHeld(pointerWorld, event.clientX, event.clientY);
      }
      setHoverSeatDropIndex(null);
      actions.releaseCapturedPointer();
    },
    [
      actions,
      defaultRmbState,
      dropHeld,
      endDrag,
      getTablePointerPosition,
      isPanning,
      interaction.mode,
      interaction.pointerId,
      interaction.rmbDown,
      interaction.isSliding,
      placeOneFromHeld,
      actions.pickupFromStack,
      actions.selectStack,
      isModalOpen
    ]
  );

  useEffect(() => {
    const handleRelease = () => {
      actionsRef.current.releaseCapturedPointer?.();
    };
    window.addEventListener('pointerup', handleRelease);
    window.addEventListener('pointercancel', handleRelease);
    window.addEventListener('blur', handleRelease);
    return () => {
      window.removeEventListener('pointerup', handleRelease);
      window.removeEventListener('pointercancel', handleRelease);
      window.removeEventListener('blur', handleRelease);
    };
  }, []);


  const playFromHand = useCallback(
    (cardIds, pointerWorld) => {
      if (mySeatIndex === null || mySeatIndex === undefined) {
        return;
      }
      if (!pointerWorld) {
        return;
      }
      const ids = Array.isArray(cardIds) ? cardIds : [cardIds];
      if (!ids.length) {
        return;
      }
      const seatHand = hands?.[mySeatIndex]?.cardIds ?? [];
      const validIds = ids.filter((id) => seatHand.includes(id));
      if (!validIds.length) {
        return;
      }
      const isRevealed = (id) => Boolean(hands?.[mySeatIndex]?.revealed?.[id]);
      const faceUp = validIds.every(isRevealed);
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
      validIds.forEach((id) => moveFromHandToTable(mySeatIndex, id));
      setStacks((prev) =>
        prev.concat({
          id: createStackId(),
          x: placement.x,
          y: placement.y,
          rotation: 0,
          faceUp,
          cardIds: validIds,
          zone: 'table',
          ownerSeatIndex: null
        })
      );
      if (faceUp) {
        if (validIds.length === 1) {
          logAction(`${myName} played ${getCardLabel(validIds[0])}`);
        } else {
          logAction(`${myName} played ${validIds.length} revealed cards`);
        }
      } else {
        logAction(
          `${myName} played ${validIds.length === 1 ? 'a card' : `${validIds.length} cards`} face-down`
        );
      }
    },
    [
      cardSize.height,
      cardSize.width,
      clampTopLeftToFelt,
      createStackId,
      getCardLabel,
      getHandZoneAtPoint,
      hands,
      moveFromHandToTable,
      myName,
      mySeatIndex,
      logAction,
      setStacks
    ]
  );

  useEffect(() => {
    if (!inventoryCardDrag) {
      return;
    }
    const handlePointerUp = (event) => {
      if (event.pointerId !== inventoryCardDrag.pointerId) {
        return;
      }
      const table = tableRef.current;
      if (table) {
        const rect = table.getBoundingClientRect();
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (inside) {
          const pointer = getTablePointerPositionFromClient(event.clientX, event.clientY);
          playFromHand(inventoryCardDrag.cardId, pointer);
        }
      }
      setInventoryCardDrag(null);
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [getTablePointerPositionFromClient, inventoryCardDrag, playFromHand]);

  actions.handleToggleReveal = useCallback(
    (cardId) => {
      if (mySeatIndex === null || mySeatIndex === undefined) {
        return;
      }
      const seatHand = hands?.[mySeatIndex];
      const isRevealed = Boolean(seatHand?.revealed?.[cardId]);
      toggleReveal(mySeatIndex, cardId);
      logRevealChange(myName, isRevealed);
    },
    [hands, myName, mySeatIndex, logRevealChange, toggleReveal]
  );

  useEffect(() => {
    if (!customLayoutsIndex.length) {
      setSelectedLayoutCode('');
      return;
    }
    if (!selectedLayoutCode || !customLayoutsIndex.some((entry) => entry.code === selectedLayoutCode)) {
      setSelectedLayoutCode(customLayoutsIndex[0].code);
    }
  }, [customLayoutsIndex, selectedLayoutCode]);

  const filteredItemSpawnerItems = useMemo(() => {
    const query = itemSpawnerSearchQuery.trim().toLowerCase();
    if (!query) {
      return ITEM_SPAWNER_ITEMS;
    }
    return ITEM_SPAWNER_ITEMS.filter((item) => item.label.toLowerCase().includes(query));
  }, [itemSpawnerSearchQuery]);

  const selectedItemSpawnerCount = useMemo(
    () =>
      Object.values(itemSpawnerSelected).reduce(
        (count, entry) => count + (entry?.checked ? 1 : 0),
        0
      ),
    [itemSpawnerSelected]
  );

  const handleSpawnItems = useCallback(() => {
    const selectedItems = ITEM_SPAWNER_ITEMS.flatMap((item) => {
      const state = itemSpawnerSelected[item.id];
      if (!state?.checked) {
        return [];
      }
      const qty = Math.max(1, Math.min(CUSTOM_LAYOUT_MAX_QTY, Math.floor(state.qty || 1)));
      return [{ item, qty }];
    });
    if (!selectedItems.length) {
      return;
    }

    const center = isLegacyDisabledShape
      ? getLegacyDisabledShapeSpawnPoint()
      : { x: tableRect.width / 2, y: tableRect.height / 2 };

    const timestampPrefix = Date.now().toString(36);
    let cardCounter = 0;
    const spawnEntries = [];
    const spawnedCards = [];

    selectedItems.forEach(({ item, qty }) => {
      if (item.type === 'chips') {
        spawnEntries.push({
          id: createStackId(),
          kind: 'chipStack',
          denom: item.denom,
          count: qty,
          x: 0,
          y: 0,
          z: 0,
          zone: 'table',
          ownerSeatIndex: null,
          rotation: 0
        });
        return;
      }
      if (item.type === 'die') {
        for (let i = 0; i < qty; i += 1) {
          spawnEntries.push({
            id: createStackId(),
            kind: 'dice',
            sides: item.sides,
            value: Math.floor(Math.random() * item.sides) + 1,
            x: 0,
            y: 0,
            zone: 'table',
            ownerSeatIndex: null,
            rotation: 0
          });
        }
        return;
      }
      for (let i = 0; i < qty; i += 1) {
        const cardPrefix = `${item.id}-${timestampPrefix}-${cardCounter}`;
        cardCounter += 1;
        const cards = buildSpawnCardsForItem(item, cardPrefix);
        spawnedCards.push(...cards);
        spawnEntries.push({
          id: createStackId(),
          x: 0,
          y: 0,
          rotation: 0,
          faceUp: !settings.resetFaceDown,
          cardIds: cards.map((card) => card.id),
          zone: 'table',
          ownerSeatIndex: null,
          cardStyle: item.style
        });
      }
    });

    const spacing = cardSize.width * 1.6;
    const startX = center.x - (spawnEntries.length - 1) * 0.5 * spacing;
    const positionedEntries = spawnEntries.map((entry, index) => {
      const bounds = getStackBounds(entry, cardSize);
      return {
        ...entry,
        x: startX + index * spacing - bounds.width / 2,
        y: center.y - bounds.height / 2,
        z: index
      };
    });

    if (spawnedCards.length) {
      setCardsById((prev) => {
        const next = { ...prev };
        spawnedCards.forEach((card) => {
          next[card.id] = card;
        });
        return next;
      });
    }

    setStacks((prev) => prev.concat(positionedEntries));

    const logSummary = selectedItems
      .map(({ item, qty }) => formatSpawnSummaryItem(item, qty))
      .filter(Boolean);
    if (logSummary.length) {
      logAction(`Spawned: ${logSummary.join(', ')}`);
    }
    setItemSpawnerOpen(false);
  }, [
    cardSize,
    createStackId,
    getLegacyDisabledShapeSpawnPoint,
    isLegacyDisabledShape,
    itemSpawnerSelected,
    logAction,
    setCardsById,
    setStacks,
    settings.resetFaceDown,
    tableRect.height,
    tableRect.width
  ]);

  const handleAddLayoutByCode = useCallback(() => {
    const code = layoutImportCode.trim();
    if (!code) {
      return;
    }
    const rawLayout = loadCustomLayoutByCode(code);
    if (!rawLayout) {
      setLayoutImportStatus('missing');
      return;
    }
    const layout = normalizeCustomLayout(rawLayout, code);
    setCustomLayoutsIndex((prev) => {
      const next = prev.some((entry) => entry.code === code)
        ? prev
        : [...prev, { code, name: layout.name ?? `Layout ${code}` }];
      saveCustomLayoutsIndex(next);
      return next;
    });
    setSelectedLayoutCode(code);
    setLayoutImportStatus('added');
  }, [layoutImportCode]);

  const handleSaveCurrentLayout = useCallback(() => {
    const trimmedName = saveLayoutName.trim();
    if (!trimmedName) {
      return;
    }
    const include = { ...saveLayoutInclude };
    const code = generateLayoutCode();
    const layout = {
      version: 1,
      code,
      name: trimmedName,
      notes: saveLayoutNotes.trim(),
      createdAt: Date.now(),
      include,
      stacks: arr(stacks).map((stack) => ({
        x: stack.x,
        y: stack.y,
        faceUp: stack.faceUp,
        cardIds: arr(stack?.cardIds)
      })),
      shape: include.shape ? settings.roomSettings.tableShape : undefined,
      seatCount: include.seatCount ? settings.roomSettings.seatCount : undefined,
      seatPositions: include.seatPositions ? seatPositions.map((seat) => ({ x: seat.x, y: seat.y })) : undefined,
      tableStyle: include.tableStyle ? settings.tableStyle : undefined,
      spawnFaceDown: include.spawnFaceDown ? settings.resetFaceDown : undefined,
      deckDefaults: include.deckDefaults
        ? {
            deckCount: settings.deckCount,
            includeJokers: settings.includeJokers,
            cardStyle: settings.cardStyle
          }
        : undefined
    };
    const normalizedLayout = normalizeCustomLayout(layout, code);
    window.localStorage.setItem(`${CUSTOM_LAYOUT_STORAGE_PREFIX}${code}`, JSON.stringify(normalizedLayout));
    setCustomLayoutsIndex((prev) => {
      const next = [...prev, { code, name: trimmedName }];
      saveCustomLayoutsIndex(next);
      return next;
    });
    setSelectedLayoutCode(code);
    setSaveLayoutCode(code);
  }, [saveLayoutInclude, saveLayoutName, saveLayoutNotes, seatPositions, settings, stacks]);

  const handleLoadLayout = useCallback(() => {
    if (!selectedLayoutCode) {
      return;
    }
    const rawLayout = loadCustomLayoutByCode(selectedLayoutCode);
    if (!rawLayout) {
      return;
    }
    const layout = normalizeCustomLayout(rawLayout, selectedLayoutCode);
    const include = layout.include ?? {};
    const shapeToUse = normalizeTableShape(
      include.shape && layout.shape ? layout.shape : settings.roomSettings.tableShape
    );
    setSettings((prev) => ({
      ...prev,
      tableStyle: include.tableStyle && layout.tableStyle ? layout.tableStyle : prev.tableStyle,
      resetFaceDown:
        include.spawnFaceDown && typeof layout.spawnFaceDown === 'boolean'
          ? layout.spawnFaceDown
          : prev.resetFaceDown,
      includeJokers:
        include.deckDefaults && typeof layout.deckDefaults?.includeJokers === 'boolean'
          ? layout.deckDefaults.includeJokers
          : prev.includeJokers,
      deckCount:
        include.deckDefaults && Number.isFinite(layout.deckDefaults?.deckCount)
          ? layout.deckDefaults.deckCount
          : prev.deckCount,
      cardStyle:
        include.deckDefaults && ['medieval', 'classic'].includes(layout.deckDefaults?.cardStyle)
          ? layout.deckDefaults.cardStyle
          : prev.cardStyle,
      roomSettings: {
        ...prev.roomSettings,
        tableShape: shapeToUse,
        seatCount: include.seatCount && Number.isFinite(layout.seatCount)
          ? layout.seatCount
          : prev.roomSettings.seatCount
      }
    }));
    setHands((prev) => Object.keys(prev ?? {}).reduce((acc, seatIndex) => {
      acc[seatIndex] = { cardIds: [], revealed: {} };
      return acc;
    }, {}));
    setStacks(() =>
      arr(layout.stacks).map((stack) => ({
        id: createStackId(),
        x: Number(stack.x) || 0,
        y: Number(stack.y) || 0,
        rotation: 0,
        faceUp: Boolean(stack.faceUp),
        cardIds: Array.isArray(stack.cardIds) ? stack.cardIds : [],
        zone: 'table',
        ownerSeatIndex: null
      }))
    );
    if (include.seatPositions && arr(layout.seatPositions).length) {
      setSeatPositions(
        seatsDerived.map((seat, index) => {
          const entry = layout.seatPositions[index] ?? { x: 0, y: 0 };
          const x = Number(entry.x) || 0;
          const y = Number(entry.y) || 0;
          const angle =
            shapeToUse === 'legacyDisabledShape'
              ? getLegacyDisabledShapeSeatAngleFromWorld(
                  x,
                  y,
                  cameraRef.current,
                  viewportRef.current,
                  tableRect?.width ?? 0,
                  tableRect?.height ?? 0
                )
              : seat.angle;
          return {
            ...seat,
            x,
            y,
            angle,
            side: getSeatSideFromAngle(angle)
          };
        })
      );
    } else {
      const nextLayout = buildSeatLayout({
        shape: shapeToUse,
        seatCount: seatsDerived.length,
        viewportW: tableRect?.width ?? 0,
        viewportH: tableRect?.height ?? 0,
        tableRect,
        seatRailBounds,
        seatParams,
        camera: cameraRef.current,
        viewport: viewportRef.current
      });
      setSeatPositions(
        seatsDerived.map((seat, index) => {
          const anchor = nextLayout[index] ?? { x: 0, y: 0, angle: -Math.PI / 2, side: 'top' };
          return {
            ...seat,
            x: anchor.x,
            y: anchor.y,
            angle: anchor.angle ?? -Math.PI / 2,
            side: anchor.side ?? 'top'
          };
        })
      );
    }
    logAction(`Loaded custom layout ${layout.name ?? selectedLayoutCode}`);
    setResetConfirmOpen(false);
  }, [
    createStackId,
    logAction,
    seatParams,
    seatRailBounds,
    seatsDerived,
    selectedLayoutCode,
    settings.roomSettings.tableShape,
    tableRect
  ]);

  const handleDeleteLayout = useCallback(() => {
    if (!selectedLayoutCode) {
      return;
    }
    window.localStorage.removeItem(`${CUSTOM_LAYOUT_STORAGE_PREFIX}${selectedLayoutCode}`);
    setCustomLayoutsIndex((prev) => {
      const next = prev.filter((entry) => entry.code !== selectedLayoutCode);
      saveCustomLayoutsIndex(next);
      return next;
    });
  }, [selectedLayoutCode]);

  const visibleBadgeStackId =
    settings.stackCountDisplayMode === 'hover' ? hoveredStackId : null;

  const clampStacksToFeltShape = useCallback(
    (shape) => {
      if (shape === 'legacyDisabledShape') {
        return;
      }
      if (!tableRect?.width || !tableRect?.height) {
        return;
      }
      const feltShape = getFeltShape({
        width: tableRect.width,
        height: tableRect.height,
        shape
      });
      setStacks((prev) =>
        prev.map((stack) => {
          const centerX = stack.x + cardSize.width / 2;
          const centerY = stack.y + cardSize.height / 2;
          const clampedCenter = clampStackToFelt(
            centerX,
            centerY,
            cardSize.width,
            cardSize.height,
            feltShape
          );
          return {
            ...stack,
            x: clampedCenter.x - cardSize.width / 2,
            y: clampedCenter.y - cardSize.height / 2
          };
        })
      );
    },
    [cardSize.height, cardSize.width, setStacks, tableRect?.height, tableRect?.width]
  );

  useEffect(() => {
    clampStacksToFeltShape(tableShape);
  }, [clampStacksToFeltShape, tableShape]);

  const handleResetTable = useCallback(() => {
    suppressNextHistoryRef.current = true;
    historyRef.current = [];
    setCanUndo(false);
    resetTableSurface(settings);
    actions.resetInteractionStates?.();
    actions.resetInteractionToDefaults?.();
    setCardFaceOverrides({});
    setSettingsOpen(false);
    actions.updateTabletopScale?.();
    if (isLegacyDisabledShape) {
      const nextLayout = buildLegacyDisabledShapeSeatLayout();
      setSeatPositions(nextLayout);
      setSettings((prev) => ({
        ...prev,
        roomSettings: {
          ...prev.roomSettings,
          seatPositions: {
            ...(prev.roomSettings.seatPositions ?? {}),
            legacyDisabledShape: nextLayout.map((seat) => ({ x: seat.x, y: seat.y }))
          }
        }
      }));
    }
    logAction('Reset table using current settings');
    setResetConfirmOpen(false);
  }, [
    actions,
    buildLegacyDisabledShapeSeatLayout,
    isLegacyDisabledShape,
    logAction,
    resetTableSurface,
    settings
  ]);

  actions.handleStackDoubleClick = useCallback((event, stackId) => {
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
      arr(stack.cardIds).forEach((cardId) => {
        const currentFace = typeof next[cardId] === 'boolean' ? next[cardId] : stack.faceUp;
        next[cardId] = !currentFace;
      });
      return next;
    });
  }, [myName, logAction, setStacks, stacksById]);

  actionsRef.current = {
    clearRmbHoldTimer: actions.clearRmbHoldTimer,
    clearInteraction: actions.clearInteraction,
    resetInteractionStates: actions.resetInteractionStates,
    resetInteractionToDefaults: actions.resetInteractionToDefaults,
    openSeatMenu: actions.openSeatMenu,
    closeSeatMenu: actions.closeSeatMenu,
    closeMenu: actions.closeMenu,
    selectStack: actions.selectStack,
    releaseCapturedPointer: actions.releaseCapturedPointer,
    updateTabletopScale: actions.updateTabletopScale,
    updateSeatDropHover: actions.updateSeatDropHover,
    handleInventoryHeaderPointerDown: actions.handleInventoryHeaderPointerDown,
    handleInventoryCardPointerDown: actions.handleInventoryCardPointerDown,
    resetInventoryPosition: actions.resetInventoryPosition,
    handleSeatPointerDown: actions.handleSeatPointerDown,
    handleSeatPointerMove: actions.handleSeatPointerMove,
    handleSeatPointerUp: actions.handleSeatPointerUp,
    handleSeatClick: actions.handleSeatClick,
    pickupFromStack: actions.pickupFromStack,
    cancelDrag: actions.cancelDrag,
    handleFlipSelected: actions.handleFlipSelected,
    handleShuffleSelected: actions.handleShuffleSelected,
    handleRollSelectedDie: actions.handleRollSelectedDie,
    updateSelectedEntity: actions.updateSelectedEntity,
    handleUndo: actions.handleUndo,
    promptRemoveSelected: actions.promptRemoveSelected,
    handleRemoveSelected: actions.handleRemoveSelected,
    handleKeyDown: actions.handleKeyDown,
    handleSurfaceWheel: actions.handleSurfaceWheel,
    handleSurfacePointerDown: actions.handleSurfacePointerDown,
    handleSurfacePointerMove: actions.handleSurfacePointerMove,
    handleSurfacePointerUp: actions.handleSurfacePointerUp,
    handleToggleReveal: actions.handleToggleReveal,
    handleStackDoubleClick: actions.handleStackDoubleClick,
  };

  const selectedStack = interaction.selectedStackId
    ? stacksById[interaction.selectedStackId]
    : null;
  const highlightStackId = interaction.held ? HELD_STACK_ID : interaction.selectedStackId;
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
  const heldStackVisual =
    interaction.held && heldWorldPosition
      ? {
          id: HELD_STACK_ID,
          x: heldWorldPosition.x,
          y: heldWorldPosition.y,
          rotation: 0,
          faceUp: interaction.held.faceUp ?? true,
          cardIds: interaction.held.cardIds,
          zone: 'table',
          ownerSeatIndex: null,
          isHeldVisual: true
        }
      : null;
  const renderStacks = heldStackVisual ? [...tableStacks, heldStackVisual] : tableStacks;
  const entities = useMemo(() => {
    return (renderStacks ?? []).reduce((acc, entity) => {
      if (entity?.id) {
        acc[entity.id] = entity;
      }
      return acc;
    }, {});
  }, [renderStacks]);
  const order = useMemo(() => (renderStacks ?? []).map((entity) => entity?.id).filter(Boolean), [renderStacks]);
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
      ? findTableOverlapStackId(
          heldWorldPosition.x,
          heldWorldPosition.y,
          null,
          getStackBounds(interaction.held, cardSize)
        )
      : null;
  const menuBelow = selectedStack ? selectedStack.y < 140 : false;
  const menuPosition =
    interaction.menu.open
      ? {
          left: interaction.menu.screenX,
          top: interaction.menu.screenY
        }
      : null;
  const menuStackCount = selectedStack
    ? isChipStack(selectedStack)
      ? selectedStack.count
      : selectedStack.cardIds?.length ?? 0
    : 0;
  const previewTopCardId =
    selectedStack && isCardStack(selectedStack) && (selectedStack.cardIds?.length ?? 0)
      ? selectedStack.cardIds?.[(selectedStack.cardIds?.length ?? 1) - 1]
      : null;
  const previewTopCardFaceUp = previewTopCardId
    ? getCardFace(selectedStack, previewTopCardId)
    : true;
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
      ? (() => {
        const local = worldToLocal(
          seatMenuSeat.x,
          seatMenuSeat.y,
          cameraRef.current,
          viewportRef.current,
          isLegacyDisabledShape
        );
          return {
            left: tableScreenRect.left + local.x * combinedScale,
            top: tableScreenRect.top + local.y * combinedScale
          };
        })()
      : null;
  const seatMenuPlayerId =
    seatMenuSeat && seatMenuSeat.seatIndex !== undefined
      ? seatAssignments[seatMenuSeat.seatIndex]
      : null;
  const seatMenuIsOccupied = Boolean(seatMenuPlayerId);
  const uiOverlayRoot =
    typeof document !== 'undefined' ? document.getElementById('ui-overlay') : null;
  const hoverSeatCardInfo = (() => {
    if (!hoverSeatCard) {
      return null;
    }
    const seatHand = hands?.[hoverSeatCard.seatIndex];
    if (!seatHand) {
      return null;
    }
    const isRevealed = Boolean(seatHand.revealed?.[hoverSeatCard.cardId]);
    const card = cardsById[hoverSeatCard.cardId];
    return {
      card,
      cardId: hoverSeatCard.cardId,
      faceUp: isRevealed,
      x: hoverSeatCard.x,
      y: hoverSeatCard.y
    };
  })();
  const dragCardPosition =
    interaction.held && heldScreenPos
      ? {
          x:
            heldScreenPos.x -
            (interaction.drag?.offset?.x ?? cardSize.width / 2) * combinedScale,
          y:
            heldScreenPos.y -
            (interaction.drag?.offset?.y ?? cardSize.height / 2) * combinedScale
        }
      : null;
  const inventoryPanelStyle = inventoryPos
    ? {
        left: `${inventoryPos.x}px`,
        top: `${inventoryPos.y}px`,
        bottom: 'auto',
        transform: 'none'
      }
    : undefined;
  return (
    <div className="tabletop">
      {isLegacyDisabledShape ? <div className="felt--legacyDisabledShape" aria-hidden="true" /> : null}
      <div
        id="sceneRoot"
        ref={sceneRootRef}
        style={{
          '--tableScale': combinedScale,
          '--player-accent': players[myPlayerId]?.seatColor ?? '#efd8a0'
        }}
      >
        <div
          ref={tableFrameRef}
          className={`table-frame table-frame--${tableStyle} table-frame--${tableShape}`}
          style={{
            '--card-scale': viewTransform.cardScale,
            '--table-width': isLegacyDisabledShape
              ? '100%'
              : `${(() => {
                  const footprint =
                    tableFootprintPx ?? Math.min(TABLE_BASE_WIDTH, TABLE_BASE_HEIGHT);
                  if (tableShape === 'circle') {
                    return footprint;
                  }
                  return footprint * (TABLE_BASE_WIDTH / TABLE_BASE_HEIGHT);
                })()}px`,
            '--table-height': isLegacyDisabledShape
              ? '100%'
              : `${tableFootprintPx ?? Math.min(TABLE_BASE_WIDTH, TABLE_BASE_HEIGHT)}px`,
            '--frame-size': isLegacyDisabledShape ? '0px' : undefined
          }}
        >
          <div
            id="seatLayer"
            className="table__seats"
            aria-label="Table seats"
            style={cameraTransformStyle}
          >
            {seatPositions.map((seat) => {
              const seatPlayerId = seatAssignments[seat.seatIndex];
              const seatPlayer = seatPlayerId ? players[seatPlayerId] : null;
              const occupied = Boolean(seatPlayerId);
              const isMine = seatPlayerId === myPlayerId;
              const seatHand = hands?.[seat.seatIndex] ?? { cardIds: [], revealed: {} };
              const seatHandCardIds = arr(seatHand?.cardIds);
              const seatHandCount = seatHandCardIds.length;
              const maxRender = 10;
              const visibleCardIds = seatHandCardIds.slice(0, maxRender);
              const overflowCount = Math.max(0, seatHandCardIds.length - visibleCardIds.length);
              const seatStyle = {
                left: `${seat.x}px`,
                top: `${seat.y}px`,
                '--seat-color': seatPlayer?.seatColor ?? null
              };
              return (
                <div
                  key={seat.id}
                  ref={(el) => {
                    seatRefs.current[seat.seatIndex] = el;
                  }}
                  className={`seat seat--${seat.side} ${occupied ? 'seat--occupied' : ''} ${isMine ? 'seat--mine' : ''} ${seatHandCount ? 'seat--has-cards' : ''} ${dragSeatIndex === seat.seatIndex ? 'seat--dragging' : ''} ${hoverSeatDropIndex === seat.seatIndex ? 'dropTarget' : ''} ${settings.roomSettings.seatLock ? 'seat--locked' : ''}`}
                  data-seat-index={seat.seatIndex}
                  style={seatStyle}
                  onClick={() => actions.handleSeatClick?.(seat.seatIndex)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      actions.handleSeatClick?.(seat.seatIndex);
                    }
                  }}
                  onPointerDown={(event) =>
                    actions.handleSeatPointerDown?.(event, seat.seatIndex)
                  }
                  onPointerMove={(event) =>
                    actions.handleSeatPointerMove?.(event, seat.seatIndex)
                  }
                  onPointerUp={() => actions.handleSeatPointerUp?.()}
                  onPointerCancel={() => actions.handleSeatPointerUp?.()}
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

                    <div
                      className="seat__handIndicator"
                      aria-hidden="true"
                      style={{ '--seat-card-count': visibleCardIds.length }}
                    >
                      <div
                        className="seat__handCards"
                        onDragStart={preventNativeDrag}
                        onDragOver={preventNativeDrag}
                        onDragEnter={preventNativeDrag}
                        onDrop={preventNativeDrag}
                      >
                        {visibleCardIds.map((cardId, index) => {
                          const card = cardsById[cardId];
                          const isRevealed = Boolean(seatHand.revealed?.[cardId]);
                          return (
                            <div
                              key={`seat-card-${seat.seatIndex}-${cardId}`}
                              className="seat__handCard"
                              style={{
                                left: `calc(${index} * var(--seat-card-gap))`,
                                top: `calc(${index} * var(--seat-card-rise) * -1)`
                              }}
                              onMouseEnter={(event) =>
                                setHoverSeatCard({
                                  seatIndex: seat.seatIndex,
                                  cardId,
                                  x: event.clientX,
                                  y: event.clientY
                                })
                              }
                              onMouseMove={(event) =>
                                setHoverSeatCard((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        x: event.clientX,
                                        y: event.clientY
                                      }
                                    : prev
                                )
                              }
                              onMouseLeave={() => setHoverSeatCard(null)}
                            >
                              <Card
                                id={cardId}
                                x={0}
                                y={0}
                                rotation={0}
                                faceUp={isRevealed}
                                cardStyle={stack.cardStyle ?? settings.cardStyle}
                                colorBlindMode={uiPrefs.colorBlindMode}
                                zIndex={index + 1}
                                rank={card?.rank}
                                suit={card?.suit}
                                color={card?.color}
                                onPointerDown={() => {}}
                                onNativeDrag={preventNativeDrag}
                              />
                            </div>
                          );
                        })}
                      </div>
                      {overflowCount > 0 ? (
                        <div className="seat__handOverflow">+{overflowCount}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={`table__surface-wrapper table__surface-wrapper--${tableShape}`}>
            <div
              ref={tableRef}
              className={`table__surface table__surface--${tableStyle} table__surface--${tableShape}`}
              onPointerDown={(event) => actions.handleSurfacePointerDown?.(event)}
              onPointerMove={(event) => actions.handleSurfacePointerMove?.(event)}
              onPointerUp={(event) => actions.handleSurfacePointerUp?.(event)}
              onPointerCancel={(event) => actions.handleSurfacePointerUp?.(event)}
              onWheel={(event) => actions.handleSurfaceWheel?.(event)}
              onContextMenu={(event) => event.preventDefault()}
              onDragStart={preventNativeDrag}
              onDragOver={preventNativeDrag}
              onDragEnter={preventNativeDrag}
              onDrop={preventNativeDrag}
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
                  {tableShape === 'rectangle' || tableShape === 'legacyDisabledShape' ? (
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
              <div className="table__stack-layer">
                <div className="table__playfield">
                  {handZones.map((zone) => {
                    const isOwnerZone = mySeatIndex === zone.seatIndex;
                    const isDragHover =
                      Boolean(interaction.held) && hoverHandSeatId === zone.seatIndex;
                    const isValidDropZone = isDragHover;
                    const isInvalidDropZone = false;
                    const seatHand = hands?.[zone.seatIndex] ?? { cardIds: [], revealed: {} };
                    const count = arr(seatHand?.cardIds).length;
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
                          '--seat-color': seatPlayer?.seatColor ?? null
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
                    const seatHandCardIds = arr(seatHand?.cardIds);
                    const count = seatHandCardIds.length;
                    const isOwnerZone = mySeatIndex === zone.seatIndex;
                    const revealedIds = seatHandCardIds.filter(
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
                                    cardStyle={settings.cardStyle}
                                    colorBlindMode={uiPrefs.colorBlindMode}
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
                        seatColor={presencePlayer?.seatColor ?? '#6aa9ff'}
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
                  {(order ?? []).map((entityId, index) => {
                    const stack = entities[entityId];
                    if (!stack) {
                      return null;
                    }
                    const topCardId = isCardStack(stack)
                      ? stack.cardIds?.[(stack.cardIds?.length ?? 1) - 1]
                      : null;
                    const topCard = topCardId ? cardsById[topCardId] : null;
                    const isSelectedStack = stack.id === highlightStackId;
                    const isHeldStack =
                      stack.id === HELD_STACK_ID ||
                      (interaction.mode === 'dragStack' &&
                        interaction.drag?.stackId === stack.id);
                    const isHoveredStack = stack.id === hoveredStackId;
                    const isMenuTarget =
                      interaction.menu.open && interaction.menu.stackId === stack.id;
                    const isMergeTarget = stack.id === mergeHighlightStackId;
                    const isTokenStack = Boolean(stack.token);
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
                    const stackBounds = getStackBounds(stack, cardSize);
                    const showBadge =
                      !stack.isHeldVisual &&
                      isCardStack(stack) &&
                      (stack.cardIds?.length ?? 0) > 1 &&
                      settings.stackCountDisplayMode !== 'off' &&
                      (settings.stackCountDisplayMode === 'always' ||
                        (settings.stackCountDisplayMode === 'hover' &&
                          stack.id === visibleBadgeStackId));
                    return (
                      <div
                        key={stack.id}
                        className={`stack-entity entity ${highlightState}`}
                        data-stack-id={stack.id}
                        data-selected={isSelectedStack}
                        data-held={isHeldStack}
                        data-hovered={isHoveredStack}
                        data-menu-target={isMenuTarget}
                        data-merge-target={isMergeTarget}
                        draggable={false}
                        style={{
                          transform: `translate(${stack.x}px, ${stack.y}px) rotate(${stack.rotation}deg)`,
                          width: stackBounds.width,
                          height: stackBounds.height,
                          zIndex
                        }}
                        onDragStart={preventNativeDrag}
                        onDragOver={preventNativeDrag}
                        onDragEnter={preventNativeDrag}
                        onDrop={preventNativeDrag}
                        onPointerDown={(event) =>
                          actions.handleStackPointerDown?.(event, stack.id)
                        }
                      >
                        {stack.isHeldVisual ? null : isTokenStack ? (
                          <div
                            className={`table-token table-token--${stack.token?.type ?? 'generic'}`}
                          >
                            <span className="table-token__label">
                              {stack.token?.label ?? 'Token'}
                            </span>
                          </div>
                        ) : isChipStack(stack) ? (
                          <div className="chipStack entityPhysical" style={{ '--chip-color': CHIP_COLORS[stack.denom] ?? '#f4f5f7' }}>
                            <div className="chipStack__denom">${stack?.denom ?? 0}</div>
                            <div className="chipStack__count">×{stack?.count ?? 0}</div>
                          </div>
                        ) : isDieStack(stack) ? (
                          <div className="dice entityPhysical">
                            <div className="die-stack__type">d{stack.sides}</div>
                            <div className="die-stack__value">{stack.value}</div>
                          </div>
                        ) : (
                          <Card
                            id={stack.id}
                            x={0}
                            y={0}
                            rotation={0}
                            faceUp={getCardFace(stack, topCardId)}
                            cardStyle={settings.cardStyle}
                            colorBlindMode={uiPrefs.colorBlindMode}
                            zIndex={1}
                            rank={topCard?.rank}
                            suit={topCard?.suit}
                            color={topCard?.color}
                            isHeld={false}
                            isSelected={false}
                            onPointerDown={() => {}}
                            onDoubleClick={(event) =>
                              actions.handleStackDoubleClick?.(event, stack.id)
                            }
                            onContextMenu={(event) => event.preventDefault()}
                            onNativeDrag={preventNativeDrag}
                          />
                        )}
                        {showBadge ? (
                          <div className="stackCountBadge">Stack: {stack?.cardIds?.length ?? 0}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
        </div>
      </div>
      {mySeatIndex !== null ? (
        <InventoryPanel
          ref={inventoryPanelRef}
          cardIds={hands?.[mySeatIndex]?.cardIds ?? []}
          cardsById={cardsById}
          revealed={hands?.[mySeatIndex]?.revealed ?? {}}
          onToggleReveal={(cardId) => actions.handleToggleReveal?.(cardId)}
          onHeaderPointerDown={(event) =>
            actions.handleInventoryHeaderPointerDown?.(event)
          }
          onCardPointerDown={(event, cardId) =>
            actions.handleInventoryCardPointerDown?.(event, cardId)
          }
          preventNativeDrag={preventNativeDrag}
          onPreviewCard={(cardId) => openCardPreview(cardId, true)}
          seatColor={players[myPlayerId]?.seatColor}
          cardStyle={settings.cardStyle}
          colorBlindMode={uiPrefs.colorBlindMode}
          panelStyle={inventoryPanelStyle}
          isDragging={Boolean(inventoryDrag)}
        />
      ) : null}
      {hoverSeatCardInfo && uiOverlayRoot
        ? createPortal(
            <div
              className="seat-card-preview"
              aria-hidden="true"
              style={{
                left: `${hoverSeatCardInfo.x + 16}px`,
                top: `${hoverSeatCardInfo.y + 16}px`,
                '--card-scale': viewTransform.cardScale * 1.2
              }}
            >
              <Card
                id={`seat-preview-${hoverSeatCardInfo.cardId ?? 'card'}`}
                x={0}
                y={0}
                rotation={0}
                faceUp={hoverSeatCardInfo.faceUp}
                cardStyle={settings.cardStyle}
                colorBlindMode={uiPrefs.colorBlindMode}
                zIndex={999999}
                rank={hoverSeatCardInfo.card?.rank}
                suit={hoverSeatCardInfo.card?.suit}
                color={hoverSeatCardInfo.card?.color}
                onPointerDown={() => {}}
                onNativeDrag={preventNativeDrag}
              />
            </div>,
            uiOverlayRoot
          )
        : null}
      {interaction.held && uiOverlayRoot && dragCardPosition
        ? createPortal(
            <div
                className="drag-layer"
                aria-hidden="true"
                style={{ '--card-scale': viewTransform.cardScale * combinedScale }}
              >
                {interaction.isChipStack(held) ? (
                  <div className="chip-stack" style={{ transform: `translate(${dragCardPosition.x}px, ${dragCardPosition.y}px)`, '--chip-color': CHIP_COLORS[interaction.held.denom] ?? '#f4f5f7' }}>
                    <div className="chip-stack__disc" />
                    <div className="chip-stack__label">{getChipStackLabel(interaction.held)}</div>
                  </div>
                ) : isDieStack(interaction.held) ? (
                  <div className="die-stack" style={{ transform: `translate(${dragCardPosition.x}px, ${dragCardPosition.y}px)` }}>
                    <div className="die-stack__type">d{interaction.held.sides}</div>
                    <div className="die-stack__value">{interaction.held.value}</div>
                  </div>
                ) : (
                  <Card
                    id={interaction.held.stackId}
                    x={dragCardPosition.x}
                    y={dragCardPosition.y}
                    rotation={0}
                    faceUp={interaction.held.faceUp ?? true}
                    cardStyle={settings.cardStyle}
                    colorBlindMode={uiPrefs.colorBlindMode}
                    zIndex={2000}
                    rank={heldTopCard?.rank}
                    suit={heldTopCard?.suit}
                    color={heldTopCard?.color}
                    isHeld
                    isSelected={false}
                    onPointerDown={() => {}}
                    onContextMenu={(event) => event.preventDefault()}
                    onNativeDrag={preventNativeDrag}
                  />
                )}
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
            Settings
          </button>
          {settingsOpen ? (
            <div className="table-settings__panel">
              <div className="table-settings__tabs">
                <button
                  className={`table-settings__tab ${
                    settingsTab === 'player' ? 'is-active' : ''
                  }`}
                  type="button"
                  onClick={() => setSettingsTab('player')}
                >
                  Player
                </button>
                <button
                  className={`table-settings__tab ${
                    settingsTab === 'table' ? 'is-active' : ''
                  }`}
                  type="button"
                  onClick={() => setSettingsTab('table')}
                >
                  Table Presets
                </button>
                <button
                  className={`table-settings__tab ${
                    settingsTab === 'room' ? 'is-active' : ''
                  }`}
                  type="button"
                  onClick={() => setSettingsTab('room')}
                >
                  Room
                </button>
              </div>
              <div className="table-settings__content">
                {settingsTab === 'player' ? (
                  <div className="table-settings__section">
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">Identity (Local)</div>
                      <label className="table-settings__row table-settings__row--stacked">
                        <span className="table-settings__label">Player Name</span>
                        <input
                          className="table-settings__input table-settings__input--full"
                          type="text"
                          maxLength={20}
                          value={player?.name ?? ''}
                          onChange={(event) => setPlayerName(event.target.value)}
                        />
                      </label>
                      <label className="table-settings__row">
                        <span className="table-settings__label">Seat Color</span>
                        <input
                          className="table-settings__color"
                          type="color"
                          value={player?.seatColor ?? '#6aa9ff'}
                          onChange={(event) => setSeatColor(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">
                        Local Visual / Accessibility
                      </div>
                      <label className="table-settings__row">
                        <span className="table-settings__label">Table Style</span>
                        <select
                          className="table-settings__select"
                          value={settings.tableStyle}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              tableStyle: event.target.value
                            }))
                          }
                        >
                          <option value="medieval">Medieval</option>
                          <option value="classic">Classic</option>
                        </select>
                      </label>
                      <div className="table-settings__row">
                        <span className="table-settings__label">
                          Color Blind Mode for Cards
                        </span>
                        <label className="table-settings__switch">
                          <input
                            type="checkbox"
                            checked={uiPrefs.colorBlindMode}
                            onChange={(event) =>
                              setUiPrefs((prev) => ({
                                ...prev,
                                colorBlindMode: event.target.checked
                              }))
                            }
                          />
                          <span>Enabled</span>
                        </label>
                      </div>
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
                        <span className="table-settings__label">
                          Stack Count Display
                        </span>
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
                          <option value="hover">Hover</option>
                          <option value="off">Off</option>
                        </select>
                      </label>
                    </div>
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">Actions</div>
                      <button
                        className="table-settings__button table-settings__button--secondary"
                        type="button"
                        onClick={() => actions.handleUndo?.()}
                        disabled={!canUndo || isModalOpen}
                      >
                        Undo
                      </button>
                    </div>
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">Inventory</div>
                      <button
                        className="table-settings__button table-settings__button--secondary"
                        type="button"
                        onClick={() => actions.resetInventoryPosition?.()}
                        disabled={!inventoryPos}
                      >
                        Reset Inventory Location
                      </button>
                    </div>
                  </div>
                ) : null}
                {settingsTab === 'table' ? (
                  <div className="table-settings__section">
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">Spawn Defaults</div>
                      <div className="table-settings__row">
                        <span className="table-settings__label">
                          Spawn new stacks face-down
                        </span>
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
                          <span>Face-Down</span>
                        </label>
                      </div>
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
                    </div>
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">Item Spawner</div>
                      <button
                        className="table-settings__button table-settings__button--secondary"
                        type="button"
                        onClick={() => setItemSpawnerOpen(true)}
                      >
                        Item Spawner...
                      </button>
                    </div>
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">Custom Layouts</div>
                      <label className="table-settings__row">
                        <span className="table-settings__label">Saved Layouts</span>
                        <select
                          className="table-settings__select"
                          value={selectedLayoutCode}
                          onChange={(event) => setSelectedLayoutCode(event.target.value)}
                        >
                          {customLayoutsIndex.length === 0 ? <option value="">No layouts saved</option> : null}
                          {customLayoutsIndex.map((entry) => (
                            <option key={entry.code} value={entry.code}>
                              {entry.name} ({entry.code})
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="table-settings__spawn-controls">
                        <button className="table-settings__button table-settings__button--secondary" type="button" onClick={() => { setSaveLayoutCode(''); setSaveLayoutName(''); setSaveLayoutNotes(''); setSaveLayoutOpen(true); }}>
                          Save Current Setup...
                        </button>
                        <button className="table-settings__button table-settings__button--secondary" type="button" onClick={() => setResetConfirmOpen(true)} disabled={!selectedLayoutCode}>
                          Load
                        </button>
                        <button className="table-settings__button table-settings__button--danger" type="button" onClick={handleDeleteLayout} disabled={!selectedLayoutCode}>
                          Delete
                        </button>
                      </div>
                      <label className="table-settings__row table-settings__row--stacked">
                        <span className="table-settings__label">Import by Code</span>
                        <input
                          className="table-settings__input table-settings__input--full"
                          type="text"
                          value={layoutImportCode}
                          onChange={(event) => {
                            setLayoutImportCode(event.target.value);
                            setLayoutImportStatus(null);
                          }}
                        />
                      </label>
                      <div className="table-settings__row table-settings__row--stacked">
                        <button className="table-settings__button table-settings__button--secondary" type="button" onClick={handleAddLayoutByCode}>
                          Add
                        </button>
                        {layoutImportStatus === 'missing' ? <span className="table-settings__hint">Layout not found on this device</span> : null}
                        {layoutImportStatus === 'added' ? <span className="table-settings__hint">Layout added to saved list</span> : null}
                      </div>
                    </div>
                    <div className="table-settings__danger">
                      <div className="table-settings__danger-title">Danger Zone</div>
                      <button
                        className="table-settings__button table-settings__button--danger"
                        type="button"
                        onClick={handleResetTable}
                      >
                        Reset Table
                      </button>
                    </div>
                  </div>
                ) : null}
                {settingsTab === 'room' ? (
                  <div className="table-settings__section">
                    <div className="table-settings__group">
                      <div className="table-settings__group-title">Table Layout</div>
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
                                tableShape: normalizeTableShape(event.target.value)
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
                      <div className="table-settings__row">
                        <span className="table-settings__label">Lock Seats</span>
                        <label className="table-settings__switch">
                          <input
                            type="checkbox"
                            checked={settings.roomSettings.seatLock}
                            onChange={(event) =>
                              setSettings((prev) => ({
                                ...prev,
                                roomSettings: {
                                  ...prev.roomSettings,
                                  seatLock: event.target.checked
                                }
                              }))
                            }
                          />
                          <span>Locked</span>
                        </label>
                      </div>
                      <button
                        className="table-settings__button table-settings__button--secondary"
                        type="button"
                        onClick={() => {
                          if (tableShape === 'legacyDisabledShape') {
                            const nextLayout = buildSeatLayout({
                              shape: 'legacyDisabledShape',
                              seatCount,
                              viewportW: tableRect?.width ?? 0,
                              viewportH: tableRect?.height ?? 0,
                              tableRect,
                              camera: cameraRef.current,
                              viewport: viewportRef.current
                            });
                            setSeatPositions(
                              seatsDerived.map((seat, index) => {
                                const anchor = nextLayout[index] ?? {
                                  x: 0,
                                  y: 0,
                                  angle: -Math.PI / 2,
                                  side: 'top'
                                };
                                return {
                                  ...seat,
                                  x: anchor.x,
                                  y: anchor.y,
                                  angle: anchor.angle ?? -Math.PI / 2,
                                  side: anchor.side ?? 'top'
                                };
                              })
                            );
                            setSettings((prev) => ({
                              ...prev,
                              roomSettings: {
                                ...prev.roomSettings,
                                seatPositions: {
                                  ...(prev.roomSettings.seatPositions ?? {}),
                                  legacyDisabledShape: nextLayout.map((seat) => ({ x: seat.x, y: seat.y }))
                                }
                              }
                            }));
                            return;
                          }
                          const nextParams = buildDefaultSeatParams(seatCount);
                          const nextLayout = buildSeatLayout({
                            shape: tableShape,
                            seatCount,
                            tableRect,
                            seatRailBounds,
                            seatParams: nextParams
                          });
                          setSeatPositions(
                            seatsDerived.map((seat, index) => {
                              const anchor = nextLayout[index] ?? {
                                x: 0,
                                y: 0,
                                angle: -Math.PI / 2,
                                side: 'top'
                              };
                              return {
                                ...seat,
                                x: anchor.x,
                                y: anchor.y,
                                angle: anchor.angle ?? -Math.PI / 2,
                                side: anchor.side ?? 'top'
                              };
                            })
                          );
                          setSettings((prev) => ({
                            ...prev,
                            roomSettings: {
                              ...prev.roomSettings,
                              seatParams: {
                                ...(prev.roomSettings.seatParams ?? {}),
                                [tableShape]: nextParams
                              }
                            }
                          }));
                        }}
                      >
                        Reset Seat Locations
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {removeConfirmOpen && uiOverlayRoot
        ? createPortal(
            <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
              <div className="modal" role="dialog" aria-modal="true" aria-labelledby="remove-stack-title" onPointerDown={(event) => event.stopPropagation()}>
                <h3 id="remove-stack-title" className="modal__title">Remove this stack?</h3>
                <div className="modal__actions">
                  <button className="modal__button modal__button--primary" type="button" onClick={() => actions.handleRemoveSelected?.()}>Yes</button>
                  <button className="modal__button modal__button--secondary" type="button" onClick={() => setRemoveConfirmOpen(false)}>No</button>
                </div>
              </div>
            </div>,
            uiOverlayRoot
          )
        : null}
      {resetConfirmOpen && uiOverlayRoot
        ? createPortal(
            <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setResetConfirmOpen(false); }}>
              <div className="modal" role="dialog" aria-modal="true" aria-labelledby="load-layout-title" onPointerDown={(event) => event.stopPropagation()}>
                <h3 id="load-layout-title" className="modal__title">Load layout?</h3>
                <p className="modal__body">This will clear the current table (and optionally reset seats).</p>
                <div className="modal__actions">
                  <button className="modal__button modal__button--primary" type="button" onClick={handleLoadLayout}>Yes</button>
                  <button className="modal__button modal__button--secondary" type="button" onClick={() => setResetConfirmOpen(false)}>No</button>
                </div>
              </div>
            </div>,
            uiOverlayRoot
          )
        : null}
      {itemSpawnerOpen && uiOverlayRoot
        ? createPortal(
            <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setItemSpawnerOpen(false); }}>
              <div className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="item-spawner-title" onPointerDown={(event) => event.stopPropagation()}>
                <div className="modal__title-row">
                  <h3 id="item-spawner-title" className="modal__title">Item Spawner</h3>
                  <button className="modal__close" type="button" aria-label="Close" onClick={() => setItemSpawnerOpen(false)}>×</button>
                </div>
                <div className="modal__section">
                  <input className="table-settings__input table-settings__input--full" type="text" placeholder="Search items…" value={itemSpawnerSearchQuery} onChange={(event) => setItemSpawnerSearchQuery(event.target.value)} />
                </div>
                <div className="modal__section">
                  <div className="table-settings__spawn-list" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    {filteredItemSpawnerItems.map((item) => {
                      const itemState = itemSpawnerSelected[item.id] ?? { checked: false, qty: 1 };
                      return (
                        <div key={item.id} className="table-settings__spawn-item">
                          <div className="table-settings__spawn-item-row">
                            <label className="table-settings__switch table-settings__switch--inline">
                              <input type="checkbox" checked={itemState.checked} onChange={(event) => setItemSpawnerSelected((prev) => ({ ...prev, [item.id]: { checked: event.target.checked, qty: prev[item.id]?.qty ?? 1 } }))} />
                              <span>{item.label}</span>
                            </label>
                            <input className="table-settings__input" type="number" min="1" max={CUSTOM_LAYOUT_MAX_QTY} disabled={!itemState.checked} value={itemState.qty} onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              const qty = Number.isFinite(parsed) ? Math.max(1, Math.min(CUSTOM_LAYOUT_MAX_QTY, parsed)) : 1;
                              setItemSpawnerSelected((prev) => ({ ...prev, [item.id]: { checked: prev[item.id]?.checked ?? false, qty } }));
                            }} />
                          </div>
                          {item.usage ? <div className="table-settings__hint">Usage: {item.usage}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="modal__actions">
                  <button className="modal__button modal__button--primary" type="button" onClick={handleSpawnItems} disabled={selectedItemSpawnerCount === 0}>Spawn</button>
                </div>
              </div>
            </div>,
            uiOverlayRoot
          )
        : null}
      {saveLayoutOpen && uiOverlayRoot
        ? createPortal(
            <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSaveLayoutOpen(false); }}>
              <div className="modal" role="dialog" aria-modal="true" aria-labelledby="save-layout-title" onPointerDown={(event) => event.stopPropagation()}>
                <div className="modal__title-row"><h3 id="save-layout-title" className="modal__title">Save Custom Layout</h3></div>
                <label className="table-settings__row table-settings__row--stacked"><span className="table-settings__label">Layout Name</span><input className="table-settings__input table-settings__input--full" type="text" value={saveLayoutName} onChange={(event) => setSaveLayoutName(event.target.value)} /></label>
                <label className="table-settings__row table-settings__row--stacked"><span className="table-settings__label">Optional Notes</span><input className="table-settings__input table-settings__input--full" type="text" value={saveLayoutNotes} onChange={(event) => setSaveLayoutNotes(event.target.value)} /></label>
                <div className="modal__section"><div className="modal__section-title">Include Options</div>
                  {[
                    ['shape', 'Include table shape'],
                    ['seatCount', 'Include seat count'],
                    ['seatPositions', 'Include seat positions'],
                    ['tableStyle', 'Include table style'],
                    ['spawnFaceDown', 'Include “spawn face-down” default'],
                    ['deckDefaults', 'Include deck settings defaults']
                  ].map(([key, label]) => (
                    <label key={key} className="table-settings__switch table-settings__switch--inline"><input type="checkbox" checked={saveLayoutInclude[key]} onChange={(event) => setSaveLayoutInclude((prev) => ({ ...prev, [key]: event.target.checked }))} /><span>{label}</span></label>
                  ))}
                </div>
                {saveLayoutCode ? <p className="modal__body">Saved. Code: <strong>{saveLayoutCode}</strong></p> : null}
                <div className="modal__actions">
                  {saveLayoutCode ? <button className="modal__button modal__button--secondary" type="button" onClick={() => navigator.clipboard?.writeText(saveLayoutCode)}>Copy Code</button> : null}
                  <button className="modal__button modal__button--primary" type="button" onClick={handleSaveCurrentLayout} disabled={!saveLayoutName.trim()}>Save</button>
                </div>
              </div>
            </div>,
            uiOverlayRoot
          )
        : null}
      {cardPreview && uiOverlayRoot
        ? createPortal(
            <div
              className="modal-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeCardPreview();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <div
                className="modal modal--preview"
                role="dialog"
                aria-modal="true"
                aria-labelledby="card-preview-title"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal__title-row">
                  <h3 id="card-preview-title" className="modal__title">
                    {cardPreview.faceUp
                      ? `Card Preview — ${formatCardName(cardPreview.card)}`
                      : 'Card Preview — Card (Hidden)'}
                  </h3>
                  <button
                    type="button"
                    className="modal__close"
                    aria-label="Close preview"
                    onPointerDown={closeCardPreview}
                    onClick={closeCardPreview}
                  >
                    ✕
                  </button>
                </div>
                <div className="card-preview__card">
                  <Card
                    id={`preview-${cardPreview.cardId}`}
                    x={0}
                    y={0}
                    rotation={0}
                    faceUp={cardPreview.faceUp}
                    cardStyle={settings.cardStyle}
                    colorBlindMode={uiPrefs.colorBlindMode}
                    zIndex={1}
                    rank={cardPreview.card?.rank}
                    suit={cardPreview.card?.suit}
                    color={cardPreview.card?.color}
                    onPointerDown={() => {}}
                    onNativeDrag={preventNativeDrag}
                  />
                </div>
              </div>
            </div>,
            uiOverlayRoot
          )
        : null}
      {selectedStack && menuPosition && uiOverlayRoot
        ? createPortal(
            <div
              className={`stack-menu ${menuBelow ? 'stack-menu--below' : 'stack-menu--above'}`}
              style={menuPosition}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {isDieStack(selectedStack) ? (
                <>
                  <button
                    type="button"
                    className="stack-menu__button"
                    onClick={() => {
                      actions.handleRollSelectedDie?.();
                      actions.closeMenu?.();
                    }}
                  >
                    Roll
                  </button>
                  <button type="button" className="stack-menu__button" onClick={() => actionsRef.current.updateSelectedEntity?.({ sides: 6 })}>Set d6</button>
                  <button type="button" className="stack-menu__button" onClick={() => actionsRef.current.updateSelectedEntity?.({ sides: 20 })}>Set d20</button>
                </>
              ) : null}
              {isChipStack(selectedStack) ? (
                <>
                  <button
                    type="button"
                    className="stack-menu__button"
                    onClick={() => {
                      actions.pickupFromStack?.(selectedStack.id, 'all');
                      actions.closeMenu?.();
                    }}
                  >
                    Pick up full stack
                  </button>
                  <button type="button" className="stack-menu__button" onClick={() => { actions.pickupFromStack?.(selectedStack.id, 1); actions.closeMenu?.(); }}>Pick up 1</button>
                  <button type="button" className="stack-menu__button" onClick={() => { actions.pickupFromStack?.(selectedStack.id, 5); actions.closeMenu?.(); }}>Pick up 5</button>
                  <button type="button" className="stack-menu__button" onClick={() => { actions.pickupFromStack?.(selectedStack.id, 10); actions.closeMenu?.(); }}>Pick up 10</button>
                  <button type="button" className="stack-menu__button" onClick={() => { setPickCountOpen(true); setPickCountValue('1'); }}>Pick up N</button>
                  <button type="button" className="stack-menu__button" onClick={() => { setSplitCountOpen(true); setSplitCountValue('1'); }}>Split…</button>
                </>
              ) : isCardStack(selectedStack) ? (
                <>
                  <button
                    type="button"
                    className="stack-menu__button"
                    onClick={() => {
                      actions.pickupFromStack?.(selectedStack.id, 'all');
                      actions.closeMenu?.();
                    }}
                  >
                    Pick up full stack
                  </button>
                  <button
                    type="button"
                    className="stack-menu__button"
                    onClick={() => {
                      if ((selectedStack.cardIds?.length ?? 0) < 2) {
                        return;
                      }
                      actions.pickupFromStack?.(
                        selectedStack.id,
                        Math.ceil((selectedStack.cardIds?.length ?? 0) / 2)
                      );
                      actions.closeMenu?.();
                    }}
                  >
                    Pick up half stack
                  </button>
                  <button
                    type="button"
                    className="stack-menu__button"
                    onClick={() => {
                      actions.pickupFromStack?.(selectedStack.id, 1);
                      actions.closeMenu?.();
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
                </>
              ) : null}
              {pickCountOpen ? (
                <div className="stack-menu__picker">
                  <label className="stack-menu__label" htmlFor="pick-count-input">
                    {isChipStack(selectedStack) ? 'Chips to pick up' : 'Cards to pick up'}
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
                        actions.pickupFromStack?.(selectedStack.id, count);
                        actions.closeMenu?.();
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
              {splitCountOpen && isChipStack(selectedStack) ? (
                <div className="stack-menu__picker">
                  <label className="stack-menu__label" htmlFor="split-count-input">Chips to split</label>
                  <input id="split-count-input" className="stack-menu__input" type="number" min="1" max={Math.max(1, menuStackCount - 1)} value={splitCountValue} onChange={(event) => setSplitCountValue(event.target.value)} />
                  <div className="stack-menu__actions">
                    <button type="button" className="stack-menu__button stack-menu__button--primary" onClick={() => { actions.splitSelectedChipStack?.(splitCountValue); actions.closeMenu?.(); }}>Split</button>
                    <button type="button" className="stack-menu__button stack-menu__button--secondary" onClick={() => setSplitCountOpen(false)}>Cancel</button>
                  </div>
                </div>
              ) : null}
              {isChipStack(selectedStack) ? (
                <button
                  type="button"
                  className="stack-menu__button"
                  onClick={() => {
                    const nextDenom = window.prompt('Chip denomination', String(selectedStack.denom ?? 1));
                    const denom = Number.parseInt(nextDenom ?? '', 10);
                    if (Number.isFinite(denom) && denom > 0) {
                      actionsRef.current.updateSelectedEntity?.({ denom });
                    }
                  }}
                >
                  Change denomination
                </button>
              ) : null}
              <button
                type="button"
                className="stack-menu__button stack-menu__button--danger"
                onClick={() => {
                  actions.promptRemoveSelected?.();
                  actions.closeMenu?.();
                }}
              >
                Remove Item
              </button>
              {isCardStack(selectedStack) && previewTopCardId ? (
                <button
                  type="button"
                  className="stack-menu__button"
                  onClick={() => {
                    openCardPreview(previewTopCardId, previewTopCardFaceUp);
                    actions.closeMenu?.();
                  }}
                >
                  Preview top card
                </button>
              ) : null}
              {isCardStack(selectedStack) ? (
                <>
                  <button
                    type="button"
                    className="stack-menu__button"
                    onClick={() => {
                      actions.handleFlipSelected?.();
                      actions.closeMenu?.();
                    }}
                  >
                    Flip
                  </button>
                  <button
                    type="button"
                    className="stack-menu__button"
                    onClick={() => {
                      actions.handleShuffleSelected?.();
                      actions.closeMenu?.();
                    }}
                  >
                    Shuffle
                  </button>
                </>
              ) : null}
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
                isOccupied={seatMenuIsOccupied}
                onSit={() => {
                  // eslint-disable-next-line no-console
                  console.log('Sit click', seatMenuIndex, myPlayerId);
                  sitAtSeat(seatMenuIndex);
                  logAction(`${myName} sat at ${seatMenuSeat.label}`);
                  actions.closeSeatMenu?.();
                }}
              />
            </div>,
            uiOverlayRoot
          )
        : null}
      {uiOverlayRoot
        ? createPortal(
            <ActionLog entries={actionLog} playerName={myName} />,
            uiOverlayRoot
          )
        : <ActionLog entries={actionLog} playerName={myName} />}
    </div>
  );
};

export default Table;
