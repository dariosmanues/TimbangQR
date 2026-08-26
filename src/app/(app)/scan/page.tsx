import { Scale } from "lucide-react";
import WeighingWorkspace from "@/components/WeighingWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scan QR & penimbangan</h1>
          <p>Identifikasi armada, ambil berat indikator, dan hitung netto otomatis.</p>
        </div>
        <span className="badge green"><Scale size={14} /> Mode operasional</span>
      </div>
      <WeighingWorkspace initialToken={params.token || ""} />
    </>
  );
}
