import { forwardRef } from 'react';

import Card from './Card.jsx';

const InventoryPanel = forwardRef(
  (
    {
      cardIds,
      cardsById,
      revealed,
      onToggleReveal,
      onHeaderPointerDown,
      onCardPointerDown,
      preventNativeDrag,
      seatColor,
      cardStyle,
      colorBlindMode,
      onPreviewCard,
      panelStyle,
      isDragging,
      isDocked
    },
    ref
  ) => {
    const safeCardIds = Array.isArray(cardIds) ? cardIds : [];
    const hasCards = safeCardIds.length > 0;

    return (
      <section
        ref={ref}
        className={`inventory-panel${isDragging ? ' is-dragging' : ''}${isDocked ? ' inventory-panel--docked' : ''}`}
        aria-label="Your hand"
        style={panelStyle}
        draggable={false}
        onDragStart={preventNativeDrag}
        onDragOver={preventNativeDrag}
        onDragEnter={preventNativeDrag}
        onDrop={preventNativeDrag}
      >
        <div
          className={`inventory-panel__header${isDocked ? ' inventory-panel__header--locked' : ''}`}
          onPointerDown={onHeaderPointerDown}
        >
          <div>
            <div className="inventory-panel__title">Your Hand</div>
            <div className="inventory-panel__subtitle">
              {hasCards ? 'Drag cards to the table, toggle reveal per card.' : 'No cards yet'}
            </div>
          </div>
          <span className="inventory-panel__count">{safeCardIds.length}</span>
        </div>
        {hasCards ? (
          <div
            className="inventory-panel__cards"
            style={{ '--accent-color': seatColor }}
            onDragStart={preventNativeDrag}
            onDragOver={preventNativeDrag}
            onDragEnter={preventNativeDrag}
            onDrop={preventNativeDrag}
          >
            {safeCardIds.map((cardId) => {
              const card = cardsById[cardId];
              const isRevealed = Boolean(revealed?.[cardId]);
              return (
                <div
                  key={cardId}
                  className="inventory-card"
                  draggable={false}
                  onPointerDown={(event) => onCardPointerDown?.(event, cardId)}
                  onDragStart={preventNativeDrag}
                  onDragOver={preventNativeDrag}
                  onDragEnter={preventNativeDrag}
                  onDrop={preventNativeDrag}
                >
                  <div className="inventory-card__face">
                    <Card
                      id={cardId}
                      x={0}
                      y={0}
                      rotation={0}
                      faceUp
                      cardStyle={cardStyle}
                      colorBlindMode={colorBlindMode}
                      zIndex={1}
                      rank={card?.rank}
                      suit={card?.suit}
                      color={card?.color}
                      onPointerDown={() => {}}
                      onNativeDrag={preventNativeDrag}
                    />
                  </div>
                  <button
                    type="button"
                    className={`inventory-card__toggle ${
                      isRevealed ? 'is-revealed' : ''
                    }`}
                    onClick={() => onToggleReveal?.(cardId)}
                    title={isRevealed ? 'Revealed to table' : 'Private to you'}
                    draggable={false}
                    onDragStart={preventNativeDrag}
                    onDragEnter={preventNativeDrag}
                    onDragOver={preventNativeDrag}
                    onDrop={preventNativeDrag}
                  >
                    <span className="inventory-card__toggle-icon">
                      {isRevealed ? '👁' : '🙈'}
                    </span>
                    <span className="inventory-card__toggle-label">
                      {isRevealed ? 'Revealed' : 'Private'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="inventory-card__preview"
                    onClick={() => onPreviewCard?.(cardId)}
                    draggable={false}
                    onDragStart={preventNativeDrag}
                    onDragEnter={preventNativeDrag}
                    onDragOver={preventNativeDrag}
                    onDrop={preventNativeDrag}
                  >
                    Preview
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }
);

export default InventoryPanel;
