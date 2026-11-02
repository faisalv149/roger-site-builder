// Procedural placeholder art: used for /stock/*.svg (theme stock placeholders) and mock "Google photos".
// Not meant to look like photos — just believable, tasteful stand-ins so layouts can be judged.

const PALETTES: Record<string, { sky: [string, string]; ground: string; main: string; accent: string; dark: string }[]> = {
  roofing: [
    { sky: ['#9CC3E6', '#E7F0F7'], ground: '#6B8F5A', main: '#8C3B2A', accent: '#E9D8C4', dark: '#3A2A24' },
    { sky: ['#F6C89F', '#FBE9D7'], ground: '#7A8B5C', main: '#47505A', accent: '#EFE6DA', dark: '#2A2F35' },
    { sky: ['#6D8AA8', '#C9D6E2'], ground: '#5C7550', main: '#5B3A29', accent: '#D9CBB8', dark: '#2B201A' },
  ],
  hvac: [
    { sky: ['#BFD9EE', '#EEF5FA'], ground: '#8AA0A8', main: '#5E6B73', accent: '#F2F4F5', dark: '#2E363B' },
    { sky: ['#FFD6A8', '#FFF1E2'], ground: '#9AA6A0', main: '#7B8790', accent: '#E9EDF0', dark: '#353D43' },
    { sky: ['#A9C7E8', '#E9F1F9'], ground: '#7F9187', main: '#41505A', accent: '#DDE4E8', dark: '#232B30' },
  ],
  plumbing: [
    { sky: ['#D8E6EF', '#F5F9FB'], ground: '#B8C4CB', main: '#9AA9B2', accent: '#E7EDF1', dark: '#33414A' },
    { sky: ['#CFE3F1', '#F2F8FC'], ground: '#A4B3BC', main: '#6E8796', accent: '#DCE6EC', dark: '#2A3942' },
    { sky: ['#E3EAEE', '#F8FAFB'], ground: '#C2CBD0', main: '#B07D4F', accent: '#EDE4DA', dark: '#3B3129' },
  ],
  electrical: [
    { sky: ['#2B3A55', '#55678A'], ground: '#3D4A5E', main: '#F2B33D', accent: '#FCE7B2', dark: '#1B2333' },
    { sky: ['#DCE4EE', '#F6F8FB'], ground: '#AEB9C6', main: '#3E4B5C', accent: '#F5C451', dark: '#222A35' },
    { sky: ['#1F2A3D', '#3E4F6B'], ground: '#2C374A', main: '#E8A93A', accent: '#FFE3A1', dark: '#141B27' },
  ],
  landscaping: [
    { sky: ['#B9DDF2', '#EEF7FC'], ground: '#5E8C3A', main: '#3F6B2A', accent: '#C9B79A', dark: '#2B4220' },
    { sky: ['#F7D9A8', '#FDF2E1'], ground: '#6E9440', main: '#4C7A33', accent: '#D8C6A5', dark: '#2F4A22' },
    { sky: ['#A8D0E6', '#E8F4FA'], ground: '#4F7F34', main: '#79A65A', accent: '#B9A27E', dark: '#28401D' },
  ],
};

