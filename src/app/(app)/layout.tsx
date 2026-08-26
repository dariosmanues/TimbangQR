import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import AppTopbar from "@/components/AppTopbar";

export const runtime = "nodejs";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="app-shell">
      <Sidebar userName={user.name} userEmail={user.email} />
      <main className="main">
        <AppTopbar />
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
