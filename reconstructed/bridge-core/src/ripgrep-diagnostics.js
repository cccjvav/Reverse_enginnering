// RECONSTRUCTED from src/ripgrep-diagnostics.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var INVALID_REGEX_SIGNATURE = /regex parse error|error parsing regex|invalid regex/i;

var INVALID_GLOB_SIGNATURE = /error parsing glob/i;

function classifyRipgrepStderr(stderr) {
  if (INVALID_REGEX_SIGNATURE.test(stderr)) return "invalid_regex";
  if (INVALID_GLOB_SIGNATURE.test(stderr)) return "invalid_glob";
  return "unknown";
}

function globErrorEchoBodies(detail) {
  const bodies = [];
  const marker = /error parsing (?:ignore case )?glob '/gi;
  let match;
  while ((match = marker.exec(detail)) !== null) {
    const rest = detail.slice(match.index + match[0].length);
    const separator = rest.lastIndexOf("': ");
    bodies.push(separator >= 0 ? rest.slice(0, separator) : rest);
  }
  return bodies;
}

function attributeGlobFailure(detail, groups) {
  const echoed = globErrorEchoBodies(detail);
  if (echoed.length === 0) return void 0;
  for (const negatedPass of [false, true]) {
    let best;
    for (const group of groups) {
      if (Boolean(group.negated) !== negatedPass) continue;
      const hit = echoedNeedleHit(echoed, group);
      if (hit && (!best || hit.pattern.length > best.pattern.length)) best = hit;
    }
    if (best) return best;
  }
  return void 0;
}

function echoedNeedleHit(echoed, group) {
  let best;
  let bestLength = -1;
  for (let index = 0; index < group.values.length; index += 1) {
    const pattern = group.values[index];
    if (!pattern || pattern.length <= bestLength) continue;
    if (!echoed.includes(group.negated ? `!${pattern}` : pattern)) continue;
    bestLength = pattern.length;
    best = { field: group.field, index, pattern };
  }
  return best;
}

function formatGlobFailureLocation(location) {
  return `${location.field}[${location.index}] ${JSON.stringify(location.pattern)}`;
}

export { INVALID_GLOB_SIGNATURE, INVALID_REGEX_SIGNATURE, attributeGlobFailure, classifyRipgrepStderr, echoedNeedleHit, formatGlobFailureLocation, globErrorEchoBodies };
