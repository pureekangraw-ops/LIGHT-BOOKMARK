import test from 'node:test';
import assert from 'node:assert/strict';
import {runProviderTool} from '../src/provider-read.js';
import {runLightDriveTool} from '../src/drive-bridge.js';
const env={LIGHT_GITHUB_REPOS:'fixture/repo',LIGHT_GITLAB_PROJECTS:'fixture/project'};
const gh=async(text,sha='a'.repeat(40))=>runProviderTool('light_github_file',{repo:'fixture/repo',path:'README.md',ref:'main'},env,async()=>Response.json({type:'file',encoding:'base64',sha,content:Buffer.from(text).toString('base64')}));
test('GitHub evidence identifies blob not commit and complete text',async()=>{
 const x=await gh('ภาษาไทย'); assert.ok(x.evidence,'missing evidence');
 assert.equal(x.evidence.revision.kind,'git_blob_sha'); assert.equal(x.evidence.revision.binding,'content');
 assert.equal(x.evidence.coverage.complete,true); assert.equal(x.evidence.coverage.total_utf16_units,7);
 assert.match(x.evidence.content_sha256,/^[a-f0-9]{64}$/); assert.ok(Number.isFinite(Date.parse(x.evidence.observed_at)));
});
test('GitLab exact limit is complete, longer response incomplete, revision unknown',async()=>{
 for(const n of [30000,30001]){
  const x=await runProviderTool('light_gitlab_file',{project:'fixture/project',path:'README.md'},env,async()=>new Response('x'.repeat(n)));
  assert.ok(x.evidence,'missing evidence');assert.equal(x.truncated,n>30000);assert.equal(x.evidence.coverage.complete,n===30000);assert.equal(x.evidence.revision,null);
 }
});
test('Drive evidence distinguishes unbound metadata revision and Thai text coverage',async()=>{
 const original=globalThis.fetch; const text='ก'.repeat(25000);
 globalThis.fetch=async url=>String(url).includes('oauth2.')?Response.json({access_token:'synthetic'}):String(url).includes('alt=media')?new Response(text):Response.json({id:'123456789012',name:'doc.txt',mimeType:'text/plain',version:'42',modifiedTime:'2026-10-21T00:00:00Z'});
 try{
  const x=(await runLightDriveTool('light_drive_file',{file_id:'123456789012'},{LIGHT_GOOGLE_CLIENT_ID:'c',LIGHT_GOOGLE_CLIENT_SECRET:'s',GOOGLE_REFRESH_TOKEN:'r'})).result;
  assert.ok(x.evidence,'missing evidence'); assert.equal(x.truncated,false);assert.equal(x.evidence.coverage.complete,true);assert.equal(x.evidence.revision.binding,'metadata_only');assert.equal(x.evidence.revision.value,'42');
 }finally{globalThis.fetch=original;}
});

