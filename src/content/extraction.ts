/**
 * What each extractor found, so a build never says "success" because a request returned 200. Every extractor
 * reports one of four states with the counts and a reason a person can act on.
 */
export type ExtractorStatus = 'success' | 'partial' | 'failed' | 'skipped';

export interface ExtractorResult {
  name: string;
  status: ExtractorStatus;
  /** how many items it found (services, images, ...) */
  count?: number;
  /** how many the source showed, where that is known (a page that lists five services and yields three is partial) */
  expected?: number;
  reason: string;
}

export const extractorResult = (name: string, status: ExtractorStatus, reason: string, count?: number, expected?: number): ExtractorResult => ({ name, status, reason, ...(count !== undefined ? { count } : {}), ...(expected !== undefined ? { expected } : {}) });

/** Whether Claude actually read the content, whether what it returned was usable, and why a fallback took over. */
export interface ClaudeRun {
  enabled: boolean;
  via: 'api' | 'cli' | null;
  /** a request was made (false when Claude is off, or there was no text to read) */
  ran: boolean;
  /** the answer came back and passed the checks below */
  validated: boolean;
  ms?: number;
  /** what was dropped because the page text didn't support it */
  dropped: string[];
  /** why the rules/templates answered instead: no key, request failed, nothing to read, output rejected */
  fallbackReason?: string;
  error?: string;
}

export const claudeNotRun = (enabled: boolean, via: ClaudeRun['via'], reason: string): ClaudeRun => ({ enabled, via, ran: false, validated: false, dropped: [], fallbackReason: reason });

/** What a build recovered from the source website, for the report and the owner's review. */
export interface ExtractionReport {
  extractors: ExtractorResult[];
  claude: ClaudeRun;
  /** how much of what the source showed made it into the site: discovered vs kept */
  retention: { what: string; discovered: number; kept: number }[];
}

export const worst = (rs: ExtractorResult[]): ExtractorStatus => (rs.some((r) => r.status === 'failed') ? 'failed' : rs.some((r) => r.status === 'partial') ? 'partial' : rs.every((r) => r.status === 'skipped') ? 'skipped' : 'success');

/** One line per extractor for logs and the build summary. */
export const describeExtractors = (rs: ExtractorResult[]) => rs.map((r) => `${r.name}: ${r.status}${r.count !== undefined ? ` (${r.count}${r.expected !== undefined ? `/${r.expected}` : ''})` : ''} - ${r.reason}`);
