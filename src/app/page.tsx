import Link from "next/link";
import {
  Upload,
  MousePointerClick,
  Sparkles,
  Download,
  History,
  ShieldCheck,
  FileType2,
  ScanText,
  Palette,
  ListOrdered,
  Brain,
  GitBranch,
  Layers,
  Wand2,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { HeroActions } from "@/components/landing/HeroActions";
import { PricingSection } from "@/components/landing/PricingSection";

const FEATURES = [
  {
    icon: Upload,
    title: "Bring your real decks & PDFs",
    desc: "Upload corporate .pptx or .pdf files — fonts, layouts, colors, and lists come in as editable elements.",
  },
  {
    icon: MousePointerClick,
    title: "Tap any element",
    desc: "Select a single text box, image, or shape right in the slide preview. No fiddly menus.",
  },
  {
    icon: Sparkles,
    title: "2–5 word commands",
    desc: '"Shorten." "CFO-style." "3 bullets." Precise, element-level edits powered by AI.',
  },
  {
    icon: History,
    title: "Review before you commit",
    desc: "See proposed changes side by side. Apply or reject each edit, with full version history.",
  },
  {
    icon: Download,
    title: "Export clean PPTX",
    desc: "Download a polished PowerPoint that opens perfectly in Office and Google Slides.",
  },
  {
    icon: ShieldCheck,
    title: "Your files stay yours",
    desc: "Decks are scoped to your account. Sign in and pick up right where you left off.",
  },
];

const CONVERT_POINTS = [
  {
    icon: FileType2,
    title: "PDF in, editable slides out",
    desc: "Drop in a PDF presentation and Slidio rebuilds it as real PowerPoint slides — selectable text, shapes, and images, not flat screenshots.",
  },
  {
    icon: ScanText,
    title: "Text recovered with OCR",
    desc: "Even image-only and scanned PDFs become fully editable. OCR lifts every line into real text boxes you can rewrite or restyle.",
  },
  {
    icon: Palette,
    title: "Brand colors & gradients preserved",
    desc: "Theme palettes, solid fills, and gradient backgrounds are read from the source and carried over faithfully — your deck still looks like your deck.",
  },
  {
    icon: ListOrdered,
    title: "Lists stay structured",
    desc: "Numbered and bulleted lists are detected and rebuilt as proper list content, so you can keep editing them as lists instead of loose text.",
  },
];

const KNOWLEDGE_POINTS = [
  {
    icon: Layers,
    title: "Persistent knowledge layers",
    desc: "Capture your brand voice, product facts, and messaging rules once. Slidio feeds them to the AI on every edit so you never re-explain context.",
  },
  {
    icon: GitBranch,
    title: "Branch context by client or product",
    desc: "Knowledge branches keep separate contexts for each customer, product, or campaign — so an edit for one never bleeds into another.",
  },
  {
    icon: Brain,
    title: "Better context, sharper edits",
    desc: "With your facts, tone, and design system in scope, the AI makes on-brand, accurate changes to your decks and slides instead of generic guesses.",
  },
  {
    icon: Wand2,
    title: "Updates that stay on-message",
    desc: "Ask for a change in a few words. The AI grounds every update in your knowledge base, keeping numbers, names, and claims consistent.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Upload a deck or PDF",
    desc: "Drop in any .pptx or .pdf. Slidio parses every slide into selectable elements in seconds.",
  },
  {
    step: "02",
    title: "Tap and tell",
    desc: "Select an element and type a 2–5 word instruction. AI proposes the edit instantly.",
  },
  {
    step: "03",
    title: "Apply and export",
    desc: "Review the change, accept what you like, and export a pixel-faithful PowerPoint.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-[#0a0f1a] text-white">
      <LandingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0d1b2a] via-[#0a0f1a] to-[#0a0f1a]" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[140px]" />
        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#1e3a5f] bg-[#0d1b2a] px-3 py-1 text-xs font-medium text-slate-300">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            AI PowerPoint editing, element by element
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Edit any slide by
            <span className="block bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
              tapping and asking.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
            Slidio turns your PowerPoint — or even a locked PDF — into a workspace you can talk to.
            Select any object, give a few words of direction, and get a clean, on-brand edit
            grounded in your own knowledge base.
          </p>
          <div className="mt-10">
            <HeroActions />
          </div>
          <p className="mt-4 text-xs text-slate-500">
            No credit card to start · Free on your first deck
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-[#11233b] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Built for the way decks actually get edited
            </h2>
            <p className="mt-3 text-slate-400">
              Stop nudging text boxes by hand. Slidio gives you element-level control with the
              speed of natural language.
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-[#11233b] bg-[#0d1b2a]/50 p-6 transition-colors hover:border-[#1e3a5f] hover:bg-[#0d1b2a]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PDF → PPTX conversion */}
      <section id="convert" className="border-t border-[#11233b] bg-[#070c16] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr]">
            <div className="lg:sticky lg:top-24">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#1e3a5f] bg-[#0d1b2a] px-3 py-1 text-xs font-medium text-slate-300">
                <FileType2 className="h-3.5 w-3.5 text-violet-400" />
                PDF → PowerPoint, the editable way
              </span>
              <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Turn locked PDFs into decks you can
                <span className="block bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                  actually edit.
                </span>
              </h2>
              <p className="mt-4 max-w-xl text-slate-400">
                Most tools dump a PDF into your slides as flat images you can&apos;t touch. Slidio
                reconstructs the real thing — text, shapes, colors, and lists — so a PDF you were
                handed becomes a working deck in seconds.
              </p>
              <div className="mt-8">
                <HeroActions />
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {CONVERT_POINTS.map((point) => (
                <div
                  key={point.title}
                  className="rounded-2xl border border-[#11233b] bg-[#0d1b2a]/50 p-6 transition-colors hover:border-[#1e3a5f] hover:bg-[#0d1b2a]"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
                    <point.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">{point.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{point.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Knowledge management */}
      <section id="knowledge" className="border-t border-[#11233b] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#1e3a5f] bg-[#0d1b2a] px-3 py-1 text-xs font-medium text-slate-300">
              <Brain className="h-3.5 w-3.5 text-violet-400" />
              Knowledge-aware AI
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Give the AI the context it needs to get your edits right
            </h2>
            <p className="mt-3 text-slate-400">
              Generic AI guesses. Slidio remembers. Build a knowledge base of your brand, facts, and
              design rules — then every slide update is grounded in what your company actually
              stands for.
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {KNOWLEDGE_POINTS.map((point) => (
              <div
                key={point.title}
                className="rounded-2xl border border-[#11233b] bg-[#0d1b2a]/50 p-6 transition-colors hover:border-[#1e3a5f] hover:bg-[#0d1b2a]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
                  <point.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{point.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-[#11233b] bg-[#070c16] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              From upload to export in three steps
            </h2>
            <p className="mt-3 text-slate-400">No tutorials. No learning curve.</p>
          </div>

          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {STEPS.map((item) => (
              <div key={item.step} className="border-t border-[#1e3a5f] pt-6">
                <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-sm font-semibold text-transparent">
                  {item.step}
                </span>
                <h3 className="mt-3 text-xl font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* Final CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to edit smarter?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-slate-400">
            Upload your first deck and make your first AI edit in under a minute.
          </p>
          <div className="mt-8">
            <HeroActions />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#11233b] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold text-white">Slidio</span>
          </div>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Slidio. AI PowerPoint editing.
          </p>
          <div className="flex items-center gap-6 text-xs text-slate-400">
            <a href="#features" className="hover:text-white">
              Features
            </a>
            <a href="#convert" className="hover:text-white">
              PDF → PPTX
            </a>
            <a href="#knowledge" className="hover:text-white">
              Knowledge
            </a>
            <a href="#pricing" className="hover:text-white">
              Pricing
            </a>
            <Link href="/app" className="hover:text-white">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
