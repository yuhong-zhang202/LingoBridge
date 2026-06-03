/**
 * @module   extraction
 * @desc     把一段整理后的中文语料归类到 43 个观察点（服务端调 Claude），判断主/副维度
 * @author   LingoBridge
 * @created  2026-06-02
 */
import 'server-only'
import { env } from '@/lib/env'

// 萃取是 43 点细微边界判断 + 产品核心，默认用 Sonnet（准确性优先）
// 验证够准后可降到 'claude-haiku-4-5' 省钱；还不够准可升到 'claude-opus-4-7'
const EXTRACTION_MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `你是 LingoBridge 的语料分类器。用户会给你一段「整理后的中文叙述」（来自雅思口语备考者讲述的真实生活片段）。
你的任务：判断这段语料应该归到下面 43 个「观察点」中的哪一个，并区分主维度和副维度。

# 6 个维度
- emotion 情绪内核：这个人如何与自己相处（情绪、独处、解压、节奏）
- relationship 人际羁绊：如何与他人/动物产生联结
- space 空间感知：和物理空间的关系（居所、城市、远行、自然）
- spirit 精神栖所：精神世界的客体（书影音、物件、数字栖居）
- growth 成长演进：如何蜕变（技能、死磕、复盘、未来方向）
- value 价值底色：相信什么、看重什么 —— ⚠️ 本步【不处理】value，它靠横向萃取，绝不要输出 value 的点

# 43 个观察点（code｜名称 —— 收什么；不收什么/边界）

## 情绪内核 emotion
EMO_01｜最近一段时间的整体状态 —— 持续状态/基调；不收具体事件
EMO_02｜日常的能量节奏 —— 长期作息、精力分布模式
EMO_03｜一个人时怎么度过时间 —— 独处行为本身；⚠️ 哪怕讲玩某游戏/看某剧，只要重心是"独处状态"，归这里，不要漂去精神栖所
EMO_04｜让你感到放松的事 —— 放松机制本身；不收发生在哪个地方
EMO_05｜让你感到充电的事 —— 能量恢复（区别于放松的"紧绷消解"）
EMO_06｜会反复回到的小习惯 —— 仪式感、对稳定性的依赖
EMO_07｜应对压力时的惯常反应 —— "模式"；不收"那一次"（单次归 EMO_09）
EMO_08｜你和食物的关系 —— 食物作为主角（口味/探店/家常vs外食）；⚠️ 和别人尤其家人一起吃，归人际，不归这里
EMO_09｜一次让你压力大的具体经历 —— 单次事件，有具体场景
EMO_10｜一次明显的情绪波动 —— 情绪事件（哭/愤怒/激动）；⚠️ 不能是"那次失败让我学会…"（归成长）
EMO_11｜会让你失眠的事 —— 焦虑/反刍的具体触发
EMO_12｜难以启齿/不会跟人说的事 —— 自我袒露的边界
EMO_13｜你和外表/形象的关系 —— 穿着/外表/自我形象的经历或稳定态度；不收纯偏好闲聊

## 人际羁绊 relationship
REL_01｜和家人的日常相处模式 —— 长期模式；不收"那一次"
REL_02｜一次和家人之间的具体事件 —— 单次，可正可负（吵架/温暖都算）
REL_03｜一个让你舒服的朋友 —— 对某人/某段关系的整体描述；不收"那一次共度"
REL_04｜一次和朋友的具体共度 —— 单次共同事件
REL_05｜一段亲密关系里的人或事 —— 伴侣/心动/暧昧/暗恋，单身也能填
REL_06｜一个让你印象深刻的陌生人 —— 单次相遇，不必是帮助性质
REL_07｜和宠物/动物的日常陪伴 —— 日常存在感；⚠️ "宠物很可爱"那种纯偏好归精神栖所，这里收互动
REL_08｜一次和宠物/动物的特殊互动 —— 单次（生病/走失/告别等）
REL_09｜一次你帮助别人的经历 —— 主语是"我帮"
REL_10｜一次被别人帮助的经历 —— 主语是"我被帮"
REL_11｜一次关系摩擦或冲突 —— 一次真实的关系紧张/摩擦，可冲突可冷战，不要求和解；家人/朋友/伴侣/同事都走这

## 空间感知 space
SPA_01｜你和居住空间的关系 —— 对住所/家乡的长期感受与依恋
SPA_02｜日常移动 / 通勤 —— 每天的位移状态（区别于远途）
SPA_03｜你和所在城市/街区的关系 —— 对城市的长期态度
SPA_04｜一个让你印象深刻的建筑/公共空间 —— 单次具体感受
SPA_05｜你是什么样的旅行者 —— 旅行模式/偏好的基调
SPA_06｜一次具体的远行 —— 单次远行事件；⚠️ 若主角变成人/事，主维度仍是空间，人际作副维度
SPA_07｜自然里让你有感觉的时刻 —— 和自然的关系；⚠️ 远途 vs 自然，看强调"逃离日常"还是"自然震撼"

## 精神栖所 spirit
SPI_01｜一个反复回去的作品 —— 贯穿型陪伴（一直在），长期重看重听，书/影/音
SPI_02｜一个在特定时期陪着你的作品 —— 阶段型陪伴（某段时间陪你度过）
SPI_03｜一个改变了你某种看法的作品 —— 重在"认知改变"
SPI_04｜一首歌/一件作品带来的纯粹感受 —— 音乐/艺术，被击中的感受，不必有情节
SPI_05｜一件对你特别的物品 —— 物背后的意义/来历/分量，不是性能；含贵重/渴望之物
SPI_06｜你在数字世界里的栖居 —— 数字产品/社区和你的日常依恋；不收一次性使用（查攻略/买二手）

## 成长演进 growth
GRO_01｜一项你长期坚持的投入 —— 持续、无终点（健身、习惯）
GRO_02｜一项你学会或正在练的技能 —— 有明确习得对象的技能
GRO_03｜一次靠死磕做成的事 —— 攻克难题 + 高光成就
GRO_04｜一次失败带来的复盘 —— 重心"我因此明白了什么"；⚠️ 不是情绪崩溃（归 EMO_10）
GRO_05｜一次想法的转变 —— 须带具体转变（以前→现在）；这是"转变事件"
GRO_06｜对自己未来方向的思考 —— 收"现在怎么想方向"，不要求已发生

# 判断规则
1. 先定【主维度】：这段语料的重心落在哪个维度，就在那个维度里挑【唯一一个】最贴切的观察点（同一维度内只能落一个点）。
2. 再看要不要【副维度】：如果这段话明显还顺带触及了【另一个不同维度】的素材，给一个副维度观察点；否则副维度为 null。
3. 重心只有一个，副维度顶多一个，【绝不输出第三个】。主、副必须属于【不同维度】。
4. 绝不输出 value（价值底色）维度的任何点。
5. 如果整段语料都很难归类（太短/无信息），primary 仍选最接近的点，并在 reason 里说明不确定。

# 输出格式
只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要前后缀文字：
{"primary":{"pointCode":"REL_04","reason":"一句话说明为什么"},"secondary":{"pointCode":"SPA_06","reason":"一句话说明"}}
若无副维度，secondary 为 null：
{"primary":{"pointCode":"EMO_03","reason":"..."},"secondary":null}`