function motif(vertical: string, p: (typeof PALETTES)['roofing'][number], w: number, h: number, seed: number): string {
  const gy = h * 0.72;
  const hx = w * (0.28 + (seed % 3) * 0.12);
  const hw = w * 0.42, hh = h * 0.3;
  const house = `
    <rect x="${hx}" y="${gy - hh}" width="${hw}" height="${hh}" fill="${p.accent}"/>
    <rect x="${hx + hw * 0.12}" y="${gy - hh * 0.62}" width="${hw * 0.16}" height="${hh * 0.26}" fill="${p.dark}" opacity=".55"/>
    <rect x="${hx + hw * 0.72}" y="${gy - hh * 0.62}" width="${hw * 0.16}" height="${hh * 0.26}" fill="${p.dark}" opacity=".55"/>
    <rect x="${hx + hw * 0.43}" y="${gy - hh * 0.5}" width="${hw * 0.14}" height="${hh * 0.5}" fill="${p.dark}" opacity=".75"/>`;
  const roof = `<polygon points="${hx - hw * 0.08},${gy - hh} ${hx + hw / 2},${gy - hh - h * 0.24} ${hx + hw * 1.08},${gy - hh}" fill="${p.main}"/>`;
  const shingles = Array.from({ length: 6 }, (_, i) => {
    const y = gy - hh - h * 0.24 + ((i + 1) * h * 0.24) / 7;
    const half = ((i + 1) / 7) * (hw * 0.58);
    return `<line x1="${hx + hw / 2 - half}" y1="${y}" x2="${hx + hw / 2 + half}" y2="${y}" stroke="${p.dark}" stroke-opacity=".25" stroke-width="${Math.max(2, w / 400)}"/>`;
  }).join('');
  switch (vertical) {
    case 'roofing':
      return house + roof + shingles;
    case 'hvac': {
      const ux = w * 0.18 + (seed % 2) * w * 0.4, uy = gy - h * 0.26, us = h * 0.26;
      return house.replace(/opacity=".55"/g, 'opacity=".35"') + roof.replace(p.main, p.dark) + `
        <rect x="${ux}" y="${uy}" width="${us * 1.1}" height="${us}" rx="${us * 0.06}" fill="${p.main}"/>
        <circle cx="${ux + us * 0.55}" cy="${uy + us * 0.5}" r="${us * 0.36}" fill="${p.dark}" opacity=".85"/>
        ${[0, 60, 120].map((a) => `<ellipse cx="${ux + us * 0.55}" cy="${uy + us * 0.5}" rx="${us * 0.32}" ry="${us * 0.07}" fill="${p.accent}" opacity=".5" transform="rotate(${a + seed * 13} ${ux + us * 0.55} ${uy + us * 0.5})"/>`).join('')}`;
    }
    case 'plumbing': {
      const y1 = h * 0.35, y2 = h * 0.58, sw = h * 0.07;
      return `
        <path d="M0 ${y1} H${w * 0.55} a${sw * 1.6} ${sw * 1.6} 0 0 1 ${sw * 1.6} ${sw * 1.6} V${h}" stroke="${p.main}" stroke-width="${sw}" fill="none"/>
        <path d="M${w} ${y2} H${w * 0.3} a${sw} ${sw} 0 0 0 -${sw} ${sw} V${h}" stroke="${p.dark}" stroke-opacity=".6" stroke-width="${sw * 0.8}" fill="none"/>
        <rect x="${w * 0.5}" y="${y1 - sw * 0.9}" width="${sw * 1.4}" height="${sw * 1.8}" rx="${sw * 0.2}" fill="${p.dark}" opacity=".7"/>
        <circle cx="${w * 0.5 + sw * 0.7}" cy="${y1 - sw * 1.4}" r="${sw * 0.55}" fill="none" stroke="${p.dark}" stroke-width="${sw * 0.22}" opacity=".7"/>`;
    }
    case 'electrical': {
      const bx = w * 0.5, by = h * 0.26, bs = h * 0.22;
      return `
        <path d="M0 ${h * 0.2} Q ${w * 0.5} ${h * 0.34} ${w} ${h * 0.18}" stroke="${p.dark}" stroke-width="${w / 300}" fill="none" opacity=".7"/>
        <circle cx="${bx}" cy="${by + bs * 0.55}" r="${bs * 0.55}" fill="${p.accent}" opacity=".9"/>
        <circle cx="${bx}" cy="${by + bs * 0.55}" r="${bs * 1.4}" fill="${p.main}" opacity=".18"/>
        <rect x="${bx - bs * 0.22}" y="${by + bs * 1.02}" width="${bs * 0.44}" height="${bs * 0.36}" fill="${p.dark}" opacity=".8"/>
        <polygon points="${bx - bs * 0.1},${by + bs * 0.2} ${bx + bs * 0.18},${by + bs * 0.2} ${bx + bs * 0.02},${by + bs * 0.55} ${bx + bs * 0.2},${by + bs * 0.55} ${bx - bs * 0.14},${by + bs * 0.98} ${bx - bs * 0.02},${by + bs * 0.62} ${bx - bs * 0.2},${by + bs * 0.62}" fill="${p.main}"/>`;
    }
    case 'landscaping':
    default: {
      const trees = Array.from({ length: 5 }, (_, i) => {
        const tx = w * (0.1 + i * 0.2 + ((seed + i) % 3) * 0.02), r = h * (0.08 + ((i + seed) % 3) * 0.03);
        return `<rect x="${tx - r * 0.12}" y="${gy - r * 1.2}" width="${r * 0.24}" height="${r * 1.2}" fill="${p.dark}"/><circle cx="${tx}" cy="${gy - r * 1.5}" r="${r}" fill="${i % 2 ? p.main : p.dark}" opacity=".92"/>`;
      }).join('');
      const path = `<path d="M${w * 0.45} ${h} Q ${w * 0.52} ${gy + (h - gy) * 0.4} ${w * 0.6} ${gy}" stroke="${p.accent}" stroke-width="${h * 0.08}" fill="none" opacity=".9"/>`;
      return trees + path;
    }
  }
}

