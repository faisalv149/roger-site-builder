/**
 * What an owner told Roger about their business (in the iMessage conversation): corrections, prices, photos, review
 * picks, service area, the trade. The highest-ranked source on the fact sheet. Kept per business, newest per field.
 */
import { studioDocs } from '../store.js';

export interface OwnerInput { field: string; value: string | string[]; at: string; from: string }
interface Doc { businessKey: string; inputs: OwnerInput[] }
const id = (businessKey: string) => businessKey.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 150);

export async function ownerInputs(businessKey: string): Promise<OwnerInput[]> {
  return (await studioDocs.get<Doc>('splash-owner-inputs', id(businessKey)))?.inputs ?? [];
}
/** record what the owner said (a later answer for the same field replaces the earlier one) */
export async function addOwnerInput(businessKey: string, input: OwnerInput): Promise<OwnerInput[]> {
  const inputs = [...(await ownerInputs(businessKey)).filter((i) => i.field !== input.field), input];
  await studioDocs.put('splash-owner-inputs', id(businessKey), { businessKey, inputs } satisfies Doc);
  return inputs;
}
