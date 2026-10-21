import test from 'node:test';
import assert from 'node:assert/strict';
import {runNotionTool} from '../src/notion-read.js';
const env={NOTION_API:'secret-test-value'};
const id='0123456789abcdef0123456789abcdef';
async function capture(t, operation){
 const logs=[];const warn=console.warn;console.warn=x=>logs.push(x);t.after(()=>{console.warn=warn;});
 const result=await operation();
 const serialized=JSON.stringify({result,logs});assert.ok(!serialized.includes(env.NOTION_API));assert.ok(!serialized.includes('PRIVATE_DOCUMENT'));assert.ok(!serialized.includes('Authorization'));
 return {result,logs};
}
test('transport exception has safe phase, type, correlation and no guessed HTTP status',async t=>{
 const {result,logs}=await capture(t,()=>runNotionTool('light_notion_search',{},env,async()=>{throw new TypeError(env.NOTION_API+' PRIVATE_DOCUMENT');}));
 assert.equal(result.diagnostic.phase,'fetch');assert.equal(result.diagnostic.category,'transport_exception');assert.equal(result.diagnostic.error_type,'TypeError');assert.equal(result.diagnostic.http_status,null);
 assert.match(result.diagnostic.request_id,/^[a-f0-9-]{36}$/);assert.equal(logs.length,1);assert.equal(JSON.parse(logs[0]).request_id,result.diagnostic.request_id);
});
test('timeout is distinguished from transport failure',async t=>{
 const {result}=await capture(t,()=>runNotionTool('light_notion_search',{},env,async()=>{throw new DOMException('PRIVATE_DOCUMENT','TimeoutError');}));
 assert.equal(result.diagnostic.category,'timeout');assert.equal(result.diagnostic.http_status,null);
});
test('invalid request headers fail in preparation, without reading secret out',async t=>{
 const {result}=await capture(t,()=>runNotionTool('light_notion_search',{}, {NOTION_API:'secret-test-value\nPRIVATE_DOCUMENT'},async()=>assert.fail('must not fetch')));
 assert.equal(result.diagnostic.phase,'request_setup');assert.equal(result.diagnostic.category,'request_setup_error');
});
for(const [status,category] of [[401,'authentication'],[403,'permission_denied'],[404,'not_found_or_not_shared'],[429,'rate_limited'],[503,'upstream_http_error']])test('HTTP '+status+' retained safely',async t=>{
 const {result}=await capture(t,()=>runNotionTool('light_notion_search',{},env,async()=>new Response('PRIVATE_DOCUMENT '+env.NOTION_API,{status})));
 assert.equal(result.http_status,status);assert.equal(result.diagnostic.http_status,status);assert.equal(result.diagnostic.category,category);
});
test('nested block failures retain diagnostic through continuation result',async t=>{
 let n=0;
 const {result}=await capture(t,()=>runNotionTool('light_notion_page',{id},env,async()=>++n===1?Response.json({id}):new Response('',{status:403})));
 assert.equal(result.diagnostic.http_status,403);assert.equal(result.manifest.at(-1).diagnostic.request_id,result.diagnostic.request_id);
});
test('invalid JSON keeps actual response status and parse phase',async t=>{
 const {result}=await capture(t,()=>runNotionTool('light_notion_search',{},env,async()=>new Response('PRIVATE_DOCUMENT',{status:200})));
 assert.equal(result.diagnostic.phase,'response_parse');assert.equal(result.http_status,200);
});
test('redirects are rejected without following a credential-bearing request',async t=>{
 let calls=0;
 const {result}=await capture(t,()=>runNotionTool('light_notion_search',{},env,async(url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://untrusted.example/'}});}));
 assert.equal(calls,1);assert.equal(result.diagnostic.category,'redirect_rejected');assert.equal(result.http_status,302);
});
