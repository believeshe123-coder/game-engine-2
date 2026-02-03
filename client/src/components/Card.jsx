const Card = ({ label, x, y, rotation, zIndex }) => {
  return (
    <div
      className="card"
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
        zIndex
      }}
    >
      {label}
    </div>
  );
};

export default Card;
