// CLI:  npm run cli -- build --google "Summit Peak Roofing 78704" [--theme ./my.theme.json | --theme-id roofing-urgent] [--website https://...]
//       npm run cli -- audit --website https://example.com [--google "Name ZIP"]
//       npm run cli -- lookup "Name ZIP | maps link | place id"
//       npm run cli -- validate ./path/to/theme.json
import fs from 'node:fs';
import { buildSite, runAudit } from './pipeline.js';
import { searchCandidates } from './sources/places.js';
import { validateTheme } from './theme/load.js';

const [cmd, ...rest] = process.argv.slice(2);
const args: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { args[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? 'true' : rest[++i]; }
  else positional.push(rest[i]);
}

async function main() {
  switch (cmd) {
    case 'build': {
      const theme = args.theme ? JSON.parse(fs.readFileSync(args.theme, 'utf8')) : undefined;
      const r = await buildSite(
        { google: args.google || positional.join(' ') || undefined, placeId: args['place-id'], website: args.website, theme, themeId: args['theme-id'], vertical: args.vertical, variant: args.variant, fonts: args.fonts === 'business' ? 'business' : 'theme', brandColor: args.color, audit: args.audit !== 'false', slug: args.slug },
        (e) => { if (e.status !== 'start') console.log(`${e.status === 'error' ? '✗' : '✓'} ${e.step}${e.ms != null ? ` (${e.ms}ms)` : ''}${e.note ? ` — ${e.note}` : ''}`); },
      );
      console.log(`\nSite:   ${r.siteUrl}\nFolder: ${r.siteDir}\nTheme:  ${r.themeId} (${r.themeReason})\nTime:   ${(r.totalMs / 1000).toFixed(1)}s`);
      if (r.audit) console.log(`Audit:  ${r.audit.score}/100 → ${r.audit.reportUrl}`);
      for (const c of r.cards) console.log(`\n[iMessage: ${c.kind}]\n${c.text}${c.url ? `\n${c.url}` : ''}`);
      if (r.warnings.length) console.log(`\nWarnings:\n- ${r.warnings.join('\n- ')}`);
      break;
    }
    case 'audit': {
      const r = await runAudit({ website: args.website || positional[0], google: args.google });
      console.log(`${r.audit.score}/100 (${r.audit.grade}) · ${r.audit.issues.length} issues → ${r.reportUrl}\n`);
      for (const i of r.audit.issues) console.log(`[${i.severity}] ${i.title} — ${i.detail}`);
      console.log(`\n[iMessage]\n${r.card.text}`);
      break;
    }
    case 'lookup': {
      const r = await searchCandidates(positional.join(' ') || args.q);
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case 'validate': {
      const v = validateTheme(JSON.parse(fs.readFileSync(positional[0], 'utf8')));
      console.log(v.ok ? `✓ valid → ${v.id}` : '✗ invalid');
      for (const e of v.errors) console.log(`  error: ${e}`);
      for (const w of v.warnings) console.log(`  warning: ${w}`);
      process.exitCode = v.ok ? 0 : 1;
      break;
    }
    default:
      console.log('Usage: npm run cli -- <build|audit|lookup|validate> [options]  (see the header of src/cli.ts)');
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
