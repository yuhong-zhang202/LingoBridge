# LingoBridge design system — conventions

LingoBridge is a warm, calm, low-pressure IELTS-speaking companion. The mood is gentle and
restrained: cream background, soft cards, gradient **borders** (never gradient fills), green
emphasis tags, and a diffuse glowing **Orb** as the brand anchor. Never add scores, streaks,
red dots, or badges.

## Setup — no provider needed

These are pure presentational components. Import from `window.LB` and compose them directly —
there is no theme/router/context provider to wrap. All styling ships in `styles.css` (which
`@import`s `_ds_bundle.css`). Gradient borders are baked into the components as inline styles
from the bundle, so they render with no extra wiring.

## Styling idiom — Tailwind utilities over the brand tokens

Components are styled with Tailwind utility classes that reference the LingoBridge color tokens.

**Important:** the shipped `styles.css` is a **static compile** containing only the utility classes
these components already use — it is NOT a live Tailwind JIT. So:

- **Compose the components as-is** for anything they cover (buttons, cards, tags, chips, steps, etc.).
- **For your own layout glue**, use inline styles with the token hex values below, or the utility
  classes that are actually shipped (listed under each token). Do not invent arbitrary Tailwind
  classes — unshipped utilities render unstyled.

### Tokens (hex — safe to use as inline-style values)

| Token | Hex | Shipped utilities |
|---|---|---|
| page background | `#F8F5F1` | `bg-bg-page` |
| card / surface | `#FFFFFF` | `bg-bg-surface` |
| muted / skeleton fill | `#EEEBE6` | `bg-bg-muted` |
| inset surface | `#F4F4F4` | `bg-bg-inner` |
| brand primary (warm orange) | `#D4875A` | `bg-brand-primary` `text-brand-primary` `border-brand-primary` `ring-brand-primary` |
| brand primary light | `#F2D5C0` | `bg-brand-primary-light` `border-brand-primary-light` |
| brand primary dark (hover/emphasis) | `#B5663A` | `text-brand-primary-dark` |
| brand accent (green-blue, AI) | `#7BA699` | `text-brand-accent` `bg-brand-accent-light` |
| text primary | `#2C2420` | `text-v2-text-primary` |
| text secondary | `#6B5B52` | `text-v2-text-secondary` |
| text muted / timestamps | `#A89990` | `text-v2-text-muted` |
| warning | `#C4965A` | `text-warning` `bg-warning` |
| error | `#C47A6A` | `text-error` `border-error` |

Emphasis tags are always **green**: bg `#EDF6EB`, border `#C0DDB9`, text `#3D7A38` (use the
`Tag` component with `variant="green"` — don't hand-roll it).

Shipped custom classes: `btn-gradient` (gradient-border CTA), `skeleton` (shimmer placeholder),
`sheet-enter` / `toast-enter` (entrance animations), `ambient-light` (home/record ambient glow).
Common radius: `rounded-full` for buttons/pills/tags; cards use `rounded-[16px]`.

## Where the truth lives

- `styles.css` (and its `@import` of `_ds_bundle.css`) — the only stylesheet designs receive.
- Per component: `<Name>.d.ts` (the props contract) and `<Name>.prompt.md` (usage).

## One idiomatic snippet

```jsx
const { Card, Tag, GradientButton } = window.LB
<Card className="px-[22px] pt-4 pb-[22px]">
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
    <Tag label="当季热题" variant="green" />
  </div>
  <p style={{ fontSize: 14, lineHeight: 1.625, color: '#2C2420' }}>
    用讲自己的真实生活故事来练口语，而不是背模板。
  </p>
  <div style={{ marginTop: 16 }}>
    <GradientButton className="px-6 py-3 rounded-full text-[14px] font-medium">免费开始练习</GradientButton>
  </div>
</Card>
```
