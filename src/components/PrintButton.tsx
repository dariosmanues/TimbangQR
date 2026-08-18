"use client";

import { Printer } from "lucide-react";

export default function PrintButton() {
  return (
    <button className="btn btn-primary no-print" onClick={() => window.print()}>
      <Printer size={17} /> Cetak QR
    </button>
  );
}
