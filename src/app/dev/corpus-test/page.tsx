/**
 * @module   dev/corpus-test
 * @desc     临时开发测试页 — 验证保存→整理→归类全流程，验证后删除
 * @author   LingoBridge
 * @created  2026-06-02
 */

'use client'

import { useEffect, useMemo, useState } from 'react'
import { ensureSession } from '@/lib/supabase'
import { createCorpus, listMyCorpus, updateCorpusCleaned, saveExtraction } from '@/lib/db/corpus'
import { listObservationPoints } from '@/lib/db/observation-points'
import type { Corpus, ObservationPoint } from '@/lib/types'

interface ExtractionPick { pointCode: string; reason: string }
interface ExtractionResult { primary: ExtractionPick; secondary: ExtractionPick | null }

export default function CorpusTestPage() {
  const [text, setText] = useState('')
  const [items, setItems] = useState<Corpus[]>([])
  const [points, setPoints] = useState<ObservationPoint[]>([])
  const [lastPick, setLastPick] = useState<ExtractionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState<string | null>(null)

  const pointByCode = useMemo(() => new Map(points.map((p) => [p.code, p])), [points])
  function label(code: string): string {
    const p = pointByCode.get(code)
    return p ? `${p.dimensionId} · ${p.name}（${p.code}）` : code
  }

  async function refresh(): Promise<void> {
    try {
      setItems(await listMyCorpus())
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    ensureSession()
      .then(async () => {
        setPoints(await listObservationPoints())
        await refresh()
      })
      .catch((e: unknown) => setError(String(e)))
  }, [])

  async function onSave(): Promise<void> {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    setLastPick(null)
    try {
      setPhase('保存中…')
      const corpus = await createCorpus({ source: 'text', rawText: text.trim() })
      setText('')
      await refresh()

      setPhase('整理中…')
      const rRes = await fetch('/api/restructure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: corpus.rawText }),
      })
      const rData = (await rRes.json()) as { cleanedText?: string; error?: string }
      if (!rRes.ok || !rData.cleanedText) throw new Error(rData.error ?? '整理失败')
      await updateCorpusCleaned(corpus.id, rData.cleanedText)
      await refresh()

      setPhase('归类中…')
      const eRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleanedText: rData.cleanedText }),
      })
      const eData = (await eRes.json()) as ExtractionResult & { error?: string }
      if (!eRes.ok || !eData.primary) throw new Error(eData.error ?? '归类失败')
      await saveExtraction(corpus.id, eData.primary.pointCode, eData.secondary?.pointCode ?? null)
      setLastPick({ primary: eData.primary, secondary: eData.secondary })
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 680, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <p style={{ color: '#888' }}>⚠️ 临时开发测试页，验证用，之后删除</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        style={{ width: '100%' }}
        placeholder="随便讲一段你的事，越口语越好…"
      />
      <button onClick={onSave} disabled={busy} style={{ marginTop: 8 }}>
        {busy ? phase || '处理中…' : '保存 → 整理 → 归类'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {lastPick && (
        <div style={{ marginTop: 16, padding: 12, background: '#f3f3f3', borderRadius: 8 }}>
          <div><b>主维度：</b>{label(lastPick.primary.pointCode)}</div>
          <div style={{ color: '#666', fontSize: 13 }}>理由：{lastPick.primary.reason}</div>
          {lastPick.secondary ? (
            <>
              <div style={{ marginTop: 6 }}><b>副维度：</b>{label(lastPick.secondary.pointCode)}</div>
              <div style={{ color: '#666', fontSize: 13 }}>理由：{lastPick.secondary.reason}</div>
            </>
          ) : (
            <div style={{ marginTop: 6, color: '#999' }}>（无副维度）</div>
          )}
        </div>
      )}

      <ul style={{ marginTop: 16, lineHeight: 1.6 }}>
        {items.map((c) => (
          <li key={c.id} style={{ marginBottom: 12 }}>
            <div style={{ color: '#888', fontSize: 12 }}>
              [{c.status}] {new Date(c.createdAt).toLocaleString()}
            </div>
            <div>原始：{c.rawText}</div>
            <div style={{ color: c.cleanedText ? '#111' : '#bbb' }}>
              整理后：{c.cleanedText ?? '（待整理）'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
