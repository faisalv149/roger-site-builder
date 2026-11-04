/**
 * Re-resolve a saved site whose business identity is invalid (a postal code, a town) and regenerate its static output.
 * Deploying fixed code alone leaves the old pages in place: this rebuilds them under the same address.
 *
 *   npx tsx scripts/repair-identity.ts --scan            list sites whose saved identity is not a business
 *   npx tsx scripts/repair-identity.ts <slug>             rebuild one site
 *   npx tsx scripts/repair-identity.ts --all              rebuild every site that --scan lists
 *
 * Uses the configured store (local data folder, or Supabase/Redis when those are set), so run it where the site lives.
 */
import { findInvalidIdentities, repairIdentity } from '../src/repair.js';

const args = process.argv.slice(2);
if (args.includes('--scan') || (!args.length)) {
  const bad = await findInvalidIdentities();
  console.log(bad.length ? bad.map((b) => `${b.slug}: "${b.name}" (${b.problem})`).join('\n') : 'No saved site has an invalid identity.');
  process.exit(0);
}
const targets = args.includes('--all') ? (await findInvalidIdentities()).map((b) => b.slug) : args.filter((a) => !a.startsWith('--'));
for (const slug of targets) {
  const r = await repairIdentity({ slug }, { force: args.includes('--force') });
  console.log(`${slug}: ${r.message}`);
  if (r.build) console.log(`  ${r.build.siteUrl}  review: ${r.build.review?.status}`);
}
