import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare, Log, LogLevel} from 'miniflare';

const source = readFileSync(new URL('../src/document-evidence.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/provider-read.js', import.meta.url), 'utf8').replace(/^import .*document-evidence.*;\n/, '');
const credential = 'synthetic-provider-credential';
const env = {
  LIGHT_GITHUB_REPOS: 'fixture/repo',
  LIGHT_GITHUB_READ_TOKEN: credential,
  LIGHT_GITLAB_PROJECTS: 'fixture/project',
  LIGHT_GITLAB_READ_TOKEN: credential,
  LIGHT_CF_WORKERS: 'fixture-worker',
  LIGHT_CF_ACCOUNT_ID: 'a'.repeat(32),
  LIGHT_CF_READ_TOKEN: credential,
};
const cases = [
  {name:'light_github_repo', args:{repo:'fixture/repo'}, host:'api.github.com', body:{full_name:'fixture/repo'}, expected:{repo:'fixture/repo'}},
  {name:'light_github_file', args:{repo:'fixture/repo',path:'README.md'}, host:'api.github.com', body:{type:'file',encoding:'base64',content:Buffer.from('hello LIGHT').toString('base64')}, expected:{text:'hello LIGHT'}},
  {name:'light_gitlab_project', args:{project:'fixture/project'}, host:'gitlab.com', body:{path_with_namespace:'fixture/project'}, expected:{project:'fixture/project'}},
  {name:'light_gitlab_file', args:{project:'fixture/project',path:'README.md'}, host:'gitlab.com', body:'hello LIGHT', expected:{text:'hello LIGHT'}},
  {name:'light_cloudflare_worker', args:{script:'fixture-worker'}, host:'api.cloudflare.com', body:{success:true,result:{deployments:[]}}, expected:{deployments:[]}},
];

