import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { apiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { FieldError, PasswordInput, Spinner } from "../components/ui";

export function RequireAuth({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="py-24"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (admin && user.role !== "ADMIN") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await login(email, password); nav(from, { replace: true }); } catch (ex) { setError(apiError(ex).message); } finally { setBusy(false); }
  };
  return (
    <div className="container-x py-12">
      <form onSubmit={submit} className="card mx-auto max-w-md space-y-4 p-6" noValidate>
        <h1 className="text-2xl font-extrabold">Log in</h1>
        <div><label htmlFor="l-email" className="label">Email</label><input id="l-email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label htmlFor="l-pass" className="label">Password</label><PasswordInput id="l-pass" autoComplete="current-password" value={password} onChange={setPassword} /></div>
        {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        <p className="text-center text-sm text-muted">New here? <Link to="/register" state={{ from }} className="font-semibold text-accent underline">Create an account</Link></p>
      </form>
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [f, setF] = useState({ name: "", email: "", password: "", phone: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try { await register({ name: f.name, email: f.email, password: f.password, phone: f.phone || undefined }); nav(from, { replace: true }); }
    catch (ex) { const i = apiError(ex); setErrors(Object.keys(i.fields).length ? i.fields : { form: i.message }); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof f, label: string, type = "text", ac?: string) => (
    <div><label htmlFor={`r-${k}`} className="label">{label}</label>{type === "password"
      ? <PasswordInput id={`r-${k}`} autoComplete={ac} value={f[k]} invalid={!!errors[k]} onChange={(v) => setF({ ...f, [k]: v })} />
      : <input id={`r-${k}`} type={type} autoComplete={ac} className="input" value={f[k]} aria-invalid={!!errors[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}<FieldError id={`r-${k}-e`} message={errors[k]} /></div>
  );
  return (
    <div className="container-x py-12">
      <form onSubmit={submit} className="card mx-auto max-w-md space-y-4 p-6" noValidate>
        <h1 className="text-2xl font-extrabold">Create your account</h1>
        {field("name", "Name", "text", "name")}{field("email", "Email", "email", "email")}{field("phone", "Mobile (optional)", "tel", "tel-national")}{field("password", "Password (min 8 characters)", "password", "new-password")}
        {errors.form && <p role="alert" className="text-sm font-semibold text-danger">{errors.form}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <p className="text-center text-sm text-muted">Already registered? <Link to="/login" state={{ from }} className="font-semibold text-accent underline">Log in</Link></p>
      </form>
    </div>
  );
}
