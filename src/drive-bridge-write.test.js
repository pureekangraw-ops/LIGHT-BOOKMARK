import test from "node:test";
import assert from "node:assert/strict";
import {runLightDriveTool,LIGHT_DRIVE_TOOLS} from "./drive-bridge.js";
const id="a".repeat(24),other="b".repeat(24);
const writeNames=["light_drive_create","light_drive_update","light_drive_move"];
test("write tools advertised as mutating",()=>{
 for(const name of writeNames){const tool=LIGHT_DRIVE_TOOLS.find(x=>x.name===name);assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,false);}
});
test("all writes go through restricted PANTHEON RPC",async()=>{
 const calls=[];const env={PANTHEON_LIGHT:{lightCall:async input=>{calls.push(input);return {ok:true,caller:"LIGHT-BOOKMARK",capability:"LIGHT_DRIVE_WRITE",result:{id}};}}};
 await runLightDriveTool("light_drive_create",{folder_id:id,name:"test.txt",text:"hello"},env);
 await runLightDriveTool("light_drive_update",{file_id:id,text:"updated"},env);
 await runLightDriveTool("light_drive_move",{file_id:id,folder_id:other},env);
 assert.deepEqual(calls.map(x=>x.operation),["drive_write","drive_write","drive_write"]);
 assert.deepEqual(calls.map(x=>x.name),writeNames);
});
test("invalid write arguments fail before any upstream call",async()=>{
 let calls=0;const env={PANTHEON_LIGHT:{lightCall:async()=>{calls++;}}};
 for(const [name,args] of [["light_drive_create",{folder_id:"../",name:"x",text:"x"}],["light_drive_update",{file_id:id,text:4}],["light_drive_move",{file_id:id,folder_id:"../"}]]){
   await assert.rejects(runLightDriveTool(name,args,env),/INVALID_INPUT/);
 }
 assert.equal(calls,0);
});
test("write rejects a forged read-only capability response",async()=>{
 const env={PANTHEON_LIGHT:{lightCall:async()=>({ok:true,caller:"LIGHT-BOOKMARK",capability:"LIGHT_DRIVE_READ",result:{id}})}};
 await assert.rejects(runLightDriveTool("light_drive_update",{file_id:id,text:"x"},env),/DRIVE_INVALID_BRIDGE_RESPONSE/);
});
