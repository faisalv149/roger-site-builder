import { BUILD } from './build-info.js';

export const buildInfo = (): { version: string; commit: string; builtAt: string } => BUILD;
/** "v12 · 1a2b3c4" for a stamped deployment; '' for a local run (nothing to show). */
export function versionLabel(withCommit = true): string {
  if (!BUILD.version || BUILD.version === 'dev') return '';
  return `v${BUILD.version}${withCommit && BUILD.commit ? ` · ${BUILD.commit}` : ''}`;
}
