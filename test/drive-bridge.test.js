import test from "node:test";
import assert from "node:assert/strict";
import {LIGHT_DRIVE_TOOLS,runLightDriveTool} from "../src/drive-bridge.js";
const id="1gmu8Mh8Uve9VX3bRjaPGF4qWmMHfCniz";
const env={PANTHEON_LIGHT:{lightCall:async args=>({ok:true,caller:"LIGHT-BOOKMARK",capability:args.operation,result:{args,roots:[{id:"root",name:"My Drive"}]}})}};
test("Drive MCP exposes read and write commands but no delete",()=>{
  const names=LIGHT_DRIVE_TOOLS.map(x=>x.name);
  assert.ok(names.includes("light_drive_read")===false);
  assert.ok(names.includes("light_drive_share"));assert.ok(names.includes("light_drive_create"));
  assert.ok(names.every(x=>!x.includes("delete")));
  for(const tool of LIGHT_DRIVE_TOOLS.filter(x=>x.name.startsWith("light_drive_roots")||x.name==="light_drive_list"||x.name==="light_drive_file"||x.name==="light_drive_permissions"))assert.equal(tool.annotations.readOnlyHint,true);
  for(const tool of LIGHT_DRIVE_TOOLS.filter(x=>["light_drive_create","light_drive_update","light_drive_rename","light_drive_move","light_drive_copy","light_drive_share","light_drive_permission_update"].includes(x.name)))assert.equal(tool.annotations.readOnlyHint,false);
});
test("read and write commands route through their PANTHEON namespace",async()=>{
  const cases=[["light_drive_roots",{},"pantheon.drive.read"],["light_drive_list",{query:"academy",page_token:"next"},"pantheon.drive.read"],["light_drive_permissions",{file_id:id},"pantheon.drive.read"],["light_drive_create",{name:"x.txt",text:"x"},"pantheon.drive.write"],["light_drive_share",{file_id:id,type:"user",role:"reader",email_address:"person@example.com"},"pantheon.drive.write"]];
  for(const [name,args,operation] of cases){const r=await runLightDriveTool(name,args,env);assert.equal(r.ok,true);assert.equal(r.result.args.operation,operation);assert.equal(r.result.args.name,name);assert.deepEqual(r.result.args.args,args);}
});
test("rejects malformed arguments before Service Binding call",async()=>{
  let calls=0;const e={PANTHEON_LIGHT:{lightCall:async()=>{calls++;throw Error("unexpected call");}}};
  for(const [name,args] of [["light_drive_roots",{approved:true}],["light_drive_list",{folder_id:"../secret"}],["light_drive_file",{file_id:"../../.env"}],["light_drive_create",{name:"  "}],["light_drive_share",{file_id:id,type:"user",role:"owner",email_address:"person@example.com"}],["light_drive_permission_update",{file_id:id,permission_id:"../x",role:"writer"}]])await assert.rejects(runLightDriveTool(name,args,e),/INVALID_INPUT/);
  assert.equal(calls,0);
});
test("missing binding fails closed and errors omit OAuth credentials",async()=>{
  await assert.rejects(runLightDriveTool("light_drive_roots",{},{}),/NOT_CONFIGURED/);
  const e={PANTHEON_LIGHT:{lightCall:async()=>({ok:false,status:"GOOGLE_DRIVE_WRITE_SCOPE_REQUIRED",upstream_status:403,caller:"LIGHT-BOOKMARK",capability:"pantheon.drive.write"})}};
  const r=await runLightDriveTool("light_drive_create",{name:"x.txt"},e);assert.equal(r.ok,false);assert.equal(r.status,"GOOGLE_DRIVE_WRITE_SCOPE_REQUIRED");
});
