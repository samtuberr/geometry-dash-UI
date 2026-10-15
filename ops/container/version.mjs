import { writeFileSync } from 'node:fs';

const revision = process.env.VCS_REF;
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) {
  throw new Error('VCS_REF must be a full Git commit SHA');
}
writeFileSync('dist/version.json', JSON.stringify({ app: 'geometrydash-ui', revision }) + '\n');
