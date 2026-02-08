const SeatMenu = ({
  seatLabel,
  isOccupied,
  onSit
}) => {
  return (
    <div className="seat-menu" onPointerDown={(event) => event.stopPropagation()}>
      <div className="seat-menu__header">
        <div>
          <div className="seat-menu__title">{seatLabel}</div>
          <div className="seat-menu__subtitle">
            {isOccupied ? 'Occupied' : 'Available'}
          </div>
        </div>
      </div>
      <div className="seat-menu__actions">
        {!isOccupied ? (
          <button type="button" className="seat-menu__button" onClick={onSit}>
            Sit Here
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default SeatMenu;
