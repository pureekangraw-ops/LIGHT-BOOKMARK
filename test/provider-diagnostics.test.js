import test from 'node:test';
import assert from 'node:assert/strict';
import {runProviderTool} from '../src/provider-read.js';
import worker from '../src/index.js';
const env={LIGHT_GITHUB_REPOS:'fixture/repo',LIGHT_GITHUB_READ_TOKEN:'synthetic-secret',LIGHT_BOOKMARK_TOKEN:'synthetic-mcp',BOOKMARKS:{}};
async function failure(status,headers={}) {
  let calls=0;
  const fetcher=async()=>{
    calls++;
    return {status,ok:false,headers:new Headers({...headers,'x-secret':'synthetic-secret'}),text(){assert.fail('must not read provider body');}};
  };
  let error;
  try {await runProviderTool('light_github_repo',{repo:'fixture/repo'},env,fetcher);}catch(e){error=e;}
  assert.equal(calls,1);
  assert.equal(error.message,'UPSTREAM_HTTP_'+status);
  assert.doesNotMatch(JSON.stringify(error),/synthetic-secret/);
  return error.diagnostics;
}
test('403 evidence distinguishes observed exhaustion from unknown permission/root cause',async()=>{
  assert.deepEqual(await failure(403,{'x-ratelimit-remaining':'0'}),{
    http_status:403,cause:'rate_limit_observed',permission_status:'unknown',rate_limit_remaining:0,retry_after_seconds:null,automatic_retry:false,
  });
  for(const remaining of [undefined,'2','-1','1.5','NaN','0 secret','99999999999']) {
    const data=await failure(403,remaining===undefined?{}:{'x-ratelimit-remaining':remaining});
    assert.equal(data.cause,'unknown');assert.equal(data.permission_status,'unknown');
    assert.equal(data.rate_limit_remaining,remaining==='2'?2:null);
  }
  assert.equal((await failure(403,{'retry-after':'10'})).cause,'unknown');
});
test('429 retains bounded delta/date timing; invalid/missing timing remains unknown',async()=>{
  for(const value of ['0','1','86400'])assert.equal((await failure(429,{'retry-after':value})).retry_after_seconds,Number(value));
  const date=new Date(Math.floor(Date.now()/1000)*1000+60000).toUTCString();
  const result=await failure(429,{'retry-after':date});
  assert.ok(result.retry_after_seconds>=59&&result.retry_after_seconds<=60);
  assert.equal(result.cause,'rate_limit_observed');
  for(const value of [undefined,'','-1','1.5','1e3','86401','999999999999','tomorrow','2026-10-22','Thu, 31 Feb 2028 00:00:00 GMT','Wed, 01 Jan 2020 00:00:00 GMT',new Date(Date.now()+172800000).toUTCString()]){
    const data=await failure(429,value===undefined?{}:{'retry-after':value});
    assert.equal(data.retry_after_seconds,null,String(value));
    assert.equal(data.permission_status,'unknown');
  }
});
test('other status and transport/redirect errors retain existing contracts',async()=>{
  for(const status of [400,401,404,500,503])assert.equal(await failure(status),undefined);
  for(const [fetcher,message] of [
    [async()=>{throw Error('synthetic-secret');},'UPSTREAM_UNAVAILABLE'],
    [async()=>new Response(null,{status:302,headers:{location:'https://invalid.example'}}),'UPSTREAM_REDIRECT_REJECTED'],
    [async()=>new Response('bad json'),'UPSTREAM_NOT_JSON'],
  ])await assert.rejects(runProviderTool('light_github_repo',{repo:'fixture/repo'},env,fetcher),e=>e.message===message&&e.diagnostics===undefined);
});
test('public GitLab route fields remain intact while preserving 403 evidence',async()=>{
  for(const file of [false,true]){
    let calls=0;
    const data=await runProviderTool(file?'light_gitlab_file':'light_gitlab_project',{project:'fixture/project',...(file?{path:'README.md'}:{})},{LIGHT_GITLAB_PROJECTS:'fixture/project'},async()=>{calls++;return new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0'}});});
    assert.equal(calls,1);assert.equal(data.ok,false);
    assert.equal(data.status,file?'PRIVATE_FILE_REQUIRES_AUTHORIZED_ROUTE':'PRIVATE_PROJECT_REQUIRES_AUTHORIZED_ROUTE');
    assert.equal(data.route,'light_pantheon_create_task');
    assert.equal(data.diagnostics.cause,'rate_limit_observed');
  }
});
test('MCP preserves error flag and first text; adds sanitized diagnostic text only for 403/429',async t=>{
  let calls=0,status=403;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('private provider content synthetic-secret',{status,headers:{'x-ratelimit-remaining':'0','retry-after':'12','x-secret':'synthetic-secret'}});});
  for(status of [403,429,500]){
    const request=new Request('https://light.example/mcp',{method:'POST',headers:{Authorization:'Bearer synthetic-mcp','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'light_github_repo',arguments:{repo:'fixture/repo'}}})});
    const response=await worker.fetch(request,env);assert.equal(response.status,200);
    const rpc=await response.json();assert.equal(rpc.id,1);assert.equal(rpc.result.isError,true);
    assert.deepEqual(rpc.result.content[0],{type:'text',text:'UPSTREAM_HTTP_'+status});
    assert.equal(rpc.result.content.length,status===500?1:2);
    if(status!==500)assert.equal(JSON.parse(rpc.result.content[1].text).diagnostics.retry_after_seconds,12);
    assert.doesNotMatch(JSON.stringify(rpc),/synthetic-secret|private provider content|x-secret/);
  }
  assert.equal(calls,3);
});

test('Retry-After dates strictly reject subsecond past and accept exact present',async t=>{
  const time=Date.parse('Thu, 22 Oct 2026 08:00:00 GMT');
  t.mock.method(Date,'now',()=>time+500);
  assert.equal((await failure(429,{'retry-after':'Thu, 22 Oct 2026 08:00:00 GMT'})).retry_after_seconds,null);
  t.mock.method(Date,'now',()=>time);
  assert.equal((await failure(429,{'retry-after':'Thu, 22 Oct 2026 08:00:00 GMT'})).retry_after_seconds,0);
});
