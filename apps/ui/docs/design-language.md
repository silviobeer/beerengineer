# Design Language — beerengineer_ UI

> Techy-clean operator console: warm-dark petrol surfaces, cream type, gold for attention, lime for live highlights.

## Tone

Operator-tooling, not a brochure. Reads like a terminal you can trust:
monospaced labels, generous whitespace, one accent at a time. Inspired by the
beerventures palette (Petrol / Gold / Accent2-Lime / warm cream) but inverted
into a dark control surface so logs and code stay legible during long sessions.

## Color Palette (dark-mode only for now)

All values live in `apps/ui/app/globals.css` as CSS custom properties and as
Tailwind v4 `@theme` tokens. The neutral scale **overrides the default
`zinc-*` palette** so the existing components keep working — they just look
warmer and slightly petrol-tinted now.

### Neutrals (overrides Tailwind `zinc-*`)
| Token | Value | Usage |
|-------|-------|-------|
| `zinc-50`  | `#FAF8F3` | Highest-contrast text (cream) |
| `zinc-100` | `#F0EBE0` | Primary text |
| `zinc-200` | `#D5DBDC` | Strong text on dim panels |
| `zinc-300` | `#B5C0C2` | Secondary text |
| `zinc-400` | `#8FA0A4` | Muted text, timestamps |
| `zinc-500` | `#6B8084` | Placeholder, hint text |
| `zinc-600` | `#3F5A60` | Strong borders |
| `zinc-700` | `#2A4348` | Default borders, chip outlines |
| `zinc-800` | `#1A2F33` | Subtle borders, divider lines |
| `zinc-900` | `#122024` | Panel backgrounds |
| `zinc-950` | `#0B1517` | Page background (deep petrol-tinted black) |

### Active / OK (overrides Tailwind `emerald-*` — used by L2 badge, active tab)
| Token | Value | Usage |
|-------|-------|-------|
| `emerald-300` | `#9FD8E0` | Active tab text, light petrol |
| `emerald-400` | `#5FB6C2` | Active border |
| `emerald-500` | `#2C95A4` | Strong active accent |
| `emerald-700` | `#0E5A65` | L2 badge border (= brand petrol) |
| `emerald-900` | `#062C32` | L2 badge background |

### Attention / Warning (overrides Tailwind `amber-*` — gold)
| Token | Value | Usage |
|-------|-------|-------|
| `amber-300` | `#E8C168` | L1 badge text |
| `amber-400` | `#D4A843` | Attention dot, primary CTA — brand gold |
| `amber-500` | `#B8913A` | CTA hover |
| `amber-700` | `#7A5E20` | L1 badge border |
| `amber-900` | `#3A2C0E` | L1 badge background |

### Highlight (lime — used sparingly)
| Token | Value | Usage |
|-------|-------|-------|
| `--accent-lime` | `#E0EE6E` | Rare emphasis: "now live", urgency dots |

### Status (unchanged Tailwind defaults — `red-*` for errors, etc.)

## Typography

Three Google fonts, loaded via `next/font` with CSS variables, registered in
`@theme` so Tailwind utilities (`font-sans`, `font-mono`, `font-display`) pick
them up.

| Role | Font | Variable | Usage |
|------|------|----------|-------|
| Display | **Space Grotesk** (500/600/700) | `--font-display` | Modal titles, page headings |
| Body | **Inter** (400/500) | `--font-sans` (default) | UI text, paragraphs, buttons |
| Mono | **JetBrains Mono** (400/500/700) | `--font-mono` | Item codes, IDs, log lines, level badges, stage labels |

Body remains 14–15px; mono labels stay at 10–11px with uppercase + wide tracking,
matching the existing operator-console look.

## Spacing & Layout

Unchanged. The board grid, modal max-width, and card padding all stay as-is.
The only spacing-adjacent tweak: borders are now `zinc-800` over `zinc-950`,
giving roughly the same contrast as before but with a faint petrol cast.

## Border Radius

Unchanged — flat right angles everywhere, matching beerventures' "code flow"
philosophy. No rounded buttons, no soft cards.

## Shadows

None. Surface separation comes from background contrast and 1px borders.

## The One Thing

A petrol-warm dark with one gold accent for "the user is needed" and a lime
glint for "this just changed live". Everything else is monochrome cream-on-ink.

## Anti-Patterns

- No teal/emerald greens that fight petrol. The "active" green IS petrol now.
- No pure black (`#000`) and no pure white (`#fff`). Always cream/ink-petrol.
- No drop shadows. Use `border-zinc-800` for separation.
- No `rounded-lg`/`rounded-xl`. Sharp corners or `rounded-full` (badges) only.
- No more than one gold element on screen at once.
