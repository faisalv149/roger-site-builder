import type { Business } from '../types.js';

/**
 * What kind of local business this is, for wording, actions and page emphasis. Detected from Google's place types
 * (primaryType first), with a general fallback that works for anything. Themes still come from src/theme/select.ts;
 * this only shapes the design plan's labels and sections.
 */
export const CATEGORIES = ['trades', 'salon', 'food', 'fitness', 'professional', 'shop', 'health', 'general'] as const;
export type Category = (typeof CATEGORIES)[number];

/** What a site's main button can ask visitors to do. */
export const GOALS = ['call', 'quote', 'appointment', 'order', 'enquiry'] as const;
export type Goal = (typeof GOALS)[number];

export interface CategoryProfile {
  id: Category;
  label: string;
  /** section title for the offerings */
  offeringsTitle: string;
  /** one offering: "service", "treatment", "item"... */
  noun: string;
  /** shown for an offering without a known price */
  unknownPrice: string;
  /** actions that make sense here, in the order the questions offer them */
  goals: Goal[];
  /** button labels per goal */
  actions: Record<Goal, string>;
  galleryTitle: string;
  areaTitle: (city?: string) => string;
  proofTitle: (city?: string) => string;
  /** the steps of the request path (what the visitor does; never claims about quality) */
  process: (name: string) => { title: string; text: string }[];
  /** default presentation of offerings */
  offeringsVariant: 'cards' | 'price-list' | 'plans';
  /** opening hours matter more than a service area (food, shops, gyms) */
  hoursFirst: boolean;
}

const ACT = (o: Partial<Record<Goal, string>> = {}): Record<Goal, string> => ({ call: 'Call now', quote: 'Request a quote', appointment: 'Request an appointment', order: 'Order enquiry', enquiry: 'Send an enquiry', ...o });
const steps = (a: string, b: string, c: string, ta: string, tb: string, tc: string) => [{ title: a, text: ta }, { title: b, text: tb }, { title: c, text: tc }];

export const PROFILES: Record<Category, CategoryProfile> = {
  trades: {
    id: 'trades', label: 'Local trade', offeringsTitle: 'Services', noun: 'service', unknownPrice: 'Request a quote',
    goals: ['call', 'quote', 'appointment'], actions: ACT(), galleryTitle: 'Recent work', offeringsVariant: 'cards', hoursFirst: false,
    areaTitle: (c) => (c ? `Serving ${c} and nearby` : 'Where we work'), proofTitle: (c) => (c ? `Trusted in ${c}` : 'What customers say'),
    process: (n) => steps('Send a request', `${n} gets back to you`, 'You decide', 'A few details about the job and where you are.', 'To talk the job through.', 'Nothing is booked until you agree the details.'),
  },
  salon: {
    id: 'salon', label: 'Salon', offeringsTitle: 'Treatments and prices', noun: 'treatment', unknownPrice: 'Price on request',
    goals: ['appointment', 'call', 'enquiry'], actions: ACT({ appointment: 'Request an appointment' }), galleryTitle: 'Inside the salon', offeringsVariant: 'price-list', hoursFirst: true,
    areaTitle: () => 'Find us', proofTitle: () => 'What clients say',
    process: (n) => steps('Choose a treatment', 'Request a time', `${n} confirms`, 'Pick from the list above.', 'Send a preferred day and time of day.', 'Your appointment is confirmed by text or phone.'),
  },
  food: {
    id: 'food', label: 'Food & drink', offeringsTitle: 'Menu', noun: 'item', unknownPrice: 'Ask in store',
    goals: ['call', 'order', 'enquiry'], actions: ACT({ call: 'Call us', order: 'Order enquiry' }), galleryTitle: 'From the kitchen', offeringsVariant: 'price-list', hoursFirst: true,
    areaTitle: () => 'Visit us', proofTitle: () => 'What guests say',
    process: (n) => steps('Send an order enquiry', `${n} replies`, 'Collect or visit', 'What you would like and when.', 'To confirm what is available.', 'At the time you agreed.'),
  },
  fitness: {
    id: 'fitness', label: 'Fitness', offeringsTitle: 'Memberships and classes', noun: 'membership', unknownPrice: 'Ask about pricing',
    goals: ['enquiry', 'appointment', 'call'], actions: ACT({ enquiry: 'Ask about membership', appointment: 'Request a class' }), galleryTitle: 'The space', offeringsVariant: 'plans', hoursFirst: true,
    areaTitle: () => 'Find us', proofTitle: () => 'What members say',
    process: (n) => steps('Ask about joining', `${n} gets back to you`, 'Choose what suits you', 'Tell us what you are looking for.', 'With options and times.', 'Nothing is charged until you sign up.'),
  },
  professional: {
    id: 'professional', label: 'Professional services', offeringsTitle: 'Services and packages', noun: 'service', unknownPrice: 'Price on request',
    goals: ['enquiry', 'appointment', 'call'], actions: ACT({ appointment: 'Request a consultation' }), galleryTitle: 'Our work', offeringsVariant: 'cards', hoursFirst: false,
    areaTitle: () => 'Where to find us', proofTitle: () => 'What clients say',
    process: (n) => steps('Send an enquiry', 'Initial conversation', 'A clear proposal', 'A short note about what you need.', `${n} gets in touch to understand it.`, 'Scope and fees agreed before any work.'),
  },
  shop: {
    id: 'shop', label: 'Shop', offeringsTitle: 'What we stock', noun: 'product', unknownPrice: 'Price on request',
    goals: ['enquiry', 'order', 'call'], actions: ACT({ enquiry: 'Ask about an item', order: 'Order enquiry' }), galleryTitle: 'In store', offeringsVariant: 'cards', hoursFirst: true,
    areaTitle: () => 'Visit the shop', proofTitle: () => 'What customers say',
    process: (n) => steps('Ask about an item', `${n} checks`, 'Collect or arrange', 'Tell us what you are after.', 'And replies with what is available.', 'Details agreed with you.'),
  },
  health: {
    id: 'health', label: 'Health clinic', offeringsTitle: 'Services', noun: 'service', unknownPrice: 'Ask the clinic',
    goals: ['appointment', 'call', 'enquiry'], actions: ACT({ appointment: 'Book an appointment', enquiry: 'Ask a question' }), galleryTitle: 'Inside the clinic', offeringsVariant: 'cards', hoursFirst: true,
    areaTitle: () => 'Visit the clinic', proofTitle: () => 'What patients say',
    process: (n) => steps('Choose a service', 'Book a visit', `${n} sees you`, 'Pick from the list above.', 'Use the online booking page, or call.', 'At the time you chose.'),
  },
  general: {
    id: 'general', label: 'Local business', offeringsTitle: 'What we offer', noun: 'service', unknownPrice: 'Price on request',
    goals: ['enquiry', 'call', 'appointment'], actions: ACT({ call: 'Call us' }), galleryTitle: 'Photos', offeringsVariant: 'cards', hoursFirst: false,
    areaTitle: () => 'Where to find us', proofTitle: () => 'What customers say',
    process: (n) => steps('Get in touch', `${n} replies`, 'Next steps', 'Send a short message.', 'To answer your questions.', 'Agreed with you.'),
  },
};

