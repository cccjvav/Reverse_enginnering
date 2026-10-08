// EXTRACTED from src/bridge-ngrok-failure.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

function isNgrokEndpointBusy(error2) {
  const message2 = typeof error2 === "string" ? error2 : error2 && typeof error2 === "object" && "message" in error2 ? String(error2.message) : "";
  return /ERR_NGROK_334\b/i.test(message2) || /\bendpoint\b[^\r\n]{0,2048}\bis already online\b/i.test(message2);
}
function isNonRetryableNgrokFailure(error2) {
  const record4 = error2 && typeof error2 === "object" ? error2 : {};
  const message2 = typeof error2 === "string" ? error2 : String(record4.message ?? "");
  return record4.retryable === false || isNgrokEndpointBusy(message2) || /ERR_NGROK_(?:9009|105|107|4018|3820)\b|authentication failed|invalid authtoken|pay-as-you-go/i.test(message2);
}
function ngrokStartFailure(output2) {
  if (isNgrokEndpointBusy(output2)) {
    return Object.assign(new Error(
      "ngrok endpoint is already online (ERR_NGROK_334). Check the existing agent or Cloud Endpoint/traffic policy in the ngrok dashboard. Use a dedicated MCP domain, or stop only an endpoint you own and no longer need, then retry. A recently stopped endpoint may need time to release. Do not enable pooling for independent MCP workspaces or kill unrelated processes."
    ), { failureCode: "ngrok-endpoint-busy", code: "ERR_NGROK_334", retryable: false });
  }
  if (/ERR_NGROK_3820\b/i.test(output2)) {
    return Object.assign(new Error(
      "ngrok rejected an old AI Gateway traffic policy (ERR_NGROK_3820). The ai-gateway action has been retired; inspect the existing Cloud Endpoint in the ngrok dashboard and use a dedicated MCP domain. This is not a Bash or local process error."
    ), { failureCode: "ngrok-start-failed", code: "ERR_NGROK_3820", retryable: false });
  }
  const code = output2.match(/ERR_NGROK_\d+\b/i)?.[0].toUpperCase();
  const error2 = new Error(`ngrok failed to establish the reserved domain.${code ? ` ${code}.` : ""} See the Bridge log for technical details.`);
  return isNonRetryableNgrokFailure(output2) ? Object.assign(error2, { retryable: false }) : error2;
}
