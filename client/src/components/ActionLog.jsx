const ActionLog = ({ entries }) => {
  return (
    <section className="action-log" aria-label="Action log">
      <div className="action-log__header">Action Log</div>
      <div className="action-log__entries">
        {entries?.length ? (
          entries.map((entry) => (
            <div key={entry.id} className="action-log__entry">
              {entry.text}
            </div>
          ))
        ) : (
          <div className="action-log__empty">No actions yet.</div>
        )}
      </div>
    </section>
  );
};

export default ActionLog;
