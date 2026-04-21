export function StackSelect() {
  return (
    <label className="form-field">
      <span>Stack</span>
      <select defaultValue="node-ts">
        <option value="node-ts">node-ts</option>
        <option value="python">python</option>
      </select>
    </label>
  );
}
