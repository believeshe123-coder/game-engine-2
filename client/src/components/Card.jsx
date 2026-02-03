const Card = ({ id, label, x, y, rotation, zIndex, onPointerDown }) => {
  return (
    <div
      className="card"
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
        zIndex
      }}
      onPointerDown={(event) => onPointerDown(event, id)}
    >
      {label}
    </div>
  );
};

export default Card;
