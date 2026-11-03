const REQUIREMENT = /^>=\s*(\d+)\.(\d+)\.(\d+)$/u;
const HOST_CORE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

/** A requirement is comparable only as `[major, minor, patch]`; anything else is a manifest error. */
export type McodeEngineRequirement = readonly [number, number, number];

/** Only `>=MAJOR.MINOR.PATCH` is supported; anything else reads as undefined. */
export function parseMcodeEngineRequirement(requirement: string): McodeEngineRequirement | undefined {
  return core(REQUIREMENT.exec(requirement.trim()));
}

/** Pre-release and build suffixes are ignored: `3.2.0-beta.1` counts as `3.2.0`. */
function parseHostVersionCore(hostVersion: string): McodeEngineRequirement | undefined {
  return core(HOST_CORE.exec(hostVersion.trim()));
}

/**
 * A Host withholds a Mini App only when it is a parsable release older than the package's
 * `engines.mcode`. No requirement, no Host version, or a version the Host cannot parse (a dev build
 * without one) never gates.
 */
export function hostWithholdsMiniApp(
  hostVersion: string | undefined,
  requirement: string | undefined,
): boolean {
  if (!requirement || !hostVersion || !parseHostVersionCore(hostVersion)) return false;
  return !satisfiesMcodeEngine(hostVersion, requirement);
}

function satisfiesMcodeEngine(hostVersion: string, requirement: string): boolean {
  const required = parseMcodeEngineRequirement(requirement);
  const host = parseHostVersionCore(hostVersion);
  if (!required || !host) return false;
  const [hostMajor, hostMinor, hostPatch] = host;
  const [major, minor, patch] = required;
  if (hostMajor !== major) return hostMajor > major;
  if (hostMinor !== minor) return hostMinor > minor;
  return hostPatch >= patch;
}

function core(match: RegExpExecArray | null): McodeEngineRequirement | undefined {
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
