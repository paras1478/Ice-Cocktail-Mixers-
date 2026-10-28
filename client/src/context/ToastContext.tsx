import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

interface Toast { id: number; kind: "success" | "error"; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string) => void }
const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const api = useMemo<ToastApi>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="rise pointer-events-auto flex max-w-md items-center gap-2 rounded-full bg-header px-4 py-2.5 text-sm font-semibold text-on-header shadow-lift">
            {t.kind === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-badge" aria-hidden /> : <XCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}
