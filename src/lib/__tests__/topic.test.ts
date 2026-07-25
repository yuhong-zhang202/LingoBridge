/**
 * @module   topic.test
 * @desc     prettifyTopic 话题名美化纯函数测试（Part1 话题标 / 雅思选题话题标共用）
 */
import { prettifyTopic } from '@/lib/topic'

describe('prettifyTopic', () => {
  it('单词全大写 → Title Case', () => {
    expect(prettifyTopic('HOMETOWN')).toBe('Hometown')
  })

  it('下划线分词 → 空格 + 每词首字母大写', () => {
    expect(prettifyTopic('WORK_OR_STUDY')).toBe('Work Or Study')
  })

  it('混合大小写输入 → 规范化为 Title Case', () => {
    expect(prettifyTopic('hoMeTown')).toBe('Hometown')
  })

  it('空字符串 → null（调用侧不渲染话题标）', () => {
    expect(prettifyTopic('')).toBeNull()
  })

  it('全空白 → null', () => {
    expect(prettifyTopic('   ')).toBeNull()
  })

  it('多重下划线/空格混合 → 折叠为单空格', () => {
    expect(prettifyTopic('A__B  C')).toBe('A B C')
  })

  it('首尾空白 → 去除', () => {
    expect(prettifyTopic('  daily routine  ')).toBe('Daily Routine')
  })
})