export function sceneSvg(vertical: string, index: number, w = 1600, h = 1000, label?: string): string {
  const pals = PALETTES[vertical] || PALETTES.roofing;
  const p = pals[index % pals.length];
  const gy = h * 0.72;
  const hills = `<path d="M0 ${gy} Q ${w * 0.25} ${gy - h * 0.08} ${w * 0.5} ${gy - h * 0.02} T ${w} ${gy - h * 0.05} V ${h} H 0 Z" fill="${p.ground}"/>`;
  const sun = `<circle cx="${w * (0.78 - (index % 3) * 0.2)}" cy="${h * 0.2}" r="${h * 0.07}" fill="#FFFFFF" opacity=".55"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>
  <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#s)"/>${sun}${hills}${motif(vertical, p, w, h, index)}
  <rect width="${w}" height="${h}" fill="url(#v)"/>
  ${label ? `<text x="${w - 24}" y="${h - 22}" text-anchor="end" font-family="Arial, sans-serif" font-size="${Math.round(h / 40)}" fill="#fff" opacity=".7">${label}</text>` : ''}
</svg>`;
}

/**
 * Plumbing pilot fixtures: stand-ins for a crew photo, a water heater, a bathroom and a work van, so the design
 * plan's photo roles (team / projects / hero) are visibly different in screenshots. Illustrations, not photos.
 */
