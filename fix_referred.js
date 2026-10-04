const fs = require('fs');
const content = fs.readFileSync('js/referrals.js', 'utf8');
const lines = content.split('\n');
let count = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('let referredSection = ') || lines[i].includes('const referredSection = ')) {
    if (!lines[i].includes('referredSection = ')) {
      lines[i] = lines[i].replace(/(const|let) referredSection = /, 'referredSection = ');
      console.log('Fixed line ' + (i+1));
    }
  }
}
fs.writeFileSync('js/referrals.js', lines.join('\n'));
console.log('Fixed referredSection');