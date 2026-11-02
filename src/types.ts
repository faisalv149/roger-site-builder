// Normalized data the rest of the pipeline works with. Places API, mock fixtures,
// and (later) the Business Profile API all map into these shapes.

export interface Photo {
  /** Places photo resource name (places/xxx/photos/yyy) or a local/remote URL */
  ref: string;
  width: number;
  height: number;
  /** Who took/uploaded the photo. Owner uploads usually match the business name. */
  authors: { name: string; uri?: string }[];
  /** Filled after download */
  localPath?: string;
  publicPath?: string;
  isOwner?: boolean;
  /**
   * What the photo shows. Live photos get this from the vision step (src/design/photos.ts); sample fixtures carry
   * it pre-filled as a stand-in for that step, the same way they stand in for the Places API.
   */
  analysis?: { kind: PhotoKind };
}

export type PhotoKind = 'team' | 'work' | 'vehicle' | 'storefront' | 'other';

export interface Review {
  author: string;
  authorUri?: string;
  rating: number;
  text: string;
  relativeTime?: string;
  publishTime?: string;
}

export interface OpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

export interface Business {
  placeId: string;
  name: string;
  primaryType?: string;
  primaryTypeLabel?: string;
  types: string[];
  formattedAddress?: string;
  shortAddress?: string;
  street?: string;
  city?: string;
  state?: string; // short code, e.g. TX
  zip?: string;
  country?: string;
  lat?: number;
  lng?: number;
  phone?: string; // national format
  phoneE164?: string;
  website?: string;
  mapsUrl?: string;
  rating?: number;
  reviewCount?: number;
  reviews: Review[];
  photos: Photo[];
  hours?: { periods: OpeningPeriod[]; weekdayText: string[] };
  utcOffsetMinutes?: number;
  businessStatus?: string;
  editorialSummary?: string;
  nearbyTowns: string[];
  /** fictional sample fixtures only: offerings with clearly labelled sample prices (never from Google) */
  offerings?: { name: string; description?: string; duration?: string; price?: { kind: string; amount?: number; max?: number; unit?: string; currency?: string }; source?: 'sample' | 'business' }[];
  /** ISO currency for prices (sample fixtures; otherwise from the country) */
  currency?: string;
  source: 'places' | 'mock';
}

export interface BusinessCandidate {
  placeId: string;
  name: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  primaryTypeLabel?: string;
  website?: string;
  mapsUrl?: string;
  photoRef?: string;
}

export interface WebsiteScan {
  url: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  error?: string;
  timing: { ttfbMs: number; totalMs: number };
  bytes: number;
  html: string;
  headers: Record<string, string>;
  redirects: string[];
  title?: string;
  description?: string;
  text: string; // visible text, trimmed
  logoCandidates: { url: string; score: number; reason: string }[];
  themeColor?: string;
  cssColors: { hex: string; count: number }[];
  fonts: { family: string; source: 'google' | 'css' }[];
  phones: string[];
  emails: string[];
  socials: { network: string; url: string }[];
  images: { src: string; alt?: string; width?: string; height?: string }[];
}

export interface BrandResult {
  brand: string; // final hex used for rendering
  brandInk: string;
  source: 'logo' | 'website' | 'default';
  rejected: { source: string; hex: string; reason: string }[];
  logo?: { publicPath: string; width: number; height: number; sourceUrl: string };
  logoRejectedReason?: string;
  tints: string[];
  shades: string[];
  fonts?: { heading?: string; body?: string; from: 'website' | 'theme' };
}

export interface Facts {
  city?: string;
  state?: string;
  zip?: string;
  years?: number;
  licensed: boolean;
  licenseNumber?: string;
  insured: boolean;
  warranty: boolean;
  open24h: boolean;
  emergency: boolean;
  maintenance: boolean;
  serviceAreas: string[];
  /** extra evidence text, e.g. from website */
  notes: string[];
  source: 'claude' | 'heuristic';
}

export interface ServiceItem {
  id: string;
  label: string;
  icon: string;
  hits: number;
  description?: string;
}

export type Step = { name: string; ms: number; ok: boolean; note?: string };
