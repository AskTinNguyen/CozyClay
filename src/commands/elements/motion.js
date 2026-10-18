import { registerElementKind } from '../elements.js';

const elements = [
  { path: 'motion.take.prompt', type: 'string' },
  { path: 'motion.ikKeys', type: 'array', readOnly: true },
  { path: 'motion.takeRecipe', type: 'object', readOnly: true },
  { path: 'motion.takeVersions', type: 'array', readOnly: true },
];
registerElementKind('motion', { collection: true, elements, normalize: row => ({ ...row, take: row.take && { ...row.take } }) });
