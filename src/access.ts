import type { MasqPermissionArgs, ResolvedMasqOptions } from './types.js'

/** Only an answer of exactly `true` passes; anything else, a thrown error included, is no. */
export async function exactlyTrue(check: () => unknown): Promise<boolean> {
  try {
    return (await check()) === true
  } catch {
    return false
  }
}

/** `canMasquerade` answered exactly `true`: a truthy value or an error is a no. */
export const mayMasquerade = (opts: Pick<ResolvedMasqOptions, 'canMasquerade'>, args: MasqPermissionArgs) => exactlyTrue(() => opts.canMasquerade(args))
