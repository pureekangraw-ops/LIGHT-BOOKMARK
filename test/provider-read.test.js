import test from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_TOOLS, isProviderTool, runProviderTool } from "../src/provider-read.js";

const env = {
  LIGHT_GITHUB_REPOS: "pureekangraw-ops/LIGHT-BOOKMARK",
  LIGHT_GITLAB_PROJECTS: "yggmetro-group1/factory-district",
  LIGHT_CF_WORKERS: "factory-district1",
  LIGHT_CF_ACCOUNT_ID: "a".repeat(32),
  LIGHT_CF_READ_TOKEN: "restricted-test-token",
};
const response = (body,status=200) => new Response(typeof body==="string"?body:JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
test("provider catalog is read-only and never exposes write operations",()=>{
  assert.equal(PROVIDER_TOOLS.length,6);
  assert.ok(PROVIDER_TOOLS.every(x=>x.annotations.readOnlyHint===true));
  assert.equal(isProviderTool("light_github_repo"),true);
  assert.equal(isProviderTool("light_github_write"),false);
});
test("status does not expose credential values; Drive remains a separate Notion connection",async()=>{
  const result=await runProviderTool("light_connections_status",{},env);
  assert.equal(result.drive.ready,false);
  assert.equal(result.cloudflare.ready,true);
  assert.equal(result.write_actions,false);
  assert.doesNotMatch(JSON.stringify(result),/restricted-test-token/);
});
test("GitHub rejects non-allowlisted repos, unknown fields and suspicious file paths before network",async()=>{
  let count=0;const mock=async()=>{count++;return response({})};
  for(const args of [{repo:"random/private"},{repo:"pureekangraw-ops/LIGHT-BOOKMARK",path:"../.env"},
    {repo:"pureekangraw-ops/LIGHT-BOOKMARK",path:"secrets/token.txt"},
    {repo:"pureekangraw-ops/LIGHT-BOOKMARK",path:"README.md",action:"write"}]){
    await assert.rejects(runProviderTool(args.path?"light_github_file":"light_github_repo",args,env,mock),/RESOURCE_NOT_ALLOWLISTED|INVALID_INPUT/);
  }
  assert.equal(count,0);
});
test("GitHub repo reader is bounded and strips unnecessary upstream fields",async()=>{
  let url;
  const value=await runProviderTool("light_github_repo",{repo:"pureekangraw-ops/LIGHT-BOOKMARK"},env,async u=>{
    url=u;return response({full_name:"pureekangraw-ops/LIGHT-BOOKMARK",default_branch:"main",html_url:"https://github.com/pureekangraw-ops/LIGHT-BOOKMARK",private:false,secret:"never-show"});
  });
  assert.equal(url,"https://api.github.com/repos/pureekangraw-ops/LIGHT-BOOKMARK");
  assert.equal(value.repo,"pureekangraw-ops/LIGHT-BOOKMARK");
  assert.doesNotMatch(JSON.stringify(value),/never-show/);
});
test("GitHub file reader validates base64 and returns bounded UTF-8 text",async()=>{
  const data={type:"file",encoding:"base64",sha:"some-sha",content:Buffer.from("hello LIGHT").toString("base64")};
  const value=await runProviderTool("light_github_file",{repo:"pureekangraw-ops/LIGHT-BOOKMARK",path:"README.md"},env,async()=>response(data));
  assert.equal(value.text,"hello LIGHT");
  assert.equal(value.truncated,false);
});
test("GitLab project reader uses fixed gitlab.com API",async()=>{
  let url;const value=await runProviderTool("light_gitlab_project",{project:"yggmetro-group1/factory-district"},env,async u=>{url=u;return response({path_with_namespace:"yggmetro-group1/factory-district",visibility:"public",default_branch:"main",access_token:"hidden"});});
  assert.match(url,/^https:\/\/gitlab.com\/api\/v4\/projects\//);
  assert.equal(value.project,"yggmetro-group1/factory-district");
  assert.doesNotMatch(JSON.stringify(value),/hidden/);
});
test("GitLab file reader requires the project's allowlist",async()=>{
  let calls=0;const mock=async()=>{calls++;return response("hello")};
  await assert.rejects(runProviderTool("light_gitlab_file",{project:"someone/other",path:"README.md"},env,mock),/RESOURCE_NOT_ALLOWLISTED/);
  const value=await runProviderTool("light_gitlab_file",{project:"yggmetro-group1/factory-district",path:"README.md"},env,mock);
  assert.equal(value.text,"hello");assert.equal(calls,1);
});
test("Cloudflare metadata requires credential, fixed scripts, and strips author/secrets",async()=>{
  let count=0;const mock=async()=>{count++;return response({success:true,result:{deployments:[{id:"deployment-1",created_on:"2026-10-17T00:00:00Z",source:"wrangler",author_email:"owner@private.invalid",versions:[{version_id:"version-1",percentage:100}],bindings:[{secret:"never-leak"}]}]}})};
  await assert.rejects(runProviderTool("light_cloudflare_worker",{script:"unknown"},env,mock),/RESOURCE_NOT_ALLOWLISTED/);
  await assert.rejects(runProviderTool("light_cloudflare_worker",{script:"factory-district1"},{...env,LIGHT_CF_READ_TOKEN:""},mock),/NOT_CONFIGURED/);
  assert.equal(count,0);
  const x=await runProviderTool("light_cloudflare_worker",{script:"factory-district1"},env,mock);
  assert.equal(x.deployments[0].versions[0].percentage,100);
  assert.doesNotMatch(JSON.stringify(x),/never-leak|private.invalid|restricted-test-token/);
});
test("upstream auth errors do not echo response body",async()=>{
  await assert.rejects(runProviderTool("light_github_repo",{repo:"pureekangraw-ops/LIGHT-BOOKMARK"},env,
    async()=>response({token:"secret-from-upstream"},403)),/UPSTREAM_HTTP_403/);
});
