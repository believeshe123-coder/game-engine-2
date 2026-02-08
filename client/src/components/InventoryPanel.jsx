import Card from './Card.jsx';

const InventoryPanel = ({
  cardIds,
  cardsById,
  revealed,
  onToggleReveal,
  onCardDragStart,
  onCardDrop,
  onDropToEnd,
  seatColor,
  cardStyle
}) => {
  if (!cardIds || cardIds.length === 0) {
    return (
      <section className="inventory-panel" aria-label="Your hand">
        <div className="inventory-panel__header">
          <div>
            <div className="inventory-panel__title">Your Hand</div>
            <div className="inventory-panel__subtitle">No cards yet</div>
          </div>
          <span className="inventory-panel__count">0</span>
        </div>
      </section>
    );
  }

  return (
    <section className="inventory-panel" aria-label="Your hand">
      <div className="inventory-panel__header">
        <div>
          <div className="inventory-panel__title">Your Hand</div>
          <div className="inventory-panel__subtitle">
            Drag cards to the table, toggle reveal per card.
          </div>
        </div>
        <span className="inventory-panel__count">{cardIds.length}</span>
      </div>
      <div
        className="inventory-panel__cards"
        style={{ '--accent-color': seatColor }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const draggedId = event.dataTransfer.getData('text/plain');
          if (draggedId) {
            onDropToEnd?.(draggedId);
          }
        }}
      >
        {cardIds.map((cardId, index) => {
          const card = cardsById[cardId];
          const isRevealed = Boolean(revealed?.[cardId]);
          return (
            <div
              key={cardId}
              className="inventory-card"
              draggable
              onDragStart={(event) => onCardDragStart?.(event, cardId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData('text/plain');
                if (draggedId) {
                  onCardDrop?.(draggedId, index);
                }
              }}
            >
              <div className="inventory-card__face">
                <Card
                  id={cardId}
                  x={0}
                  y={0}
                  rotation={0}
                  faceUp
                  cardStyle={cardStyle}
                  zIndex={1}
                  rank={card?.rank}
                  suit={card?.suit}
                  color={card?.color}
                  onPointerDown={() => {}}
                />
              </div>
              <button
                type="button"
                className={`inventory-card__toggle ${isRevealed ? 'is-revealed' : ''}`}
                onClick={() => onToggleReveal?.(cardId)}
                title={isRevealed ? 'Revealed to table' : 'Private to you'}
              >
                <span className="inventory-card__toggle-icon">
                  {isRevealed ? '👁' : '🙈'}
                </span>
                <span className="inventory-card__toggle-label">
                  {isRevealed ? 'Revealed' : 'Private'}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default InventoryPanel;
