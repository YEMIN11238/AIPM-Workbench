/** Fail publication checks on private runtime files, large binaries and recognizable credential formats. */
import { readdir, readFile, lstat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative, extname } from 'node:path'
const root=fileURLToPath(new URL('../',import.meta.url));
const skipped=new Set(['.git','node_modules','.venv','__pycache__','dist']);
const failures=[];let checked=0;
const secretPatterns=[/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/,/\bsk-[A-Za-z0-9]{32,}\b/,/^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/m];
async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){if(skipped.has(entry.name))continue;const path=join(folder,entry.name),name=relative(root,path);if(entry.isSymbolicLink()){failures.push(`${name}: unexpected symlink`);continue}if(entry.isDirectory()){if(entry.name==='.app-data')failures.push(`${name}: runtime data`);else await walk(path);continue}const stat=await lstat(path);if(stat.size>15*1024*1024)failures.push(`${name}: file exceeds source distribution limit`);if(entry.name.startsWith('.env')&&!['.env.example','.env.sample'].includes(entry.name))failures.push(`${name}: private environment file`);if(/(?:credential\.bin|\.sqlite3?$|\.pem$|\.key$|\.onnx$)/.test(entry.name))failures.push(`${name}: credential, database or model file`);if(['.node','.bin'].includes(extname(path)))continue;const bytes=await readFile(path);if(bytes.includes(0))continue;const text=bytes.toString('utf8');for(const pattern of secretPatterns)if(pattern.test(text))failures.push(`${name}: credential-shaped content`);checked++}}
await walk(root);
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log(`Public source scan passed (${checked} text files; credentials and private runtime files absent).`);
