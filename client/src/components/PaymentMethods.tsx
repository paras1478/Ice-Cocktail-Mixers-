import type { ComponentType } from "react";
import { Banknote, Check, CreditCard, Landmark, Smartphone, type LucideProps } from "lucide-react";

/** What the customer picked. UPI / card / net banking all pay through Razorpay (the order's payment method is ONLINE). */
export type PayChoice = "UPI" | "CARD" | "NETBANKING" | "COD";

interface Option {
  id: PayChoice;
  title: string;
  body: string;
  Icon: ComponentType<LucideProps>;
  online: boolean;
}

const OPTIONS: Option[] = [
  { id: "UPI", title: "UPI", body: "Google Pay, PhonePe, Paytm and other UPI apps", Icon: Smartphone, online: true },
  { id: "CARD", title: "Debit / credit card", body: "Visa, Mastercard, RuPay and more", Icon: CreditCard, online: true },
  { id: "NETBANKING", title: "Net banking", body: "Pay from your bank account", Icon: Landmark, online: true },
  { id: "COD", title: "Cash on delivery", body: "Pay in cash when your order arrives", Icon: Banknote, online: false },
];

interface Props {
  value: PayChoice;
  onChange: (v: PayChoice) => void;
  codOk: boolean;
  onlineOk: boolean;
  /** Why online payment is unavailable (shown instead of silently hiding it). */
  onlineNote?: string;
  disabled?: boolean;
}

/** Radio-card group. Unavailable methods stay visible with the reason, so a missing configuration is understandable and COD keeps working. */
export function PaymentMethods({ value, onChange, codOk, onlineOk, onlineNote, disabled }: Props) {
  const keys: PayChoice[] = OPTIONS.map((o) => o.id);
  const move = (from: PayChoice, delta: number) => {
    const enabled = OPTIONS.filter((o) => (o.online ? onlineOk : codOk)).map((o) => o.id);
    if (!enabled.length) return;
    const i = enabled.indexOf(from);
    onChange(enabled[(i + delta + enabled.length) % enabled.length]);
  };
  return (
    <div role="radiogroup" aria-label="Payment method" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map(({ id, title, body, Icon, online }) => {
        const available = online ? onlineOk : codOk;
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={!available || disabled}
            disabled={!available || disabled}
            tabIndex={selected || (!keys.includes(value) && id === "UPI") ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(id, 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(id, -1); }
            }}
            data-testid={`pay-${id}`}
            className={`relative flex items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              selected ? "border-accent bg-tint/70 shadow-sm ring-1 ring-accent" : "border-line bg-surface hover:border-accent/60"
            } ${available ? "" : "cursor-not-allowed opacity-60"}`}
          >
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${selected ? "bg-action text-on-action" : "bg-band text-ink-soft"}`}><Icon className="h-5 w-5" aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">{title}</span>
              <span className="mt-0.5 block text-xs text-muted">{available ? body : online ? onlineNote ?? "Not available right now" : "Not available for this store right now"}</span>
            </span>
            {selected && <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-on-action" aria-hidden><Check className="h-3.5 w-3.5" /></span>}
          </button>
        );
      })}
    </div>
  );
}
