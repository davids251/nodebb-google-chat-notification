#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJSON(p){return JSON.parse(fs.readFileSync(p,'utf8'))}
function writeJSON(p,obj){fs.writeFileSync(p,JSON.stringify(obj,null,2)+'\n','utf8')}
function bumpVer(v,type='patch'){const parts=v.split('.').map(Number); if(type==='major'){parts[0]++; parts[1]=0; parts[2]=0}else if(type==='minor'){parts[1]++; parts[2]=0}else{parts[2]++} return parts.join('.')}

const type = process.argv[2] || 'patch';
const repoRoot = path.join(__dirname, '..');
const pkgPath = path.join(repoRoot, 'package.json');
const plugPath = path.join(repoRoot, 'plugin.json');

const pkg = readJSON(pkgPath);
const plug = readJSON(plugPath);

const newVer = bumpVer(pkg.version, type);
pkg.version = newVer;
plug.version = newVer;

writeJSON(pkgPath, pkg);
writeJSON(plugPath, plug);

console.log(`Bumped version to ${newVer} (${type})`);