test('comparison is available as a pure bounded evidence operation',async()=>{
 const module=await import('../src/document-evidence.js');
 assert.equal(typeof module.compareDocumentEvidence,'function','comparison missing');
 const a=(await gh('one')).evidence,b=(await gh('two','b'.repeat(40))).evidence;
 const result=module.compareDocumentEvidence({before:a,after:b});
 assert.equal(result.status,'changed');assert.equal(result.content_status,'changed');assert.equal(result.revision_status,'changed');assert.equal(result.authenticity_verified,false);
});
test('comparison separates content from revision and fails closed on missing/partial/mismatched observations',async()=>{
 const module=await import('../src/document-evidence.js');assert.equal(typeof module.compareDocumentEvidence,'function','comparison missing');
 const a=(await gh('one')).evidence,b=structuredClone(a);b.revision.value='b'.repeat(40);
 assert.equal(module.compareDocumentEvidence({before:a,after:b}).content_status,'unchanged');
 assert.equal(module.compareDocumentEvidence({before:a,after:b}).revision_status,'changed');
 for(const mutate of [x=>x.resource[1]='other.md',x=>x.requested_ref='other',x=>delete x.content_sha256,x=>x.coverage.complete='true',x=>x.extra='secret']){
  const x=structuredClone(a);mutate(x);assert.equal(module.compareDocumentEvidence({before:a,after:x}).status,'incomparable');
 }
 const partial=structuredClone(a);partial.coverage.complete=false;partial.coverage.total_utf16_units++;
 assert.equal(module.compareDocumentEvidence({before:a,after:partial}).status,'incomplete');
 assert.equal(module.compareDocumentEvidence({before:{ok:false},after:a}).status,'incomparable');
 assert.equal(module.compareDocumentEvidence({before:a,after:a}).status,'unchanged');
});
test('comparison refuses internally conflicting fingerprint lengths and blob evidence',async()=>{
 const {compareDocumentEvidence}=await import('../src/document-evidence.js');const a=(await gh('one')).evidence;
 const b=structuredClone(a);b.coverage.returned_utf16_units++;b.coverage.total_utf16_units++;
 assert.equal(compareDocumentEvidence({before:a,after:b}).status,'incomparable');
 const c=(await gh('two')).evidence;assert.equal(compareDocumentEvidence({before:a,after:c}).status,'incomparable');
});
test('UTF-16 output boundary never splits supplementary characters',async()=>{
 const x=await gh('x'.repeat(29999)+'😀');assert.equal(x.text.length,29999);assert.equal(x.truncated,true);assert.equal(x.evidence.coverage.total_utf16_units,30001);assert.equal(x.evidence.coverage.complete,false);
});
test('provider 429 and timeout have no retry and never produce success evidence or leak credentials',async()=>{
 for(const timeout of [false,true]){
  let calls=0; await assert.rejects(runProviderTool('light_github_file',{repo:'fixture/repo',path:'README.md'},env,async()=>{calls++;if(timeout)throw new Error('secret-network-details');return new Response('secret-upstream',{status:429,headers:{'retry-after':'120'}});}),timeout?/^Error: UPSTREAM_UNAVAILABLE$/:/^Error: UPSTREAM_HTTP_429$/);assert.equal(calls,1);
 }
});
test('Drive errors return no observation and do not retry',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{if(String(url).includes('oauth2.'))return Response.json({access_token:'synthetic'});calls++;return new Response('sensitive',{status:429,headers:{'retry-after':'120'}});};
 try{const x=await runLightDriveTool('light_drive_file',{file_id:'123456789012'},{LIGHT_GOOGLE_CLIENT_ID:'c',LIGHT_GOOGLE_CLIENT_SECRET:'s',GOOGLE_REFRESH_TOKEN:'r'});assert.equal(x.ok,false);assert.equal(x.upstream_status,429);assert.equal(x.evidence,undefined);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(x),/sensitive|synthetic/);}finally{globalThis.fetch=original;}
});
test('returned fingerprints match independent SHA-256 oracle and incomplete content is not equal',async()=>{
 const {createHash}=await import('node:crypto');const {compareDocumentEvidence}=await import('../src/document-evidence.js');
 const x=await gh('ภาษาไทย😀');assert.equal(x.evidence.content_sha256,createHash('sha256').update(x.text,'utf8').digest('hex'));
 const partial=(await gh('x'.repeat(30001))).evidence;assert.equal(compareDocumentEvidence({before:partial,after:partial}).status,'incomplete');
});
test('Drive selected ZIP entry has its own identity; listing never claims content coverage',async()=>{
 const {zipSync}=await import('fflate');const original=globalThis.fetch;
 const bytes=zipSync({'a.txt':new TextEncoder().encode('ภาษาไทย'),'bad.txt':new Uint8Array([255])});
 globalThis.fetch=async url=>String(url).includes('oauth2.')?Response.json({access_token:'synthetic'}):String(url).includes('alt=media')?new Response(bytes):Response.json({id:'123456789012',name:'docs.zip',mimeType:'application/zip',version:'2'});
 const settings={LIGHT_GOOGLE_CLIENT_ID:'c',LIGHT_GOOGLE_CLIENT_SECRET:'s',GOOGLE_REFRESH_TOKEN:'r'};
 try{
  const listing=await runLightDriveTool('light_drive_file',{file_id:'123456789012'},settings);assert.equal(listing.result.evidence,undefined);
  const x=await runLightDriveTool('light_drive_file',{file_id:'123456789012',entry:'a.txt'},settings);assert.equal(x.result.text,'ภาษาไทย');assert.deepEqual(x.result.evidence.resource,['123456789012','a.txt']);assert.equal(x.result.evidence.coverage.complete,true);
  const bad=await runLightDriveTool('light_drive_file',{file_id:'123456789012',entry:'bad.txt'},settings);assert.equal(bad.status,'LIGHT_DRIVE_NOT_UTF8');
 }finally{globalThis.fetch=original;}
});
test('GitLab invalid UTF-8 cannot collapse distinct bytes into equal complete evidence',async()=>{
 for(const byte of [0xff,0xfe])await assert.rejects(runProviderTool('light_gitlab_file',{project:'fixture/project',path:'README.md'},env,async()=>new Response(new Uint8Array([byte]))),/NOT_UTF8/);
});
