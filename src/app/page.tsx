import Link from "next/link";
import {
  Upload,
  MousePointerClick,
  Sparkles,
  Download,
  History,
  ShieldCheck,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { HeroActions } from "@/components/landing/HeroActions";
import { PricingSection } from "@/components/landing/PricingSection";

const FEATURES = [
  {
    icon: Upload,
    title: "Bring your real decks",
    desc: "Upload corporate .pptx files — fonts, layouts, and formatting are preserved exactly.",
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

const STEPS = [
  {
    step: "01",
    title: "Upload a deck",
    desc: "Drop in any .pptx. DeckPilot parses every slide into selectable elements in seconds.",
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
            DeckPilot turns your PowerPoint into a workspace you can talk to. Select any object,
            give a few words of direction, and get a clean, on-brand edit — without opening
            PowerPoint.
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
              Stop nudging text boxes by hand. DeckPilot gives you element-level control with the
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
            <span className="text-sm font-semibold text-white">DeckPilot</span>
          </div>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} DeckPilot. AI PowerPoint editing.
          </p>
          <div className="flex items-center gap-6 text-xs text-slate-400">
            <a href="#features" className="hover:text-white">
              Features
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
