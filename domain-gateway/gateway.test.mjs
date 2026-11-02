import assert from "node:assert/strict";
import test from "node:test";
import gateway from "./public/_worker.js";

test("forwards a same-origin POST with its body and session intact", async () => {
  const request = new Request("https://www.kanibarber.com/api/action?step=2", {
    method: "POST",
    headers: {
      origin: "https://www.kanibarber.com",
      cookie: "session=example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ service: "corte" }),
  });
  const response = await gateway.fetch(request, {
    KANI_APP: {
      async fetch(forwarded) {
        assert.equal(forwarded.url, request.url);
        assert.equal(new URL(forwarded.url).origin, forwarded.headers.get("origin"));
        assert.equal(forwarded.method, "POST");
        assert.equal(forwarded.headers.get("cookie"), "session=example");
        assert.deepEqual(await forwarded.json(), { service: "corte" });
        return new Response(null, {
          status: 303,
          headers: {
            location: "/confirmacion",
            "set-cookie": "session=updated; Secure; HttpOnly; Path=/",
          },
        });
      },
    },
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/confirmacion");
  assert.equal(response.headers.get("set-cookie"), "session=updated; Secure; HttpOnly; Path=/");
});

test("streams assets and error responses without replacing them", async () => {
  for (const status of [200, 404, 500]) {
    const upstream = new Response(new Uint8Array([0, 255, 128, 10]), {
      status,
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
    });
    const response = await gateway.fetch(
      new Request("https://www.kanibarber.com/assets/example.bin"),
      {
        KANI_APP: { fetch: async () => upstream },
      },
    );
    assert.equal(response, upstream);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      new Uint8Array([0, 255, 128, 10]),
    );
  }
});
