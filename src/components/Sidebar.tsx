"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Camera,
  FileSpreadsheet,
  Gauge,
  QrCode,
  Truck,
  Usb,
} from "lucide-react";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/scan", label: "Scan & Timbang", icon: Camera },
  { href: "/armada", label: "Master Armada", icon: Truck },
  { href: "/transaksi", label: "Transaksi", icon: Gauge },
  { href: "/laporan", label: "Rekap & Laporan", icon: FileSpreadsheet },
  { href: "/perangkat", label: "Koneksi Timbangan", icon: Usb },
];

export default function Sidebar({ userName, userEmail }: { userName: string; userEmail: string }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><QrCode size={23} /></div>
        <div>
          <strong>TimbangQR</strong>
          <small>Harapan Jaya</small>
        </div>
      </div>
      <div className="nav-section">Operasional</div>
      <nav>
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} className={`nav-link ${active ? "active" : ""}`} href={item.href}>
              <Icon size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-user">
        <strong>{userName}</strong>
        <span>{userEmail}</span>
      </div>
    </aside>
  );
}
