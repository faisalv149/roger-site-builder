/**
 * The trade playbook for Roger's one-page splash homepage: for each trade, how it is recognised, what its first screen
 * must answer, its main action and dock, the order of its screens, the plain standard flow a visitor can expect, and
 * its watch-outs (hard rules for copy and layout).
 *
 * The scroll order is standardised: every trade uses STANDARD_ORDER unless its family needs a different emphasis
 * (food leads with the menu, health and calm trades lead with what to expect). A row changes the order only through
 * its family, never on its own, so pages stay consistent across trades.
 */

/** the screens a splash page can have, in their standard order */
export type ScreenId = 'hero' | 'proof' | 'offer' | 'work' | 'expect' | 'about' | 'faq' | 'where' | 'cta';
export const SCREEN_LABELS: Record<ScreenId, string> = {
  hero: 'Hero', proof: 'Proof', offer: 'Offer', work: 'Work', expect: 'What to expect', about: 'About', faq: 'FAQ', where: 'Where and when', cta: 'Final call to action',
};
/** the standard order: what they do → why trust them → what they offer → their work → how it goes → who → questions → where/when → act */
export const STANDARD_ORDER: ScreenId[] = ['hero', 'proof', 'offer', 'work', 'expect', 'about', 'faq', 'where', 'cta'];

/** dock actions (the main action is one of these) */
export type Action = 'call' | 'text' | 'book' | 'order' | 'reserve' | 'quote' | 'directions' | 'menu';
export const ACTION_LABELS: Record<Action, string> = { call: 'Call', text: 'Text', book: 'Book', order: 'Order', reserve: 'Reserve', quote: 'Get a quote', directions: 'Directions', menu: 'Menu' };

/**
 * A trade's family sets its scroll order and its tone:
 *  service  home and auto services (proof early: trust decides the call)
 *  food     restaurants, cafes, bakeries, bars (the menu and the food lead)
 *  beauty   salons, barbers, spas, nails (services and prices, then the work)
 *  health   dentists, clinics, therapists, vets (what to expect early; minimal contact form)
 *  calm     restoration, counselling, funeral (no motion at all; quiet, plain)
 *  retail   shops, florists
 *  pro      lawyers, accountants, agents and other professional services
 */
export type Family = 'service' | 'food' | 'beauty' | 'health' | 'calm' | 'retail' | 'pro';
export const FAMILY_ORDER: Record<Family, ScreenId[]> = {
  service: STANDARD_ORDER,
  beauty: STANDARD_ORDER,
  retail: STANDARD_ORDER,
  pro: STANDARD_ORDER,
  food: ['hero', 'offer', 'work', 'proof', 'about', 'expect', 'faq', 'where', 'cta'],
  health: ['hero', 'offer', 'expect', 'about', 'proof', 'work', 'faq', 'where', 'cta'],
  calm: ['hero', 'offer', 'expect', 'about', 'proof', 'work', 'faq', 'where', 'cta'],
};

/** watch-outs every trade shares (each row adds its own) */
export const COMMON_WATCH_OUTS = [
  'Every fact comes from the fact sheet; a fact with no source is not on the page.',
  'No superlatives ("best", "#1", "top-rated") outside a quoted review or a sourced award.',
  'Never infer prices, credentials, licences, years in business, awards, service areas, 24/7 or emergency availability, response times, financing, warranties, insurance accepted, "free estimate", "family owned" or "accepting new patients".',
  'Service names, prices and durations exactly as the business writes them.',
  'Reviews verbatim, attributed, labelled "Selected reviews", next to the full rating and count.',
  'No stock or AI-generated images of the business, its work, food, team or space.',
];

