import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,Log,LogLevel} from 'miniflare';
const source=readFileSync(new URL('../src/slack-read.js',import.meta.url),'utf8');
test('Slack adapter reaches native Workers fetch and does not follow redirects',async()=>{
 let calls=[]; let redirect=false;
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-08-06',log:new Log(LogLevel.NONE),bindings:{SLACK_ACCESS:'synthetic-runtime-secret'},outboundService:request=>{
  calls.push({url:request.url,authorization:request.headers.get('authorization')});
  if(redirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});
  return Response.json({ok:true,messages:[{ts:'1792785709.299539',text:'runtime fixture'}],has_more:false});
 },script:source+`\nexport default {async fetch(request,env){return Response.json(await runSlackTool('light_slack_history',{channel:'C0CBVCZ1A20'},env));}};`});
 try{
  const r=await (await mf.dispatchFetch('http://localhost/')).json();
  assert.equal(r.ok,true);assert.equal(r.messages[0].text,'runtime fixture');assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).host,'slack.com');assert.equal(calls[0].authorization,'Bearer synthetic-runtime-secret');
  calls=[];redirect=true;
  const failure=await (await mf.dispatchFetch('http://localhost/')).json();assert.equal(failure.ok,false);assert.equal(failure.http_status,302);assert.equal(calls.length,1);assert(!JSON.stringify(failure).includes('secret'));
 }finally{await mf.dispose();}
});
