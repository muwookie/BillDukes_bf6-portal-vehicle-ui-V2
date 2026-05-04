/**
 * Bundler for Vehicle UI Universal
 * Produces a single .ts file that can be uploaded directly to the
 * BF6 Portal Rules Editor "Script" slot.
 *
 * Fork of bundle-vehicle-ui-standalone.js targeting mods/VehicleUIuniversal.
 */

const fs = require('fs');
const path = require('path');

const MODULE_ORDER = [
    'lib/logging.ts',
    'lib/callback-handler.ts',
    'lib/events.ts',
    'lib/solid-ui.ts',
    'lib/ui-v8.ts',
    'config/StandaloneConfig.ts',
    'modules/SafeSDKWrapper.ts',
    'modules/AutoDiscoveryModule.ts',
    'modules/VehicleSpawnUIModule.ts',
    'main.script.ts',
];

const SOURCE_DIR = path.join(__dirname, '..', 'mods', 'VehicleUIuniversal');
const OUTPUT_DIR = path.join(__dirname, '..', 'dist');
const OUTPUT_FILE = 'VehicleUIUniversal.portal.ts';

if (!fs.existsSync(SOURCE_DIR)) {
    console.error('ERROR: Source folder not found: ' + SOURCE_DIR);
    process.exit(1);
}

console.log('='.repeat(60));
console.log('Vehicle UI Universal Bundler');
console.log('='.repeat(60));

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

let bundledCode = '';
bundledCode += '// @ts-nocheck\n';
bundledCode += '// Vehicle UI Universal - drop-in vehicle deploy UI for BF6 Portal\n';
bundledCode += '// Strip is positioned lower (UI_PANEL_Y=110) to clear the in-game HUD\n';
bundledCode += '// Auto-generated bundle - DO NOT EDIT\n';
bundledCode += '// Generated: ' + new Date().toISOString() + '\n\n';

console.log('\nBundling modules from: ' + SOURCE_DIR);

for (const relPath of MODULE_ORDER) {
    const fullPath = path.join(SOURCE_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
        console.error('ERROR: Module not found: ' + relPath);
        process.exit(1);
    }
    console.log('  + ' + relPath);

    let code = fs.readFileSync(fullPath, 'utf8');

    // Strip triple-slash references
    code = code.replace(/^\s*\/\/\/\s*<reference\b[^>]*\/?>\s*$/gm, '');

    // Strip ES module imports (we use namespace bundling)
    code = code
        .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
        .replace(/^import\s+['"].*?['"];?\s*$/gm, '')
        .trim();

    // Strip line comments and block comments
    const lines = code.split(/\r?\n/);
    const cleaned = [];
    let inBlockComment = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (inBlockComment) {
            if (trimmed.endsWith('*/')) inBlockComment = false;
            continue;
        }
        if (trimmed.startsWith('/*')) {
            if (trimmed.endsWith('*/')) continue;
            inBlockComment = true;
            continue;
        }
        if (trimmed.startsWith('//')) continue;
        if (trimmed.length === 0) continue;
        cleaned.push(line);
    }
    code = cleaned.join('\n').trim();

    bundledCode += '\n// ===== Module: ' + relPath + ' =====\n';
    bundledCode += code;
    bundledCode += '\n\n';
}

const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
fs.writeFileSync(outputPath, bundledCode, 'utf8');

const sizeKB = (bundledCode.length / 1024).toFixed(2);

// ASCII verification
const buf = fs.readFileSync(outputPath);
let nonAscii = 0;
let firstNonAsciiLine = -1;
let lineNo = 1;
for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0A) lineNo++;
    if (buf[i] > 127) {
        nonAscii++;
        if (firstNonAsciiLine === -1) firstNonAsciiLine = lineNo;
    }
}

console.log('\nBundle created: ' + outputPath);
console.log('File size:      ' + sizeKB + ' KB');
console.log('Non-ASCII bytes: ' + nonAscii + (firstNonAsciiLine > 0 ? ' (first at line ' + firstNonAsciiLine + ')' : ''));
console.log('='.repeat(60));

if (nonAscii > 0) {
    console.error('FAIL: bundle contains non-ASCII characters - Portal will reject!');
    process.exit(2);
}

console.log('SUCCESS: Vehicle UI Universal bundle ready for Portal upload!');
