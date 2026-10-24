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

/** A busy flyer-style graphic: used to exercise images.rejectTextHeavy. */
export function flyerSvg(w = 1200, h = 1200): string {
  const lines = Array.from({ length: 14 }, (_, i) => `<rect x="80" y="${260 + i * 62}" width="${1040 - (i % 4) * 160}" height="26" fill="#111"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>
  <rect x="60" y="60" width="1080" height="140" fill="#E11D48"/><text x="600" y="160" text-anchor="middle" font-family="Arial" font-weight="700" font-size="96" fill="#fff">SPRING SALE 20% OFF</text>${lines}</svg>`;
}
