"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@lps.local");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Login gagal");
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div>
        <h2>Masuk ke aplikasi</h2>
        <p>Gunakan akun operator atau administrator.</p>
      </div>
      <div className="field">
        <label>Email</label>
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
      </div>
      <div className="field">
        <label>Kata sandi</label>
        <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
      </div>
      {error && <div className="error">{error}</div>}
      <button className="btn btn-primary" disabled={loading} type="submit">
        <LogIn size={18} /> {loading ? "Memeriksa..." : "Masuk"}
      </button>
      <div className="help">
        Akun awal: <strong>admin@lps.local</strong> / <strong>Admin123!</strong>. Ganti lewat berkas <code>.env</code> sebelum database pertama kali dibuat.
      </div>
    </form>
  );
}
