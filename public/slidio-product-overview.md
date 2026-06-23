# Slidio — Product Overview & Value Proposition
## Internal Knowledge Base Document · June 2026

---

## What Is Slidio

Slidio is an AI-native presentation editor that gives professionals and teams **element-level control over their slides** through natural language commands — without leaving the slide canvas.

The core idea: most AI presentation tools treat decks as black-box outputs. Slidio treats your deck as a **living workspace** — you select any element, type 2–5 words, and the AI edits exactly that thing. You review the proposal, accept it or don't, and keep a full revert history of everything.

**Tagline:** "Slidio turns your PowerPoint — or even a locked PDF — into a workspace you can talk to."

---

## Core Capabilities

### 1. Bring Your Real Decks & PDFs
Upload corporate .pptx or .pdf files. Fonts, layouts, colors, and lists come in as editable elements — not flat images. PDFs are rebuilt as real PowerPoint slides with selectable text, shapes, and images. Even scanned or image-only PDFs become fully editable through OCR.

- Brand colors & gradients preserved faithfully from source
- Numbered and bulleted lists detected and rebuilt as proper list content
- Text recovered from scanned documents with OCR

### 2. Tap-to-Select Element Editing
Select a single text box, image, or shape right in the slide preview. No fiddly menus or sidebars. Editing targets the exact element you selected — not the whole slide.

### 3. 2–5 Word Commands
Short, precise instructions: "Shorten." "CFO-style." "3 bullets." "Dark background." The AI proposes the edit and shows you a before/after diff before anything changes.

### 4. Review Before You Commit
Every AI edit is a proposal. See proposed changes side by side. Apply or reject each edit with one tap. Nothing is committed without your explicit approval.

### 5. Full Version History & Restore
Every user message captures a deck checkpoint before running. Revert the deck to any prior state in one click — full undo, not just Ctrl-Z.

### 6. Export Clean PPTX & PDF
Download a polished PowerPoint that opens perfectly in Microsoft Office and Google Slides. Fonts, layouts, and formatting are preserved exactly.

### 7. Your Files Stay Yours
Decks are scoped to your account. Files are never used for AI training. Sign in and pick up right where you left off.

---

## AI Agent Pipeline (Advanced Feature)

Slidio includes a three-phase AI agent pipeline for building complete decks from scratch:

**Phase 1 — Planner**
A dedicated AI agent reads your knowledge base, asks clarifying questions (audience, depth, goal, tone), and produces a structured slide-by-slide plan. You approve the plan before a single slide is built. Not a black box.

**Phase 2 — Content Agent**
Executes the approved plan using the Claude Agent SDK. Builds 2–3 slides per batch with progressive rendering — slides appear on-canvas in real-time as they are generated. Token-efficient: uses Anthropic prompt caching so the plan+knowledge context is sent once, not 20+ times.

**Phase 3 — Layout Pass**
A second agent does a pure visual-polish pass: fixes overlaps, evens margins, resolves spacing issues — without rewriting any content. Content and layout concerns are separated into two distinct agents.

This pipeline is unique: competitors generate one-shot. Slidio plans first, builds second, polishes third — with human approval gates between phases.

---

## Knowledge Base & Knowledge Graph

### Persistent Knowledge Layers
Capture your brand voice, product facts, and messaging rules once. Slidio feeds them to the AI on every edit so you never re-explain context. Knowledge is scoped by Hub (branch) so different clients or products have separate context that never bleeds into each other.

### Document Ingestion & Knowledge Graph
Upload DOCX, PDF, TXT, or Markdown documents to your Hub. Slidio's extraction pipeline:
1. Chunks the document into sections
2. Runs an LLM extraction pass that identifies **Topics**, **Claims**, and **Metrics** as structured knowledge nodes
3. Each node has a confidence score and links back to the exact source passage (evidence text)
4. Nodes can be approved, rejected, or annotated — approved nodes are weighted higher in retrieval

When the AI agent builds a deck, it retrieves the most relevant nodes from the graph for your current instruction — not raw document dumps. Every claim in the output traces back to a verified source passage.

### Design System Support
Teams can load a design system (brand colors, typography, spacing rules, component tokens). When present, the AI replaces its generic style guidance with your brand tokens — ensuring every generated slide is on-brand by default.

---

## Pricing

**Philosophy:** Every plan has the exact same features. The only difference is the monthly token budget — you only pay for how much you use.

| Plan | Monthly Price | Annual Price | Token Budget | Approx. AI Edits |
|---|---|---|---|---|
| Free | $0 | $0 | Limited | ~50 edits |
| Pro | $0.50/mo | $200/yr | Medium | ~500 edits |
| Max | $1.00/mo | $500/yr | Large | ~2,000+ edits |

*Tokens = units of AI work (input + output) across a single edit. Simple element-level commands are cheap; deck-wide builds use more.*

**All plans include:**
- Tap-to-select element editing
- 2–5 word AI commands
- Review, apply, or reject each change
- Full version history & restore
- Persistent knowledge layers
- Export clean PPTX & PDF

---

## Target Users

### Primary: Professionals Who Own Their Slides
- Sales executives who maintain pitch decks and need to update them constantly
- Consultants and analysts who produce client deliverables in PowerPoint
- Finance and strategy teams with branded deck templates and strict formatting requirements
- Marketing managers who need on-brand, accurate slide updates without a designer

### Secondary: Teams with Shared Knowledge
- Teams with a shared knowledge base (brand voice, product facts, client context)
- Organizations with design systems they want enforced across all decks
- Agencies managing multiple client presentation contexts simultaneously

### Not For
- Users who need a Canva-style visual design tool with millions of assets
- Teams that only need a one-shot "generate a deck from my prompt" experience with no editorial control
- Users who need to create websites, social posts, or documents (not just presentations)

---

## Key Differentiators vs. The Market

1. **You own every edit.** No AI generation happens without your explicit approval. Every change is a proposal you accept or reject.

2. **Element-level precision.** You select the exact text box, shape, or image you want to change — then describe the change. Competitors operate at the slide level at best.

3. **Knowledge that sticks.** Persistent knowledge layers mean you never re-explain your brand, product, or client context. Competitors start from scratch on every prompt.

4. **Three-phase agentic pipeline.** Plan first. Build second. Polish third. Human approval between phases. This produces dramatically better output than one-shot generation.

5. **Full revert history.** Every user action creates a checkpoint. You can revert the entire deck to any prior state — not just undo the last action.

6. **Token cost transparency.** The app shows predicted vs. actual token spend for each AI phase — so you know exactly what you're spending before it happens.

---

## Company & Product Stage

- Product: In active development as of June 2026
- Stack: Next.js, Anthropic Claude, Claude Agent SDK, Prisma/SQLite, NextAuth, Stripe
- Deployment: Vercel
- AI Models: Claude Sonnet 4.6 (primary), Claude Opus 4.7 (planning & complex reasoning)
- Status: Private beta / early access
