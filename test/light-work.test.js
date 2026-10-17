import test from "node:test";
import assert from "node:assert/strict";
import { LIGHT_WORK_TOOLS,runLightWorkTool,isLightWorkTool } from "../src/light-work.js";
const task_id="task_"+"b".repeat(32);
const env={PANTHEON_LIGHT:{lightCall:async args=>({ok:true,caller:"LIGHT-BOOKMARK",result:{task_id,status:"QUEUED",args}})}};
test("MCP task tools include read/create/queue but never dispatch/deploy",()=>{
  assert.deepEqual(LIGHT_WORK_TOOLS.map(x=>x.name),[
    "light_pantheon_tasks","light_pantheon_create_task","light_pantheon_queue_factory","light_pantheon_factory"
  ]);
  assert.equal(isLightWorkTool("light_pantheon_dispatch"),false);
  assert.equal(LIGHT_WORK_TOOLS.find(x=>x.name==="light_pantheon_create_task").annotations.readOnlyHint,false);
});
test("create task forwards scoped request to LIGHT entrypoint",async()=>{
  const r=await runLightWorkTool("light_pantheon_create_task",{request:"  Inspect a failed PR  "},env);
  assert.equal(r.ok,true);
  assert.equal(r.execution_requested,false);
  assert.deepEqual(r.result.args,{operation:"create_task",request:"Inspect a failed PR"});
});
test("Factory queue does not dispatch",async()=>{
  const r=await runLightWorkTool("light_pantheon_queue_factory",{request:"Review code"},env);
  assert.equal(r.execution_requested,false);
  assert.equal(r.result.args.operation,"queue_factory");
});
test("read exact task and Factory job",async()=>{
  const a=await runLightWorkTool("light_pantheon_tasks",{task_id},env);
  const b=await runLightWorkTool("light_pantheon_factory",{task_id},env);
  assert.equal(a.result.args.operation,"show_task");
  assert.equal(b.result.args.operation,"factory_job");
});
test("bad ids and extra approval flag rejected before upstream",async()=>{
  let touched=false;
  const e={PANTHEON_LIGHT:{lightCall:async()=>{touched=true;throw Error("network");}}};
  for(const req of [
    ["light_pantheon_tasks",{task_id:"../secrets"}],
    ["light_pantheon_create_task",{request:"work",approved:true}],
    ["light_pantheon_queue_factory",{request:""}],
    ["light_pantheon_factory",{task_id:"hello"}]
  ])await assert.rejects(runLightWorkTool(req[0],req[1],e),/INVALID_INPUT/);
  assert.equal(touched,false);
});
test("missing Service Binding and disabled upstream produce explicit statuses",async()=>{
  await assert.rejects(runLightWorkTool("light_pantheon_tasks",{},{}),/NOT_CONFIGURED/);
  const r=await runLightWorkTool("light_pantheon_create_task",{request:"work"},{
    PANTHEON_LIGHT:{lightCall:async()=>({ok:false,status:"LIGHT_CREATE_DISABLED",upstream_status:403})}
  });
  assert.deepEqual(r,{ok:false,status:"LIGHT_CREATE_DISABLED",upstream_status:403});
});
test("only the LIGHT-BOOKMARK attested caller is accepted",async()=>{
  await assert.rejects(runLightWorkTool("light_pantheon_tasks",{},{
    PANTHEON_LIGHT:{lightCall:async()=>({ok:true,caller:"GO",result:{tasks:[]}})}
  }),/INVALID_UPSTREAM/);
});
