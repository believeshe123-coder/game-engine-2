const SeatMenu = ({
  seatLabel,
  isMine,
  isOccupied,
  seatColor,
  accentColor,
  onSit,
  onStand,
  onUpdateColors,
  onClose
}) => {
  return (
    <div className="seat-menu" onPointerDown={(event) => event.stopPropagation()}>
      <div className="seat-menu__header">
        <div>
          <div className="seat-menu__title">{seatLabel}</div>
          <div className="seat-menu__subtitle">
            {isOccupied ? (isMine ? 'You are seated here.' : 'Occupied') : 'Available'}
          </div>
        </div>
        <div
          className="seat-menu__swatch"
          style={{ background: seatColor || '#ccc' }}
          aria-hidden="true"
        />
      </div>
      <div className="seat-menu__actions">
        {!isOccupied ? (
          <button type="button" className="seat-menu__button" onClick={onSit}>
            Sit Here
          </button>
        ) : null}
        {isOccupied && isMine ? (
          <button type="button" className="seat-menu__button" onClick={onStand}>
            Stand Up
          </button>
        ) : null}
      </div>
      {isOccupied && isMine ? (
        <div className="seat-menu__settings">
          <div className="seat-menu__setting">
            <label className="seat-menu__label" htmlFor="seat-color">
              Seat color
            </label>
            <input
              id="seat-color"
              className="seat-menu__color"
              type="color"
              value={seatColor}
              onChange={(event) => onUpdateColors?.({ seatColor: event.target.value })}
            />
          </div>
          <div className="seat-menu__setting">
            <label className="seat-menu__label" htmlFor="accent-color">
              Highlight color
            </label>
            <input
              id="accent-color"
              className="seat-menu__color"
              type="color"
              value={accentColor}
              onChange={(event) => onUpdateColors?.({ accentColor: event.target.value })}
            />
          </div>
        </div>
      ) : null}
      <div className="seat-menu__footer">
        <button type="button" className="seat-menu__link" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

export default SeatMenu;
