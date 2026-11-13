'use strict';
/* Copies the Brisk VS Code extension into your VS Code extensions folder. Restart VS Code afterwards. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const from = path.join(__dirname, '..', 'vscode-brisk');
const to = path.join(os.homedir(), '.vscode', 'extensions', 'brisk-language-0.1.0');

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log('Installed the Brisk extension to ' + to);
console.log('Restart VS Code, then open any .brisk file.');
