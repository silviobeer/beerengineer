export function PathInput({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type="text" defaultValue={defaultValue} />
    </label>
  );
}
