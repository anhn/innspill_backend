/**
 * Scanners for task 2.2. `reviewTools` on the course config turns them on.
 * The sidebar `tools` list is a different setting and is not read here.
 * Optional scanners stay off until a teacher enables them.
 */
const REVIEW_CATALOG = [
  { id: 'eslint', name: 'ESLint', group: 'established', defaultOn: true },
  { id: 'sonarqube', name: 'SonarQube', group: 'established', defaultOn: true },
  { id: 'semgrep', name: 'Semgrep', group: 'established', defaultOn: true },
  { id: 'codeql', name: 'CodeQL', group: 'established', defaultOn: true },
  { id: 'gitleaks', name: 'Gitleaks', group: 'established', defaultOn: true },
  { id: 'osv-scanner', name: 'OSV-Scanner', group: 'established', defaultOn: true },
  { id: 'jscpd', name: 'jscpd', group: 'established', defaultOn: true },
  { id: 'lizard', name: 'Lizard', group: 'established', defaultOn: true },
  { id: 'coverage', name: 'coverage', group: 'established', defaultOn: true },
  { id: 'ai-reviewer', name: 'AI reviewer', group: 'established', defaultOn: true },
  { id: 'vibeguard', name: 'VibeGuard', group: 'vibe', defaultOn: true },
  { id: 'prodlint', name: 'prodlint', group: 'vibe', defaultOn: true },
  { id: 'shipsafe', name: 'Ship Safe', group: 'vibe', defaultOn: true },
  { id: 'vibesec', name: 'VibeSec', group: 'vibe', defaultOn: true },
  { id: 'guardvibe', name: 'GuardVibe', group: 'vibe', defaultOn: true },
  { id: 'vibecheck-ai', name: 'vibecheck-ai', group: 'optional', defaultOn: false },
  { id: 'shipsafe-pypi', name: 'shipsafe', group: 'optional', defaultOn: false },
  { id: 'vibe-hardening', name: 'vibe-hardening', group: 'optional', defaultOn: false },
  { id: 'vibechecker', name: 'vibechecker', group: 'optional', defaultOn: false },
  { id: 'vibescan-cli', name: 'vibescan-cli', group: 'optional', defaultOn: false },
];

function toolByRef(value) {
  const key = String(value || '').trim().toLowerCase();
  return REVIEW_CATALOG.find((tool) => tool.id === key || tool.name.toLowerCase() === key) || null;
}

function defaultToolIds() {
  return REVIEW_CATALOG.filter((tool) => tool.defaultOn).map((tool) => tool.id);
}

function toolName(value) {
  const tool = toolByRef(value);
  return tool ? tool.name : String(value || '').trim();
}

module.exports = {
  REVIEW_CATALOG,
  toolByRef,
  defaultToolIds,
  toolName,
};