// No fetch stub is injected into runProviderTool: the native workerd fetch must
// construct the request first. The outbound service intercepts *all* network I/O,
// including a regression that would try to follow a credential-bearing redirect.
test('provider readers use native Workers fetch without redirect or credential leaks', async t => {
  let calls = [];
  let upstream = () => new Response('Unexpected request', {status:500});
  const mf = new Miniflare({
    modules:true,
    // Match the newest date supported by the repository's pinned workerd.
    compatibilityDate:'2026-08-06',
    log:new Log(LogLevel.NONE),
    bindings:env,
    outboundService:request => {
      calls.push({url:request.url,method:request.method,authorization:request.headers.get('authorization')});
      return upstream(request);
    },
    script:source + `
      export default {async fetch(request, env) {
        const {name,args,publicOnly} = await request.json();
        const settings = publicOnly ? {...env,LIGHT_GITLAB_READ_TOKEN:''} : env;
        try {return Response.json({result:name==='light_document_compare'?compareDocumentEvidence(args):await runProviderTool(name,args,settings)});}
        catch (error) {return Response.json({error:error.message,...(error.diagnostics?{diagnostics:error.diagnostics}:{})});}
      }};`,
  });
  const call = async (item, extra={}) => {
    calls = [];
    const response = await mf.dispatchFetch('http://localhost/', {
      method:'POST',body:JSON.stringify({name:item.name,args:item.args,...extra}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const assertSingleRequest = item => {
    assert.equal(calls.length, 1, JSON.stringify(calls.map(x=>x.url)));
    assert.equal(new URL(calls[0].url).hostname, item.host);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].authorization, 'Bearer '+credential);
  };
  try {
    for (const item of cases) {
      await t.test(item.name+' reaches only its fixed provider origin', async () => {
        upstream = () => typeof item.body === 'string' ? new Response(item.body) : Response.json(item.body);
        const data = await call(item);
        assert.equal(data.error, undefined, JSON.stringify(data));
        for (const [key,value] of Object.entries(item.expected)) assert.deepEqual(data.result[key], value);
        if(item.name.endsWith('_file')){assert.equal(data.result.evidence.coverage.complete,true);assert.match(data.result.evidence.content_sha256,/^[a-f0-9]{64}$/);}
        assertSingleRequest(item);
        assert.doesNotMatch(JSON.stringify(data), /synthetic-provider-credential/);
      });
      for (const status of [300,301,302,303,304,307,308,399]) {
        await t.test(item.name+' rejects HTTP '+status+' without following Location', async () => {
          upstream = request => new URL(request.url).hostname === item.host
            ? new Response(null, {status,headers:{Location:'https://redirect.invalid/stolen?credential='+credential}})
            : Response.json({credential});
          const data = await call(item);
          assert.equal(data.error, 'UPSTREAM_REDIRECT_REJECTED');
          assertSingleRequest(item);
          assert.doesNotMatch(JSON.stringify(data), /synthetic-provider-credential|redirect.invalid/);
        });
      }
      for (const status of [401,403,404,429,503]) {
        await t.test(item.name+' preserves sanitized HTTP '+status+' errors', async () => {
          upstream = () => new Response('upstream-sensitive-body '+credential, {status});
          assert.deepEqual(await call(item), {error:'UPSTREAM_HTTP_'+status,...([403,429].includes(status)?{diagnostics:{http_status:status,cause:status===429?'rate_limit_observed':'unknown',permission_status:'unknown',rate_limit_remaining:null,retry_after_seconds:null,automatic_retry:false}}:{})});
          assertSingleRequest(item);
        });
      }
    }
    await t.test('native Workers preserves normalized 403/429 headers with one request',async()=>{
      for(const status of [403,429]){
        upstream=()=>new Response('sensitive body',{status,headers:{'x-ratelimit-remaining':'0','retry-after':'60','x-private':'sensitive'}});
        const data=await call(cases[0]);
        assert.equal(data.diagnostics.cause,'rate_limit_observed');
        assert.equal(data.diagnostics.retry_after_seconds,60);
        assert.equal(data.diagnostics.rate_limit_remaining,0);
        assert.doesNotMatch(JSON.stringify(data),/sensitive/);
        assertSingleRequest(cases[0]);
      }
    });
    await t.test('native Workers rejects malformed GitLab UTF-8 instead of generating evidence',async()=>{
      const item=cases.find(x=>x.name==='light_gitlab_file');
      for(const byte of [0xff,0xfe]){
        upstream=()=>new Response(new Uint8Array([byte]));
        assert.deepEqual(await call(item),{error:'NOT_UTF8'});assertSingleRequest(item);
      }
    });
    await t.test('native Workers compares observations without additional outbound requests',async()=>{
      const item=cases.find(x=>x.name==='light_github_file');
      upstream=()=>Response.json(item.body);
      const first=(await call(item)).result.evidence;
      const result=await call({name:'light_document_compare',args:{before:first,after:first}});
      assert.equal(result.result.status,'unchanged');assert.equal(result.result.authenticity_verified,false);assert.equal(calls.length,0);
    });
    for (const item of cases.filter(x=>x.name.startsWith('light_gitlab_'))) {
      for (const status of [401,403,404]) {
        await t.test(item.name+' retains its public-only authorized-route response for '+status, async () => {
          upstream = () => new Response('private upstream body', {status});
          const data = await call(item, {publicOnly:true});
          assert.equal(data.error, undefined, JSON.stringify(data));
          assert.equal(data.result.status, item.name.endsWith('_file') ? 'PRIVATE_FILE_REQUIRES_AUTHORIZED_ROUTE' : 'PRIVATE_PROJECT_REQUIRES_AUTHORIZED_ROUTE');
          assert.equal(data.result.route, 'light_pantheon_create_task');
          assert.equal(calls.length, 1);
          assert.equal(calls[0].authorization, null);
        });
      }
    }
  } finally {
    await mf.dispose();
  }
});
