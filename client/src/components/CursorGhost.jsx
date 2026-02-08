const CursorGhost = ({ ghost, label, seatColor }) => {
  return (
    <div
      className={`cursor-ghost ${ghost?.isDown ? 'cursor-ghost--down' : ''}`}
      style={{
        left: `${ghost?.x ?? 0}px`,
        top: `${ghost?.y ?? 0}px`,
        '--ghost-color': seatColor
      }}
    >
      <div className="cursor-ghost__dot" />
      <div className="cursor-ghost__label">{label}</div>
      {ghost?.holdingCount ? (
        <div className="cursor-ghost__badge">+{ghost.holdingCount}</div>
      ) : null}
    </div>
  );
};

export default CursorGhost;
