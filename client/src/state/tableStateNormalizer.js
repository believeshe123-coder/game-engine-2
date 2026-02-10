const arr = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === 'object' ? value : {});

const DEFAULT_SEAT_COLOR = '#6b7280';

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

const normalizeSnapshot = (s) => ({
  entities: obj(s?.entities),
  order: arr(s?.order),
  hands: obj(s?.hands),
  selections: arr(s?.selections)
});

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
  const normalized = {
    ...raw,
    snapshot,
    entities: snapshot.entities,
    order: snapshot.order,
    selections: snapshot.selections,
    stacks: arr(raw.stacks).map(normalizeStack),
    seats: arr(raw.seats).map(normalizeSeat),
    actionLog: arr(raw.actionLog),
    hands: normalizeHands(raw.hands),
    chat: arr(raw.chat),
    undo: arr(raw.undo),
    redo: arr(raw.redo),
    history: arr(raw.history),
    held: raw.held ?? null,
    selectedStackId: raw.selectedStackId ?? null,
    selectedSeatId: raw.selectedSeatId ?? null,
    tokens: arr(raw.tokens),
    interaction: {
      held: raw.held ?? null,
      selected:
        raw.interaction?.selected && typeof raw.interaction.selected === 'object'
          ? raw.interaction.selected
          : raw.selectedStackId
            ? { kind: 'stack', id: raw.selectedStackId }
            : null,
      dragging: raw.interaction?.dragging ?? null,
      ...obj(raw.interaction)
    },
    savedLayouts: arr(raw.savedLayouts).map(normalizeLayoutMeta),
    objects: hasUnifiedObjects ? arr(raw.objects) : undefined,
    chipStacks: hasUnifiedObjects ? undefined : arr(raw.chipStacks).map(normalizeStack),
    dice: hasUnifiedObjects ? undefined : arr(raw.dice).map(normalizeStack)
  };
  return normalized;
};

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

export { arr, obj, normalizeCustomLayout, normalizeSnapshot, normalizeTableState };
