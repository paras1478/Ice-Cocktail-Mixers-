import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, apiError } from "../lib/api";
import type { Bundle, Category, Order, OrderStatus, Product } from "../lib/types";
import { formatDateTime, formatMoney, minorToRupees, rupeesToMinor } from "../lib/format";
import { useToast } from "../context/ToastContext";
import { EmptyState, ErrorState, FieldError, Skeleton, useAsync } from "../components/ui";
import { OrderAddress, StatusBadge, STATUS_LABEL } from "./Orders";

const TABS = ["Overview", "Orders", "Products", "Bundles", "Discounts", "Delivery areas", "Customers"] as const;
type Tab = (typeof TABS)[number];

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr>{head.map((h) => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead><tbody className="divide-y divide-line">{children}</tbody></table></div>
);

function Load<T>({ state, children }: { state: { data: T | null; loading: boolean; error: string | null; reload: () => void }; children: (d: T) => ReactNode }) {
  if (state.loading) return <Skeleton className="h-48" />;
  if (state.error || !state.data) return <ErrorState message={state.error ?? "Failed to load"} onRetry={state.reload} />;
  return <>{children(state.data)}</>;
}

// ---------- Overview ----------
function Overview() {
  const s = useAsync(() => api.get<{ orders: number; customers: number; products: number; revenueMinor: number; byStatus: Record<string, number>; lowStock: { id: string; name: string; packSize: string; stock: number }[] }>("/admin/stats").then((r) => r.data), []);
  return (
    <Load state={s}>{(d) => (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[["Orders", d.orders], ["Revenue (excl. cancelled)", formatMoney(d.revenueMinor)], ["Customers", d.customers], ["Active products", d.products]].map(([k, v]) => <div key={k as string} className="card p-4"><p className="text-xs font-bold uppercase text-muted">{k}</p><p className="mt-1 text-2xl font-extrabold">{v}</p></div>)}
        </div>
        <div className="card p-4"><h3 className="font-bold">Orders by status</h3><div className="mt-2 flex flex-wrap gap-2">{Object.entries(d.byStatus).map(([k, v]) => <span key={k} className="chip">{STATUS_LABEL[k as OrderStatus]}: {v}</span>)}{!Object.keys(d.byStatus).length && <span className="text-sm text-muted">No orders yet.</span>}</div></div>
        <div className="card p-4"><h3 className="font-bold">Low stock</h3>{d.lowStock.length ? <ul className="mt-2 space-y-1 text-sm">{d.lowStock.map((p) => <li key={p.id}>{p.name} <span className="text-muted">({p.packSize})</span>: <b className={p.stock === 0 ? "text-danger" : "text-warn"}>{p.stock} left</b></li>)}</ul> : <p className="mt-1 text-sm text-muted">Nothing is running low.</p>}</div>
      </div>
    )}</Load>
  );
}

// ---------- Orders ----------
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { PLACED: "CONFIRMED", CONFIRMED: "PREPARING", PREPARING: "OUT_FOR_DELIVERY", OUT_FOR_DELIVERY: "DELIVERED" };

