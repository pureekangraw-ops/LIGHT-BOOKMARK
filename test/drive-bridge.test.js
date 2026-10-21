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

test('Drive catalog describes direct OAuth and current partial implementation truthfully',()=>{
 const tools=Object.fromEntries(LIGHT_DRIVE_TOOLS.map(tool=>[tool.name,tool]));
 assert.equal(LIGHT_DRIVE_TOOLS.length,11);
 assert.match(tools.light_drive_roots.description,/LIGHT.*OAuth/);
 assert.doesNotMatch(tools.light_drive_roots.description,/PANTHEON/);
 assert.match(tools.light_drive_create.description,/without text/);
 for(const name of ['light_drive_update','light_drive_move','light_drive_share','light_drive_permission_update']){
  assert.match(tools[name].description,/not implemented/i);
  assert.match(tools[name].description,/LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED/);
  assert.equal(tools[name].annotations.readOnlyHint,false);
 }
});
test('documented unsupported Drive operations fail before OAuth or provider calls',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=()=>assert.fail('unimplemented operations must not fetch');
 const file_id='fixture_file_12345';
 const operations=[
  ['light_drive_create',{name:'fixture',text:'content'}],
  ['light_drive_update',{file_id,text:'content'}],
  ['light_drive_move',{file_id,folder_id:'root'}],
  ['light_drive_share',{file_id,type:'anyone',role:'reader'}],
  ['light_drive_permission_update',{file_id,permission_id:'fixture_permission',role:'reader'}],
 ];
 try{for(const [name,args] of operations)await assert.rejects(runLightDriveTool(name,args,{}),{message:'LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED'});}
 finally{globalThis.fetch=original;}
});
