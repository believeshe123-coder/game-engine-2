const Card = ({ id, x, y, rotation, zIndex, faceUp, onPointerDown }) => {
  return (
    <div
      className={`card ${faceUp ? 'card--faceup' : 'card--facedown'}`}
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
        zIndex
      }}
      onPointerDown={(event) => onPointerDown(event, id)}
    >
      <div className="card__surface" aria-hidden="true" />
    </div>
  );
};

export default Card;
