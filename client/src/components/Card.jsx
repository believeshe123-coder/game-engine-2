const SUIT_SYMBOLS = {
  Spades: '♠',
  Clubs: '♣',
  Hearts: '♥',
  Diamonds: '♦'
};

const SUIT_COLORS = {
  Spades: 'black',
  Clubs: 'black',
  Hearts: 'red',
  Diamonds: 'red'
};

const PIP_LAYOUTS = {
  A: [
    [1, 2]
  ],
  2: [
    [1, 0],
    [1, 4]
  ],
  3: [
    [1, 0],
    [1, 2],
    [1, 4]
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 4],
    [2, 4]
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 2],
    [0, 4],
    [2, 4]
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
    [0, 4],
    [2, 4]
  ],
  7: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
    [0, 4],
    [2, 4]
  ],
  8: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
    [1, 3],
    [0, 4],
    [2, 4]
  ],
  9: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [1, 3],
    [0, 4],
    [2, 4]
  ],
  10: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
    [0, 3],
    [2, 3],
    [0, 4],
    [2, 4]
  ]
};

const Card = ({
  id,
  x,
  y,
  rotation,
  zIndex,
  faceUp,
  onPointerDown,
  rank,
  suit,
  color,
  cardStyle,
  isHeld,
  isSelected,
  stackCount,
  showStackCount
}) => {
  const displayRank = rank ?? '?';
  const isJoker = displayRank === 'JOKER';
  const jokerColor = color ?? 'black';
  const symbol = SUIT_SYMBOLS[suit] ?? '♠';
  const suitColor = SUIT_COLORS[suit] ?? 'black';
  const faceColorClass = isJoker
    ? jokerColor === 'red'
      ? 'card__face--red'
      : ''
    : suitColor === 'red'
      ? 'card__face--red'
      : '';
  const isCourt = ['J', 'Q', 'K'].includes(displayRank);
  const pipLayout = PIP_LAYOUTS[displayRank] ?? [];
  return (
    <div
      className={`card card--style-${cardStyle ?? 'medieval'} ${
        faceUp ? 'card--faceup' : 'card--facedown'
      } ${isHeld ? 'card--held' : ''} ${isSelected ? 'card--selected' : ''}`}
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
        zIndex
      }}
      onPointerDown={(event) => onPointerDown(event, id)}
    >
      {showStackCount ? (
        <div className="card__count" aria-hidden="true">
          {stackCount}
        </div>
      ) : null}
      <div className="card__surface" aria-hidden="true">
        {faceUp ? (
          <div
            className={`card__face ${faceColorClass} ${
              isJoker ? 'card__face--joker' : ''
            }`}
          >
            {isJoker ? (
              <div className="card__joker">
                <span className="card__joker-title">Joker</span>
                <span className="card__joker-emblem">✶</span>
                <span className="card__joker-title card__joker-title--small">
                  {jokerColor === 'red' ? 'Crimson' : 'Onyx'}
                </span>
              </div>
            ) : (
              <>
                <div className="card__corner card__corner--top">
                  <span className="card__rank">{displayRank}</span>
                  <span className="card__suit">{symbol}</span>
                </div>
                <div className="card__corner card__corner--bottom">
                  <span className="card__rank">{displayRank}</span>
                  <span className="card__suit">{symbol}</span>
                </div>
                {isCourt ? (
                  <div className="card__court">
                    <div className="card__court-emblem">{symbol}</div>
                    <div className="card__court-rank">{displayRank}</div>
                    <div className="card__court-ornament" />
                  </div>
                ) : (
                  <div className="card__pips">
                    {pipLayout.map(([col, row], index) => (
                      <span
                        key={`${col}-${row}-${index}`}
                        className="card__pip"
                        style={{
                          gridColumn: col + 1,
                          gridRow: row + 1
                        }}
                      >
                        {symbol}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Card;
