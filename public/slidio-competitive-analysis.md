# Slidio — Competitive Analysis & Feature Overview
## Internal Knowledge Base Document · June 2026

---

## What Is Slidio

Slidio is an AI-native presentation editor built around a **three-phase multi-agent pipeline**:

1. **Phase 1 — Planner**: A dedicated AI agent reads your knowledge base, asks clarifying questions (audience, depth, goal), and produces a structured slide-by-slide plan that you approve before anything is built.
2. **Phase 2 — Content Agent**: Executes the approved plan using Claude Agent SDK with prompt caching, building 2–3 slides per batch with progressive rendering — slides appear on-canvas in real-time as they are generated.
3. **Phase 3 — Layout Pass**: A second agent does a pure visual-polish pass: fixes overlaps, evens margins, resolves spacing issues — without touching content.

This pipeline is fundamentally different from every competitor: **the user approves the plan before a single slide is built**, and the content and layout concerns are separated into distinct agents with distinct responsibilities.

---

## Slidio's Core Capabilities

### Knowledge Graph Engine
- Upload DOCX, PDF, or text — documents are chunked and passed through an LLM extraction pipeline
- Extracts **Topics**, **Claims**, and **Metrics** as structured graph nodes with confidence scores and evidence text
- Graph-following retrieval: SUPPORTED_BY edges link knowledge nodes back to the exact source chunks, so the agent works from verbatim document passages — not invented summaries
- Knowledge nodes can be approved, rejected, or annotated; approved nodes are boosted in retrieval scoring
- Deck Mapping: after building, each slide element is linked to the knowledge node it expresses (EXPRESSES / REPRESENTS edges), so knowledge-to-slide traceability is built-in

### Agent Editing Loop
- Precision element-level edits: users describe changes in natural language; the agent applies JSON patch operations on specific elements
- Checkpoint / revert: every user message captures a deck snapshot before running; users can revert the deck to any prior state
- Multi-turn continuations: agent sessions are resumable after pause, clarification, or interruption
- Scope detection: agent automatically determines whether a request targets the active slide, selected slides, or the full deck
- Effort routing: a lightweight router LLM classifies each instruction and selects effort level (medium → high → xhigh) before spawning the agent

### Token Efficiency (Industry-Leading)
- Anthropic prompt caching on all system prompts: router, extractor, deck mapper, and Phase 2 system context
- Phase 2 system context (plan + knowledge, ~17k tokens) lives in the cached system prompt — not the user message — so it is sent once and cached at 90% discount across all 20–30 turns of a build
- Effort: medium for Phase 2 and Phase 3 (no extended thinking per tool call)
- Token prediction UI: each phase shows predicted token range and cost before starting, then updates with actual vs predicted when done

### Design System Support
- Teams can load a design system (brand colors, typography, component rules)
- When a design system is present, the agent's style layer is replaced with the team's brand tokens
- Phase 1 planner extracts title/header style from the design system tokens and enforces it across all slides

### Collaboration
- Hub: shared knowledge graph across team members
- Role-based access (viewer / editor / admin) with per-hub permission model
- Pinned deck comments
- Knowledge node review workflow (approve / reject / candidate)

---

## Competitor Analysis

### Gamma (gamma.app)
**Funding / Scale:** $68M Series B (Andreessen Horowitz, Nov 2025) · $2.1B valuation · $100M ARR · 52 employees

**What they do well:**
- Fastest time-to-deck: a single prompt generates a complete presentation in under 60 seconds
- Card-based editor with flexible modular layouts (grids, timelines, comparison boxes)
- Web-native format: share via link, embed live websites and videos within slides
- Gamma Agent (2026): conversational chatbot for restyle/rewrite commands
- Multi-format: presentations, documents, and web pages from the same tool
- SOC 2 Type II certified (Oct 2025)
- Generous free tier (400 credits)

**Key limitations vs Slidio:**
- No plan approval gate: the AI builds immediately from your prompt — you get what you get, then iterate
- No knowledge graph: context comes from the prompt only; no document ingestion pipeline with structured extraction
- One-shot generation, not an agent loop: the "Gamma Agent" is a chat interface on top of the same one-shot model, not a multi-turn tool-using agent
- No element-level precision: edits are card-level or text-level, not individual element patches
- No checkpoint / revert system
- No token efficiency transparency: no visibility into what the AI is spending
- Content and layout mixed in one pass: no separation between "what this slide says" and "how it looks"

**Pricing:** Free / Plus $10/mo / Team $20/user/mo / Enterprise custom

---

### Beautiful.ai
**What they do well:**
- Smart templates with auto-reflow: as you add content, elements automatically resize and reposition to maintain readability
- Outline-first AI workflow (Context-Aware Workflow, March 2026): generates a structured outline you review before the slides are built — closest to Slidio's plan-approval model among competitors
- Wide library of slide types (timeline, team intro, comparison, chart) with layout intelligence per type
- Clean, consistent visual output

**Key limitations vs Slidio:**
- No knowledge graph: AI works from your typed outline, not uploaded documents
- No agent loop: one-shot generation per slide type; no multi-turn execution
- No progressive rendering: deck appears when generation is complete
- No precision element editing: you edit within template constraints, not at the element level
- No checkpoint / revert
- No design-system enforcement: brand kit is applied per-template, not enforced by an agent
- Pricing from $12/month

---

### Canva Magic Design
**What they do well:**
- Enormous asset library (photos, icons, brand elements, videos)
- Brand Kit: company colors, fonts, and logos applied consistently across slides
- Deep collaboration for large teams
- Magic Design generates a full deck from a brief prompt using the Canva asset library
- Strong for marketers creating highly visual, campaign-aligned decks

