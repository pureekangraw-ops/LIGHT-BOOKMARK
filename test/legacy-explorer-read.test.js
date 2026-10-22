import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyCapabilityProbe } from "../src/legacy-explorer-read.js";

test("Notion REST manifest probes never expose results or pretend to be Notion AI",async()=>{
  let received;
  const probe=createLegacyCapabilityProbe({notion:async(name,args,env)=>{
    received={name,args,env};return {status:"ok",manifest:[{id:"PRIVATE_NOTION_ID",title:"PRIVATE_TITLE"}]};
  }});
  const r=await probe("notion",{NOTION_API:"secret-token"});
  assert.equal(received.name,"light_notion_search");
  assert.equal(r.connected,true);
  assert.equal(r.notionAiEnabled,false);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_NOTION_ID|PRIVATE_TITLE|secret-token/);
});
test("Cloudflare provider receives alias credential only inside request memory",async()=>{
  let args;
  const probe=createLegacyCapabilityProbe({provider:async(name,input,env)=>{
    args={name,input,env};
    return {source:"cloudflare",script:"light-bookmark",deployments:[{secret:"PRIVATE"}]};
  }});
  const r=await probe("cloudflare",{CLOUDFARE_TOKEN:"SECRET_1",CLOUDFAIR_ID:"ID_2",LIGHT_CF_WORKERS:"light-bookmark"});
  assert.equal(args.name,"light_cloudflare_worker");
  assert.equal(args.input.script,"light-bookmark");
  assert.equal(args.env.LIGHT_CF_READ_TOKEN,"SECRET_1");
  assert.equal(r.connected,true);
  assert.doesNotMatch(JSON.stringify(r),/SECRET_1|ID_2|PRIVATE/);
});
test("Google Drive never returns private root data",async()=>{
  const probe=createLegacyCapabilityProbe({drive:async(name,args)=>{
    assert.equal(name,"light_drive_roots");
    assert.deepEqual(args,{});
    return {ok:true,result:{files:[{name:"SECRET_FOLDER"}]}};
  }});
  const r=await probe("google",{});
  assert.equal(r.status,"CONNECTED");
  assert.doesNotMatch(JSON.stringify(r),/SECRET_FOLDER/);
});
test("unsupported capability refuses arbitrary RPC requests",async()=>{
  const probe=createLegacyCapabilityProbe({notion:()=>{throw Error("called")}});
  const r=await probe("delete_all",{});
  assert.equal(r.status,"UNSUPPORTED_CAPABILITY");
  assert.equal(r.connected,false);
});