export function plumbingSceneSvg(kind: 'team' | 'heater' | 'bath' | 'van' | 'pipes', seed: number, w = 1600, h = 1066): string {
  const tones = [['#C9D7E2', '#EEF3F7', '#1F4E79', '#F2B33D'], ['#E6DCCF', '#F7F2EA', '#2F5D50', '#E8742B'], ['#D5DEE6', '#F4F7F9', '#7A2E2E', '#3D8BD9']][seed % 3];
  const [wall, light, uniform, accent] = tones;
  const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${wall}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`;
  const floor = `<rect y="${h * 0.78}" width="${w}" height="${h * 0.22}" fill="#9AA6AE" opacity=".55"/>`;
  let body = '';
  if (kind === 'team') {
    const n = 3 + (seed % 2);
    body = Array.from({ length: n }, (_, i) => {
      const cx = w * ((i + 1) / (n + 1)), s = h * (0.19 + ((i + seed) % 2) * 0.02), top = h * 0.3 + ((i + seed) % 2) * h * 0.03;
      return `<circle cx="${cx}" cy="${top}" r="${s * 0.32}" fill="#C69C7B"/><path d="M${cx - s * 0.36} ${top - s * 0.12} Q ${cx} ${top - s * 0.62} ${cx + s * 0.36} ${top - s * 0.12} Z" fill="${uniform}"/>
        <rect x="${cx - s * 0.62}" y="${top + s * 0.38}" width="${s * 1.24}" height="${h * 0.78 - top - s * 0.38}" rx="${s * 0.4}" fill="${uniform}"/><rect x="${cx - s * 0.22}" y="${top + s * 0.6}" width="${s * 0.44}" height="${s * 0.12}" fill="${accent}"/>`;
    }).join('');
  } else if (kind === 'heater') {
    const x = w * 0.42, tw = w * 0.16, th = h * 0.56;
    body = `<rect x="${x}" y="${h * 0.22}" width="${tw}" height="${th}" rx="${tw * 0.18}" fill="#E7ECEF" stroke="#8A979F" stroke-width="${w / 400}"/>
      <rect x="${x + tw * 0.3}" y="${h * 0.62}" width="${tw * 0.4}" height="${h * 0.06}" rx="6" fill="#56636B"/><path d="M${x + tw * 0.3} ${h * 0.22} V${h * 0.08} M${x + tw * 0.7} ${h * 0.22} V${h * 0.08}" stroke="#B07D4F" stroke-width="${w / 90}"/>
      <path d="M${x + tw} ${h * 0.4} H${w * 0.82}" stroke="${accent}" stroke-width="${w / 120}"/>`;
  } else if (kind === 'bath') {
    body = `${Array.from({ length: 10 }, (_, i) => `<line x1="0" y1="${h * 0.08 * (i + 1)}" x2="${w}" y2="${h * 0.08 * (i + 1)}" stroke="#fff" stroke-opacity=".6" stroke-width="2"/>`).join('')}
      <rect x="${w * 0.12}" y="${h * 0.5}" width="${w * 0.5}" height="${h * 0.24}" rx="${h * 0.08}" fill="#FBFCFD" stroke="#A9B4BA" stroke-width="${w / 500}"/>
      <path d="M${w * 0.55} ${h * 0.5} V${h * 0.3} H${w * 0.5}" stroke="#7D8A92" stroke-width="${w / 160}" fill="none"/>
      <rect x="${w * 0.7}" y="${h * 0.42}" width="${w * 0.16}" height="${h * 0.06}" rx="10" fill="#FBFCFD" stroke="#A9B4BA" stroke-width="3"/><rect x="${w * 0.74}" y="${h * 0.48}" width="${w * 0.08}" height="${h * 0.3}" fill="#E5EAED"/>`;
  } else if (kind === 'van') {
    const x = w * 0.18, y = h * 0.4, vw = w * 0.6, vh = h * 0.32;
    body = `<rect x="${x}" y="${y}" width="${vw}" height="${vh}" rx="${vh * 0.12}" fill="#F8FAFB"/><path d="M${x + vw} ${y + vh * 0.25} h${vw * 0.16} l${vw * 0.08} ${vh * 0.35} v${vh * 0.4} h-${vw * 0.24} Z" fill="#F8FAFB"/>
      <rect x="${x}" y="${y + vh * 0.45}" width="${vw * 1.2}" height="${vh * 0.12}" fill="${uniform}"/><circle cx="${x + vw * 0.22}" cy="${y + vh}" r="${vh * 0.18}" fill="#2B3237"/><circle cx="${x + vw * 0.95}" cy="${y + vh}" r="${vh * 0.18}" fill="#2B3237"/>`;
  } else {
    return sceneSvg('plumbing', seed, w, h);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}${floor}${body}</svg>`;
}

