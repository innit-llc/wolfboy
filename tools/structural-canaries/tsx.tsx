export function Panel({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" aria-label="Close" onClick={onClose}>
      x
    </button>
  );
}
