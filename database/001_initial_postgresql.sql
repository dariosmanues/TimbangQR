BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ADMIN',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lps (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  plate_number TEXT NOT NULL,
  plate_normalized TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL,
  waste_type TEXT NOT NULL,
  default_tare_kg INTEGER,
  qr_token TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  lps_id INTEGER NOT NULL REFERENCES lps(id),
  driver_name TEXT,
  tare_kg INTEGER,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weighbridge_devices (
  id SERIAL PRIMARY KEY,
  device_code TEXT NOT NULL UNIQUE,
  location_name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  firmware_version TEXT,
  connection_type TEXT NOT NULL DEFAULT 'RS232',
  port_name TEXT,
  baud_rate INTEGER NOT NULL DEFAULT 9600,
  protocol TEXT NOT NULL DEFAULT 'DIRECT_SERIAL',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_readings (
  id BIGSERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES weighbridge_devices(id),
  weight_kg INTEGER NOT NULL CHECK (weight_kg >= 0),
  stable BOOLEAN NOT NULL DEFAULT FALSE,
  indicator_raw TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weighings (
  id BIGSERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL,
  weighed_at TIMESTAMPTZ NOT NULL,
  vehicle_id INTEGER REFERENCES vehicles(id),
  plate_number TEXT NOT NULL,
  driver_name TEXT,
  vehicle_type TEXT NOT NULL,
  lps_id INTEGER REFERENCES lps(id),
  lps_name TEXT NOT NULL,
  waste_type TEXT NOT NULL,
  gross_kg INTEGER NOT NULL CHECK (gross_kg >= 0),
  tare_kg INTEGER NOT NULL CHECK (tare_kg >= 0),
  netto_1_kg INTEGER NOT NULL,
  rafaksi_kg INTEGER NOT NULL DEFAULT 0 CHECK (rafaksi_kg >= 0),
  netto_2_kg INTEGER NOT NULL,
  ritasi INTEGER NOT NULL DEFAULT 1 CHECK (ritasi > 0),
  tare_source TEXT NOT NULL DEFAULT 'DATABASE',
  device_id INTEGER REFERENCES weighbridge_devices(id),
  indicator_raw TEXT,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  source TEXT NOT NULL DEFAULT 'APPLICATION',
  source_note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weighings_date ON weighings(weighed_at DESC);
CREATE INDEX IF NOT EXISTS idx_weighings_ticket ON weighings(ticket_number);
CREATE INDEX IF NOT EXISTS idx_weighings_lps ON weighings(lps_id);
CREATE INDEX IF NOT EXISTS idx_weighings_vehicle ON weighings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_readings_device_date ON device_readings(device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_vehicle ON vehicle_assignments(vehicle_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_primary_assignment_per_vehicle
  ON vehicle_assignments(vehicle_id) WHERE is_primary = TRUE AND active = TRUE;

COMMIT;
