import assert from "node:assert/strict";
import test from "node:test";

const { parseMacOsSystemProxy, systemProxyEnvironmentFromValues } = await import("./system-proxy.ts");

test("parses manual proxy values emitted by scutil", () => {
  const values = parseMacOsSystemProxy(`
<dictionary> {
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7890
  HTTPSEnable : 1
  HTTPSProxy : proxy.example.test
  HTTPSPort : 8443
}
`);

  assert.deepEqual(values, {
    HTTPEnable: "1",
    HTTPProxy: "127.0.0.1",
    HTTPPort: "7890",
    HTTPSEnable: "1",
    HTTPSProxy: "proxy.example.test",
    HTTPSPort: "8443",
  });
});

test("maps system web proxy values to Git and npm proxy variables", () => {
  const env = systemProxyEnvironmentFromValues({
    HTTPEnable: "1",
    HTTPProxy: "127.0.0.1",
    HTTPPort: "7890",
    SOCKSEnable: "1",
    SOCKSProxy: "::1",
    SOCKSPort: "1080",
  });

  assert.deepEqual(env, {
    HTTP_PROXY: "http://127.0.0.1:7890",
    http_proxy: "http://127.0.0.1:7890",
    HTTPS_PROXY: "http://127.0.0.1:7890",
    https_proxy: "http://127.0.0.1:7890",
    ALL_PROXY: "socks5h://[::1]:1080",
    all_proxy: "socks5h://[::1]:1080",
  });
});
