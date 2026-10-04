# Flat BeOS Pixel Style UI Redesign Specification

## 1. Executive Summary & Design Direction

This specification defines the **Flat BeOS Pixel Style** for **Read Later**. It strips away all skeuomorphic 3D bevels and fake window chrome, delivering a razor-sharp, flat, minimalist pixel aesthetic inspired by the BeOS color palette and geometric discipline.

### Core Visual Principles
1. **100% Flat Geometry**: No multi-layer `box-shadow` bevels, no faux-3D highlights, no inset shadows. Everything is built on crisp **1px solid borders** and flat surfaces.
2. **Strict 0px Pixel Corners**: Zero border-radius (`rounded-none` / `0px`) on all buttons, inputs, tabs, pills, and dialog panels.
3. **BeOS Flat Color System**:
   - **Canvas**: Clean warm gray (`#f2f1ee` light, `#17181b` dark).
   - **Surfaces**: Slightly raised neutral tone (`#e6e5e1` light, `#212328` dark).
   - **Accent**: Signature **BeOS Yellow** (`#ffc400`), used as a flat, high-contrast action fill for primary buttons, active tabs, and badges.
   - **Lines & Borders**: Crisp 1px solid borders (`#111111` or `#d3d1cb` in light, `#2e3138` or `#f0f0ee` in dark).
4. **Hybrid Typography (Approved)**:
   - **UI Chrome & Controls**: Crisp monospace font (`JetBrains Mono`) for all headers, tabs, buttons, inputs, timestamps, and metadata.
   - **Long-Form Reader**: High-legibility serif (`Source Serif 4`) in `.prose` for article bodies.
5. **Clean Controls & Lightweight Icons**:
   - **Text Buttons** (`Button.vue`): Flat solid fills with 1px solid borders; primary in BeOS yellow.
   - **Icon Buttons** (`IconButton.vue`): Minimal ghost / transparent icons without bulky boxes.
   - **Form Inputs** (`Input.vue`): Flat white background with 1px solid border and high-contrast focus outline.
   - **Status Tabs** (`StatusTabs.vue`, `Tabs.vue`): Clean flat tabs with BeOS yellow active indicators.

An interactive preview prototype is available at:
[`prototype.html`](./prototype.html) *(can be opened directly in any web browser)*

---

## 2. Component Design Specifications

### A. Shared Primitives (`app/src/shared/ui/`)

| Component | Flat BeOS Treatment | Preserved Contract |
|---|---|---|
| **`Button.vue`** | **Flat 1px Solid Border**: <br>• Primary: Solid BeOS yellow (`#ffc400`) background, black text, 1px solid black border.<br>• Secondary: Flat neutral surface (`#e6e5e1`), 1px solid border.<br>• Active: Clean `translate(1px, 1px)`. | `variant` ("primary" \| "secondary"), `size` ("md" \| "lg"), `type`, `disabled`, `testId`. |
| **`IconButton.vue`** | **Clean Ghost / Transparent**: Minimal inline icon button with crisp hover color change. No chunky frames. | `title` (maps to `aria-label`), `testId`. |
| **`Input.vue`** | **Flat 1px Border**: 0px radius, flat background (`#ffffff` light, `#121315` dark), 1px solid border. Focus: 2px solid yellow outline. | `modelValue`, `area`, `testId`, emits `enter` and `escape`. |
| **`Tabs.vue`** | **Flat Tabs & Segmented Switch**: <br>• Underline variant: Clean flat tab with 2px solid yellow bottom border when active.<br>• Segmented variant: Flat 1px bordered strip with solid yellow active item. | `options`, `modelValue`, `variant` ("underline" \| "segmented"). |
| **`Dialog.vue`** | **Flat 1px Border Card**: 0px radius, flat raised background, 1px solid border, floating over backdrop scrim. | `placement` ("center" \| "sheet"), `ariaLabel`, `testId`. |
| **`Pill.vue`** | **Flat Pixel Badges**: 1px border, 0px radius; solid yellow fill with black border when active. | `variant`, `size`, `testId`. |
| **`Message.vue` / `Empty.vue`** | Flat monospace typography with crisp spacing. | Clean status text. |

