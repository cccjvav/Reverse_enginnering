import type { ExtensionContext } from "vscode";
import { randomBytes } from "node:crypto";
import { DurableBridgeRouteToken } from "./bridge-route-token.js";
import { acquireBridgeTunnelLease, isBridgeTunnelLeaseConflict } from "./bridge-tunnel-lease.js";

const ROUTE_TOKEN_SECRET = "shuncode.bridge.routeToken";
/** Preserve the existing Windows profile secret key; do not rotate on upgrade.
 * Serialize first creation/reset across windows sharing this SecretStorage.
 */
export function createWindowsBridgeRouteIdentity(context: ExtensionContext): DurableBridgeRouteToken {
  return new DurableBridgeRouteToken({
    read: async () => context.secrets.get(ROUTE_TOKEN_SECRET),
    write: async token => context.secrets.store(ROUTE_TOKEN_SECRET, token),
    generate: () => randomBytes(16).toString("hex"),
    withLock: async action => {
      const resource = `route-identity:${context.globalStorageUri.toString()}:${ROUTE_TOKEN_SECRET}`;
      for (let attempt = 0; ; attempt++) {
        let release: () => Promise<void>;
        try { release = await acquireBridgeTunnelLease([resource]); }
        catch (error) {
          if (!isBridgeTunnelLeaseConflict(error) || attempt >= 49) throw error;
          await new Promise<void>(resolve => setTimeout(resolve, 100));
          continue;
        }
        try { return await action(); } finally { await release(); }
      }
    },
  });
}
