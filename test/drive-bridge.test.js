import test from "node:test";
import assert from "node:assert/strict";
import {LIGHT_DRIVE_TOOLS,runLightDriveTool} from "../src/drive-bridge.js";
test("direct Drive exposes no delete tool",()=>{
 assert.ok(LIGHT_DRIVE_TOOLS.some(x=>x.name==="light_drive_list"));
 assert.ok(LIGHT_DRIVE_TOOLS.every(x=>!x.name.includes("delete")));
});
test("missing dedicated OAuth configuration fails closed",async()=>{
 await assert.rejects(runLightDriveTool("light_drive_list",{},{}),/LIGHT_DRIVE_NOT_CONFIGURED/);
});
test("reject malformed IDs without network access",async()=>{
 await assert.rejects(runLightDriveTool("light_drive_file",{file_id:"../secrets"},{}),/INVALID_INPUT/);
});
test("unsupported mutations fail closed",async()=>{
 await assert.rejects(runLightDriveTool("light_drive_update",{file_id:"1gmu8Mh8Uve9VX3bRjaPGF4qWmMHfCniz",text:"test"},{}),/LIGHT_DRIVE_NOT_CONFIGURED|LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED/);
});
