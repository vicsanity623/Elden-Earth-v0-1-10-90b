const fs = require('fs');
const content = fs.readFileSync('functions/index.js', 'utf8');
const lines = content.split('\n');
let fixed = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const plotCount = Object.keys(save.plots') || 
      lines[i].includes('let plotCount = Object.keys(save.plots')) {
    if (!lines[i].includes('plotCount2') && !lines[i].includes('plotCount3')) {
      lines[i] = lines[i].replace(/const plotCount = /, 'const plotCount2 = ')
                        .replace('let plotCount = ', 'const plotCount2 = ');
      console.log('Fixed line ' + (i+1) + ': ' + lines[i].trim());
    }
  }
}
fs.writeFileSync('functions/index.js', lines.join('\n'));
console.log('Fixed remaining duplicates');