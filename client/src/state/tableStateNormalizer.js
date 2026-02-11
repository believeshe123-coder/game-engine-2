const arr = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === 'object' ? value : {});

const DEFAULT_SEAT_COLOR = '#6b7280';
const DEFAULT_INTERACTION_STATE = {
  selectedId: null,
  held: null,
  dragId: null,
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  hover: null,
  drag: null
};
const DEFAULT_UI_STATE = {
  logChatOpen: true,
  logChatTab: 'log'
};

const normalizeSeat = (seat) => {
  const nextSeat = obj(seat);
  return {
    ...nextSeat,
    inventory: arr(nextSeat.inventory),
    hand: nextSeat.hand === undefined ? undefined : arr(nextSeat.hand),
    seatColor: nextSeat.seatColor ?? DEFAULT_SEAT_COLOR,
    playerName: nextSeat.playerName ?? ''
  };
};

const normalizeStack = (stack) => {
  const nextStack = obj(stack);
  const normalizedKind =
    nextStack.kind === 'chips'
      ? 'chipStack'
      : nextStack.kind === 'die'
        ? 'dice'
        : nextStack.kind ?? 'cardStack';
  return {
    ...nextStack,
    kind: normalizedKind,
    cardIds: arr(nextStack.cardIds),
    cards: arr(nextStack.cards)
  };
};

const normalizeHeld = (heldInput) => {
  if (!heldInput || typeof heldInput !== 'object') {
    return null;
  }
  const held = obj(heldInput);
  const offset = obj(held.offset ?? held.dragOffset);
  const dragStart = obj(held.dragStart);
  return {
    ...held,
    kind: held.kind ?? 'cardStack',
    id: held.id ?? held.stackId ?? null,
    payload: obj(held.payload),
    offset: {
      x: Number.isFinite(offset.x) ? offset.x : 0,
      y: Number.isFinite(offset.y) ? offset.y : 0
    },
    dragStart: {
      x: Number.isFinite(dragStart.x) ? dragStart.x : 0,
      y: Number.isFinite(dragStart.y) ? dragStart.y : 0
    },
    isDragging: Boolean(held.isDragging ?? held.dragging)
  };
};

const normalizeSnapshot = (snapshotInput) => {
  const snapshot = obj(snapshotInput);
  const normalizedInteraction = {
    ...DEFAULT_INTERACTION_STATE,
    ...obj(snapshot.interaction),
    held: normalizeHeld(snapshot.interaction?.held)
  };
  return {
    ...snapshot,
    entities: obj(snapshot.entities),
    order: arr(snapshot.order),
    hands: obj(snapshot.hands),
    seats: arr(snapshot.seats),
    settings: obj(snapshot.settings),
    interaction: normalizedInteraction,
    chat: arr(snapshot.chat),
    log: arr(snapshot.log),
    selections: arr(snapshot.selections)
  };
};

const normalizeHands = (handsInput) => {
  const handsObj = obj(handsInput);
  return Object.keys(handsObj).reduce((acc, seatIndex) => {
    const hand = obj(handsObj[seatIndex]);
    acc[seatIndex] = {
      ...hand,
      cardIds: arr(hand.cardIds),
      revealed: obj(hand.revealed)
    };
    return acc;
  }, {});
};

const normalizeLayoutMeta = (layout, index) => {
  const nextLayout = obj(layout);
  const fallbackCode = `layout-${index + 1}`;
  return {
    ...nextLayout,
    code: typeof nextLayout.code === 'string' && nextLayout.code.trim()
      ? nextLayout.code
      : fallbackCode,
    name: typeof nextLayout.name === 'string' && nextLayout.name.trim()
      ? nextLayout.name
      : `Layout ${index + 1}`,
    createdAt: Number.isFinite(nextLayout.createdAt) ? nextLayout.createdAt : Date.now(),
    notes: typeof nextLayout.notes === 'string' ? nextLayout.notes : '',
    include: obj(nextLayout.include),
    items: arr(nextLayout.items),
    stacks: arr(nextLayout.stacks).map(normalizeStack),
    seatPositions: arr(nextLayout.seatPositions)
  };
};