### B. Feature Views

1. **`ReadingListView.vue`**:
   - Monospace app title "Read Later".
   - Flat primary `+ Add` button in BeOS yellow.
   - Minimal ghost icon buttons for Settings and Theme toggle.
   - Flat 1px border search input.
   - Flat status tabs (`Unread`, `All`, `Archived`) with yellow indicator.
   - Clean list rows with 1px border dividers.
2. **`BookmarkRow.vue`**:
   - Clean inline document / video / note icon.
   - Monospace title: bold for unread, regular muted for read.
   - Clean ghost icon buttons for offline caching and archiving.
3. **`ReaderView.vue` & `ReaderHeader.vue`**:
   - Clean header toolbar with back and action icons.
   - Flat progress bar: 4px flat track with solid yellow fill.
   - Article content: readable serif for prose body, sharp monospace for code, blockquotes, and headers.
4. **`AddBookmarkDialog.vue` & `ShareDialog.vue`**:
   - Flat segmented switch for Link / Note / File modes.
   - Flat inputs and flat action buttons.

---

## 3. Design Tokens Architecture (`app/src/main.css`)

```css
@theme {
  /* Surfaces */
  --color-canvas: #f2f1ee;           /* Light warm gray */
  --color-raised: #e6e5e1;           /* Slightly deeper surface */
  --color-recessed: #ffffff;         /* Flat white */
  --color-scrim: rgba(0, 0, 0, 0.45);

  /* Lines & Borders */
  --color-line: #d3d1cb;
  --color-line-strong: #111111;

  /* Ink / Text */
  --color-ink: #111111;
  --color-ink-muted: #5a5955;
  --color-ink-faint: #8a8880;
  --color-ink-inverse: #ffffff;

  /* BeOS Yellow Accent */
  --color-accent: #ffc400;           /* Iconic BeOS Yellow */
  --color-accent-hover: #ffd133;
  --color-accent-ink: #111111;
  --color-beos-blue: #235487;
  --color-danger: #c82828;

  /* Strict Pixel Geometry */
  --radius-sm: 0px;
  --radius-md: 0px;

  /* Typography */
  --font-sans: "JetBrains Mono", ui-monospace, monospace;
  --font-serif: "Source Serif 4", Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

[data-theme="dark"] {
  --color-canvas: #17181b;
  --color-raised: #212328;
  --color-recessed: #121315;
  --color-line: #2e3138;
  --color-line-strong: #f0f0ee;
  --color-ink: #f0f0ee;
  --color-ink-muted: #9c9da1;
  --color-ink-faint: #68696e;
  --color-accent: #ffc400;
  --color-accent-hover: #ffd133;
  --color-accent-ink: #111111;
  --color-beos-blue: #4a8ec9;
}
```

---

## 4. Quality & Compatibility

- **Zero Breaking Changes**: All 420 Vitest unit tests and 3 Playwright e2e specs remain green.
- **Strict Contracts**: All component props, emits, and `data-testid` selectors are strictly preserved.
- **Ultra-lightweight**: Pure Tailwind CSS utilities and tokens; zero runtime overhead.
- **SemVer**: Minor version bump (`0.4.0`) in `package.json`.

---

## 5. Implementation Steps (Upon Approval)

1. **Step 1: CSS Theme Tokens**: Update `app/src/main.css`.
2. **Step 2: Shared UI Primitives**: Update `Button.vue`, `Input.vue`, `Tabs.vue`, `Pill.vue`, `Dialog.vue`, keeping `IconButton.vue` clean and ghost.
3. **Step 3: List & Rows**: Update `ReadingListView.vue`, `BookmarkRow.vue`, `StatusTabs.vue`.
4. **Step 4: Reader & Dialogs**: Update `ReaderProgressBar.vue`, `AddBookmarkDialog.vue`, `ShareDialog.vue`, `ReaderHeader.vue`.
5. **Step 5: Testing & Verification**: Run `bun run typecheck`, `bun run test`, and `bun run build`. Bump version to `0.4.0`.