function Orders() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useAsync(() => api.get<{ orders: Order[] }>("/orders", { params: { all: true, status: status || undefined } }).then((r) => r.data.orders), [status]);
  const move = async (o: Order, to: OrderStatus) => {
    try { await api.patch(`/orders/${o.id}/status`, { status: to }); toast.success(`Order #${o.number}: ${STATUS_LABEL[to]}`); list.reload(); } catch (e) { toast.error(apiError(e).message); }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><label htmlFor="ostatus" className="label !mb-0">Status</label>
        <select id="ostatus" className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
      <Load state={list}>{(orders) => !orders.length ? <EmptyState title="No orders" /> : (
        <ul className="space-y-3">{orders.map((o) => (
          <li key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button className="text-left" onClick={() => setOpen(open === o.id ? null : o.id)} aria-expanded={open === o.id}><b>Order #{o.number}</b> <span className="text-sm text-muted">· {o.user?.name} · {formatDateTime(o.createdAt)}</span></button>
              <div className="flex items-center gap-3"><StatusBadge status={o.status} /><b>{formatMoney(o.totalMinor)}</b>
                {NEXT[o.status] && <button className="btn-add-solid !min-h-9 !px-4" onClick={() => move(o, NEXT[o.status]!)}>Mark {STATUS_LABEL[NEXT[o.status]!].toLowerCase()}</button>}
                {o.status !== "DELIVERED" && o.status !== "CANCELLED" && <button className="btn-ghost !min-h-9" onClick={() => window.confirm(`Cancel order #${o.number}?`) && move(o, "CANCELLED")}>Cancel</button>}</div>
            </div>
            {open === o.id && (
              <div className="mt-3 grid gap-4 border-t border-line pt-3 sm:grid-cols-2">
                <div><h4 className="mb-1 text-xs font-bold uppercase text-muted">Delivery address</h4><OrderAddress o={o} />{o.instructions && <p className="mt-2 text-sm">Note: {o.instructions}</p>}<p className="mt-2 text-xs text-muted">Customer: {o.user?.email}{o.user?.phone ? ` · ${o.user.phone}` : ""}</p></div>
                <div><h4 className="mb-1 text-xs font-bold uppercase text-muted">Items</h4><ul className="text-sm">{o.items.map((i) => <li key={i.id}>{i.quantity} × {i.name} <span className="text-muted">({formatMoney(i.unitMinor)})</span></li>)}</ul><p className="mt-2 text-xs text-muted">Payment: {o.payment?.method} · {o.payment?.status}</p></div>
              </div>
            )}
          </li>))}</ul>
      )}</Load>
    </div>
  );
}

// ---------- Products ----------
interface Img { url: string; alt: string; placeholder: boolean; source: string; license: string }
interface PForm { id?: string; sku: string; variantGroup: string; name: string; brand: string; categoryId: string; packSize: string; price: string; mrp: string; priceStatus: "SAMPLE" | "VERIFIED"; priceSourceUrl: string; priceVerifiedAt: string; stock: string; lowStockAt: string; description: string; details: string; isActive: boolean; images: Img[] }
const blank = (categoryId: string): PForm => ({ sku: "", variantGroup: "", name: "", brand: "", categoryId, packSize: "", price: "", mrp: "", priceStatus: "SAMPLE", priceSourceUrl: "", priceVerifiedAt: "", stock: "0", lowStockAt: "10", description: "", details: "", isActive: true, images: [{ url: "/img/coming-soon.svg", alt: "", placeholder: true, source: "", license: "" }] });
const fromProduct = (p: Product): PForm => ({ id: p.id, sku: p.sku ?? "", variantGroup: p.variantGroup ?? "", name: p.name, brand: p.brand ?? "", categoryId: p.categoryId, packSize: p.packSize, price: minorToRupees(p.priceMinor), mrp: p.mrpMinor ? minorToRupees(p.mrpMinor) : "", priceStatus: p.priceStatus, priceSourceUrl: p.priceSourceUrl ?? "", priceVerifiedAt: p.priceVerifiedAt?.slice(0, 10) ?? "", stock: String(p.stock), lowStockAt: String(p.lowStockAt), description: p.description, details: p.details ?? "", isActive: p.isActive, images: p.images.length ? p.images.map((i) => ({ url: i.url, alt: i.alt, placeholder: i.isPlaceholder, source: i.sourceUrl ?? "", license: i.license ?? "" })) : [{ url: "/img/coming-soon.svg", alt: "", placeholder: true, source: "", license: "" }] });

