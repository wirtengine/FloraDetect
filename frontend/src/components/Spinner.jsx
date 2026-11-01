export default function Spinner({ full, label }) {
  const s = (
    <div className="flex flex-col items-center gap-3 text-leaf-700">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-leaf-200 border-t-leaf-600" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
  return full ? <div className="grid min-h-[60vh] place-items-center">{s}</div> : s
}
