export default function DropZone({ title, items, onDrop, onRemove }) {
  return (
    <div
      className="panel"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const key = e.dataTransfer.getData('text/plain');
        if (key) onDrop(key);
      }}
    >
      <h2>{title}</h2>
      {!items.length ? <div className="empty">Перетащите поля сюда</div> : null}
      <div className="toolbar">
        {items.map(item => (
          <span key={item} className="chip">
            {item}
            <button className="ghost" onClick={() => onRemove(item)} style={{ marginLeft: 8 }}>x</button>
          </span>
        ))}
      </div>
    </div>
  );
}
