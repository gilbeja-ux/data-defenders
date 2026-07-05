#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const assetDir = path.join(__dirname, '..', 'assets');

// Create src directory if it doesn't exist
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
}

console.log('✓ Build directory ready');
console.log('✓ Assets available at', assetDir);
