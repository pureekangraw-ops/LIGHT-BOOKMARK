import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./index.js";
import { legacyCapabilityProbe } from "./legacy-explorer-read.js";

// Public /mcp authentication remains defined entirely in index.js.
export default worker;

// Internal only: callers require an explicit named Cloudflare Service Binding.
// No credentials, Notion content, Google file names, or Cloudflare settings
// leave this RPC. Every accepted operation is read-only.
export class LegacyExplorerRead extends WorkerEntrypoint {
  async probe(capability) {
    return legacyCapabilityProbe(capability,this.env);
  }
}