export interface TradeRow {
  id: string;
  label: string;
  family: Family;
  /** Google place types that identify the trade (primaryType first, then types) */
  googleTypes: string[];
  /** words in the business's category, name or website that point to the trade (lower-case, whole words) */
  keywords: string[];
  /** the most specific schema.org LocalBusiness subtype */
  schemaType: string;
  /** what the first screen must answer at 390x844, besides what they do and where */
  firstScreen: string;
  /** the main action, then the secondary dock actions in order (the dock shows what the business has links for) */
  mainAction: Action;
  dock: Action[];
  /** the plain standard flow for the trade ("What to expect" when the business states none); no guarantees */
  standardFlow: string[];
  /** trade-specific hard rules */
  watchOuts: string[];
}

const HOME = (id: string, label: string, googleTypes: string[], keywords: string[], schemaType: string, firstScreen: string, extra: string[], flow?: string[]): TradeRow => ({
  id, label, family: 'service', googleTypes, keywords, schemaType, firstScreen, mainAction: 'call', dock: ['quote', 'text', 'directions'],
  standardFlow: flow ?? ['You call or send the job details.', 'They confirm what is needed and when they can come.', 'They do the work and walk you through it.'],
  watchOuts: extra,
});

export const PLAYBOOK: TradeRow[] = [
  // ── home and auto services ──
  HOME('plumber', 'Plumber', ['plumber'], ['plumber', 'plumbing', 'drain', 'drains', 'water heater', 'sewer'], 'Plumber', 'The towns they serve and a one-tap call.',
    ['No "24/7", emergency or response-time claims unless the business states them.', 'Licence numbers only exactly as the business shows them.']),
  HOME('hvac', 'Heating and cooling', ['hvac_contractor', 'air_conditioning_contractor', 'heating_contractor'], ['hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'boiler', 'heat pump'], 'HVACBusiness', 'The towns they serve and a one-tap call.',
    ['No financing, warranty or rebate claims unless stated, with their terms.', 'Seasonal offers only with a stated date.']),
  HOME('electrician', 'Electrician', ['electrician'], ['electrician', 'electrical', 'wiring', 'rewire'], 'Electrician', 'The towns they serve and a one-tap call.',
    ['No safety advice or DIY instructions.', 'Licence numbers only exactly as shown.']),
  HOME('roofer', 'Roofer', ['roofing_contractor'], ['roofing', 'roofer', 'roof', 'gutters', 'shingle'], 'RoofingContractor', 'The towns they serve and how to get a quote.',
    ['No insurance-claim promises or "we handle your claim" unless stated.', 'No "free inspection" unless the business says free.', 'No storm-urgency language.'],
    ['You ask for a quote and describe the roof.', 'They inspect and explain what they found.', 'They agree the work and schedule it.']),
  HOME('contractor', 'General contractor', ['general_contractor', 'home_builder'], ['contractor', 'remodeling', 'renovation', 'construction', 'builder'], 'GeneralContractor', 'What kind of projects and how to get a quote.',
    ['Project photos only of their own work (owner or website).'],
    ['You describe the project.', 'They visit, measure and give a quote.', 'They schedule and build.']),
  HOME('painter', 'Painter', ['painter'], ['painting', 'painter', 'painters'], 'HousePainter', 'Interior, exterior or both, and how to get a quote.', []),
  HOME('landscaper', 'Landscaping', ['landscaper', 'landscaping', 'lawn_care'], ['landscaping', 'landscaper', 'lawn', 'garden', 'yard', 'tree'], 'LandscapingBusiness', 'The towns they serve and how to get a quote.', []),
  HOME('cleaning', 'Cleaning service', ['house_cleaning_service', 'cleaning_service'], ['cleaning', 'cleaners', 'maid', 'janitorial'], 'HousekeepingService', 'What they clean and how to book.', ['No "eco-friendly" or "non-toxic" claims unless stated.']),
  HOME('locksmith', 'Locksmith', ['locksmith'], ['locksmith', 'lockout', 'locks', 'keys'], 'Locksmith', 'The area they cover and a one-tap call.',
    ['No price quoted unless the business states it exactly (no "from $19" lures).', 'No response-time claims unless stated.']),
  HOME('movers', 'Moving company', ['moving_company'], ['moving', 'movers', 'removals', 'relocation'], 'MovingCompany', 'Local or long distance, and how to get a quote.', ['No licence or insurance claims unless stated (with numbers as shown).']),
  HOME('pest', 'Pest control', ['pest_control_service'], ['pest', 'exterminator', 'termite', 'rodent'], 'HomeAndConstructionBusiness', 'The pests they treat and a one-tap call.', ['No safety claims about chemicals unless stated.']),
  {
    id: 'auto', label: 'Auto repair', family: 'service', googleTypes: ['car_repair', 'auto_parts_store', 'car_dealer'], keywords: ['auto', 'mechanic', 'garage', 'brakes', 'tyres', 'tires', 'car repair'],
    schemaType: 'AutoRepair', firstScreen: 'What they fix, today\'s hours and a one-tap call.', mainAction: 'call', dock: ['book', 'directions', 'text'],
    standardFlow: ['You call or book a slot.', 'They check the car and explain the work and cost first.', 'They fix it and hand it back.'],
    watchOuts: ['No certifications (ASE or similar) or warranties unless stated.', '"Free diagnostic" only if the business says free.'],
  },
  // ── food ──
  {
    id: 'restaurant', label: 'Restaurant', family: 'food', googleTypes: ['restaurant', 'meal_takeaway', 'meal_delivery', 'fast_food_restaurant', 'pizza_restaurant', 'steak_house', 'seafood_restaurant', 'sushi_restaurant', 'indian_restaurant', 'italian_restaurant', 'mexican_restaurant', 'chinese_restaurant', 'thai_restaurant', 'american_restaurant', 'hamburger_restaurant', 'barbecue_restaurant', 'vegetarian_restaurant', 'mediterranean_restaurant', 'middle_eastern_restaurant', 'japanese_restaurant', 'korean_restaurant', 'vietnamese_restaurant', 'french_restaurant', 'brunch_restaurant', 'breakfast_restaurant'],
    keywords: ['restaurant', 'kitchen', 'grill', 'bistro', 'eatery', 'diner', 'pizzeria', 'menu'],
    schemaType: 'Restaurant', firstScreen: 'Open now or today\'s hours, and the menu or order/reserve.', mainAction: 'order', dock: ['reserve', 'menu', 'directions', 'call'],
    standardFlow: ['Order ahead, book a table or walk in.', 'Pick up, eat in or have it delivered, as the restaurant offers.'],
    watchOuts: ['Dietary and allergen claims (halal, vegan, gluten-free, nut-free) only as the business states them.', 'No "fresh", "homemade" or "authentic" unless the business says it.', 'Menu prices exactly as listed, with the date they were read when known.', 'Hours must be current: open-now comes from Google live.'],
  },
  {
    id: 'cafe', label: 'Cafe', family: 'food', googleTypes: ['cafe', 'coffee_shop', 'tea_house', 'juice_shop'], keywords: ['cafe', 'café', 'coffee', 'espresso', 'tea'],
    schemaType: 'CafeOrCoffeeShop', firstScreen: 'Open now or today\'s hours, and the menu.', mainAction: 'directions', dock: ['menu', 'order', 'call'],
    standardFlow: ['Walk in, order at the counter or ahead.', 'Stay or take it with you.'],
    watchOuts: ['Dietary claims only as stated.', 'No "single origin", "organic" or "locally roasted" unless stated.'],
  },
  {
    id: 'bakery', label: 'Bakery', family: 'food', googleTypes: ['bakery', 'dessert_shop', 'confectionery', 'donut_shop'], keywords: ['bakery', 'bakeshop', 'cakes', 'pastry', 'patisserie', 'bread', 'cupcakes'],
    schemaType: 'Bakery', firstScreen: 'Open now or today\'s hours, and what they bake (custom orders if offered).', mainAction: 'order', dock: ['call', 'menu', 'directions'],
    standardFlow: ['Visit the shop or order ahead.', 'For custom cakes, share the date and design; they confirm the details.'],
    watchOuts: ['Allergen and dietary claims only as stated.', 'Custom-order lead times only as stated.'],
  },
  {
    id: 'bar', label: 'Bar', family: 'food', googleTypes: ['bar', 'pub', 'wine_bar', 'night_club'], keywords: ['bar', 'pub', 'tavern', 'taproom', 'cocktails'],
    schemaType: 'BarOrPub', firstScreen: 'Open now or tonight\'s hours, and what\'s on.', mainAction: 'directions', dock: ['reserve', 'menu', 'call'],
    standardFlow: ['Walk in, or reserve where the bar takes bookings.'],
    watchOuts: ['Events only with stated dates.', 'No drink promotions without stated dates and terms.'],
  },
  // ── beauty ──
  {
    id: 'salon', label: 'Hair salon', family: 'beauty', googleTypes: ['hair_salon', 'hair_care', 'beauty_salon'], keywords: ['salon', 'hair', 'stylist', 'colour', 'color', 'blowout'],
    schemaType: 'HairSalon', firstScreen: 'What they do and a one-tap booking.', mainAction: 'book', dock: ['call', 'text', 'directions'],
    standardFlow: ['Book online or call.', 'Talk through what you want with your stylist.', 'Your appointment, then rebooking if you like.'],
    watchOuts: ['Prices exactly as listed ("from" kept when they write it).', 'Stylist names only as the business shows them.', 'Before-and-after photos only from the owner or the business\'s own site.'],
  },
  {
    id: 'barber', label: 'Barber', family: 'beauty', googleTypes: ['barber_shop'], keywords: ['barber', 'barbers', 'fade', 'shave', 'grooming'],
    schemaType: 'HairSalon', firstScreen: 'Walk-ins or booking, today\'s hours, and a one-tap booking.', mainAction: 'book', dock: ['call', 'directions', 'text'],
    standardFlow: ['Book a slot or walk in.', 'Choose the cut; your barber confirms it before starting.'],
    watchOuts: ['Prices exactly as listed.', 'Walk-ins mentioned only if the business says so.'],
  },
  {
    id: 'nails', label: 'Nail salon', family: 'beauty', googleTypes: ['nail_salon'], keywords: ['nails', 'manicure', 'pedicure', 'gel'],
    schemaType: 'NailSalon', firstScreen: 'What they do and a one-tap booking.', mainAction: 'book', dock: ['call', 'directions', 'text'],
    standardFlow: ['Book or walk in.', 'Choose your service and design.'], watchOuts: ['Prices exactly as listed.'],
  },
  {
    id: 'spa', label: 'Spa', family: 'beauty', googleTypes: ['spa', 'massage', 'skin_care_clinic', 'beauty_salon'], keywords: ['spa', 'massage', 'facial', 'skincare', 'wellness'],
    schemaType: 'DaySpa', firstScreen: 'The treatments and a one-tap booking.', mainAction: 'book', dock: ['call', 'directions', 'text'],
    standardFlow: ['Book a treatment.', 'Arrive a little early; they check what you need.', 'Your treatment.'],
    watchOuts: ['No health or medical benefit claims.', 'Treatment durations and prices exactly as listed.'],
  },
  {
    id: 'fitness', label: 'Gym and fitness', family: 'beauty', googleTypes: ['gym', 'fitness_center', 'yoga_studio', 'sports_club'], keywords: ['gym', 'fitness', 'training', 'yoga', 'pilates', 'crossfit', 'boxing'],
    schemaType: 'ExerciseGym', firstScreen: 'Hours, what you can do there, and how to start.', mainAction: 'call', dock: ['directions', 'text', 'book'],
    standardFlow: ['Visit or get in touch.', 'They show you around and explain the options.', 'Start training.'],
    watchOuts: ['No body-transformation imagery or results claims.', 'No classes, coaches, trainers or amenities unless the business states them.', 'Membership prices only exactly as stated.'],
  },
  // ── health ──
  {
    id: 'dentist', label: 'Dentist', family: 'health', googleTypes: ['dentist', 'dental_clinic'], keywords: ['dentist', 'dental', 'orthodontist', 'teeth', 'implants'],
    schemaType: 'Dentist', firstScreen: 'What they treat, where, and a one-tap appointment request.', mainAction: 'book', dock: ['call', 'directions'],
    standardFlow: ['Request an appointment.', 'They confirm a time.', 'Your visit: they examine, explain and agree the next step with you.'],
    watchOuts: ['No outcome promises, "painless" or "pain-free" claims.', '"Accepting new patients" and insurance accepted only as stated.', 'Contact form collects name, phone and preferred time only.', 'No reviews that mention health conditions.'],
  },
  {
    id: 'clinic', label: 'Medical clinic', family: 'health', googleTypes: ['doctor', 'medical_clinic', 'physiotherapist', 'chiropractor', 'hospital', 'medical_lab'], keywords: ['clinic', 'doctor', 'medical', 'physio', 'physiotherapy', 'chiropractor', 'chiropractic'],
    schemaType: 'MedicalClinic', firstScreen: 'What they treat, where, and a one-tap appointment request.', mainAction: 'book', dock: ['call', 'directions'],
    standardFlow: ['Request an appointment.', 'They confirm a time.', 'Your visit: assessment, then a plan agreed with you.'],
    watchOuts: ['No diagnosis, treatment-outcome or cure claims.', 'Credentials exactly as stated.', 'Contact form collects name, phone and preferred time only.', 'No reviews that mention health conditions.'],
  },
  {
    id: 'vet', label: 'Veterinarian', family: 'health', googleTypes: ['veterinary_care'], keywords: ['vet', 'veterinary', 'animal hospital', 'pet clinic'],
    schemaType: 'VeterinaryCare', firstScreen: 'Where, today\'s hours, and a one-tap appointment request.', mainAction: 'book', dock: ['call', 'directions'],
    standardFlow: ['Request an appointment.', 'They confirm a time.', 'Your visit.'],
    watchOuts: ['No emergency availability unless stated.', 'Contact form collects name, phone and preferred time only.'],
  },
  // ── calm ──
  {
    id: 'restoration', label: 'Restoration', family: 'calm', googleTypes: [], keywords: ['restoration', 'water damage', 'fire damage', 'mold', 'mould', 'flood'],
    schemaType: 'HomeAndConstructionBusiness', firstScreen: 'What they restore, where, and a one-tap call.', mainAction: 'call', dock: ['quote', 'text'],
    standardFlow: ['You call and describe the damage.', 'They assess it and explain the work.', 'They restore and keep you updated.'],
    watchOuts: ['No motion at all.', 'No insurance-claim promises or response times unless stated.', 'Quiet, plain tone: no urgency language.'],
  },
  {
    id: 'counseling', label: 'Counselling', family: 'calm', googleTypes: ['psychologist', 'mental_health_service'], keywords: ['counseling', 'counselling', 'therapy', 'therapist', 'psychotherapy', 'psychologist'],
    schemaType: 'MedicalBusiness', firstScreen: 'Who they help, how sessions work, and a quiet way to get in touch.', mainAction: 'call', dock: ['book', 'text'],
    standardFlow: ['Get in touch.', 'A first conversation about what you are looking for.', 'Regular sessions, if it feels right.'],
    watchOuts: ['No motion at all.', 'No outcome promises.', 'No reviews shown (privacy); rating only if the business wants it.', 'Contact form collects name, phone and preferred time only.'],
  },
  {
    id: 'funeral', label: 'Funeral home', family: 'calm', googleTypes: ['funeral_home', 'cemetery'], keywords: ['funeral', 'cremation', 'memorial'],
    schemaType: 'FuneralHome', firstScreen: 'Who they are, where, and a direct number answered any time only if stated.', mainAction: 'call', dock: ['directions'],
    standardFlow: ['Call them.', 'They talk with you about what is needed.', 'They guide you through the arrangements.'],
    watchOuts: ['No motion at all.', 'No promotional tone, discounts or urgency.', 'Prices only as the business publishes them.'],
  },
  // ── retail and professional ──
  {
    id: 'retail', label: 'Shop', family: 'retail', googleTypes: ['store', 'clothing_store', 'florist', 'gift_shop', 'book_store', 'furniture_store', 'home_goods_store', 'jewelry_store', 'pet_store', 'shoe_store', 'grocery_store', 'supermarket', 'convenience_store'],
    keywords: ['shop', 'store', 'boutique', 'florist', 'flowers'],
    schemaType: 'Store', firstScreen: 'What they sell, open now or today\'s hours, and directions.', mainAction: 'directions', dock: ['call', 'order'],
    standardFlow: ['Visit the shop, or order where they offer it.'],
    watchOuts: ['Stock and prices only as the business states them.'],
  },
  {
    id: 'lawyer', label: 'Law firm', family: 'pro', googleTypes: ['lawyer'], keywords: ['law', 'lawyer', 'attorney', 'solicitor', 'legal'],
    schemaType: 'Attorney', firstScreen: 'The areas of law, where, and a one-tap call for a consultation.', mainAction: 'call', dock: ['book', 'directions'],
    standardFlow: ['Get in touch about your matter.', 'A first consultation.', 'They explain the options and the costs.'],
    watchOuts: ['No outcome guarantees or past-result claims unless the business publishes them.', 'No "specialist" or "expert" unless certified and stated.', 'Consultation "free" only if stated.'],
  },
  {
    id: 'accountant', label: 'Accountant', family: 'pro', googleTypes: ['accounting'], keywords: ['accountant', 'accounting', 'bookkeeping', 'tax', 'cpa'],
    schemaType: 'AccountingService', firstScreen: 'Who they help, where, and how to get in touch.', mainAction: 'call', dock: ['book', 'directions'],
    standardFlow: ['Get in touch.', 'A first conversation about what you need.', 'They agree the work and fees.'], watchOuts: ['Credentials (CPA, chartered) exactly as stated.'],
  },
  {
    id: 'realestate', label: 'Real estate', family: 'pro', googleTypes: ['real_estate_agency'], keywords: ['real estate', 'realtor', 'estate agent', 'properties'],
    schemaType: 'RealEstateAgent', firstScreen: 'The area they cover and how to get in touch.', mainAction: 'call', dock: ['text', 'directions'],
    standardFlow: ['Get in touch about buying, selling or renting.', 'They talk through what you need.', 'They guide you through the process.'],
    watchOuts: ['Fair-housing language: never describe who a home suits.', 'Sales figures only as published.'],
  },
];

/** used when the trade can't be told with confidence (below 0.7): the owner is asked to confirm the trade */
export const GENERIC_ROW: TradeRow = {
  id: 'generic', label: 'Local business', family: 'service', googleTypes: [], keywords: [], schemaType: 'LocalBusiness',
  firstScreen: 'What they do, where, and the main way to get in touch.', mainAction: 'call', dock: ['directions', 'text'],
  standardFlow: ['Get in touch.', 'They confirm what you need.', 'They take care of it.'], watchOuts: [],
};

export const tradeRow = (id: string): TradeRow => PLAYBOOK.find((r) => r.id === id) ?? GENERIC_ROW;
export const screenOrder = (row: TradeRow): ScreenId[] => FAMILY_ORDER[row.family];
/** calm trades have no motion at all; health trades collect only name, phone and preferred time */
export const isCalm = (row: TradeRow) => row.family === 'calm';
export const minimalContact = (row: TradeRow) => row.family === 'health' || row.id === 'counseling';
export const watchOuts = (row: TradeRow) => [...COMMON_WATCH_OUTS, ...row.watchOuts];
