import test from "node:test";
import assert from "node:assert/strict";
import {LIGHT_DRIVE_TOOLS,runLightDriveTool} from "../src/drive-bridge.js";
const root="1gmu8Mh8Uve9VX3bRjaPGF4qWmMHfCniz";
const env={PANTHEON_LIGHT:{lightCall:async args=>({ok:true,caller:"LIGHT-BOOKMARK",capability:"pantheon.drive.read",result:{args,roots:[{id:"root",name:"My Drive"}]}})}};
test("Drive tools advertise the pantheon.drive.read read-only capability",()=>{
  assert.deepEqual(LIGHT_DRIVE_TOOLS.map(x=>x.name),["light_drive_roots","light_drive_list","light_drive_file"]);
  for(const tool of LIGHT_DRIVE_TOOLS)assert.equal(tool.annotations.readOnlyHint,true);
});
test("roots, global list and file requests use the PANTHEON capability",async()=>{
  for(const [name,args] of [["light_drive_roots",{}],["light_drive_list",{query:"academy",page_token:"next"}],["light_drive_file",{file_id:root}]]){
    const r=await runLightDriveTool(name,args,env);assert.equal(r.ok,true);assert.equal(r.result.args.operation,"pantheon.drive.read");assert.equal(r.result.args.name,name);assert.deepEqual(r.result.args.args,args);
  }
});
test("allows valid root/folder IDs and rejects malformed arguments before Service Binding call",async()=>{
  let calls=0;const e={PANTHEON_LIGHT:{lightCall:async()=>{calls++;throw Error("unexpected call");}}};
  for(const [name,args] of [["light_drive_roots",{approved:true}],["light_drive_list",{folder_id:"../secret"}],["light_drive_list",{page_token:"x",execute:true}],["light_drive_file",{file_id:"../../.env"}],["light_drive_file",{file_id:root,write:true}]]){
    await assert.rejects(runLightDriveTool(name,args,e),/INVALID_INPUT/);
  }
  const r=await runLightDriveTool("light_drive_list",{folder_id:"root"},env);assert.equal(r.ok,true);assert.equal(calls,0);
});
test("missing binding fails closed and upstream errors do not expose secrets",async()=>{
  await assert.rejects(runLightDriveTool("light_drive_roots",{},{}),/NOT_CONFIGURED/);
  const e={PANTHEON_LIGHT:{lightCall:async()=>({ok:false,status:"GOOGLE_DRIVE_READ_SCOPE_REQUIRED",upstream_status:403,caller:"LIGHT-BOOKMARK",capability:"pantheon.drive.read"})}};
  const r=await runLightDriveTool("light_drive_roots",{},e);assert.equal(r.ok,false);assert.equal(r.status,"GOOGLE_DRIVE_READ_SCOPE_REQUIRED");
});
