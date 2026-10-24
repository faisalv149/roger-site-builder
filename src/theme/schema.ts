import { z } from 'zod';

// Roger theme.json — schemaVersion 2.
// Validation is strict about the keys the renderer needs and *permissive* about
// everything else: unknown keys are kept (passthrough) and reported as warnings,
// so designers can add fields without breaking uploads.

const px = z.number();
const phoneDesktop = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ phone: t.optional(), desktop: t.optional() }).passthrough();
const hex = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'must be a hex color like #1D4ED8');

const imageRef = z
  .object({
    url: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    alt: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();

const sectionLayoutEntry = z
  .object({
    variant: z.string(),
    columns: phoneDesktop(z.number()).optional(),
    span: z.object({ desktop: z.number().optional(), offset: z.number().optional() }).passthrough().optional(),
    offset: z.number().optional(),
    split: z.object({ desktop: z.tuple([z.number(), z.number()]) }).passthrough().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    height: phoneDesktop(z.string()).optional(),
  })
  .passthrough();

const button = z
  .object({
    fill: z.string(),
    ink: z.string(),
    border: z.string(),
    radius: z.enum(['sm', 'md', 'lg']).or(z.string()),
    height: z.number(),
    case: z.enum(['none', 'uppercase', 'title']).or(z.string()),
    weight: z.number(),
  })
  .passthrough();

export const SECTION_IDS = ['hero', 'urgent', 'services', 'proof', 'quote', 'gallery', 'area', 'maintenance', 'footer'] as const;

export const themeSchema = z
  .object({
    meta: z
      .object({
        name: z.string(),
        vertical: z.string(),
        variant: z.string(),
        description: z.string().optional(),
        schemaVersion: z.number(),
        previewImage: z.string().optional(),
      })
      .passthrough(),
    match: z.object({ googleTypes: z.array(z.string()) }).passthrough(),
    fontPairs: z
      .array(z.object({ id: z.string(), label: z.string().optional(), heading: z.string(), body: z.string() }).passthrough())
      .min(1),
    defaultPair: z.string(),
    fontFaces: z
      .array(
        z
          .object({ family: z.string(), src: z.string().optional(), weights: z.array(z.number()).max(3).optional(), url: z.string().optional() })
          .passthrough(),
      )
      .default([]),
    type: z
      .object({
        scale: z
          .object({
            xs: px, sm: px, md: px, lg: px, xl: px, '2xl': px, '3xl': px,
            '4xl': z.object({ phone: px, desktop: px }),
          })
          .passthrough(),
        measure: z.number().default(65),
        bodyWeight: z.number().default(400),
        headingWeight: z.number().default(700),
        headingCase: z.string().default('none'),
        headingTracking: z.string().default('0'),
        lineHeight: z.object({ heading: z.number(), body: z.number() }).passthrough(),
      })
      .passthrough(),
    palette: z.object({ brand: hex, ink: hex, inkMuted: hex, surface: hex, surfaceAlt: hex }).passthrough(),
    derive: z
      .object({
        space: z.string().default('oklch'),
        tints: z.array(z.number()).default([97, 94, 90]),
        shades: z.array(z.number()).default([45, 35, 25]),
        brandInkAuto: z.boolean().default(true),
        minButtonContrast: z.number().default(4.5),
      })
      .passthrough(),
    overlayAlpha: z.number().min(0).max(1).default(0.6),
    overlayStyle: z.enum(['solid', 'gradient-left', 'gradient-bottom']).default('solid'),
    brandColor: z
      .object({
        source: z.array(z.enum(['logo', 'website', 'default'])).default(['logo', 'website', 'default']),
        rejectNearGray: z.boolean().default(true),
        rejectNeon: z.boolean().default(true),
        minChroma: z.number().default(0.04),
        maxChroma: z.number().default(0.3),
        darkenUntilContrast: z.boolean().default(true),
      })
      .passthrough(),
    logo: z
      .object({
        placement: z.string().default('header-left'),
        maxHeight: z.object({ phone: px, desktop: px }),
        band: z.string().default('surface'),
        padding: z.number().default(8),
        fallback: z.string().default('wordmark'),
        wordmark: z
          .object({ font: z.string(), case: z.string(), maxLines: z.number(), color: z.string() })
          .passthrough(),
      })
      .passthrough(),
    grid: z
      .object({
        system: z.enum(['12-col', 'asymmetric-12', 'centered-8', 'sidebar-12', 'single-col']),
        columns: z.number(),
        maxWidth: z.number(),
        gutter: z.number(),
        margin: z.object({ phone: px, desktop: px }),
        sidebar: z
          .object({ desktop: z.number(), side: z.enum(['left', 'right']), sticky: z.boolean(), holds: z.string() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    spacing: z
      .object({
        scale: z.array(z.number()).length(8),
        sectionY: z.object({ phone: px, desktop: px }),
        density: z.string(),
      })
      .passthrough(),
    radius: z.object({ sm: px, md: px, lg: px }).passthrough(),
    shadow: z.object({ card: z.string() }).passthrough(),
    buttons: z
      .object({ primary: button, secondary: button, minTapTarget: z.number().default(44), focusRing: z.string() })
      .passthrough(),
    icons: z
      .object({ set: z.string(), stroke: z.number(), size: z.number(), color: z.string(), style: z.string().optional() })
      .passthrough(),
    images: z
      .object({
        hero: z.object({ ratio: z.object({ phone: z.string(), desktop: z.string() }), fit: z.string() }).passthrough(),
        gallery: z.object({ ratio: z.string(), fit: z.string() }).passthrough(),
        minWidth: z.number(),
        minHeight: z.number(),
        maxGallery: z.number(),
        rejectTextHeavy: z.boolean().default(true),
        maxFileKb: z.number(),
      })
      .passthrough(),
    motion: z.string().default('subtle'),
    colorScheme: z.string().default('light'),
    sections: z.array(z.string()).min(1),
    sectionLayout: z.record(sectionLayoutEntry),
    sectionRules: z.record(z.record(z.any())).default({}),
    copy: z
      .object({
        hero: z.string(),
        subline: z.string(),
        urgent: z.string(),
        action: z.string(),
        actionKind: z.enum(['call', 'form']).or(z.string()),
        quoteTitle: z.string(),
        sublineNoServices: z.string(),
        heroNoCity: z.string(),
        maintenance: z.string().optional(),
      })
      .passthrough(),
    placeholders: z.array(z.string()).default(['{business}', '{city}', '{state}', '{zip}', '{rating}', '{reviewCount}', '{years}']),
    services: z.object({
      defaults: z
        // may be empty (general themes): then services come only from the business's own website/reviews
        .array(z.object({ id: z.string(), label: z.string(), icon: z.string(), keywords: z.array(z.string()) }).passthrough()),
    }).passthrough(),
    trust: z.object({ max: z.number().default(4), templates: z.record(z.string()) }).passthrough(),
    roger: z
      .object({
        stickyBar: z.boolean().default(true),
        headerCallButton: z.boolean().default(true),
        chatBubble: z.boolean().default(true),
        /** the Roger widget (Book / Chat / Call, bottom right); replaces stickyBar and chatBubble when on */
        widget: z.boolean().default(true),
        textPrefill: z.string().default(''),
        consentCopy: z.string().default(''),
        previewBanner: z.boolean().default(true),
        footerCredit: z.boolean().default(true),
      })
      .passthrough(),
    seo: z
      .object({
        titlePattern: z.string(),
        descriptionPattern: z.string(),
        schemaType: z.string().default('LocalBusiness'),
        ogImage: z.string().default('hero'),
      })
      .passthrough(),
    locale: z.string().default('en-US'),
    stock: z.object({ hero: z.array(imageRef), gallery: z.array(imageRef) }).passthrough(),
  })
  .passthrough();

export type Theme = z.infer<typeof themeSchema>;
export type SectionLayout = z.infer<typeof sectionLayoutEntry>;

/** Every section variant the renderer implements. Kept in one place so the uploader can warn on unknown ones. */
export const SUPPORTED_VARIANTS: Record<string, string[]> = {
  hero: ['full-bleed-center', 'split', 'split-form', 'stacked', 'text-only'],
  urgent: ['full-width-bar', 'callout-box'],
  services: ['cards', 'checklist', 'numbered-list', 'zigzag', 'card-list', 'icon-tiles'],
  proof: ['stat-row', 'inline-badges', 'pull-quote-band', 'review-cards'],
  quote: ['split', 'sticky-sidebar', 'inline-form', 'inset-card', 'centered-card'],
  gallery: ['filmstrip', 'uniform-grid', 'bento', 'carousel'],
  area: ['two-col-list', 'chips', 'split-list', 'card'],
  footer: ['four-col', 'three-col', 'centered-stack', 'minimal-two-col'],
  maintenance: ['plan-band'],
};
