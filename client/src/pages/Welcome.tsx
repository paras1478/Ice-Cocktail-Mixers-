import { ArrowRight } from "lucide-react";

/** The dark welcome screen from the design ("Keep it cool."). It is shown once per browser session before the shop; see WelcomeGate in App.tsx. */
export default function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <main className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#30261f] text-[#f8f5ed]" aria-label="Welcome">
      {/* soft amber glow behind the photos */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_38%,rgba(109,75,44,0.34),rgba(109,75,44,0)_55%)]" aria-hidden />

      <header className="flex items-start justify-between px-6 pt-6 sm:px-12 sm:pt-8">
        <div aria-label="Ice and Cocktail Mixers Express" className="leading-none">
          <p className="font-script relative text-[26px] sm:text-4xl">
            <span>Ice</span>
            <span className="text-[#e5ad52]" aria-hidden>&amp;</span>
            <span className="-ml-1 block pl-5 sm:pl-7">Cocktail</span>
          </p>
          <p className="mt-2 text-[9px] font-extrabold uppercase tracking-[0.22em] text-[#c9bdaf] sm:text-[11px]">Mixers Express</p>
        </div>
        <p className="max-w-[7.5rem] text-right text-[9px] font-bold uppercase leading-snug tracking-[0.17em] text-[#c9bdaf] sm:max-w-[11rem] sm:text-[11px]">Chilled essentials delivered</p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-4 pt-6 text-center">
        {/* two tilted photo cards */}
        <div className="relative h-[270px] w-full max-w-[640px] sm:h-[340px]" aria-hidden>
          {/* cut-outs exported from the design: already rotated, with transparent corners */}
          <img src="/img/welcome-card-drinks.webp" alt="" width={843} height={687} fetchPriority="high"
            className="absolute left-0 top-[5%] w-[62%] opacity-50 drop-shadow-[0_28px_40px_rgba(13,8,5,0.5)]" />
          <img src="/img/welcome-card-bucket.webp" alt="" width={715} height={668}
            className="absolute right-0 top-0 w-[53%] opacity-50 drop-shadow-[0_28px_40px_rgba(13,8,5,0.5)]" />
          <span className="absolute left-1/2 top-1/2 h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e5ad52]/10 blur-[110px]" />
        </div>

        <p className="mt-2 font-serif text-[10px] uppercase tracking-[0.24em] text-[#e5ad52] sm:text-xs" style={{ fontFamily: '"Instrument Serif", serif' }}>Everything for a better pour</p>
        <h1 className="font-script mt-3 whitespace-nowrap text-[64px] leading-[0.85] tracking-[-0.045em] sm:text-[86px]">
          Keep it <span className="text-[#e5ad52]">cool.</span>
        </h1>
        <p className="mt-5 max-w-[21rem] text-[15px] leading-relaxed text-[#c9bdaf]">Premium ice, mixers, beverages and cocktail essentials, ready when you are.</p>
        <button type="button" onClick={onStart} autoFocus
          className="mt-7 inline-flex items-center gap-4 rounded-full bg-[#e5ad52] py-3.5 pl-6 pr-5 text-xs font-bold uppercase tracking-[0.08em] text-[#30261f] shadow-[0_12px_36px_rgba(13,8,5,0.25)] transition hover:brightness-105 active:scale-[0.98]">
          Start ordering <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <footer className="flex items-center justify-center gap-3 px-5 pb-6 text-[9.6px] font-extrabold uppercase tracking-[0.18em] text-[#8f8275]">
        <span>Ice</span><span className="h-[3px] w-[3px] rounded-full bg-[#e5ad52]" aria-hidden />
        <span>Mixers</span><span className="h-[3px] w-[3px] rounded-full bg-[#e5ad52]" aria-hidden />
        <span>Beverages</span>
      </footer>
    </main>
  );
}
