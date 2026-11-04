import { claudeEnabled, claudeJson } from '../content/claude.js';
import { faithful } from '../content/story.js';
import { config } from '../config.js';
import { studioDocs } from '../store.js';
import { sha256 } from './snapshot.js';
import type { BusinessBrief } from './schema.js';

/**
 * A short AI summary of the evidence ("what this business is, for whom, where"), written once per snapshot and
 * cached: a rerun with the same snapshot gets the same words back. It is kept apart from the brief's facts and
 * hash, and it is checked against the evidence (no new numbers, names or claims) before it is kept. It never
 * changes the service inventory: the services are the brief's, not the model's.
 */
// 3: the check reads a number at the end of a sentence without its full stop, and the summary's sentences in groups
export const SUMMARY_PROMPT_VERSION = 'brief-summary-3';

export async function summarize(brief: BusinessBrief, evidenceText: string): Promise<BusinessBrief['summary']> {
  const inputHash = sha256(`${SUMMARY_PROMPT_VERSION}\n${brief.snapshotId}\n${evidenceText}`);
  const cached = await studioDocs.get<BusinessBrief['summary']>('studio-ai', `sum_${inputHash.slice(0, 40)}`);
  if (cached) return cached;
  if (!claudeEnabled() || process.env.STUDIO_SUMMARY === '0') return { status: 'unavailable', text: null, reason: 'Claude is not available here', inputHash };
  if (evidenceText.length < 60) return { status: 'unavailable', text: null, reason: 'too little evidence to summarise', inputHash };
  const r = await claudeJson<{ summary: string }>({
    system: 'You summarise evidence about a small business for a website designer. Write 2 or 3 plain sentences: what the business is and does, for whom, and where. Use only the evidence; add no facts, numbers, names, awards, guarantees or promises; do not list every service; no marketing language.',
    prompt: evidenceText.slice(0, 4000),
    toolName: 'brief_summary',
    toolDescription: 'the summary: {"summary": string}',
    schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false },
    maxTokens: 400,
  });
  const text = r?.data.summary?.replace(/\s+/g, ' ').trim();
  let out: BusinessBrief['summary'];
  if (!text) out = { status: 'unavailable', text: null, reason: 'Claude did not answer', inputHash };
  else {
    // the checker reads paragraphs of at most 420 characters: the summary's sentences, grouped to fit
    const groups: string[] = [];
    for (const s of text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [text]) {
      const last = groups[groups.length - 1];
      if (last !== undefined && (last.length < 40 || `${last} ${s.trim()}`.length <= 420)) groups[groups.length - 1] = `${last} ${s.trim()}`;
      else groups.push(s.trim());
    }
    const problem = text.length > 900 ? 'the summary is too long' : faithful(evidenceText, groups, brief.identity.name.value || '');
    out = problem ? { status: 'rejected', text: null, reason: problem === 'the summary is too long' ? problem : `the summary added something the evidence does not say (${problem})`, inputHash } : { status: 'written', text, model: config.anthropicModel, inputHash };
  }
  await studioDocs.put('studio-ai', `sum_${inputHash.slice(0, 40)}`, out);
  return out;
}
