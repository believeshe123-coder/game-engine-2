const Card = ({ id, label, x, y, rotation, zIndex, faceUp, onPointerDown }) => {
  return (
    <div
      className={`card ${faceUp ? '' : 'card--facedown'}`}
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
        zIndex
      }}
      onPointerDown={(event) => onPointerDown(event, id)}
    >
      {faceUp ? label : 'Back'}
    </div>
  );
};

export default Card;