// Google place types → category. Checked against primaryType first, then the other types.
const TYPES: [Category, RegExp][] = [
  ['trades', /^(plumber|electrician|roofing_contractor|hvac_contractor|air_conditioning_contractor|general_contractor|painter|locksmith|landscaper|lawn_care|carpenter|moving_company|pest_control|cleaning_service|handyman|contractor|flooring_contractor|window_cleaning_service|tree_service|pool_cleaning_service)$/],
  ['salon', /^(beauty_salon|hair_salon|hair_care|barber_shop|nail_salon|spa|beautician|massage|skin_care_clinic|tanning_studio|makeup_artist|wellness_center)$/],
  ['food', /(restaurant|^cafe$|^coffee_shop$|^bakery$|^bar$|^pub$|^meal_takeaway$|^meal_delivery$|^ice_cream_shop$|^food$|^deli$|^bagel_shop$|^tea_house$|^juice_shop$|^dessert_shop$|^food_court$|^brunch)/],
  ['fitness', /^(gym|fitness_center|yoga_studio|pilates_studio|sports_club|martial_arts_school|boxing_gym|dance_school|sports_activity_location|swimming_pool)$/],
  ['professional', /^(consultant|accounting|lawyer|insurance_agency|real_estate_agency|financial_planner|marketing_agency|corporate_office|tax_preparer|architect|employment_agency|travel_agency|bookkeeper|business_consultant)$/],
  ['shop', /(_store$|^store$|^florist$|^shopping_mall$|^market$|^boutique$|^gift_shop$|^book_store$)/],
  ['health', /^(chiropractor|dentist|dental_clinic|doctor|physiotherapist|physical_therapist|medical_clinic|health|optometrist|orthodontist|veterinary_care|acupuncturist|naturopath|pharmacy|hospital|medical_lab|psychologist|counselor|therapist|podiatrist|dermatologist)$/],
];

/** Category from Google types; trade themes (roofing, plumbing...) are always trades. */
export function detectCategory(b: Pick<Business, 'primaryType' | 'types'>, themeVertical?: string): Category {
  if (themeVertical && themeVertical !== 'general') return 'trades';
  for (const t of [b.primaryType, ...(b.types || [])].filter(Boolean) as string[]) {
    const hit = TYPES.find(([, re]) => re.test(t));
    if (hit) return hit[0];
  }
  return 'general';
}

export const profileFor = (c: Category | string | undefined): CategoryProfile => PROFILES[(CATEGORIES as readonly string[]).includes(c || '') ? (c as Category) : 'general'];