/** A busy flyer-style graphic: used to exercise images.rejectTextHeavy. */
export function flyerSvg(w = 1200, h = 1200): string {
  const lines = Array.from({ length: 14 }, (_, i) => `<rect x="80" y="${260 + i * 62}" width="${1040 - (i % 4) * 160}" height="26" fill="#111"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>
  <rect x="60" y="60" width="1080" height="140" fill="#E11D48"/><text x="600" y="160" text-anchor="middle" font-family="Arial" font-weight="700" font-size="96" fill="#fff">SPRING SALE 20% OFF</text>${lines}</svg>`;
}

/**
 * Category fixtures (salon, café, restaurant, gym, office, shop, electrician): simple illustrated scenes so each
 * category's photo roles are visibly different in screenshots. Illustrations, not photos.
 */
export type CategoryScene = 'salon' | 'cafe' | 'plate' | 'gym' | 'office' | 'shop' | 'electric' | 'storefront' | 'team';
export function categorySceneSvg(kind: CategoryScene, seed: number, w = 1600, h = 1066): string {
  const tones = [['#E9DED3', '#F8F3EE', '#7B3F52', '#D9A441'], ['#D7E3E0', '#F3F7F6', '#22543D', '#E07A5F'], ['#E3DCEB', '#F7F4FA', '#3B3355', '#F2A541'], ['#DCE4EE', '#F5F8FB', '#1D3557', '#E63946']][seed % 4];
  const [wall, light, deep, accent] = tones;
  const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${wall}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`;
  const floor = `<rect y="${h * 0.8}" width="${w}" height="${h * 0.2}" fill="${deep}" opacity=".18"/>`;
  const sw = w / 300;
  let body = '';
  if (kind === 'salon') {
    body = [0.22, 0.52, 0.82].map((x, i) => `<rect x="${w * x - w * 0.09}" y="${h * 0.12}" width="${w * 0.18}" height="${h * 0.34}" rx="${w * 0.09}" fill="#fff" stroke="${deep}" stroke-width="${sw}" opacity=".9"/>
      <rect x="${w * x - w * 0.07}" y="${h * 0.5}" width="${w * 0.14}" height="${h * 0.16}" rx="${w * 0.03}" fill="${i % 2 ? accent : deep}"/><rect x="${w * x - w * 0.01}" y="${h * 0.66}" width="${w * 0.02}" height="${h * 0.14}" fill="#555"/>`).join('');
  } else if (kind === 'cafe') {
    body = `<rect x="${w * 0.08}" y="${h * 0.6}" width="${w * 0.84}" height="${h * 0.05}" rx="8" fill="${deep}"/>` + [0.25, 0.48, 0.7].map((x, i) =>
      `<path d="M${w * x - w * 0.06} ${h * 0.42} h${w * 0.12} l-${w * 0.015} ${h * 0.18} h-${w * 0.09} Z" fill="#fff" stroke="${deep}" stroke-width="${sw}"/><path d="M${w * x + w * 0.055} ${h * 0.46} q${w * 0.04} 0 ${w * 0.03} ${h * 0.06} q-${w * 0.005} ${h * 0.03} -${w * 0.04} ${h * 0.03}" fill="none" stroke="${deep}" stroke-width="${sw}"/>
      <path d="M${w * x - w * 0.02} ${h * 0.38} q${w * 0.01} -${h * 0.05} 0 -${h * 0.1} M${w * x + w * 0.015} ${h * 0.38} q${w * 0.01} -${h * 0.05} 0 -${h * 0.1}" stroke="${i === 1 ? accent : '#bbb'}" stroke-width="${sw * 0.8}" fill="none"/>`).join('');
  } else if (kind === 'plate') {
    body = `<ellipse cx="${w * 0.5}" cy="${h * 0.55}" rx="${w * 0.3}" ry="${h * 0.26}" fill="#fff" stroke="#ccc" stroke-width="${sw}"/><ellipse cx="${w * 0.5}" cy="${h * 0.55}" rx="${w * 0.2}" ry="${h * 0.16}" fill="${accent}" opacity=".85"/>
      <circle cx="${w * 0.44}" cy="${h * 0.5}" r="${h * 0.05}" fill="${deep}" opacity=".7"/><circle cx="${w * 0.56}" cy="${h * 0.58}" r="${h * 0.04}" fill="#5a8f3c"/><circle cx="${w * 0.53}" cy="${h * 0.47}" r="${h * 0.03}" fill="#5a8f3c"/>
      <rect x="${w * 0.12}" y="${h * 0.3}" width="${w * 0.015}" height="${h * 0.5}" rx="6" fill="#999"/><rect x="${w * 0.86}" y="${h * 0.3}" width="${w * 0.015}" height="${h * 0.5}" rx="6" fill="#999"/>`;
  } else if (kind === 'gym') {
    const bar = (y: number, s: number) => `<rect x="${w * 0.15}" y="${y}" width="${w * 0.7}" height="${h * 0.02}" fill="#444"/>${[0.17, 0.22, 0.78, 0.83].map((x) => `<rect x="${w * x - w * 0.02 * s}" y="${y - h * 0.09 * s}" width="${w * 0.04 * s}" height="${h * 0.2 * s}" rx="8" fill="${deep}"/>`).join('')}`;
    body = `${bar(h * 0.45, 1)}<rect x="${w * 0.12}" y="${h * 0.7}" width="${w * 0.76}" height="${h * 0.04}" fill="${accent}" opacity=".8"/>`;
  } else if (kind === 'office') {
    body = `<rect x="${w * 0.15}" y="${h * 0.58}" width="${w * 0.7}" height="${h * 0.04}" fill="${deep}"/><rect x="${w * 0.2}" y="${h * 0.62}" width="${w * 0.02}" height="${h * 0.18}" fill="${deep}"/><rect x="${w * 0.78}" y="${h * 0.62}" width="${w * 0.02}" height="${h * 0.18}" fill="${deep}"/>
      <rect x="${w * 0.38}" y="${h * 0.32}" width="${w * 0.24}" height="${h * 0.24}" rx="10" fill="#2b2f36"/><rect x="${w * 0.4}" y="${h * 0.34}" width="${w * 0.2}" height="${h * 0.19}" fill="${accent}" opacity=".5"/>
      <rect x="${w * 0.7}" y="${h * 0.12}" width="${w * 0.18}" height="${h * 0.26}" fill="#fff" stroke="${deep}" stroke-width="${sw}"/><path d="M${w * 0.72} ${h * 0.32} l${w * 0.04} -${h * 0.08} l${w * 0.04} ${h * 0.04} l${w * 0.05} -${h * 0.1}" stroke="${accent}" stroke-width="${sw}" fill="none"/>`;
  } else if (kind === 'shop') {
    body = [0.3, 0.5, 0.7].map((y) => `<rect x="${w * 0.1}" y="${h * y}" width="${w * 0.8}" height="${h * 0.02}" fill="${deep}"/>`).join('') +
      Array.from({ length: 18 }, (_, i) => { const row = Math.floor(i / 6), x = 0.13 + (i % 6) * 0.125; const c = [accent, deep, '#6aa', '#c66', '#da5', '#8a6'][(i + seed) % 6]; return `<rect x="${w * x}" y="${h * (0.14 + row * 0.2)}" width="${w * 0.1}" height="${h * 0.16}" rx="8" fill="${c}" opacity=".85"/>`; }).join('');
  } else if (kind === 'electric') {
    body = `<rect x="${w * 0.36}" y="${h * 0.16}" width="${w * 0.28}" height="${h * 0.6}" rx="12" fill="#e8ecef" stroke="#7d8a92" stroke-width="${sw}"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${w * (0.39 + (i % 2) * 0.12)}" y="${h * (0.22 + Math.floor(i / 2) * 0.1)}" width="${w * 0.1}" height="${h * 0.06}" rx="4" fill="${i === 3 ? accent : '#4b5560'}"/>`).join('')}
      <path d="M${w * 0.5} ${h * 0.76} V${h * 0.9}" stroke="#333" stroke-width="${sw * 2}"/><circle cx="${w * 0.18}" cy="${h * 0.3}" r="${h * 0.08}" fill="${accent}" opacity=".7"/>`;
  } else if (kind === 'storefront') {
    body = `<rect x="${w * 0.12}" y="${h * 0.25}" width="${w * 0.76}" height="${h * 0.55}" fill="#fff" stroke="${deep}" stroke-width="${sw}"/><rect x="${w * 0.12}" y="${h * 0.18}" width="${w * 0.76}" height="${h * 0.1}" fill="${deep}"/>
      <rect x="${w * 0.18}" y="${h * 0.36}" width="${w * 0.3}" height="${h * 0.3}" fill="${light}" stroke="${deep}" stroke-width="${sw * 0.6}"/><rect x="${w * 0.58}" y="${h * 0.36}" width="${w * 0.22}" height="${h * 0.44}" fill="${accent}" opacity=".7"/>
      ${Array.from({ length: 8 }, (_, i) => `<path d="M${w * (0.12 + i * 0.095)} ${h * 0.28} h${w * 0.095} l-${w * 0.02} ${h * 0.06} h-${w * 0.055} Z" fill="${i % 2 ? '#fff' : accent}"/>`).join('')}`;
  } else {
    return plumbingSceneSvg('team', seed, w, h);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}${floor}${body}</svg>`;
}
