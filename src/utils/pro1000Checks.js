const VAGUE = ['rask', 'enkel', 'brukervennlig', 'god', 'fast', 'easy', 'simple', 'user-friendly', 'good'];

function check(id, level, message, target) {
  return target ? { id, level, message, target } : { id, level, message };
}

function vagueWords(text) {
  const lower = String(text || '').toLowerCase();
  return VAGUE.filter((word) => new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u').test(lower));
}

function susScore(answers) {
  const sum = answers.reduce((total, value, index) => total + (index % 2 === 0 ? value - 1 : 5 - value), 0);
  return Math.round(sum * 2.5 * 10) / 10;
}

function leafNodes(node) {
  if (!node.children || node.children.length === 0) return [node];
  return node.children.flatMap(leafNodes);
}

function rollup(node) {
  if (!node.children || node.children.length === 0) return node.hours;
  const parts = node.children.map(rollup);
  if (parts.some((hours) => hours === null || hours === undefined)) return null;
  return parts.reduce((sum, hours) => sum + hours, 0);
}

function hasCycle(tasks) {
  const byId = new Map((tasks || []).map((task) => [task.id, task.dependsOn || []]));
  const state = new Map();
  function visit(id) {
    const mark = state.get(id);
    if (mark === 'visiting') return true;
    if (mark === 'done') return false;
    state.set(id, 'visiting');
    for (const next of byId.get(id) || []) {
      if (visit(next)) return true;
    }
    state.set(id, 'done');
    return false;
  }
  return [...byId.keys()].some((id) => visit(id));
}

function requirementChecks(data) {
  const items = data.items || [];
  const checks = [];
  for (const item of items) {
    const vague = vagueWords(item.text);
    if (vague.length) checks.push(check('vague', 'warn', `Vague words: ${vague.join(', ')}`, item.id));
    if (!String(item.source || '').trim()) checks.push(check('source', 'fail', 'Requirement has no source.', item.id));
  }
  return checks;
}

function storyChecks(data) {
  const checks = [];
  for (const item of data.items || []) {
    const text = String(item.text || '');
    if (!/slik at|so that/i.test(text)) checks.push(check('so-that', 'fail', 'Story has no "slik at" / "so that".', item.id));
    if (!String(item.acceptance || '').trim()) checks.push(check('acceptance', 'fail', 'Story has no acceptance criteria.', item.id));
  }
  return checks;
}

function nfrChecks(data) {
  const checks = [];
  for (const item of data.items || []) {
    if (!String(item.scale || '').trim() || !String(item.target || '').trim() || !String(item.verification || '').trim()) {
      checks.push(check('measurable', 'fail', 'NFR needs a scale, a target, and how it will be verified.', item.id));
    }
  }
  return checks;
}

function wbsChecks(data) {
  const checks = [];
  const nodes = data.nodes || [];
  function walk(node) {
    if (node.children && node.children.length) {
      const sum = rollup(node);
      if (node.hours != null && sum != null && node.hours !== sum) {
        checks.push(check('sum', 'fail', `WBS sum is ${sum}, the package says ${node.hours}.`, node.id));
      }
      node.children.forEach(walk);
      return;
    }
    if (node.hours == null) checks.push(check('estimate', 'fail', 'Work package has no estimate.', node.id));
    else if (node.hours > 80) checks.push(check('split', 'fail', 'Work package is over 80 hours. Split it.', node.id));
  }
  nodes.forEach(walk);
  return checks;
}

function ganttChecks(data) {
  const tasks = data.tasks || [];
  if (!hasCycle(tasks)) return [];
  return [check('cycle', 'fail', 'The dependency graph has a cycle.')];
}

function usabilityChecks(data) {
  const checks = [];
  const scores = [];
  for (const participant of data.participants || []) {
    const answers = participant.answers || [];
    if (answers.length !== 10) {
      checks.push(check('sus-items', 'fail', 'SUS needs 10 answers.', participant.code));
      continue;
    }
    scores.push(susScore(answers));
  }
  if (scores.length && data.reportedAverage != null) {
    const average = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
    if (average !== data.reportedAverage) {
      checks.push(check('sus-average', 'fail', `SUS average is ${average}, the report says ${data.reportedAverage}.`));
    }
    if (data.target != null && average < data.target) {
      checks.push(check('sus-target', 'warn', `SUS average ${average} is under the target ${data.target}.`));
    }
  }
  return checks;
}

function folderChecks(data) {
  const files = data.files || [];
  const paths = files.map((file) => String(file.path || '').replace(/\\/g, '/'));
  const checks = [];
  if (!paths.includes('index.html')) checks.push(check('index', 'fail', 'index.html is missing from the root.'));
  for (const folder of ['css', 'js', 'pages']) {
    if (!paths.some((filePath) => filePath.startsWith(`${folder}/`))) {
      checks.push(check('folders', 'fail', `Missing ${folder}/ folder.`, folder));
    }
  }
  if (!paths.some((filePath) => /(^|\/)readme(\.[a-z0-9]+)?$/i.test(filePath))) {
    checks.push(check('readme', 'fail', 'README is missing.'));
  }
  for (const filePath of paths) {
    const name = filePath.split('/').pop();
    if (name !== name.toLowerCase() || /\s/.test(filePath)) {
      checks.push(check('names', 'fail', 'Use lowercase names without spaces.', filePath));
    }
  }
  const known = new Set(paths);
  for (const link of data.links || []) {
    if (link.to && !known.has(link.to)) checks.push(check('link', 'fail', `Broken link to ${link.to}.`, link.from));
  }
  return checks;
}

function testPlanChecks(data) {
  const tests = data.tests || [];
  const checks = [];
  for (const item of tests) {
    if (!item.requirementId) checks.push(check('link', 'fail', 'Test is not linked to a requirement.', item.id));
    if (!item.ran) checks.push(check('ran', 'warn', 'Test has not been run.', item.id));
  }
  return checks;
}

const CHECKERS = {
  requirements: requirementChecks,
  stories: storyChecks,
  nfr: nfrChecks,
  wbs: wbsChecks,
  gantt: ganttChecks,
  usability: usabilityChecks,
  folderTree: folderChecks,
  testPlan: testPlanChecks,
};

/**
 * Checks for one artefact. A Word upload is not checked.
 * Kinds without a rule-based checker return no checks.
 */
function checksFor(kind, data) {
  if (data && data.format === 'word') {
    return [check('word', 'warn', 'A Word upload gets an AI comment only. Automatic checks were not run.')];
  }
  const checker = CHECKERS[kind];
  return checker ? checker(data || {}) : [];
}

/**
 * Links from PRO1000 section 5. `bundle` is a map of kind to artefact data.
 */
function coverageLinks(bundle) {
  const requirements = (bundle.requirements && bundle.requirements.items) || [];
  const stories = (bundle.stories && bundle.stories.items) || [];
  const tests = (bundle.testPlan && bundle.testPlan.tests) || [];
  const stakeholders = (bundle.stakeholders && bundle.stakeholders.items) || [];
  const charter = bundle.charter || {};
  const comm = (bundle.commPlan && bundle.commPlan.rows) || [];
  const wbsLeaves = (bundle.wbs && bundle.wbs.nodes ? bundle.wbs.nodes.flatMap(leafNodes) : []);
  const ganttIds = new Set(((bundle.gantt && bundle.gantt.tasks) || []).map((task) => task.wbsId));
  const backlogIds = new Set(((bundle.backlog && bundle.backlog.items) || []).map((item) => item.storyId));
  const storyRequirementIds = new Set(stories.map((story) => story.requirementId).filter(Boolean));
  const tested = new Set(tests.map((item) => item.requirementId).filter(Boolean));
  const checks = [];

  for (const item of requirements) {
    if (!storyRequirementIds.has(item.id)) checks.push(check('requirement-story', 'fail', 'Requirement has no story.', item.id));
    if (tests.length && !tested.has(item.id)) checks.push(check('requirement-test', 'fail', 'Requirement has no test.', item.id));
  }
  for (const story of stories) {
    if (bundle.backlog && !backlogIds.has(story.id)) checks.push(check('story-backlog', 'warn', 'Story is not on the backlog.', story.id));
  }
  for (const person of stakeholders) {
    const inCharter = (charter.stakeholderIds || []).includes(person.id);
    if (bundle.charter && !inCharter) checks.push(check('stakeholder-charter', 'fail', 'Stakeholder is missing from the charter.', person.id));
    if (bundle.commPlan && !comm.some((row) => row.stakeholderId === person.id)) {
      checks.push(check('stakeholder-plan', 'fail', 'Stakeholder is missing from the communication plan.', person.id));
    }
  }
  for (const deliverable of charter.deliverableIds || []) {
    if (bundle.wbs && !wbsLeaves.some((leaf) => leaf.deliverableId === deliverable || leaf.id === deliverable)) {
      checks.push(check('deliverable-wbs', 'fail', 'Charter deliverable has no work package.', deliverable));
    }
  }
  for (const leaf of wbsLeaves) {
    if (bundle.gantt && !ganttIds.has(leaf.id)) checks.push(check('wbs-gantt', 'fail', 'Work package is missing from the Gantt.', leaf.id));
  }
  return checks;
}

module.exports = {
  vagueWords,
  susScore,
  rollup,
  hasCycle,
  checksFor,
  coverageLinks,
};
