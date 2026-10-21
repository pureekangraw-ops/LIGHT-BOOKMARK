import test from 'node:test';
import assert from 'node:assert/strict';
import { runNotionTool, NOTION_TOOLS } from '../src/notion-read.js';
const id = n => n.toString(16).padStart(32,'0');
const env = {NOTION_API:'test-secret'};
const list = (results, next_cursor=null) => Response.json({results,has_more:!!next_cursor,next_cursor});
test('search exposes only manifest and forwards pagination', async()=>{
 const calls=[];
 const fetcher=async(url,init)=>{calls.push(JSON.parse(init.body));return list([{object:'page',id:id(1),properties:{secret:'FULL CONTENT'},url:'https://notion.so/'+id(1)}], 'next');};
 const r=await runNotionTool('light_notion_search',{cursor:'prior'},env,fetcher);
 assert.equal(r.next_cursor,'next');assert.equal(calls[0].start_cursor,'prior');
 assert.equal(r.coverage.workspace_complete,false);assert.ok(!JSON.stringify(r).includes('FULL CONTENT'));
});
test('data source rows support pagination without leaking properties',async()=>{
 const r=await runNotionTool('light_notion_data_source',{id:id(1),cursor:'row2'},env,async(url,init)=>{
 assert.equal(url,'https://api.notion.com/v1/data_sources/'+id(1)+'/query');assert.equal(JSON.parse(init.body).start_cursor,'row2');
 return list([{id:id(2),object:'page',properties:{Name:'PRIVATE'}}],'row3');});
 assert.equal(r.next_cursor,'row3');assert.equal(r.manifest[0].id,id(2));assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('recursive blocks follow children and pagination with resumable budget',async()=>{
 const calls=[];
 const fetcher=async url=>{calls.push(url);if(url.includes('/pages/'))return Response.json({id:id(1),object:'page'});
 if(url.includes('/'+id(1)+'/children')&&!url.includes('start_cursor'))return list([{id:id(2),type:'toggle',has_children:true,toggle:{rich_text:'NEVER RETURN'}}],'second');
 if(url.includes('start_cursor=second'))return list([{id:id(3),type:'paragraph',has_children:false}]);
 return list([{id:id(4),type:'paragraph',has_children:false}]);};
 let r=await runNotionTool('light_notion_page',{id:id(1),max_requests:2},env,fetcher);
 assert.equal(r.coverage.status,'partial');assert.ok(r.continuation);let blocks=[...r.manifest];
 while(r.continuation){r=await runNotionTool('light_notion_page',{id:id(1),continuation:r.continuation,max_requests:2},env,fetcher);blocks.push(...r.manifest);}
 assert.equal(r.coverage.status,'complete_for_requested_page');assert.equal(blocks.filter(x=>x.kind==='block').length,3);
 assert.ok(!JSON.stringify(blocks).includes('NEVER RETURN'));assert.ok(calls.some(x=>x.includes('/'+id(2)+'/children')));
});
for(const status of [401,403,404])test('permission '+status+' is inaccessible, never absent',async()=>{
 const r=await runNotionTool('light_notion_page',{id:id(1)},env,async()=>new Response('secret upstream error',{status}));
 assert.equal(r.manifest[0].status,'inaccessible');assert.equal(r.coverage.status,'partial');assert.ok(!JSON.stringify(r).includes('secret upstream'));
});
test('rate limits preserve unfinished work and retry-after',async()=>{
 const r=await runNotionTool('light_notion_page',{id:id(1)},env,async()=>new Response('',{status:429,headers:{'Retry-After':'3'}}));
 assert.equal(r.status,'rate_limited');assert.equal(r.retry_after_seconds,3);assert.ok(r.continuation);
});
test('database discovery returns only data source locators',async()=>{
 const r=await runNotionTool('light_notion_database',{id:id(1)},env,async()=>Response.json({id:id(1),data_sources:[{id:id(2),name:'PRIVATE'}]}));
 assert.equal(r.manifest[0].id,id(2));assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('validation and missing configuration fail before network',async()=>{
 const fail=()=>{throw Error('network should not run');};
 await assert.rejects(()=>runNotionTool('light_notion_page',{id:'https://evil.test'},env,fail),/INVALID_INPUT/);
 await assert.rejects(()=>runNotionTool('light_notion_search',{}, {},fail),/NOTION_NOT_CONFIGURED/);
 assert.ok(NOTION_TOOLS.every(t=>t.annotations.readOnlyHint));
});
test('block rate limit resumes the same unfinished cursor',async()=>{
 let count=0;
 const r=await runNotionTool('light_notion_page',{id:id(1)},env,async()=>++count===1?Response.json({id:id(1),object:'page'}):new Response('',{status:429,headers:{'Retry-After':'2'}}));
 assert.equal(r.continuation.phase,'blocks');assert.equal(r.continuation.tasks[0].id,id(1));
 const done=await runNotionTool('light_notion_page',{id:id(1),continuation:r.continuation},env,async()=>list([]));
 assert.equal(done.coverage.status,'complete_for_requested_page');
});
test('nested permission failure remains partial across resume',async()=>{
 const r=await runNotionTool('light_notion_page',{id:id(1),max_requests:2},env,async url=>url.includes('/pages/')?Response.json({id:id(1)}):list([{id:id(2),type:'toggle',has_children:true}]));
 const done=await runNotionTool('light_notion_page',{id:id(1),continuation:r.continuation},env,async()=>new Response('',{status:403}));
 assert.equal(done.coverage.status,'partial');assert.equal(done.coverage.inaccessible,1);assert.equal(done.manifest[0].status,'inaccessible');
});
test('upstream exception never exposes token and invalid continuation never fetches',async()=>{
 const r=await runNotionTool('light_notion_search',{},env,async()=>{throw Error(env.NOTION_API);});
 assert.ok(!JSON.stringify(r).includes(env.NOTION_API));
 await assert.rejects(()=>runNotionTool('light_notion_page',{id:id(1),continuation:{page_id:id(2)}},env,()=>assert.fail()),/INVALID_INPUT/);
});
test('only fixed-origin read endpoints are called',async()=>{
 for(const [name,args] of [['light_notion_search',{}],['light_notion_data_source',{id:id(1)}],['light_notion_database',{id:id(1)}],['light_notion_page',{id:id(1)}]]){
 await runNotionTool(name,args,env,async(url,init)=>{
 assert.equal(new URL(url).origin,'https://api.notion.com');assert.equal(init.redirect,'manual');
 if(init.method==='POST')assert.match(new URL(url).pathname,/^\/v1\/(search|data_sources\/[a-f0-9]+\/query)$/);else assert.equal(init.method,'GET');
 assert.equal(init.headers.Authorization,'Bearer test-secret');
 return url.includes('/databases/')?Response.json({data_sources:[]}):url.includes('/pages/')?Response.json({id:id(1)}):list([]);
 });}
});
