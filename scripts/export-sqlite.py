#!/usr/bin/env python3
"""Ekspor database SQLite TimbangQR lama ke JSON tanpa dependency tambahan."""

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

TABLES = [
    "users",
    "lps",
    "vehicles",
    "vehicle_assignments",
    "weighbridge_devices",
    "device_readings",
    "weighings",
    "audit_logs",
    "settings",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sqlite_db", help="Lokasi timbang.db versi lama")
    parser.add_argument("output", nargs="?", default="data/sqlite-export.json")
    args = parser.parse_args()

    db_path = Path(args.sqlite_db).resolve()
    output_path = Path(args.output).resolve()
    if not db_path.exists():
        raise SystemExit(f"Database tidak ditemukan: {db_path}")

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    data: dict[str, object] = {
        "meta": {
            "source": str(db_path),
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }
    }

    try:
        existing = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for table in TABLES:
            if table not in existing:
                data[table] = []
                continue
            data[table] = [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]
    finally:
        connection.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Ekspor selesai: {output_path}")
    for table in TABLES:
        print(f"- {table}: {len(data.get(table, []))}")


if __name__ == "__main__":
    main()
