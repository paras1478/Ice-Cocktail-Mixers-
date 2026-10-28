import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, apiError } from "../lib/api";
import type { Address } from "../lib/types";
import { formatAddress } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { AddressForm, addressPayload, draftFromRecord, emptyAddress, validateAddress, type AddressDraft } from "../components/AddressForm";
import { ErrorState, FieldError, Skeleton, useAsync } from "../components/ui";

const toDraft = (a: Address): AddressDraft => draftFromRecord(a);

function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await api.patch("/auth/me", { name, phone: phone || null });
      setUser(data.user); setErrors({}); toast.success("Profile updated");
    } catch (ex) { const i = apiError(ex); setErrors(Object.keys(i.fields).length ? i.fields : { name: i.message }); }
  };
  return (
    <form onSubmit={submit} className="card space-y-4 p-5" noValidate>
      <h2 className="text-lg font-extrabold">Profile</h2>
      <div><label htmlFor="p-name" className="label">Name</label><input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /><FieldError id="p-name-e" message={errors.name} /></div>
      <div><label htmlFor="p-email" className="label">Email</label><input id="p-email" className="input" value={user?.email ?? ""} disabled /></div>
      <div><label htmlFor="p-phone" className="label">Mobile</label><input id="p-phone" className="input" inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} /><FieldError id="p-phone-e" message={errors.phone} /></div>
      <button className="btn-primary">Save changes</button>
    </form>
  );
}

function Addresses() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ addresses: Address[] }>("/addresses").then((r) => r.data.addresses), []);
  const [editing, setEditing] = useState<{ id: string | null; draft: AddressDraft } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async () => {
    if (!editing) return;
    const e = validateAddress(editing.draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const body = { ...addressPayload(editing.draft), label: editing.draft.type === "WORK" ? "Work" : editing.draft.type === "OTHER" ? "Other" : "Home", confirmed: true };
      if (editing.id) await api.put(`/addresses/${editing.id}`, body); else await api.post("/addresses", body);
      toast.success("Address saved"); setEditing(null); list.reload();
    } catch (ex) { const i = apiError(ex); setErrors(Object.keys(i.fields).length ? { ...i.fields, ...(i.fields.city ? { district: i.fields.city } : {}) } : { pincode: i.message }); }
  };
  const del = async (a: Address) => {
    if (!window.confirm("Delete this address? Past orders keep their own address.")) return;
    try { await api.delete(`/addresses/${a.id}`); toast.success("Address deleted"); list.reload(); } catch (ex) { toast.error(apiError(ex).message); }
  };

  return (
    <section className="card p-5" aria-labelledby="addr-h">
      <div className="flex items-center justify-between"><h2 id="addr-h" className="text-lg font-extrabold">Saved addresses</h2>{!editing && <button className="btn-ghost" onClick={() => { setEditing({ id: null, draft: { ...emptyAddress } }); setErrors({}); }}>Add address</button>}</div>
      {editing ? (
        <div className="mt-4">
          <AddressForm value={editing.draft} errors={errors} onChange={(p) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e))} />
          <div className="mt-4 flex gap-2"><button className="btn-primary" onClick={save}>Save address</button><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
        </div>
      ) : list.loading ? <Skeleton className="mt-4 h-20" /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
        : !list.data?.length ? <p className="mt-3 text-sm text-muted">No saved addresses yet.</p>
        : <ul className="mt-4 space-y-3">{list.data.map((a) => (
          <li key={a.id} className="rounded-xl border border-line p-3 text-sm">
            <p className="font-bold">{a.label}{a.isDefault && <span className="chip ml-2">Default</span>}</p>
            <p className="text-ink-soft">{formatAddress(a)}</p>
            <div className="mt-2 flex gap-3 text-xs font-semibold"><button className="underline" onClick={() => { setEditing({ id: a.id, draft: toDraft(a) }); setErrors({}); }}>Edit</button><button className="underline" onClick={() => del(a)}>Delete</button></div>
          </li>))}</ul>}
    </section>
  );
}

export default function Account() {
  return (
    <div className="container-x py-8">
      <div className="flex items-center justify-between"><h1 className="text-3xl font-extrabold">My account</h1><Link to="/orders" className="btn-ghost">My orders</Link></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2"><Profile /><Addresses /></div>
    </div>
  );
}