**Key limitations vs Slidio:**
- Design-first, content-second: AI prioritizes visual aesthetics over narrative logic
- No knowledge graph: all context is from the prompt
- No agent editing loop: Magic Design is one-shot; further edits are manual in the drag-and-drop editor
- No plan approval gate
- No token/cost transparency
- No checkpoint / revert
- AI features shallow on enterprise plans compared to dedicated AI-first tools
- Pro $12/mo / Team $40/user/mo

---

### Microsoft Copilot for PowerPoint
**What they do well:**
- Deep integration with the Microsoft 365 ecosystem (OneDrive, Teams, Word, Excel)
- Works within the familiar PowerPoint environment for users who need .pptx output natively
- Summarize documents from Word directly into slides

**Key limitations vs Slidio:**
- Very expensive: $30/user/month on top of existing Microsoft 365 license
- Design quality is poor: generated slides rely heavily on standard PowerPoint templates with limited visual variety
- No real agent loop: Copilot is a text-transform layer, not a multi-turn reasoning agent
- Editing is shallow: can rewrite sentences, cannot reorganize slide structure or rethink ideas
- 30–40 minutes of manual formatting cleanup required to reach client-ready standard on a professional deck (per independent reviews)
- No knowledge graph
- No plan approval gate
- No token efficiency or transparency

---

### Google Gemini for Slides (formerly Duet AI)
**What they do well:**
- Native integration in Google Workspace (Docs, Drive, Meet)
- Gemini can summarize Docs into slide outlines
- Image generation within slides
- Free on Workspace plans

**Key limitations vs Slidio:**
- Design logic is weak: generates slides with poor structure — images placed without supporting the text narrative
- No agent editing loop; Gemini is a side-panel assistant, not an autonomous agent
- No knowledge graph or document extraction pipeline
- No plan approval gate
- No checkpoint / revert
- Layout and content quality far below Gamma or Beautiful.ai

---

### Claude Design (Anthropic Labs, launched April 2026)
**What they do well:**
- Powered by Claude Opus 4.7 — highest reasoning quality of any competitor
- Reads your codebase and design files to build a design system during onboarding
- Can output actual .pptx files, PDFs, and standalone HTML — not just SVG previews
- Exports to Canva for further design editing
- Polished visual quality, especially for one-pagers and brand decks

**Key limitations vs Slidio:**
- No three-phase pipeline: generates in one shot (no plan approval, no separate layout pass)
- No knowledge graph: works from the conversation context, not a structured document extraction pipeline
- No progressive rendering (slides appear when generation is complete)
- No checkpoint / revert
- No per-element editing loop: once generated, further edits require re-prompting the full deck
- No token cost transparency
- Still an Anthropic Labs product (not GA) — limited availability and no enterprise SLA yet

---

### Figma Slides
**What they do well:**
- Native integration with Figma Design: embed live prototypes, design components, and FigJam boards directly in slides
- Collaboration features built for design teams: co-presenting, live polls, voting, alignment scales
- AI First Draft from a FigJam board: converts a whiteboard to a slide deck
- Translate, rewrite tone, generate images — all within slides
- Included at no extra cost on all Figma plans including free

**Key limitations vs Slidio:**
- AI is assistive, not agentic: features like rewrite, translate, and image generation are individual actions, not a multi-turn agent loop that builds a full deck
- No knowledge graph or document extraction
- No plan approval gate
- No checkpoint / revert system
- Strong for design teams already in the Figma ecosystem; weak for business users who need content-first AI generation
- Not a standalone presentation tool: requires Figma subscription and ecosystem buy-in

---

## Competitive Positioning Summary

| Feature | Slidio | Gamma | Beautiful.ai | Canva | Copilot | Gemini | Claude Design | Figma Slides |
|---|---|---|---|---|---|---|---|---|
| Plan approval gate | ✅ | ❌ | Partial | ❌ | ❌ | ❌ | ❌ | ❌ |
| Knowledge graph (doc ingestion) | ✅ | ❌ | ❌ | ❌ | Partial | Partial | ❌ | ❌ |
| Multi-turn agent loop | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Progressive canvas rendering | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Separate layout pass | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Element-level precision editing | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Checkpoint / revert | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Token cost transparency | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Prompt caching / efficiency | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Design system enforcement | ✅ | Partial | Partial | Partial | ❌ | ❌ | ✅ | ✅ |
| Hub collaboration | ✅ | Team plan | Team plan | ✅ | ✅ | ✅ | ❌ | ✅ |
| PPTX export | ✅ | ✅ | ✅ | ✅ | Native | Native | ✅ | ✅ |
| Web-native sharing | Partial | ✅ | ❌ | Partial | ❌ | ❌ | ✅ | ❌ |
| Free tier | ❌ | ✅ | ❌ | ✅ | ❌ | Workspace | ❌ | ✅ |

---

## Slidio's Unique Value Proposition

**"The only AI presentation tool where you approve the plan before it builds — with a knowledge graph that ensures every fact in your deck traces back to a source document."**

Three things no competitor offers simultaneously:
1. **Plan-before-build with human approval** — you see the slide-by-slide structure, adjust it, then trigger the build. Not a black box.
2. **Knowledge graph with traceability** — uploaded documents are structurally indexed; every claim in the deck links back to the source passage that generated it.
3. **Separation of content and layout agents** — the content agent writes what each slide says; the layout agent fixes how it looks. Two models, two passes, dramatically better output.

**Target customer:** Professionals and teams who need decks from their own proprietary content — not generic AI-generated filler — and who care about accuracy, traceability, and brand consistency over raw generation speed.
