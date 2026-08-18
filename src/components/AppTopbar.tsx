import { LogOut } from "lucide-react";

export default function AppTopbar() {
  const now = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "full",
    timeZone: "Asia/Jakarta",
  }).format(new Date());

  return (
    <header className="topbar">
      <div className="topbar-title">
        <strong>Transdepo Harapan Jaya</strong>
        <span>{now}</span>
      </div>
      <form action="/api/auth/logout" method="post">
        <button className="btn btn-secondary btn-sm" type="submit">
          <LogOut size={15} /> Keluar
        </button>
      </form>
    </header>
  );
}
