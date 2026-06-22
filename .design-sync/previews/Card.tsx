import { Card } from 'lingobridge'

export const Plain = () => (
  <div style={{ width: 360 }}>
    <Card className="px-[22px] pt-4 pb-[22px]">
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#2C2420' }}>素材录入</p>
      <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.625, color: '#6B5B52' }}>
        今天下班路上下了很大的雨，我没带伞，在地铁口站了快十分钟，看着雨慢慢小下来。
      </p>
    </Card>
  </div>
)

export const GradientEmphasis = () => (
  <div style={{ width: 360 }}>
    <Card variant="gradient" className="px-[22px] pt-4 pb-[22px]">
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.625, color: '#2C2420' }}>
        这段经历可以聊「一次难忘的雨天」，逻辑清晰、细节具体，很适合直接作答。
      </p>
    </Card>
  </div>
)
