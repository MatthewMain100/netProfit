const FIELDS = [
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'category', label: 'Category' },
  { key: 'project', label: 'Project' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
];

export default function FieldPalette({ onDragStart }) {
  return (
    <div className="panel">
      <h2>Field Palette</h2>
      <div className="toolbar">
        {FIELDS.map(field => (
          <button
            type="button"
            key={field.key}
            className="ghost"
            draggable
            onDragStart={e => onDragStart(e, field.key)}
          >
            {field.label}
          </button>
        ))}
      </div>
    </div>
  );
}
