export function FavoriteButton({
  name,
  selected,
  onToggle,
}: {
  name: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="favorite-button"
      aria-label={`${selected ? 'Remove' : 'Add'} ${name} ${selected ? 'from' : 'to'} favorites`}
      aria-pressed={selected}
      onClick={onToggle}
    >
      <span aria-hidden="true">{selected ? '★' : '☆'}</span>
    </button>
  );
}
