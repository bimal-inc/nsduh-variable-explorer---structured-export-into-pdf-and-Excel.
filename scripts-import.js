const { refreshDataset } = require('./services/nsduh');
const slug = process.argv[2] || 'NSDUH-2021-DS0001';
refreshDataset(slug)
  .then(r => { console.log(`Imported ${r.count} variables from ${slug}`); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
