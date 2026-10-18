import test from "node:test";
import assert from "node:assert/strict";
import { LIGHT_DRIVE_TOOLS,runLightDriveTool } from "../src/drive-bridge.js";
const root="1gmu8Mh8Uve9VX3bRjaPGF4qWmMHfCniz";
const env={PANTHEON_LIGHT:{lightCall:async args=>({ok:true,caller:"LIGHT-BOOKMARK",capability:"LIGHT_DRIVE_READ",result:{args,folder_ids:[root]}})}};
test("Drive tools advertise accurate read and write permissions",()=>{assert.deepEqual(LIGHT_DRIVE_TOOLS.map(x=>x.name),["light_drive_roots","light_drive_list","light_drive_file"]);for(const tool of LIGHT_DRIVE_TOOLS)assert.equal(tool.annotations.readOnlyHint,true);});
test("roots, list and file forward to PANTHEON only",async()=>{
  for(const [name,args] of [["light_drive_roots",{}],["light_drive_list",{folder_id:root}],["light_drive_file",{file_id:"1mi5UMJRE2Q6nM9u9kz0wgdEVw3QSR2S"}]]){
    const r=await runLightDriveTool(name,args,env);assert.equal(r.ok,true);assert.equal(r.result.args.name,name);assert.deepEqual(r.result.args.args,args);
  }
});
test("reject unknown fields, write requests and invalid IDs without Service Binding call",async()=>{
  let calls=0;const e={PANTHEON_LIGHT:{lightCall:async()=>{calls++;throw Error("unexpected call")}}};
  for(const [name,args] of [["light_drive_roots",{approved:true}],["light_drive_list",{folder_id:"../secret"}],["light_drive_file",{file_id:"../../.env"}],["light_drive_file",{file_id:"123456789012",write:true}]]){
    await assert.rejects(runLightDriveTool(name,args,e),/INVALID_INPUT/);
  }
  assert.equal(calls,0);
});
test("missing binding fails closed, and upstream errors omit any secret values",async()=>{
  await assert.rejects(runLightDriveTool("light_drive_roots",{},{}),/NOT_CONFIGURED/);
  const e={PANTHEON_LIGHT:{lightCall:async()=>({ok:false,status:"DRIVE_FOLDER_ALLOWLIST_NOT_CONFIGURED",upstream_status:503,caller:"LIGHT-BOOKMARK",capability:"LIGHT_DRIVE_READ"})}};
  const r=await runLightDriveTool("light_drive_roots",{},e);assert.equal(r.ok,false);assert.equal(r.status,"DRIVE_FOLDER_ALLOWLIST_NOT_CONFIGURED");
});