/** Shows the image exactly as the storefront will load it, and says so when it can't be loaded. */
function ImagePreview({ url }: { url: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => setState("loading"), [url]);
  const bad = !/^(https?:\/\/\S+|\/\S*)$/.test(url.trim());
  return (
    <div className="flex items-center gap-3" data-testid="image-preview">
      {!bad && url.trim() ? <img src={url.trim()} alt="" width={64} height={64} className={`h-16 w-16 rounded-lg bg-tint object-cover ${state === "error" ? "hidden" : ""}`} onLoad={() => setState("ok")} onError={() => setState("error")} /> : null}
      {(bad || state === "error") && <span className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-danger text-center text-[10px] font-semibold text-danger">No preview</span>}
      <p role="status" className={`text-xs font-semibold ${bad || state === "error" ? "text-danger" : state === "ok" ? "text-ok" : "text-muted"}`}>
        {!url.trim() ? "Add an image URL or a path like /img/stock/photo.jpg" : bad ? "Use an http(s) URL or a path starting with /" : state === "error" ? "This image can't be loaded. Check the URL or file name (paths are case-sensitive)." : state === "ok" ? "Image loads correctly" : "Checking image…"}
      </p>
    </div>
  );
}

function ProductForm({ initial, cats, onDone }: { initial: PForm; cats: Category[]; onDone: (saved: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PForm>(k: K, v: PForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name, sku: f.sku || null, variantGroup: f.variantGroup || null, brand: f.brand || null, categoryId: f.categoryId, packSize: f.packSize, description: f.description, details: f.details || null,
      priceMinor: rupeesToMinor(f.price || 0), mrpMinor: f.mrp ? rupeesToMinor(f.mrp) : null,
      priceStatus: f.priceStatus, priceSourceUrl: f.priceSourceUrl || null, priceVerifiedAt: f.priceVerifiedAt || null,
      stock: Number(f.stock || 0), lowStockAt: Number(f.lowStockAt || 0), isActive: f.isActive,
      images: f.images.filter((i) => i.url.trim()).map((i) => ({ url: i.url.trim(), alt: i.alt.trim() || f.name, isPlaceholder: i.placeholder, sourceUrl: i.source || null, license: i.license || null })),
    };
    setBusy(true); setErrors({});
    try { if (f.id) await api.put(`/products/${f.id}`, body); else await api.post("/products", body); toast.success("Product saved"); onDone(true); }
    catch (ex) { const i = apiError(ex); setErrors(Object.keys(i.fields).length ? i.fields : { form: i.message }); } finally { setBusy(false); }
  };
  const inp = (k: keyof PForm, label: string, props: Record<string, unknown> = {}) => (
    <div><label htmlFor={`pf-${k}`} className="label">{label}</label><input id={`pf-${k}`} className="input" value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} {...props} /><FieldError id={`pf-${k}-e`} message={errors[k]} /></div>
  );
  return (
    <form onSubmit={submit} className="card space-y-4 p-5" noValidate>
      <h3 className="text-lg font-extrabold">{f.id ? "Edit product" : "New product"}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {inp("name", "Name")}{inp("brand", "Brand (optional)")}
        {inp("sku", "SKU (store identifier)")}{inp("variantGroup", "Pack-size group (optional, e.g. party-ice)")}
        <div><label htmlFor="pf-cat" className="label">Category</label><select id="pf-cat" className="input" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {inp("packSize", "Exact pack size (e.g. 300 ml)")}
        {inp("price", "Selling price (₹)", { inputMode: "decimal" })}{inp("mrp", "MRP (₹, only if verified)", { inputMode: "decimal" })}
        <div><label htmlFor="pf-ps" className="label">Price status</label><select id="pf-ps" className="input" value={f.priceStatus} onChange={(e) => set("priceStatus", e.target.value as PForm["priceStatus"])}><option value="SAMPLE">Sample (unverified)</option><option value="VERIFIED">Verified</option></select></div>
        {f.priceStatus === "VERIFIED" && <>{inp("priceSourceUrl", "Price source URL")}{inp("priceVerifiedAt", "Verified on", { type: "date" })}</>}
        {inp("stock", "Stock", { inputMode: "numeric" })}{inp("lowStockAt", "Low-stock alert at", { inputMode: "numeric" })}
      </div>
      <div><label htmlFor="pf-desc" className="label">Description</label><textarea id="pf-desc" className="input" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
      <fieldset className="space-y-3 rounded-xl bg-band p-3"><legend className="label px-1">Images (the first one is the main photo)</legend>
        {f.images.map((im, n) => {
          const setImg = (patch: Partial<Img>) => set("images", f.images.map((x, k) => (k === n ? { ...x, ...patch } : x)));
          return (
            <div key={n} className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 sm:col-span-2"><div className="min-w-0 flex-1"><b className="text-sm">Image {n + 1}</b><ImagePreview url={im.url} /></div>
                {f.images.length > 1 && <button type="button" className="ml-auto text-sm font-semibold text-danger underline" onClick={() => set("images", f.images.filter((_, k) => k !== n))}>Remove</button>}</div>
              <div><label htmlFor={`im-url-${n}`} className="label">Image URL / path</label><input id={`im-url-${n}`} className="input" value={im.url} onChange={(e) => setImg({ url: e.target.value })} /></div>
              <div><label htmlFor={`im-alt-${n}`} className="label">Alt text</label><input id={`im-alt-${n}`} className="input" value={im.alt} onChange={(e) => setImg({ alt: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={im.placeholder} onChange={(e) => setImg({ placeholder: e.target.checked })} /> Stand-in (not a photo of this exact product)</label>
              {!im.placeholder && <><div><label htmlFor={`im-src-${n}`} className="label">Photo source URL</label><input id={`im-src-${n}`} className="input" value={im.source} onChange={(e) => setImg({ source: e.target.value })} /></div><div><label htmlFor={`im-lic-${n}`} className="label">Licence / permission</label><input id={`im-lic-${n}`} className="input" value={im.license} onChange={(e) => setImg({ license: e.target.value })} /></div></>}
            </div>
          );
        })}
        {f.images.length < 8 && <button type="button" className="btn-ghost" onClick={() => set("images", [...f.images, { url: "", alt: "", placeholder: true, source: "", license: "" }])}>Add another image</button>}
        {errors.images && <p role="alert" className="text-xs font-semibold text-danger">{errors.images}</p>}
      </fieldset>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Published (visible on the storefront)</label>
      {errors.form && <p role="alert" className="text-sm font-semibold text-danger">{errors.form}</p>}
      <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save product"}</button><button type="button" className="btn-ghost" onClick={() => onDone(false)}>Cancel</button></div>
    </form>
  );
}

function Products() {
  const toast = useToast();
  const cats = useAsync(() => api.get<{ categories: Category[] }>("/categories").then((r) => r.data.categories), []);
  const list = useAsync(() => api.get<{ products: Product[] }>("/products", { params: { includeInactive: true, pageSize: 60, sort: "newest" } }).then((r) => r.data.products), []);
  const [editing, setEditing] = useState<PForm | null>(null);
  const [stock, setStock] = useState<Record<string, string>>({});
  const saveStock = async (p: Product) => {
    const n = Number(stock[p.id]);
    if (!Number.isInteger(n) || n < 0) return toast.error("Stock must be a whole number, 0 or more");
    try { await api.put(`/products/${p.id}`, { stock: n }); toast.success(`${p.name}: stock set to ${n}`); setStock((s) => { const { [p.id]: _, ...rest } = s; return rest; }); list.reload(); } catch (e) { toast.error(apiError(e).message); }
  };
  const archive = async (p: Product) => {
    if (!window.confirm(`Remove ${p.name}? Products with order history are archived instead of deleted.`)) return;
    try { await api.delete(`/products/${p.id}`); toast.success("Product removed"); list.reload(); } catch (e) { toast.error(apiError(e).message); }
  };
  if (editing && cats.data) return <ProductForm initial={editing} cats={cats.data.filter((c) => c.slug !== "party-bundles")} onDone={(saved) => { setEditing(null); if (saved) { list.reload(); cats.reload(); } }} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><p className="text-sm text-muted">Manage ice, tonic, club soda, margarita mixes, bitters, citrus garnishes and party essentials.</p><button className="btn-add-solid" disabled={!cats.data} onClick={() => setEditing(blank(cats.data!.find((c) => c.slug !== "party-bundles")!.id))}>New product</button></div>
      <Load state={list}>{(ps) => (
        <Table head={["Product", "Category", "Price", "Stock", "Status", ""]}>
          {ps.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3"><b>{p.name}</b><br /><span className="text-xs text-muted">{p.packSize}</span></td>
              <td className="px-4 py-3">{p.category?.name}</td>
              <td className="px-4 py-3">{formatMoney(p.priceMinor)}{p.priceStatus === "SAMPLE" && <span className="block text-xs text-warn">sample</span>}{p.mrpMinor ? <span className="block text-xs text-muted line-through">{formatMoney(p.mrpMinor)}</span> : null}</td>
              <td className="px-4 py-3"><div className="flex items-center gap-1.5"><label className="sr-only" htmlFor={`st-${p.id}`}>Stock for {p.name}</label><input id={`st-${p.id}`} className="input !min-h-9 w-20 !px-2" inputMode="numeric" value={stock[p.id] ?? String(p.stock)} onChange={(e) => setStock({ ...stock, [p.id]: e.target.value.replace(/\D/g, "") })} />{stock[p.id] !== undefined && stock[p.id] !== String(p.stock) && <button className="btn-add !min-h-9 !px-3" onClick={() => saveStock(p)}>Save</button>}</div></td>
              <td className="px-4 py-3">{p.isActive ? <span className="chip text-ok">Published</span> : <span className="chip text-muted">Hidden</span>}</td>
              <td className="px-4 py-3 text-right"><button className="mr-3 font-semibold underline" onClick={() => setEditing(fromProduct(p))}>Edit</button><button className="font-semibold text-danger underline" onClick={() => archive(p)}>Remove</button></td>
            </tr>))}
        </Table>)}</Load>
    </div>
  );
}

// ---------- Bundles ----------
function Bundles() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ bundles: Bundle[] }>("/bundles", { params: { includeInactive: true } }).then((r) => r.data.bundles), []);
  const prods = useAsync(() => api.get<{ products: Product[] }>("/products", { params: { pageSize: 60, includeInactive: true } }).then((r) => r.data.products), []);
  const [form, setForm] = useState<{ id?: string; name: string; description: string; price: string; isActive: boolean; qty: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edit = (b?: Bundle) => { setError(null); setForm(b ? { id: b.id, name: b.name, description: b.description, price: minorToRupees(b.priceMinor), isActive: b.isActive, qty: Object.fromEntries(b.items.map((i) => [i.productId, i.quantity])) } : { name: "", description: "", price: "", isActive: true, qty: {} }); };
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!form) return;
    const items = Object.entries(form.qty).filter(([, q]) => q > 0).map(([productId, quantity]) => ({ productId, quantity }));
    const body = { name: form.name, description: form.description, priceMinor: rupeesToMinor(form.price || 0), isActive: form.isActive, items };
    try { if (form.id) await api.put(`/admin/bundles/${form.id}`, body); else await api.post("/admin/bundles", body); toast.success("Bundle saved"); setForm(null); list.reload(); }
    catch (ex) { const i = apiError(ex); setError(Object.values(i.fields)[0] ?? i.message); }
  };
  const del = async (b: Bundle) => { if (!window.confirm(`Delete ${b.name}?`)) return; try { await api.delete(`/admin/bundles/${b.id}`); toast.success("Bundle deleted"); list.reload(); } catch (e) { toast.error(apiError(e).message); } };
  if (form) return (
    <form onSubmit={save} className="card space-y-4 p-5" noValidate>
      <h3 className="text-lg font-extrabold">{form.id ? "Edit bundle" : "New bundle"}</h3>
      <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="b-name" className="label">Name</label><input id="b-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div><label htmlFor="b-price" className="label">Bundle price (₹)</label><input id="b-price" className="input" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div></div>
      <div><label htmlFor="b-desc" className="label">Description</label><textarea id="b-desc" className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <fieldset><legend className="label">Items (quantity per product)</legend><div className="grid max-h-64 gap-1.5 overflow-auto sm:grid-cols-2">{(prods.data ?? []).filter((p) => p.isActive).map((p) => <label key={p.id} className="flex items-center justify-between gap-2 text-sm"><span>{p.name} <span className="text-muted">({p.packSize})</span></span><input aria-label={`Quantity of ${p.name}`} className="input !min-h-9 w-16 !px-2" inputMode="numeric" value={form.qty[p.id] ?? 0} onChange={(e) => setForm({ ...form, qty: { ...form.qty, [p.id]: Number(e.target.value.replace(/\D/g, "")) } })} /></label>)}</div></fieldset>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Published</label>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <div className="flex gap-2"><button className="btn-primary">Save bundle</button><button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button></div>
    </form>
  );
  return (
    <div className="space-y-4"><div className="flex justify-end"><button className="btn-add-solid" onClick={() => edit()}>New bundle</button></div>
      <Load state={list}>{(bs) => <Table head={["Bundle", "Price", "Regular", "Items", "Status", ""]}>{bs.map((b) => <tr key={b.id}><td className="px-4 py-3 font-bold">{b.name}</td><td className="px-4 py-3">{formatMoney(b.priceMinor)}</td><td className="px-4 py-3 text-muted">{formatMoney(b.regularMinor)}</td><td className="px-4 py-3">{b.items.length}</td><td className="px-4 py-3">{b.isActive ? "Published" : "Hidden"}</td><td className="px-4 py-3 text-right"><button className="mr-3 font-semibold underline" onClick={() => edit(b)}>Edit</button><button className="font-semibold text-danger underline" onClick={() => del(b)}>Delete</button></td></tr>)}</Table>}</Load></div>
  );
}

