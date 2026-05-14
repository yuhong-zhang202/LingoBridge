interface FlowDotsProps {
  total: number
  current: number
}

export default function FlowDots({ total, current }: FlowDotsProps) {
  return (
    <div className="flex items-center justify-center gap-[6px] py-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-300"
          style={{
            width:  i === current ? 8 : 6,
            height: i === current ? 8 : 6,
            background:
              i === current  ? '#111111' :
              i < current    ? 'rgba(0,0,0,0.22)' :
                               '#DDDDDD',
          }}
        />
      ))}
    </div>
  )
}
