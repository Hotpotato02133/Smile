import type { ServiceCategory } from "./enums";

export interface DefaultServiceCatalogItem {
  readonly name: string;
  readonly category: ServiceCategory;
  readonly description: string;
  readonly durationMinutes: number;
  readonly bufferMinutes: number;
  readonly pricePhp: number;
  readonly requiresXray: boolean;
  readonly requiredChairTag?: string;
}

/** Default service catalog template; copied into `services` when a clinic is provisioned. */
export const DEFAULT_SERVICE_CATALOG: readonly DefaultServiceCatalogItem[] = [
  {
    name: "Oral Prophylaxis (Routine Cleaning)",
    category: "Preventive",
    description: "Professional teeth cleaning and polishing.",
    durationMinutes: 30,
    bufferMinutes: 15,
    pricePhp: 800,
    requiresXray: false,
  },
  {
    name: "Composite Tooth-Colored Filling",
    category: "Restorative",
    description: "Tooth-colored resin filling for cavities.",
    durationMinutes: 45,
    bufferMinutes: 15,
    pricePhp: 1500,
    requiresXray: false,
  },
  {
    name: "Simple Tooth Extraction",
    category: "Oral Surgery",
    description: "Removal of a visible, non-impacted tooth.",
    durationMinutes: 45,
    bufferMinutes: 15,
    pricePhp: 1200,
    requiresXray: true,
    requiredChairTag: "Surgery",
  },
  {
    name: "Root Canal Therapy (Single Canal)",
    category: "Endodontics",
    description: "Endodontic treatment of a single-canal tooth.",
    durationMinutes: 90,
    bufferMinutes: 15,
    pricePhp: 6000,
    requiresXray: true,
  },
  {
    name: "Orthodontic Braces Consultation & Adjustment",
    category: "Orthodontics",
    description: "Braces consultation or routine adjustment visit.",
    durationMinutes: 30,
    bufferMinutes: 10,
    pricePhp: 1000,
    requiresXray: false,
  },
  {
    name: "Emergency Toothache & Triage Exam",
    category: "Emergency",
    description: "Urgent pain assessment and triage.",
    durationMinutes: 30,
    bufferMinutes: 10,
    pricePhp: 700,
    requiresXray: true,
  },
] as const;
