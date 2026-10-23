import test from 'node:test';
import assert from 'node:assert/strict';
import {runSlackTool,SLACK_TOOLS} from '../src/slack-read.js';
import worker from '../src/index.js';
const env={SLACK_ACCESS:'test-access-secret',SLACK_REFRESH:'test-refresh-secret'};
const channel='C0CBVCZ1A20';
const reply=data=>new Response(JSON.stringify(data));
test('MCP requires authentication and discovers all four read-only tools',async()=>{
 const request=token=>new Request('https://light/mcp',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 assert.equal((await worker.fetch(request('wrong'),{LIGHT_BOOKMARK_TOKEN:'owner',BOOKMARKS:{}})).status,401);
 const data=await (await worker.fetch(request('owner'),{LIGHT_BOOKMARK_TOKEN:'owner',BOOKMARKS:{}})).json();
 for(const t of SLACK_TOOLS){assert(data.result.tools.some(x=>x.name===t.name));assert.equal(t.annotations.readOnlyHint,true);}
});
test('auth status makes real fixed-origin call and returns no tokens or response extras',async()=>{
 const r=await runSlackTool('light_slack_status',{},env,async(url,opts)=>{assert.equal(url,'https://slack.com/api/auth.test');assert.equal(opts.method,'POST');assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Authorization,'Bearer '+env.SLACK_ACCESS);return reply({ok:true,team_id:'T123',user_id:'U123',token:env.SLACK_ACCESS});});
 assert.equal(r.status,'AUTHENTICATED');assert.equal(r.channel_access_verified,false);assert.equal(r.automatic_refresh,false);assert(!JSON.stringify(r).includes('secret'));
});
test('history retains pagination, timestamps, authors and bounded text',async()=>{
 const r=await runSlackTool('light_slack_history',{channel,limit:1},env,async(url)=>{const u=new URL(url);assert.equal(u.pathname,'/api/conversations.history');assert.equal(u.searchParams.get('channel'),channel);return reply({ok:true,has_more:true,messages:[{ts:'1792785709.299539',text:'x'.repeat(13000),user:'U1',files:[{url_private:'hidden'}]}],response_metadata:{next_cursor:'next'}});});
 assert.equal(r.next_cursor,'next');assert.equal(r.messages[0].text.length,12000);assert.equal(r.messages[0].text_truncated,true);assert.equal(r.messages[0].has_attachments,true);assert(!JSON.stringify(r).includes('url_private'));
});
test('thread targets replies endpoint and provides time continuation when cursor absent',async()=>{
 const r=await runSlackTool('light_slack_thread',{channel,ts:'1792785709.299539'},env,async(url)=>{assert.equal(new URL(url).pathname,'/api/conversations.replies');return reply({ok:true,has_more:true,messages:[{ts:'1792785710.000001',text:'reply'}]});});
 assert.deepEqual(r.next_time,{oldest:'1792785710.000001'});
});
test('channel listing defaults to public; private and DM types are explicit',async()=>{
 for(const args of [{},{types:['private_channel','im']}]){
 const r=await runSlackTool('light_slack_channels',args,env,async(url)=>{assert.equal(new URL(url).searchParams.get('types'),args.types?.join(',')||'public_channel');return reply({ok:true,channels:[],response_metadata:{next_cursor:'continue'}});});assert.equal(r.has_more,true);
 }
});
test('invalid or injected arguments fail before any request',async()=>{
 for(const [name,args] of [['light_slack_history',{channel:'https://evil.test'}],['light_slack_history',{channel,limit:16}],['light_slack_history',{channel,token:'injected'}],['light_slack_thread',{channel,ts:'bad'}],['light_slack_status',{url:'evil'}],['light_slack_channels',{types:['all']}],['light_slack_channels',{cursor:'x\ny'}],['chat.postMessage',{}]]){
 await assert.rejects(()=>runSlackTool(name,args,env,()=>{throw Error('must not call');}));
 }
});
test('missing token, expiry and missing scopes are distinct; never refresh automatically',async()=>{
 assert.equal((await runSlackTool('light_slack_status',{})).status,'SLACK_NOT_CONFIGURED');
 for(const error of ['token_expired','missing_scope','not_in_channel']){let calls=0;const r=await runSlackTool('light_slack_status',{},env,async()=>{calls++;return reply({ok:false,error,detail:env.SLACK_REFRESH});});assert.equal(r.status,error);assert.equal(calls,1);assert(!JSON.stringify(r).includes('secret'));}
});
test('rate limiting returns retry interval without retrying',async()=>{
 let calls=0;const r=await runSlackTool('light_slack_status',{},env,async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'60'}});});assert.equal(r.retry_after_seconds,60);assert.equal(calls,1);
});
test('transport failures, redirects, unknown errors and oversized bodies are sanitized',async()=>{
 const cases=[async()=>{throw Error(env.SLACK_ACCESS);},async()=>new Response('',{status:302,headers:{Location:'https://evil.test'}}),async()=>reply({ok:false,error:env.SLACK_ACCESS}),async()=>reply({ok:true,padding:'x'.repeat(1500001)})];
 for(const fetcher of cases){const r=await runSlackTool('light_slack_status',{},env,fetcher);assert.equal(r.ok,false);assert(!JSON.stringify(r).includes('secret'));}
});
test('malformed successful responses are not reported as verified',async()=>{
 assert.equal((await runSlackTool('light_slack_status',{},env,async()=>reply({ok:true}))).ok,false);
 assert.equal((await runSlackTool('light_slack_history',{channel},env,async()=>reply({ok:true,messages:[{}]}))).ok,false);
});
