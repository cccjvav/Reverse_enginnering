import { createHmac, randomBytes } from 'node:crypto';

/**
 * Preview token (R2 §6.1-7): binds a confirmation to the catalog revision and the exact input without being a hash of
 * that input, which may contain credentials. The key is random per extension-host process; tokens never persist.
 */
const KEY = randomBytes(32);

export function externalMcpPreviewToken(revision: string, input: string): string {
  return createHmac('sha256', KEY).update(revision).update('\0').update(input).digest('hex');
}
