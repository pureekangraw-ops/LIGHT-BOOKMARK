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

test("read-only Drive file returns UTF-8 content instead of metadata only",async()=>{
 const original=globalThis.fetch;
 const env={LIGHT_GOOGLE_CLIENT_ID:"client",LIGHT_GOOGLE_CLIENT_SECRET:"secret",GOOGLE_REFRESH_TOKEN:"refresh"};
 globalThis.fetch=async url=>{
  if(String(url).includes("oauth2.googleapis.com"))return Response.json({access_token:"mock"});
  if(String(url).includes("alt=media"))return new Response("console.log('hello');");
  return Response.json({id:"123456789012",name:"app.js",mimeType:"text/javascript"});
 };
 try{
  const r=await runLightDriveTool("light_drive_file",{file_id:"123456789012"},env);
  assert.equal(r.ok,true);assert.match(r.result.text,/hello/);
 }finally{globalThis.fetch=original;}
});
test("file reader rejects path traversal in ZIP entry",async()=>{
 await assert.rejects(runLightDriveTool("light_drive_file",{file_id:"123456789012",entry:"../secrets"},{}),/INVALID_INPUT/);
});
