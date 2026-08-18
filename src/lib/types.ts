export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: string;
};

export type VehicleRow = {
  id: number;
  code: string;
  plate_number: string;
  plate_normalized: string;
  vehicle_type: string;
  waste_type: string;
  default_tare_kg: number | null;
  qr_token: string;
  active: boolean;
  lps_names?: string | null;
  assignment_count?: number;
};

export type AssignmentRow = {
  id: number;
  lps_id: number;
  lps_name: string;
  driver_name: string | null;
  tare_kg: number | null;
  is_primary: boolean;
};

export type DeviceReading = {
  id: number;
  device_id: number;
  device_code: string;
  weight_kg: number;
  stable: boolean;
  indicator_raw: string | null;
  recorded_at: string;
};

export type WeighingRow = {
  id: number;
  ticket_number: string;
  weighed_at: string;
  plate_number: string;
  driver_name: string | null;
  lps_name: string;
  gross_kg: number;
  tare_kg: number;
  netto_1_kg: number;
  rafaksi_kg: number;
  netto_2_kg: number;
  ritasi: number;
  tare_source: string;
  status: string;
};
