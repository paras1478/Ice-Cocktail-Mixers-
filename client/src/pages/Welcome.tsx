import { ArrowRight } from "lucide-react";

/**
 * The dark welcome screen ("Keep it cool."), shown once per browser session before the shop; see WelcomeGate in App.tsx.
 * Everything is real, crisp HTML sized from the viewport height (svh) so the whole screen fits a laptop without scrolling.
 * It plays a short intro like the landing video (cards drift in, then text and button rise) and then stays in place; see .wl-* in index.css.
 */
export default function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <main className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#1c0f08] text-[#f8f5ed]" aria-label="Welcome">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_40%,rgba(109,75,44,0.38),rgba(109,75,44,0)_58%)]" aria-hidden />

      <header className="flex items-start justify-between px-6 pt-6 sm:px-12 sm:pt-8 lg:px-20 lg:pt-[4svh]">
        <div aria-label="Ice and Cocktail Mixers Express" className="leading-none">
          <p className="font-script relative text-[26px] sm:text-4xl lg:text-[min(7svh,64px)]">
            <span>Ice</span>
            <span className="text-[#e0a444]" aria-hidden>&amp;</span>
            <span className="-ml-1 block pl-5 sm:pl-7 lg:pl-10">Cocktail</span>
          </p>
          <p className="mt-2 text-[9px] font-extrabold uppercase tracking-[0.22em] text-[#c9bdaf] sm:text-[11px] lg:text-[13px]">Mixers Express</p>
        </div>
        <p className="max-w-[7.5rem] text-right text-[9px] font-bold uppercase leading-snug tracking-[0.17em] text-[#c9bdaf] sm:max-w-[11rem] sm:text-[11px] lg:max-w-[15rem] lg:text-[13px]">Chilled essentials delivered</p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-2 pt-4 text-center">
        {/* two tilted photo cards (cut-outs exported from the design: already rotated, transparent corners) */}
        <div className="relative aspect-[1.88/1] w-full max-w-[640px] lg:w-[min(92vw,84svh)] lg:max-w-none" aria-hidden>
          <img src="/img/welcome-card-drinks.webp" alt="" width={843} height={687} fetchPriority="high"
            className="wl-card-l absolute left-0 top-[5%] w-[62%] drop-shadow-[0_28px_40px_rgba(13,8,5,0.5)]" />
          <img src="/img/welcome-card-bucket.webp" alt="" width={715} height={668}
            className="wl-card-r absolute right-0 top-0 w-[53%] drop-shadow-[0_28px_40px_rgba(13,8,5,0.5)]" />
          <span className="absolute left-1/2 top-1/2 h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e0a444]/10 blur-[110px]" />
        </div>

        <p className="wl-rise mt-2 text-[10px] uppercase tracking-[0.24em] text-[#e0a444] sm:text-xs lg:text-sm" style={{ fontFamily: '"Instrument Serif", serif', animationDelay: "0.9s" }}>Everything for a better pour</p>
        <h1 style={{ animationDelay: "1.05s" }} className="wl-rise font-script mt-3 whitespace-nowrap text-[64px] leading-[0.85] tracking-[-0.045em] sm:text-[86px] lg:text-[min(13svh,124px)]">
          Keep it <span className="text-[#e0a444]">cool.</span>
        </h1>
        <p style={{ animationDelay: "1.25s" }} className="wl-rise mt-4 max-w-[21rem] text-[15px] leading-relaxed text-[#c9bdaf] lg:max-w-[30rem] lg:text-lg">Premium ice, mixers, beverages and cocktail essentials, ready when you are.</p>
        <button type="button" onClick={onStart} autoFocus style={{ animationDelay: "1.45s" }}
          className="wl-rise mt-6 inline-flex items-center gap-4 rounded-full bg-[#e0a444] py-3.5 pl-6 pr-5 text-xs font-bold uppercase tracking-[0.08em] text-[#1c0f08] shadow-[0_12px_36px_rgba(13,8,5,0.25)] transition hover:brightness-105 active:scale-[0.98] lg:py-4 lg:pl-8 lg:pr-7 lg:text-sm">
          Start ordering <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <footer className="flex items-center justify-center gap-3 px-5 pb-5 text-[9.6px] font-extrabold uppercase tracking-[0.18em] text-[#8f8275] lg:pb-[3svh] lg:text-xs">
        <span>Ice</span><span className="h-[3px] w-[3px] rounded-full bg-[#e0a444]" aria-hidden />
        <span>Mixers</span><span className="h-[3px] w-[3px] rounded-full bg-[#e0a444]" aria-hidden />
        <span>Beverages</span>
      </footer>
    </main>
  );
}