const normalizeTableState = (rawInput) => {
  const raw = obj(rawInput);
  const snapshot = normalizeSnapshot(raw.snapshot);
  const hasUnifiedObjects = Array.isArray(raw.objects);
  const interactionInput = obj(raw.interaction);
  const dragOffset = obj(interactionInput.dragOffset);
  const normalizedInteraction = {
    ...DEFAULT_INTERACTION_STATE,
    ...interactionInput,
    selectedId:
      interactionInput.selectedId ??
      raw.selectedStackId ??
      DEFAULT_INTERACTION_STATE.selectedId,
    held: normalizeHeld(interactionInput.held ?? raw.held ?? DEFAULT_INTERACTION_STATE.held),
    dragId: interactionInput.dragId ?? interactionInput.drag?.stackId ?? DEFAULT_INTERACTION_STATE.dragId,
    dragging: Boolean(interactionInput.dragging ?? interactionInput.drag),
    dragOffset: {
      x: Number.isFinite(dragOffset.x) ? dragOffset.x : DEFAULT_INTERACTION_STATE.dragOffset.x,
      y: Number.isFinite(dragOffset.y) ? dragOffset.y : DEFAULT_INTERACTION_STATE.dragOffset.y
    }
  };
  const uiInput = obj(raw.ui);
  const normalized = {
    ...raw,
    entitiesById: obj(raw.entitiesById),
    entityOrder: arr(raw.entityOrder),
    stacksById: obj(raw.stacksById),
    stackOrder: arr(raw.stackOrder),
    snapshot,
    entities: snapshot.entities,
    order: snapshot.order,
    selections: snapshot.selections,
    stacks: arr(raw.stacks).map(normalizeStack),
    seats: arr(raw.seats).map(normalizeSeat),
    actionLog: arr(raw.actionLog),
    hands: normalizeHands(raw.hands),
    settings: obj(raw.settings),
    chat: arr(raw.chat),
    log: arr(raw.log),
    undo: arr(raw.undo),
    redo: arr(raw.redo),
    history: arr(raw.history),
    held: raw.held ?? null,
    selectedStackId: raw.selectedStackId ?? null,
    selectedSeatId: raw.selectedSeatId ?? null,
    tokens: arr(raw.tokens),
    interaction: {
      ...normalizedInteraction,
      hover: normalizedInteraction.hover ?? null,
      drag: normalizedInteraction.drag ?? null,
      selected:
        interactionInput.selected && typeof interactionInput.selected === 'object'
          ? interactionInput.selected
          : normalizedInteraction.selectedId
            ? { kind: 'stack', id: normalizedInteraction.selectedId }
            : null
    },
    ui: {
      ...DEFAULT_UI_STATE,
      ...uiInput,
      logChatOpen: uiInput.logChatOpen ?? DEFAULT_UI_STATE.logChatOpen,
      logChatTab: uiInput.logChatTab === 'chat' ? 'chat' : 'log'
    },
    savedLayouts: arr(raw.savedLayouts).map(normalizeLayoutMeta),
    objects: hasUnifiedObjects ? arr(raw.objects) : undefined,
    chipStacks: hasUnifiedObjects ? undefined : arr(raw.chipStacks).map(normalizeStack),
    dice: hasUnifiedObjects ? undefined : arr(raw.dice).map(normalizeStack)
  };
  return normalized;
};

const normalizeRuntimeState = (rawInput) => {
  const normalized = normalizeTableState(rawInput);
  return {
    entitiesById: normalized.entitiesById,
    entityOrder: normalized.entityOrder,
    stacksById: normalized.stacksById,
    stackOrder: normalized.stackOrder,
    seats: normalized.seats,
    handsBySeat: normalized.handsBySeat ?? normalized.hands ?? {},
    interaction: {
      ...DEFAULT_INTERACTION_STATE,
      ...normalized.interaction,
      selectedId: normalized.interaction?.selectedId ?? null,
      held: normalizeHeld(normalized.interaction?.held),
      dragId: normalized.interaction?.dragId ?? null,
      dragging: Boolean(normalized.interaction?.dragging),
      dragOffset: {
        x: Number.isFinite(normalized.interaction?.dragOffset?.x)
          ? normalized.interaction.dragOffset.x
          : 0,
        y: Number.isFinite(normalized.interaction?.dragOffset?.y)
          ? normalized.interaction.dragOffset.y
          : 0
      }
    },
    ui: {
      ...DEFAULT_UI_STATE,
      ...(normalized.ui ?? {}),
      logChatOpen: normalized.ui?.logChatOpen ?? true,
      logChatTab: normalized.ui?.logChatTab === 'chat' ? 'chat' : 'log'
    }
  };
};

const normalizeState = (rawInput) => normalizeTableState(rawInput);

const normalizeCustomLayout = (rawLayout, codeHint = '') => {
  const normalized = normalizeLayoutMeta(rawLayout, 0);
  const shape = ['rectangle', 'oval', 'circle'].includes(normalized.shape)
    ? normalized.shape
    : 'oval';
  return {
    ...normalized,
    code: normalized.code === 'layout-1' && codeHint ? codeHint : normalized.code,
    shape,
    seatCount: Number.isFinite(normalized.seatCount) ? Math.max(2, Math.min(12, normalized.seatCount)) : undefined,
    deckDefaults: {
      ...obj(normalized.deckDefaults),
      deckCount: Number.isFinite(normalized.deckDefaults?.deckCount)
        ? normalized.deckDefaults.deckCount
        : 1,
      includeJokers: typeof normalized.deckDefaults?.includeJokers === 'boolean'
        ? normalized.deckDefaults.includeJokers
        : true,
      cardStyle: ['medieval', 'classic'].includes(normalized.deckDefaults?.cardStyle)
        ? normalized.deckDefaults.cardStyle
        : 'medieval'
    }
  };
};

export {
  arr,
  obj,
  normalizeCustomLayout,
  normalizeRuntimeState,
  normalizeState,
  normalizeSnapshot,
  normalizeTableState
};
