export interface LaborRole {
  id: number;
  name: string;
  default_hourly_rate: number;
  burden_multiplier: number;
  notes: string | null;
  aliases: string | null;
}

export interface CrewMember {
  id: number;
  crew_template_id: number;
  labor_role_id: number;
  quantity: number;
  role_name: string;
  default_hourly_rate: number;
  burden_multiplier: number;
}

export interface CrewTemplate {
  id: number;
  name: string;
  description: string | null;
  members: CrewMember[];
}
