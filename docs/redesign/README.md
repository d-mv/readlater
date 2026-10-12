# Braun redesign (app 0.7.0)

Read Later follows the Braun / Dieter Rams design language shared by
kairos-v2 (source of truth: `kairos-v2/docs/redesign/kairos-tokens.css` and
`kairos-redesign.html`), drive_read and forth-circle-ims. It replaces the
Flat BeOS pixel style of 0.4.0 (spec and prototype in git history before this
change).

## Principles applied

- **Less, but better.** Three surface depths only — `recessed` (wells,
  inputs, code), `canvas` (the enclosure), `raised` (dialogs, cards, the
  reading page). Depth is a tone shift plus a hairline, never a shadow.
- **2px corners.** A manufacturing tolerance, not a style.
- **One signal colour.** Signal red marks reading progress, failures, errors
  and destructive actions. Primary actions are ink-filled; links in articles
  are ink with a hairline underline; tags carry their colour only as a 6px
  square marker (kairos area markers).
- **Labels are instruments.** Every label, tab, button, byline and metadata
  row is IBM Plex Mono, uppercase or tabular, letterspaced (`label` / `num`
  utilities).
- **Dark is a dimmed panel,** warm graphite with the red lifted — not an
  inversion.

## Type

| Role | Face |
|---|---|
| Interface | Space Grotesk (variable) |
| Labels, metadata, numerals | IBM Plex Mono 400/500 |
| Article text (`.prose`) | Literata (variable) — as drive_read |

Scale (62.5% root): 10 / 11 / 13 / 14 / 17 / 22 / 26px. The kairos sheet's
30px `xl` is lowered to 26px for article titles on phones.

## Deviations from kairos-v2

- No sidebar / rail: Read Later is a single column (640px list, 680px
  reader) with hairline edges from `sm` up.
- `xl` is 26px (see above); `base` stays 14px.
- The reading page sits on `raised` (lightest) rather than `canvas`, so long
  text gets the brightest, calmest surface.
- `ink-muted` and `ink-faint` keep the kairos hue but are darker (lighter in
  dark mode) so both clear WCAG AA 4.5:1 on every surface; kairos's faint
  was ~2.5:1 (app 0.8.0).
- On phones (below `sm`) list titles and metadata, tabs and tag pills are a
  step larger than on desktop (app 0.7.1).
