#!/usr/bin/env node
// Generates docs/cmake-settings.md from package.json and package.nls.json.
// Only adds settings that are not already documented — existing entries are preserved.
// Run: node tools/generate-settings-docs.js

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const nlsJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.nls.json'), 'utf8'));
const outputPath = path.join(repoRoot, 'docs', 'cmake-settings.md');

const properties = packageJson.contributes.configuration.properties;

function resolveNls(str) {
    if (!str) return '';
    if (typeof str !== 'string') return String(str);
    const match = str.match(/^%(.+)%$/);
    if (match) {
        const resolved = nlsJson[match[1]];
        if (!resolved) return str;
        // NLS values can be objects with a "message" property (for i18n comments)
        if (typeof resolved === 'object' && resolved.message) {
            return resolved.message;
        }
        if (typeof resolved === 'string') {
            return resolved;
        }
        return String(resolved);
    }
    return str;
}

function formatType(prop) {
    if (prop.type) {
        if (Array.isArray(prop.type)) {
            return prop.type.join(' \\| ');
        }
        return prop.type;
    }
    if (prop.oneOf) {
        return prop.oneOf.map(o => o.type).filter(Boolean).join(' \\| ');
    }
    if (prop.enum) {
        return 'enum';
    }
    return 'unknown';
}

function formatDefault(prop) {
    const val = prop.default;
    if (val === null || val === undefined) {
        return '`null`';
    }
    if (typeof val === 'boolean') {
        return `\`${val}\``;
    }
    if (typeof val === 'string') {
        return `\`${val}\``;
    }
    if (typeof val === 'number') {
        return `\`${val}\``;
    }
    if (Array.isArray(val)) {
        if (val.length === 0) {
            return '`[]`';
        }
        const json = JSON.stringify(val);
        if (json.length <= 80) {
            return `\`${json}\``;
        }
        return 'See package.json';
    }
    if (typeof val === 'object') {
        if (Object.keys(val).length === 0) {
            return '`{}`';
        }
        return 'See package.json';
    }
    return `\`${JSON.stringify(val)}\``;
}

function escapeMarkdown(str) {
    if (typeof str !== 'string') str = String(str || '');
    return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// Parse existing markdown to find already-documented settings
function getExistingSettings(filePath) {
    if (!fs.existsSync(filePath)) {
        return new Set();
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const settingPattern = /\|\s*`([^`]+)`\s*\|/g;
    const existing = new Set();
    let match;
    while ((match = settingPattern.exec(content)) !== null) {
        existing.add(match[1]);
    }
    return existing;
}

const existingSettings = getExistingSettings(outputPath);

// Find settings in package.json that are not yet documented
const newSettings = Object.keys(properties)
    .filter(key => !existingSettings.has(key))
    .sort()
    .map(key => {
        const prop = properties[key];
        const description = escapeMarkdown(resolveNls(prop.description || prop.markdownDescription || ''));
        const type = formatType(prop);
        const defaultVal = formatDefault(prop);
        const deprecated = prop.deprecationMessage || prop.markdownDeprecationMessage ? ' **(Deprecated)**' : '';

        let enumValues = '';
        if (prop.enum && prop.enum.length > 0) {
            enumValues = ` Options: ${prop.enum.map(e => `\`${e}\``).join(', ')}.`;
        }

        return { key, description: description + deprecated + enumValues, type, defaultVal };
    });

if (newSettings.length === 0) {
    console.log(`docs/cmake-settings.md is up to date. All ${Object.keys(properties).length} settings are documented.`);
    process.exit(0);
}

// Append new settings to the existing file
let content = fs.readFileSync(outputPath, 'utf8');

// Find the last table row to append after it
const tableRowPattern = /^(\|.*\|)\s*$/gm;
let lastMatch;
let match;
while ((match = tableRowPattern.exec(content)) !== null) {
    lastMatch = match;
}

if (!lastMatch) {
    console.error('Error: Could not find existing settings table in docs/cmake-settings.md');
    process.exit(1);
}

const insertPosition = lastMatch.index + lastMatch[0].length;
const newRows = newSettings.map(s =>
    `| \`${s.key}\` | ${s.description} | ${s.defaultVal} | no |`
);

const before = content.slice(0, insertPosition);
const after = content.slice(insertPosition);
content = before + '\n' + newRows.join('\n') + after;

fs.writeFileSync(outputPath, content, 'utf8');
console.log(`Added ${newSettings.length} new setting(s) to docs/cmake-settings.md. Total in package.json: ${Object.keys(properties).length}.`);

