const TRUSTED_PREFIXES = ['sum:', 'file:', 'mem:'];

export function isTrustedRef(ref) {
  return TRUSTED_PREFIXES.some(p => String(ref).startsWith(p));
}

export function assessSourceRefs(refs = []) {
  const result = {
    totalRefs: refs.length,
    trustedRefs: 0,
    artifactRefs: 0,
    otherRefs: 0,
    hasTrusted: false,
    artifactOnly: false,
  };
  for (const ref of refs) {
    if (isTrustedRef(ref)) result.trustedRefs++;
    else if (String(ref).startsWith('artifact:')) result.artifactRefs++;
    else result.otherRefs++;
  }
  result.hasTrusted = result.trustedRefs > 0;
  result.artifactOnly = result.totalRefs > 0 && result.trustedRefs === 0 && result.artifactRefs > 0;
  return result;
}
