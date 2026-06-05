# Product

## Register

product

## Users

This dashboard is for developers and agent operators who use OpenCode, Codex, Claude, Hermes, and related LLM workflows enough that usage becomes something worth measuring. The user is technical, cost-aware, and often scanning telemetry between coding sessions rather than browsing casually.

Primary jobs:

- Understand where LLM spend, latency, and token volume are coming from.
- Compare models, providers, tools, sessions, and coding activity over time.
- Spot failed tools, expensive patterns, weak cache usage, and abnormal activity.
- Review conversation history when debugging agent behavior or explaining usage.

## Product Purpose

Agent Observatory turns raw LLM telemetry into an operational dashboard. It exists to make agent usage legible: what ran, what it cost, how fast it was, which models carried the work, which tools succeeded, and how usage changes over time.

Success means a developer can answer practical questions in seconds: "What changed today?", "Which model is driving cost?", "Are tools failing?", "How active was this project?", and "Which conversations produced the usage I am seeing?"

## Brand Personality

Precise, technical, restrained.

The product should feel like an instrument panel for serious work: dense enough for repeated use, quiet enough to stay readable, and explicit enough that metrics are trusted. The voice is direct and compact. Labels should prefer operational nouns over marketing phrasing.

## Anti-references

Avoid marketing-dashboard gloss: oversized hero cards, decorative gradients, generic SaaS illustrations, celebratory empty states, and vague "insights" copy. Avoid neon cyberpunk observability tropes, heavy glass effects, ornamental animation, and chart decoration that weakens data comparison.

Do not make the interface feel like a generic admin template. The data is developer telemetry, so the UI should keep a command-center density without becoming noisy or theatrical.

## Design Principles

1. **Data before decoration.** Visual treatment earns its place only when it improves scanning, comparison, or confidence.
2. **Operational density.** The product should support many metrics on screen, with enough rhythm and grouping to prevent fatigue.
3. **Trust the numbers.** Cost, token, latency, and success metrics must be formatted consistently and placed where they can be verified against related data.
4. **Expose provenance.** Model, provider, session, agent, and tool context should remain visible near derived metrics.
5. **Quiet urgency.** Failures, high spend, and abnormal trends should stand out without turning the whole surface into an alert wall.

## Accessibility & Inclusion

Target WCAG AA contrast for text and interactive controls. Do not encode success, warning, failure, or model identity by color alone; pair color with labels, values, icons, or position. Respect reduced motion by keeping reveal and shimmer effects short and nonessential. Preserve keyboard access for navigation, filters, tables, and retry actions.
