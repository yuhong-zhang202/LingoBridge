import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-jakarta)',
          'PingFang SC',
          'Noto Sans SC',
          'sans-serif',
        ],
      },
      colors: {
        /* v1 tokens */
        'text-1':   '#111111',
        'text-2':   '#444444',
        'text-3':   '#888888',
        'text-4':   '#BBBBBB',
        'bg-page':  '#FBFAF7',
        'bg-card':  '#FFFFFF',
        'bg-inner': '#F4F4F4',
        /* 语义状态色（跨版本通用，v2 页面可用）*/
        'success':  '#5BA08A',
        'warning':  '#C4965A',   /* 仅作填充/浅底/圆点（bg-warning・bg-warning/15）；警告文字用 warning-text */
        'warning-text': '#8C6128',   /* 警告文字专用（WCAG AA：on bg-page 5.22 / on warning/15 tint 4.61） */
        'error':    '#AB5344',   /* 深化：白字压它 5.18、它作文字压浅底 4.96，删除按钮与 error 文字同时达标 */
        /* v2 tokens */
        'bg-base':              '#FBFAF7',
        'bg-surface':           '#FFFFFF',
        'bg-muted':             '#EEEBE6',
        'brand-primary':        '#D4875A',
        'brand-primary-light':  '#F2D5C0',
        'brand-primary-dark':   '#B5663A',
        'brand-primary-strong': '#C77C4F',   /* 定点：白字压品牌橙圆圈用（白字 3.27，配 ≥14px 粗体达大字 3:1） */
        'brand-accent':         '#7BA699',
        'brand-accent-light':   '#C8DDD9',
        'brand-accent-dark':    '#557E6D',   /* 定点：白字压品牌绿头像用（白字 4.57，正文级达标） */
        'band-55':              '#AAAAAA',
        'band-60':              '#7BA699',
        'band-65':              '#D4875A',
        'band-70':              '#9A7DB8',
        'v2-text-primary':      '#2C2420',
        'v2-text-secondary':    '#6B5B52',
        'v2-text-muted':        '#7C6B5E',   /* 深化达 AA：on bg-page 4.88 / surface 5.09（压 bg-muted 4.28 的少数处改用 secondary） */
        /* analysis 词组分组色（暖橙复用 brand-*；绿沿用全局绿 hex；雾青为本组新增）*/
        'phrase-warm-bg':       '#F7EBE1',
        'phrase-blue-bg':       '#E9EEF4',
        'phrase-blue-text':     '#4A6178',
        'phrase-blue-border':   '#CCD8E6',
        /* 中性灰阶：把散落的硬编码灰归拢成命名 token（值即原 hex，视觉零变化）*/
        'neutral-line':         '#EEEEEE',   /* 极浅分隔线 / StepBar 未达连线 */
        'neutral-border':       '#E5E5E5',   /* Chip / Tag 描边 */
        'neutral-track':        '#DDDDDD',   /* StepBar 未达圆点 / 轨道底 */
        'neutral-mute':         '#CCCCCC',   /* 最弱提示 / 占位文字（如「← 跳过」）*/
        'neutral-mid':          '#A0A09A',   /* 次级说明文字 */
        'neutral-slate':        '#555555',   /* 深灰块 */
        /* 反色深底：Toast / 更新提示 / TabBar 激活标记 */
        'surface-ink':          '#111111',
        'surface-inverse':      '#1A1A1A',
        /* v2 暖白 / 暖灰阶（配合奶油底系统）*/
        'cream-subtle':         '#FAFAF8',   /* 表格行 hover / 弹层近白底 */
        'cream-soft':           '#F8F7F5',   /* 卡片内嵌暖白 */
        'cream-deep':           '#F4F2EE',   /* 记忆卡底 */
        'warm-line':            '#E5DED7',   /* 记忆卡叠层 / 进度点空态 */
        'warm-mute':            '#D8D2CA',   /* 记忆卡弱文字 */
        'warm-taupe':           '#C4B5A9',   /* 暖调次级文字 */
        /* 强调标签绿三色：原 design.md §5 标注「无 token」，此处提为正式 token */
        'tag-success-bg':       '#EDF6EB',
        'tag-success-border':   '#C0DDB9',
        'tag-success-text':     '#3D7A38',
      },
      borderRadius: {
        'xl2': '24px',
        'xl3': '32px',
      },
      animation: {
        'wave-1':  'wave 750ms ease-in-out 0ms infinite alternate',
        'wave-2':  'wave 750ms ease-in-out 80ms infinite alternate',
        'wave-3':  'wave 750ms ease-in-out 160ms infinite alternate',
        'wave-4':  'wave 750ms ease-in-out 80ms infinite alternate',
        'wave-5':  'wave 750ms ease-in-out 0ms infinite alternate',
        'wave-a1': 'wave 500ms ease-in-out 0ms infinite alternate',
        'wave-a2': 'wave 500ms ease-in-out 80ms infinite alternate',
        'wave-a3': 'wave 500ms ease-in-out 160ms infinite alternate',
        'wave-a4': 'wave 500ms ease-in-out 80ms infinite alternate',
        'wave-a5': 'wave 500ms ease-in-out 0ms infinite alternate',
        'orb-breathe': 'orbBreathe 3.5s ease-in-out infinite',
        'orb-pulse':   'orbPulse 2.2s ease-in-out infinite',
        'fade-up':     'fadeUp 300ms ease-out both',
        'blink':       'blink 1s step-end infinite',
      },
      keyframes: {
        wave: {
          '0%,100%': { transform: 'scaleY(0.35)' },
          '50%':     { transform: 'scaleY(1.0)'  },
        },
        orbBreathe: {
          '0%,100%': { transform: 'scale(1.00)', opacity: '0.88' },
          '50%':     { transform: 'scale(1.03)', opacity: '1.00' },
        },
        orbPulse: {
          '0%,100%': { transform: 'scale(1.00)' },
          '50%':     { transform: 'scale(1.07)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)'    },
        },
        blink: {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
