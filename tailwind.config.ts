import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
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
        'bg-page':  '#F9F9F9',
        'bg-card':  '#FFFFFF',
        'bg-inner': '#F4F4F4',
        'success':  '#5BA08A',
        'warning':  '#C4965A',
        'error':    '#C47A6A',
        /* v2 tokens */
        'bg-base':              '#F5F2EE',
        'bg-surface':           '#FFFFFF',
        'bg-muted':             '#EEEBE6',
        'brand-primary':        '#D4875A',
        'brand-primary-light':  '#F2D5C0',
        'brand-primary-dark':   '#B5663A',
        'brand-accent':         '#7BA699',
        'brand-accent-light':   '#C8DDD9',
        'band-55':              '#AAAAAA',
        'band-60':              '#7BA699',
        'band-65':              '#D4875A',
        'band-70':              '#9A7DB8',
        'v2-text-primary':      '#2C2420',
        'v2-text-secondary':    '#6B5B52',
        'v2-text-muted':        '#A89990',
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
