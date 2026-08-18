"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

export default function VehicleCreateForm({ lpsOptions }: { lpsOptions: Array<{ id: number; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());

    try {
      const response = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal menyimpan armada");
      setStatus("Armada berhasil ditambahkan.");
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Gagal menyimpan armada");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={18} /> Tambah armada
      </button>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <div>
          <h3>Armada baru</h3>
          <p>QR Code dibuat otomatis setelah data disimpan.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}><X size={15} /> Tutup</button>
      </div>
      <form className="card-body" onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label>Nomor polisi</label>
            <input className="input" name="plateNumber" placeholder="BM 1234 XX" required />
          </div>
          <div className="field">
            <label>Nama pengemudi</label>
            <input className="input" name="driverName" placeholder="Nama pengemudi" />
          </div>
          <div className="field">
            <label>Jenis kendaraan</label>
            <select className="select" name="vehicleType" defaultValue="PICKUP">
              <option value="PICKUP">PICKUP</option>
              <option value="DUMP TRUCK">DUMP TRUCK</option>
              <option value="TRUK">TRUK</option>
              <option value="LAINNYA">LAINNYA</option>
            </select>
          </div>
          <div className="field">
            <label>LPS / Pengirim</label>
            <select className="select" name="lpsId" defaultValue="">
              <option value="">Pilih LPS</option>
              {lpsOptions.map((lps) => <option key={lps.id} value={lps.id}>{lps.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tare acuan (kg)</label>
            <input className="input" name="tareKg" type="number" min="0" placeholder="Contoh: 1200" />
          </div>
          <div className="field">
            <label>Jenis sampah</label>
            <input className="input" name="wasteType" defaultValue="SAMPAH RUMAH TANGGA" />
          </div>
        </div>
        {status && <p className={status.includes("berhasil") ? "success" : "error"}>{status}</p>}
        <div className="sticky-actions">
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? "Menyimpan..." : "Simpan dan buat QR"}
          </button>
        </div>
      </form>
    </div>
  );
}
