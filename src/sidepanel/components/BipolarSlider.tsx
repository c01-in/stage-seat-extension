interface BipolarSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
}

function toSliderValue(value: number) {
  return Math.round(value * 100)
}

function fromSliderValue(value: string) {
  return Number(value) / 100
}

export function BipolarSlider({ label, value, onChange }: BipolarSliderProps) {
  return (
    <label className="control-row">
      <div className="control-copy">
        <span>{label}</span>
        <strong>{toSliderValue(value)}</strong>
      </div>
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        value={toSliderValue(value)}
        title="Double-click to reset to 0"
        onChange={(event) => onChange(fromSliderValue(event.target.value))}
        onDoubleClick={() => onChange(0)}
      />
    </label>
  )
}