// ---------- Discounts ----------
interface Disc { id: string; code: string; type: "PERCENT" | "FIXED"; value: number; minSubtotalMinor: number; usedCount: number; isActive: boolean }
function Discounts() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ discounts: Disc[] }>("/admin/discounts").then((r) => r.data.discounts), []);
  const [f, setF] = useState({ code: "", type: "PERCENT", value: "", min: "" });
  const [error, setError] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api.post("/admin/discounts", { code: f.code, type: f.type, value: f.type === "FIXED" ? rupeesToMinor(f.value || 0) : Number(f.value || 0), minSubtotalMinor: rupeesToMinor(f.min || 0) }); setF({ code: "", type: "PERCENT", value: "", min: "" }); toast.success("Discount created"); list.reload(); }
    catch (ex) { const i = apiError(ex); setError(Object.values(i.fields)[0] ?? i.message); }
  };
  const toggle = async (d: Disc) => { try { await api.put(`/admin/discounts/${d.id}`, { isActive: !d.isActive }); list.reload(); } catch (e) { toast.error(apiError(e).message); } };
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid gap-3 p-4 sm:grid-cols-5" noValidate>
        <div><label htmlFor="d-code" className="label">Code</label><input id="d-code" className="input uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div><label htmlFor="d-type" className="label">Type</label><select id="d-type" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="PERCENT">Percent</option><option value="FIXED">Fixed (₹)</option></select></div>
        <div><label htmlFor="d-val" className="label">Value</label><input id="d-val" className="input" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
        <div><label htmlFor="d-min" className="label">Min subtotal (₹)</label><input id="d-min" className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></div>
        <div className="flex items-end"><button className="btn-primary w-full">Add code</button></div>
        {error && <p role="alert" className="text-sm font-semibold text-danger sm:col-span-5">{error}</p>}
      </form>
      <Load state={list}>{(ds) => <Table head={["Code", "Discount", "Min order", "Used", "Active"]}>{ds.map((d) => <tr key={d.id}><td className="px-4 py-3 font-bold">{d.code}</td><td className="px-4 py-3">{d.type === "PERCENT" ? `${d.value}%` : formatMoney(d.value)}</td><td className="px-4 py-3">{formatMoney(d.minSubtotalMinor)}</td><td className="px-4 py-3">{d.usedCount}</td><td className="px-4 py-3"><label className="flex items-center gap-2"><input type="checkbox" checked={d.isActive} onChange={() => toggle(d)} aria-label={`${d.code} active`} /> {d.isActive ? "Yes" : "No"}</label></td></tr>)}</Table>}</Load>
    </div>
  );
}