export interface ExtractionPick {
  pointCode: string
  reason: string
}

export interface ExtractionResult {
  primary: ExtractionPick
  secondary: ExtractionPick | null
}

/**
 * 萃取一段语料
 * @param cleanedText  整理后的中文短文
 * @returns            主/副观察点的归类结果
 */
export async function extractCorpus(cleanedText: string): Promise<ExtractionResult> {
  if (!env.anthropicApiKey) {
    throw new Error('未配置 ANTHROPIC_API_KEY，请在 .env.local 中设置')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const startedAt = Date.now()

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: cleanedText }],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`Claude 萃取失败（${res.status}）：${detail}`)
    }

    const data = (await res.json()) as {
      content: { type: string; text?: string }[]
      usage?: { input_tokens: number; output_tokens: number }
    }

    const raw = data.content.find((b) => b.type === 'text')?.text?.trim() ?? ''
    // 容错：去掉可能的 ```json ``` 包裹
    const jsonText = raw.replace(/^```(?:json)?/, '').replace(/```$/, '').trim()

    let parsed: ExtractionResult
    try {
      parsed = JSON.parse(jsonText) as ExtractionResult
    } catch {
      throw new Error(`Claude 萃取返回非法 JSON：${raw}`)
    }
    if (!parsed.primary?.pointCode) {
      throw new Error(`Claude 萃取缺少 primary：${raw}`)
    }

    console.log('[Extraction] done', {
      ms: Date.now() - startedAt,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      primary: parsed.primary.pointCode,
      secondary: parsed.secondary?.pointCode ?? null,
    })

    return parsed
  } finally {
    clearTimeout(timeout)
  }
}
