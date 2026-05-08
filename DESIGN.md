---
name: Agent Observatory
description: Dense telemetry dashboard for OpenCode and agent usage.
colors:
  void-black: "#050505"
  surface-raised: "#0a0a0a"
  surface-panel: "#0f0f0f"
  surface-hover: "#161616"
  accent-blue: "#3b82f6"
  accent-blue-bright: "#60a5fa"
  accent-blue-soft: "#93c5fd"
  text-primary: "#f2f2f2"
  text-secondary: "#b3b3b3"
  text-tertiary: "#737373"
  grid-line: "#1f1f1f"
  grid-line-bright: "#2a2a2a"
  success: "#22c55e"
  warning: "#f59e0b"
  danger: "#ef4444"
typography:
  display:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "0"
  headline:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0"
  title:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.15em"
  body:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.1em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
rounded:
  none: "0"
  sm: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-default:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.none}"
    padding: "0.5rem 1rem"
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "0.65rem 1rem"
  panel:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "1rem"
  table-cell:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.none}"
    padding: "0.625rem 1rem"
---

# Design System: Agent Observatory

## 1. Overview

**Creative North Star: "Instrument Console"**

Agent Observatory should feel like a precise developer instrument: compact, dark, measured, and built for repeated scanning. The current system uses dark tonal layers, thin borders, uppercase section labels, mono numerals, and a restrained blue accent to keep attention on cost, tokens, latency, and tool outcomes.

The interface rejects marketing gloss. No decorative hero treatment, no ornamental cards, no generic analytics spectacle. The product can be dense, but density should be organized through panels, section headers, tables, and charts with clear rhythm.

**Key Characteristics:**

- Dark operational surface with subtle tonal separation.
- Blue accent reserved for active emphasis, links, chart focus, and selected values.
- Mono numerals and compact uppercase labels for telemetry readability.
- Flat panels with thin borders instead of heavy shadows.
- Dense data views with predictable grids and table behavior.

## 2. Colors

The palette is restrained: near-black surfaces, muted white text, fine grid lines, and one cool blue accent. Semantic colors appear only when state or risk needs to be legible.

### Primary

- **Telemetry Blue** (`#3b82f6`): Primary accent for active values, chart lines, focused links, and high-salience metric numbers.
- **Bright Telemetry Blue** (`#60a5fa`): Hover or stronger accent state, used sparingly.
- **Soft Telemetry Blue** (`#93c5fd`): Secondary chart or supporting data color.

### Secondary

- **Success Green** (`#22c55e`): Positive operational state such as tool success and cache health.
- **Warning Amber** (`#f59e0b`): Elevated attention, trend warnings, Hermes highlights, and partial failure states.
- **Failure Red** (`#ef4444`): Error rate, failed commands, and destructive or broken outcomes.

### Neutral

- **Void Black** (`#050505`): Page background. Use a tinted near-black rather than pure black for new surfaces.
- **Raised Surface** (`#0a0a0a`): Tooltips, input backgrounds, and nested tonal regions.
- **Panel Surface** (`#0f0f0f`): Primary panels, top nav, stat cards, chart containers, and tables.
- **Hover Surface** (`#161616`): Row hover, nav hover, and button hover.
- **Primary Text** (`#f2f2f2`): Main values and high-confidence labels.
- **Secondary Text** (`#b3b3b3`): Body copy, normal table cells, and supporting numbers.
- **Tertiary Text** (`#737373`): Metadata, labels, subtitles, and low-emphasis table context.
- **Grid Lines** (`#1f1f1f` / `#2a2a2a`): Dividers, panel borders, table rules, chart grid lines.

### Named Rules

**The One Accent Rule.** Blue is the default accent and should stay rare. Introduce semantic colors only for state, not decoration.

**The Tinted Neutral Rule.** New dark surfaces should use near-black values with slight lift. Avoid pure `#000000` and pure `#ffffff` in new UI work.

## 3. Typography

**Display Font:** DM Sans with system sans fallbacks  
**Body Font:** DM Sans with system sans fallbacks  
**Label/Mono Font:** JetBrains Mono with system mono fallbacks

**Character:** The typography is compact and technical without feeling like a terminal clone. DM Sans carries the product shell and section hierarchy, while JetBrains Mono is reserved for values, IDs, timestamps, code-like content, and chart annotations.

### Hierarchy

