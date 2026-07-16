'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, Pencil, Check } from 'lucide-react'
import { Card, GradientButton, Tag } from './primitives'

const RAW =
  '嗯就是上周末吧，我朋友她那个心情特别不好，因为工作上遇到挫折嘛，然后我就约她出来喝咖啡，陪她聊了一下午，听她把烦恼都讲出来，后来她感觉好多了。'

const TIDY =
  '上周末，我的朋友因为工作上遇到了挫折，情绪非常低落。我主动约她出来喝咖啡，陪她聊了一个下午，认真听她倾诉所有的烦恼。聊完之后，她的心情明显好转了很多。'

export function RestructureView() {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(TIDY)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 lg:px-10">
      <div className="md:hidden">
        <Tag variant="neutral" className="mb-4">
          第 2 步 · 整理
        </Tag>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* raw */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink2">你刚才讲的（原话）</span>
          </div>
          <Card className="p-6">
            <p className="text-pretty leading-relaxed text-ink2">{RAW}</p>
          </Card>
          <p className="mt-3 text-[13px] leading-relaxed text-ink3">
            设备端实时转写难免有口语化和零碎的地方，右侧是我帮你顺过的版本，你可以再改改。
          </p>
        </div>

        {/* tidy / editable */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Sparkles className="size-4 text-teal" />
              整理后
            </span>
            <button
              onClick={() => setEditing((e) => !e)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-ink2 transition-colors hover:text-ink"
            >
              {editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
              {editing ? '完成编辑' : '编辑确认'}
            </button>
          </div>
          <Card gradient className="p-6">
            {editing ? (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={7}
                className="w-full resize-none rounded-[14px] bg-inset p-4 text-[16px] leading-relaxed text-ink outline-none"
              />
            ) : (
              <p className="text-pretty text-[16px] leading-relaxed text-ink">{text}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Tag variant="green">主维度 · 人际羁绊</Tag>
              <Tag variant="green">副维度 · 情绪内核</Tag>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-10 flex justify-end">
        <Link href="/matching">
          <GradientButton size="lg">
            去匹配雅思真题
            <ArrowRight className="size-4" />
          </GradientButton>
        </Link>
      </div>
    </div>
  )
}
