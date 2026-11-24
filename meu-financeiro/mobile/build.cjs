const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const source = path.join(__dirname, '..', 'public');
const output = process.argv[2] && path.resolve(process.argv[2]);
if (!output) throw new Error('Informe o diretório da versão para celular.');

const assets = [
  'app.js', 'monthly-budget.js', 'local-store.js', 'style.css', 'auth.css', 'charts.css',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'
];
fs.mkdirSync(output, { recursive: true });
for (const asset of assets) fs.copyFileSync(path.join(source, asset), path.join(output, asset));

const index = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
  .replace(/<html lang="pt-BR">/, '<html lang="pt-BR" data-storage="local">')
  .replace('<title>Meu Financeiro</title>', '<link rel="apple-touch-icon" href="./icon-192.png">\n  <title>Meu Financeiro</title>');
fs.writeFileSync(path.join(output, 'index.html'), index);

const workerTemplate = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const hash = createHash('sha256').update(workerTemplate);
for (const asset of [...assets, 'index.html']) hash.update(fs.readFileSync(path.join(output, asset)));
const worker = workerTemplate
  .replace('__CACHE_REVISION__', hash.digest('hex').slice(0, 16))
  .replace('__ASSETS__', JSON.stringify(['index.html', ...assets]));
fs.writeFileSync(path.join(output, 'sw.js'), worker);
