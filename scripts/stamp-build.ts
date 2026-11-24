// Stamps a deployment's version into src/build-info.ts. Run it in the deploy staging copy, never in the repo:
//   npx tsx scripts/stamp-build.ts <version> <commit>
// The version shows in the top-right corner of staff pages, on splash preview ribbons and at /api/version.
import fs from 'node:fs';

const [version, commit = ''] = process.argv.slice(2);
if (!version || !/^[\w.-]{1,20}$/.test(version) || !/^[0-9a-f]{0,40}$/i.test(commit)) {
  console.error('usage: npx tsx scripts/stamp-build.ts <version> [commit sha]');
  process.exit(1);
}
const info = { version, commit: commit.slice(0, 7), builtAt: new Date().toISOString() };
fs.writeFileSync('src/build-info.ts', `// Stamped by scripts/stamp-build.ts for this deployment.\nexport const BUILD = ${JSON.stringify(info)};\n`);
console.log('stamped', info);
