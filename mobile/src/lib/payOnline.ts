/**
 * Razorpay Standard Checkout (UPI, cards, net banking), opened inside a WebView so it works in Expo Go and in builds alike.
 * Only the PUBLIC key id reaches the phone; the secret, the amount and the verification all stay on the server.
 */
export interface CheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface GatewayOrder {
  keyId: string;
  razorpayOrderId: string;
  amountMinor: number;
  currency: string;
  orderId: string;
  orderNumber: number;
  testMode?: boolean;
  prefill: { name: string; email: string; contact: string };
}

/** The customer closed the payment window, or the payment failed: the order is kept so they can pay again. */
export class PaymentNotCompleted extends Error {
  constructor(message: string, public kind: "cancelled" | "failed") {
    super(message);
  }
}

export type OnlineMethod = "UPI" | "CARD" | "NETBANKING";
export const tab = (m: OnlineMethod) => m.toLowerCase() as "upi" | "card" | "netbanking";

/** Messages sent from the page inside the WebView back to the app. */
export type CheckoutMessage =
  | { type: "success"; data: CheckoutSuccess }
  | { type: "failed"; message?: string }
  | { type: "dismiss"; failure?: string }
  | { type: "loaderror" };

const safeJson = (v: unknown) => JSON.stringify(v).split("<").join("\\u003c").split(String.fromCharCode(0x2028)).join("").split(String.fromCharCode(0x2029)).join("");

/** The small page that loads Razorpay's checkout.js and opens it straight away. */
export function checkoutHtml(g: GatewayOrder, method?: OnlineMethod): string {
  const options = {
    key: g.keyId,
    amount: g.amountMinor,
    currency: g.currency,
    order_id: g.razorpayOrderId,
    name: "Ice & Mixers Express",
    description: `Order #${g.orderNumber}`,
    prefill: { ...g.prefill, ...(method ? { method: tab(method) } : {}) },
    theme: { color: "#d97706" },
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#30261f;color:#f8f5ed;font-family:sans-serif}p{padding:24px;text-align:center}</style></head>
<body><p>Opening secure payment…</p>
<script>
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var lastFail=null;
function start(){
  if(!window.Razorpay){post({type:"loaderror"});return;}
  var o=${safeJson(options)};
  o.handler=function(r){post({type:"success",data:r});};
  o.modal={ondismiss:function(){post({type:"dismiss",failure:lastFail});},confirm_close:true};
  var rz=new Razorpay(o);
  rz.on("payment.failed",function(r){var e=(r&&r.error)||{};lastFail=[e.description,e.reason?("("+e.reason+")"):""].join(" ").trim()||"Payment failed";});
  rz.open();
}
</script>
<script src="https://checkout.razorpay.com/v1/checkout.js" onload="start()" onerror="post({type:'loaderror'})"></script>
</body></html>`;
}
