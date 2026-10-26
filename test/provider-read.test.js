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
  assert.equal(result.gitlab.private_project_route,"LIGHT_DIRECT_TOKEN_REQUIRED");
  assert.doesNotMatch(JSON.stringify(result.gitlab),/PANTHEON/i);
  let reads=0;
  const binding={get:async()=>{reads++;return "synthetic-secret-store-token";}};
  const bound=await runProviderTool("light_connections_status",{}, {...env,LIGHT_GITLAB_READ_TOKEN:binding});
  assert.equal(bound.gitlab.mode,"token");
  assert.equal(reads,0);
  assert.doesNotMatch(JSON.stringify(bound),/synthetic-secret-store-token/);
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
test("provider readers resolve Cloudflare Secrets Store bindings asynchronously",async()=>{
  const secret="synthetic-secret-store-token";
  const binding={get:async()=>secret};
  const cases=[
    ["light_github_repo",{repo:"pureekangraw-ops/LIGHT-BOOKMARK"},{...env,LIGHT_GITHUB_READ_TOKEN:binding},"github",{full_name:"pureekangraw-ops/LIGHT-BOOKMARK"}],
    ["light_gitlab_project",{project:"yggmetro-group1/factory-district"},{...env,LIGHT_GITLAB_READ_TOKEN:binding},"gitlab",{path_with_namespace:"yggmetro-group1/factory-district"}],
    ["light_cloudflare_worker",{script:"factory-district1"},{...env,LIGHT_CF_READ_TOKEN:binding},"cloudflare",{success:true,result:{deployments:[]}}],
  ];
  for(const [name,args,settings,host,body] of cases){
    let authorization;
    const value=await runProviderTool(name,args,settings,async(url,options)=>{
      assert.equal(new URL(url).hostname,host==="cloudflare"?"api.cloudflare.com":host==="github"?"api.github.com":"gitlab.com");
      authorization=options.headers.Authorization;
      return response(body);
    });
    assert.equal(authorization,"Bearer "+secret);
    assert.doesNotMatch(JSON.stringify(value),/synthetic-secret-store-token/);
  }
});
test("Secret Store read failures are sanitized",async()=>{
  await assert.rejects(runProviderTool("light_gitlab_project",{project:"yggmetro-group1/factory-district"},{...env,LIGHT_GITLAB_READ_TOKEN:{get:async()=>{throw Error("synthetic-secret-store-token")}}}),/SECRET_STORE_READ_FAILED/);
  await assert.rejects(runProviderTool("light_github_repo",{repo:"pureekangraw-ops/LIGHT-BOOKMARK"},{...env,LIGHT_GITHUB_READ_TOKEN:{get:async()=>{throw Error("synthetic-secret-store-token")}}}),/SECRET_STORE_READ_FAILED/);
});
test("GitLab access failures stay on LIGHT and clearly request its own read token",async()=>{
  for(const [name,args,kind] of [
    ["light_gitlab_project",{project:"yggmetro-group1/factory-district"},"project"],
    ["light_gitlab_file",{project:"yggmetro-group1/factory-district",path:"README.md"},"file"],
  ]){
    const value=await runProviderTool(name,args,{...env,LIGHT_GITLAB_READ_TOKEN:""},async()=>response("private",404));
    assert.equal(value.status,"GITLAB_DIRECT_TOKEN_REQUIRED");
    assert.equal(value.resource_kind,kind);
    assert.equal(value.route,"LIGHT_DIRECT");
    assert.equal(value.required_configuration,"LIGHT_GITLAB_READ_TOKEN");
    assert.doesNotMatch(JSON.stringify(value),/PANTHEON/i);
  }
  const denied=await runProviderTool("light_gitlab_project",{project:"yggmetro-group1/factory-district"},{...env,LIGHT_GITLAB_READ_TOKEN:"synthetic-token"},async()=>response("denied",403));
  assert.equal(denied.status,"GITLAB_DIRECT_ACCESS_DENIED");
  assert.equal(denied.route,"LIGHT_DIRECT");
  assert.doesNotMatch(JSON.stringify(denied),/synthetic-token|PANTHEON/i);
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

test('connection status distinguishes configuration from unverified live access without networking', async()=>{
  const configured={...env,LIGHT_GITHUB_READ_TOKEN:'synthetic-github-secret',LIGHT_GITLAB_READ_TOKEN:'synthetic-gitlab-secret',LIGHT_GOOGLE_CLIENT_ID:'synthetic-client',LIGHT_GOOGLE_CLIENT_SECRET:'synthetic-client-secret',LIGHT_GOOGLE_REFRESH_TOKEN:'synthetic-refresh'};
  const value=await runProviderTool('light_connections_status',{},configured,()=>assert.fail('status must not fetch'));
  assert.equal(value.configuration_only,true);
  assert.equal(value.live_access_verified,false);
  for(const provider of ['github','gitlab','cloudflare','drive']){
    assert.equal(value[provider].ready,true);
    assert.equal(value[provider].configured,true);
    assert.equal(value[provider].status,'configured_unverified');
    assert.deepEqual(value[provider].missing_configuration,[]);
  }
  assert.doesNotMatch(JSON.stringify(value),/synthetic-|restricted-test-token/);
});
test('connection status lists canonical missing configuration names without using generic aliases',async()=>{
  const value=await runProviderTool('light_connections_status',{}, {
    CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-old-cf-token',
    GITHUB_TOKEN:'synthetic-generic-github',GITLAB_TOKEN:'synthetic-generic-gitlab',
    GOOGLE_CLIENT_ID:'synthetic-generic-client',GOOGLE_CLIENT_SECRET:'synthetic-generic-secret',
  },()=>assert.fail('status must not fetch'));
  assert.deepEqual(value.github.missing_configuration,['LIGHT_GITHUB_REPOS']);
  assert.deepEqual(value.gitlab.missing_configuration,['LIGHT_GITLAB_PROJECTS']);
  assert.deepEqual(value.cloudflare.missing_configuration,['LIGHT_CF_READ_TOKEN','LIGHT_CF_ACCOUNT_ID','LIGHT_CF_WORKERS']);
  assert.deepEqual(value.drive.missing_configuration,['LIGHT_GOOGLE_CLIENT_ID','LIGHT_GOOGLE_CLIENT_SECRET','LIGHT_GOOGLE_REFRESH_TOKEN or GOOGLE_REFRESH_TOKEN']);
  assert.equal(value.github.mode,'public_only');
  assert.equal(value.gitlab.mode,'public_only');
  for(const provider of ['github','gitlab','cloudflare','drive']){
    assert.equal(value[provider].ready,false);
    assert.equal(value[provider].configured,false);
    assert.equal(value[provider].status,'not_configured');
  }
  assert.doesNotMatch(JSON.stringify(value),/synthetic-/);
});
test('connection status reports an invalid Cloudflare account ID without returning its value',async()=>{
  const value=await runProviderTool('light_connections_status',{}, {...env,LIGHT_CF_ACCOUNT_ID:'not-an-account-id'},()=>assert.fail('status must not fetch'));
  assert.equal(value.cloudflare.ready,false);
  assert.equal(value.cloudflare.configured,false);
  assert.equal(value.cloudflare.status,'invalid_configuration');
  assert.deepEqual(value.cloudflare.invalid_configuration,['LIGHT_CF_ACCOUNT_ID']);
  assert.doesNotMatch(JSON.stringify(value),/not-an-account-id|restricted-test-token/);
});
