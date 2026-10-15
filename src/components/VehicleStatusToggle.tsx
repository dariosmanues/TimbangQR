"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Power, Loader2, ExternalLink } from "lucide-react";

interface VehicleStatusToggleProps {
  vehicleId: number;
  initialActive: boolean;
  plateNumber: string;
  code?: string;
  showLabelPrompt?: boolean;
}

export default function VehicleStatusToggle({
  vehicleId,
  initialActive,
  plateNumber,
  code,
  showLabelPrompt = true,
}: VehicleStatusToggleProps) {
  const [active, setActive] = useState(initialActive);
  const [loading, setLoading] = useState(false);
  const [justActivated, setJustActivated] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const router = useRouter();

  const [prevInitialActive, setPrevInitialActive] = useState(initialActive);
  if (prevInitialActive !== initialActive) {
    setPrevInitialActive(initialActive);
    setActive(initialActive);
  }

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const targetActive = !active;

    // Optional confirmation when deactivating an active vehicle
    if (!targetActive) {
      const confirmDeactivate = window.confirm(
        `Nonaktifkan armada ${plateNumber}${code ? ` (${code})` : ""}? QR tidak akan bisa ditimbang saat nonaktif.`
      );
      if (!confirmDeactivate) return;
    }

    setLoading(true);
    setToastMessage(null);

    try {
      const res = await fetch(`/api/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: targetActive }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal mengubah status armada");
      }

      // 1. Immediately update client UI to Active / Inactive
      setActive(targetActive);
      if (targetActive) {
        setJustActivated(true);
      }
      setToastMessage(targetActive ? `✓ ${plateNumber} BERHASIL DIAKTIFKAN` : `Dinonaktifkan`);

      // Clear toast after 3.5 seconds
      setTimeout(() => setToastMessage(null), 3500);

      // 2. Dispatch custom event for any other components on the page
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("vehicle-status-updated", {
            detail: { vehicleId, active: targetActive, plateNumber },
          })
        );
      }

      // 3. Smart refresh:
      // If the user is currently on the "status=inactive" tab, DO NOT immediately refresh
      // because refreshing will filter out the newly-activated vehicle and make it vanish from view!
      // Instead, let the row stay visible with the green "Aktif" badge so the user sees the confirmation.
      const isInactiveTab =
        typeof window !== "undefined" && window.location.search.includes("status=inactive");

      if (!isInactiveTab) {
        router.refresh();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan sistem");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={loading}
        title={
          active
            ? `Status: Aktif (Klik untuk Menonaktifkan ${plateNumber})`
            : `Status: Nonaktif (Klik untuk Mengaktifkan ${plateNumber})`
        }
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: loading ? "wait" : "pointer",
          outline: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          transition: "transform 0.16s ease, filter 0.16s ease",
          opacity: loading ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (!loading) e.currentTarget.style.transform = "scale(1.05)";
        }}
        onMouseLeave={(e) => {
          if (!loading) e.currentTarget.style.transform = "scale(1)";
        }}
      >
        <span
          className={`badge ${active ? "green" : "red"}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: "999px",
            fontSize: 11,
            fontWeight: 800,
            background: active ? "rgba(8,120,79,0.12)" : "rgba(195,61,61,0.1)",
            color: active ? "#08784f" : "#c33d3d",
            boxShadow: active
              ? "0 2px 6px rgba(8,120,79,0.18)"
              : "0 2px 6px rgba(195,61,61,0.18)",
            border: active
              ? "1.5px solid rgba(8,120,79,0.35)"
              : "1px solid rgba(195,61,61,0.25)",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          {loading ? (
            <>
              <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
              <span>Memproses...</span>
            </>
          ) : (
            <>
              <span
                className="dot"
                style={{
                  background: active ? "#08784f" : "#c33d3d",
                  boxShadow: active ? "0 0 6px #08784f" : undefined,
                }}
              />
              <span>{active ? "Aktif" : "Nonaktif"}</span>

              {!active && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    marginLeft: 3,
                    padding: "3px 8px",
                    background: "var(--primary, #08784f)",
                    color: "white",
                    borderRadius: "6px",
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing: "0.02em",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                >
                  <Power size={10} /> Aktifkan
                </span>
              )}

              {active && (
                <Check
                  size={12}
                  style={{ color: "#08784f", strokeWidth: 3 }}
                />
              )}
            </>
          )}
        </span>
      </button>

      {/* Persistent success badge if activated on this view */}
      {justActivated && active && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            fontSize: 10,
            fontWeight: 800,
            color: "#08784f",
            background: "rgba(8,120,79,0.08)",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          <Check size={10} strokeWidth={3} /> Status Kini Aktif
        </span>
      )}

      {/* Instant visual popup toast message */}
      {toastMessage && (
        <span
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginTop: 4,
            padding: "3px 10px",
            background: active ? "#08784f" : "#c33d3d",
            color: "white",
            fontSize: 10.5,
            fontWeight: 800,
            borderRadius: 6,
            whiteSpace: "nowrap",
            zIndex: 30,
            boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {toastMessage}
        </span>
      )}
    </div>
  );
}
