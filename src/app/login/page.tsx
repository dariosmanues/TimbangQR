import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { QrCode, ShieldCheck, Usb } from "lucide-react";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await getSession();
  if (user) redirect("/dashboard");

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-hero">
          <div className="brand-mark"><QrCode size={23} /></div>
          <h1>Jembatan timbang yang cepat, akurat, dan dapat diaudit.</h1>
          <p>
            Identifikasi armada melalui QR Code, baca berat langsung dari indikator RS232/RS485, hitung netto otomatis,
            dan hasilkan rekap tonase per LPS dalam satu aplikasi.
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 28 }}>
            <span><ShieldCheck size={17} style={{ verticalAlign: "middle", marginRight: 8 }} /> Audit log dan anti-duplikasi</span>
            <span><Usb size={17} style={{ verticalAlign: "middle", marginRight: 8 }} /> Koneksi langsung melalui adapter USB–RS232/RS485</span>
          </div>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