- **Display** (400, `1.875rem` to `2.25rem`, `0.95` line-height): Page titles and major route headers.
- **Headline** (700, `1.5rem` to `2.25rem`, `1` line-height): Primary metric values and chart center numbers.
- **Title** (500, `0.75rem`, uppercase, `0.15em` letter-spacing): Section titles and panel labels.
- **Body** (400, `0.875rem`, `1.5` line-height): Table content, supporting descriptions, and normal UI text.
- **Label** (500, `0.65rem` to `0.75rem`, uppercase, `0.1em` to `0.32em` letter-spacing): Breadcrumbs, nav items, stat labels, time labels, and metadata.
- **Mono** (400 to 600, `0.65rem` to `1.5rem`): Token counts, cost values, model IDs, request IDs, timestamps, and code excerpts.

### Named Rules

**The Numeric Trust Rule.** Important numbers should use tabular or mono treatment when alignment or comparison matters.

**The Label Compression Rule.** Uppercase labels are allowed because the product is dense, but they must stay short and should not become prose.

## 4. Elevation

The system is flat by default. Depth comes from tonal layering, borders, sticky table headers, and chart focus states rather than large shadows. Tooltips are the main exception because they float over charts and need separation from dense backgrounds.

### Shadow Vocabulary

- **Tooltip Float** (`0 4px 20px rgba(0, 0, 0, 0.5)`): Use only for transient overlays such as chart tooltips.

### Named Rules

**The Border-First Rule.** Use one-pixel borders and tonal contrast before shadows. Shadows are for overlays, not permanent panels.

## 5. Components

### Buttons

- **Shape:** Rectangular with no radius (`0`) to match the instrument-panel language.
- **Default:** Transparent background, thin bright grid border, secondary text, uppercase label, `0.5rem 1rem` padding.
- **Primary:** Accent-blue fill for authentication or clear primary submission actions.
- **Hover / Focus:** Move from secondary to primary text, lift border toward accent blue, and use hover surface. Keep transitions around `150ms`.
- **Disabled / Loading:** Preserve size, reduce contrast, and avoid layout shift.

### Chips

- **Style:** Small uppercase labels with thin borders and muted text. Provider badges use transparent fill and accent-dim border.
- **State:** Active filter chips may use accent border or subtle hover background, but inactive chips should stay neutral.

### Cards / Containers

- **Corner Style:** Square corners by default.
- **Background:** Panel surface (`#0f0f0f`) for primary grouping, raised surface (`#0a0a0a`) for nested content only when necessary.
- **Shadow Strategy:** No resting shadows. Borders and background differences define containment.
- **Border:** One-pixel grid-line-bright border for panels, one-pixel grid-line border for internal separators.
- **Internal Padding:** `1rem` on mobile, `1.5rem` on wider screens. Nested compact panels can use `0.75rem`.

### Inputs / Fields

- **Style:** Raised dark background, thin bright grid border, primary text, mono where values are code-like.
- **Focus:** Accent-dim border or focus ring. Do not rely on color alone.
- **Error / Disabled:** Error text uses semantic red with clear copy; disabled states reduce contrast and keep dimensions stable.

### Navigation

- **Top Nav:** Compact horizontal nav with uppercase links, tertiary text, transparent resting state, hover surface, and bright grid border on hover.
- **Route Headers:** Breadcrumb plus large route title, supporting subtitle, and optional live time/status cluster.
- **Tabs / Filters:** Favor segmented or button-like controls with persistent selected state. Keep filter labels short.

### Tables

- **Headers:** Sticky where useful, uppercase `0.65rem` labels, tertiary text, bright bottom border.
- **Rows:** Secondary text, subtle bottom borders, hover surface for scan tracking.
- **Numbers:** Mono or tabular treatment for costs, durations, token counts, and percentages.
- **Overflow:** Horizontal scroll is acceptable for dense model and request tables.

### Charts

- **Background:** Charts sit in flat panels, not decorative frames.
- **Lines / Bars:** Accent blue for the primary series; semantic or secondary colors only when comparison requires it.
- **Grid:** Low-contrast grid lines that support reading without dominating.
- **Tooltips:** Raised dark tooltip, bright border, mono title, compact rows.

## 6. Do's and Don'ts

**Do**

- Use the existing CSS variables in `src/routes/layout.css` before inventing new tokens.
- Keep metric labels compact, specific, and close to their values.
- Use panels to group related data, not to decorate every individual fact.
- Preserve dense tables and charts when they help expert users compare quickly.
- Pair semantic color with text labels, symbols, or position.

**Don't**

- Do not add marketing-style hero sections, decorative gradient text, glass cards, or identical feature-card grids.
- Do not use side-stripe borders as colored accents.
- Do not add large border radii to core dashboard containers.
- Do not make charts colorful unless multiple series truly require distinction.
- Do not hide provenance for derived metrics. Model, time range, session, provider, or agent context should remain nearby.
