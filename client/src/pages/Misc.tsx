import { Link, useParams } from "react-router-dom";
import { EmptyState } from "../components/ui";

// Policy pages are templates. The operator must replace them with their real policies before launch.
const POLICIES: Record<string, { title: string; body: string[] }> = {
  delivery: {
    title: "Delivery information",
    body: [
      "We aim to deliver within about 10 minutes where our service areas allow. That is a business goal, not a guarantee: the time shown for your PIN code is an estimate and can vary with demand, traffic and weather.",
      "We deliver only to PIN codes in our coverage list. A valid postal PIN code does not mean we deliver there: we confirm coverage when you enter your PIN code.",
      "A delivery fee applies to orders below the free-delivery threshold shown at checkout.",
    ],
  },
  returns: { title: "Returns & refunds", body: ["Template: replace with your returns and refunds policy. Perishable items such as ice cannot be returned once delivered; contact us about damaged or missing items."] },
  privacy: { title: "Privacy", body: ["Template: replace with your privacy policy. We store your account details and delivery addresses to fulfil orders. GPS location is used only if you choose to share it while entering an address."] },
  terms: { title: "Terms of use", body: ["Template: replace with your terms. Prices and availability are subject to change. This store sells non-alcoholic ice, mixers and party essentials only."] },
};

export function Policy() {
  const { slug = "" } = useParams();
  const p = POLICIES[slug];
  if (!p) return <NotFound />;
  return (
    <div className="container-x max-w-3xl py-10">
      <h1 className="text-3xl font-extrabold">{p.title}</h1>
      <div className="mt-4 space-y-3 text-ink-soft">{p.body.map((t) => <p key={t}>{t}</p>)}</div>
    </div>
  );
}

export function NotFound() {
  return <div className="container-x py-16"><EmptyState title="Page not found" body="The page you're looking for doesn't exist." action={<Link to="/" className="btn-primary">Back to home</Link>} /></div>;
}
