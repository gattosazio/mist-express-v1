const HIGH_SIMILARITY_THRESHOLD = 0.65;
const MEDIUM_SIMILARITY_THRESHOLD = 0.45;
const MAX_CLARIFICATION_CHOICES = 3;

const POLICY_GUIDANCE_SUFFIX =
    'If you want, I can also check the official company policy for that.';

const POLICY_KEYWORDS = [
    'policy',
    'policies',
    'procedure',
    'procedures',
    'guideline',
    'guidelines',
    'rule',
    'rules',
    'compliance',
    'company',
    'official',
    'allowed',
    'required',
    'requirement',
    'requirements',
    'restricted',
    'prohibited',
    'forbidden',
    'permitted',
    'permission',
    'approval',
    'approvals',
    'approve',
    'approver',
    'process',
    'processes',
    'report',
    'incident',
    'incidents',
    'visitor',
    'visitors',
    'escort',
    'security',
    'hr',
    'human resources',
    'safety',
    'leave',
    'remote',
    'remote work',
    'work from home',
    'hybrid',
    'vpn',
    'mfa',
    'device',
    'devices',
    'equipment',
    'access',
    'visitor access',
    'security control',
    'security controls',
    'stipend',
    'allowance',
    'reimbursement',
    'department',
    'departments',
];

const POLICY_INTENT_PATTERNS = [
    /\bwhat\s+(?:is|are)\b.*\b(policy|process|procedure|requirement|requirements|rules?)\b/i,
    /\bwho\s+approves?\b/i,
    /\bis\b.*\brequired\b/i,
    /\bare\b.*\brequired\b/i,
    /\bmust\b/i,
    /\bcan\b.*\b(use|access|bring|submit|request|work)\b/i,
    /\bdo\b.*\bneed\b/i,
    /\bhow\s+many\b/i,
];

const UNSUPPORTED_NEGATION_PATTERNS = [
    /\bnot explicitly mentioned\b/i,
    /\bnot explicitly allowed\b/i,
    /\bnot explicitly prohibited\b/i,
    /\bnot mentioned\b/i,
    /\bnot specified\b/i,
    /\bnot addressed\b/i,
    /\bnot clear from the provided policy context\b/i,
];

const CLARIFICATION_ANY_PATTERNS = [
    'any',
    'either',
    'all',
    'whichever',
    'whatever',
    'anything',
    'doesnt matter',
    "doesn't matter",
    'not sure',
    'you decide',
];

const FOLLOW_UP_PREFIXES = [
    'what about',
    'how about',
    'and ',
    'for ',
    'about ',
    'what if',
];

const INTRO_PHRASES = [
    'remote work is allowed',
    'eligible for remote work',
    'eligibility criteria',
    'full-time and part-time employees',
    'probationary period',
    'performance tier',
];

const PRIORITY_TERMS = [
    'mfa',
    'multi-factor',
    'multi factor',
    'vpn',
    'approve',
    'approval',
    'approver',
    'devices',
    'device',
    'security',
    'access',
    'visitor',
    'escort',
    'leave',
    'stipend',
    'reimbursement',
];

module.exports = {
    HIGH_SIMILARITY_THRESHOLD,
    MEDIUM_SIMILARITY_THRESHOLD,
    MAX_CLARIFICATION_CHOICES,
    POLICY_GUIDANCE_SUFFIX,
    POLICY_KEYWORDS,
    POLICY_INTENT_PATTERNS,
    UNSUPPORTED_NEGATION_PATTERNS,
    CLARIFICATION_ANY_PATTERNS,
    FOLLOW_UP_PREFIXES,
    INTRO_PHRASES,
    PRIORITY_TERMS,
};