// ---------- Delivery areas ----------
interface Area { pincode: string; areaName: string; city: string | null; state: string | null; etaMinutes: number; isActive: boolean; isSample: boolean }
function Areas() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ areas: Area[] }>("/admin/service-areas").then((r) => r.data.areas), []);
  const [f, setF] = useState({ pincode: "", areaName: "", city: "", state: "", eta: "20" });
  const [error, setError] = useState<string | null>(null);
  const save = async (a: Area) => { try { await api.put(`/admin/service-areas/${a.pincode}`, { areaName: a.areaName, city: a.city, state: a.state, etaMinutes: a.etaMinutes, isActive: a.isActive, isSample: a.isSample }); toast.success(`${a.pincode} updated`); list.reload(); } catch (e) { toast.error(apiError(e).message); } };
  const add = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api.put(`/admin/service-areas/${f.pincode}`, { areaName: f.areaName, city: f.city || null, state: f.state || null, etaMinutes: Number(f.eta) }); setF({ pincode: "", areaName: "", city: "", state: "", eta: "20" }); toast.success("Area saved"); list.reload(); }
    catch (ex) { const i = apiError(ex); setError(Object.values(i.fields)[0] ?? i.message); }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Only PIN codes listed here (and active) can be ordered to. The ETA shown to customers comes from this table.</p>
      <form onSubmit={add} className="card grid gap-3 p-4 sm:grid-cols-6" noValidate>
        {([["pincode", "PIN code"], ["areaName", "Area name"], ["city", "City"], ["state", "State"], ["eta", "ETA (min)"]] as const).map(([k, l]) => <div key={k}><label htmlFor={`a-${k}`} className="label">{l}</label><input id={`a-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
        <div className="flex items-end"><button className="btn-primary w-full">Add / update</button></div>
        {error && <p role="alert" className="text-sm font-semibold text-danger sm:col-span-6">{error}</p>}
      </form>
      <Load state={list}>{(as) => <Table head={["PIN", "Area", "City / State", "ETA", "Active", ""]}>{as.map((a) => <tr key={a.pincode}><td className="px-4 py-3 font-bold">{a.pincode}{a.isSample && <span className="block text-xs text-warn">sample</span>}</td><td className="px-4 py-3">{a.areaName}</td><td className="px-4 py-3">{[a.city, a.state].filter(Boolean).join(", ")}</td><td className="px-4 py-3"><input aria-label={`ETA for ${a.pincode}`} className="input !min-h-9 w-20 !px-2" inputMode="numeric" defaultValue={a.etaMinutes} onChange={(e) => (a.etaMinutes = Number(e.target.value) || a.etaMinutes)} /></td><td className="px-4 py-3"><input type="checkbox" aria-label={`${a.pincode} active`} defaultChecked={a.isActive} onChange={(e) => (a.isActive = e.target.checked)} /></td><td className="px-4 py-3 text-right"><button className="font-semibold underline" onClick={() => save(a)}>Save</button></td></tr>)}</Table>}</Load>
    </div>
  );
}

// ---------- Customers ----------
function Customers() {
  const list = useAsync(() => api.get<{ customers: { id: string; name: string; email: string; phone: string | null; createdAt: string; orderCount: number }[] }>("/admin/customers").then((r) => r.data.customers), []);
  return <Load state={list}>{(cs) => !cs.length ? <EmptyState title="No customers yet" /> : <Table head={["Name", "Email", "Mobile", "Joined", "Orders"]}>{cs.map((c) => <tr key={c.id}><td className="px-4 py-3 font-bold">{c.name}</td><td className="px-4 py-3">{c.email}</td><td className="px-4 py-3">{c.phone ?? "—"}</td><td className="px-4 py-3">{formatDateTime(c.createdAt)}</td><td className="px-4 py-3">{c.orderCount}</td></tr>)}</Table>}</Load>;
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>("Overview");
  return (
    <div className="container-x py-8">
      <h1 className="text-3xl font-extrabold">Admin dashboard</h1>
      <div role="tablist" aria-label="Admin sections" className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${tab === t ? "border-action bg-action text-on-action" : "border-line bg-surface hover:border-accent"}`}>{t}</button>)}
      </div>
      <div className="mt-6" role="tabpanel">
        {tab === "Overview" && <Overview />}{tab === "Orders" && <Orders />}{tab === "Products" && <Products />}{tab === "Bundles" && <Bundles />}{tab === "Discounts" && <Discounts />}{tab === "Delivery areas" && <Areas />}{tab === "Customers" && <Customers />}
      </div>
    </div>
  );
}
