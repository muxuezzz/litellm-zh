import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, discover, eligible, selectRelease, version } from "../scripts/release.mjs";

const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: false, ...extra });

test("仅接纳 >= 1.108.0 的正式发行版，版本号按数字比较", () => {
  assert.equal(eligible(release("v1.108.0")), true);
  assert.equal(eligible(release("v1.109.0")), true);
  for (const item of [release("v1.107.99"), release("v1.104.9"), release("v1.110.0-rc.1"), release("v1.110.0", { prerelease: true }), release("v1.110.0", { draft: true }), release("v01.108.0")]) assert.equal(eligible(item), false);
  assert.equal(version("v1.108.0; echo secret"), null);
  assert.equal(version("v999999999999999999999.108.0"), null);
  assert.ok(compareVersions("v1.109.0", "v1.108.99") > 0);
  assert.ok(compareVersions("v1.108.10", "v1.108.9") > 0);
  assert.equal(selectRelease([release("v1.104.9"), release("v1.109.0"), release("v1.108.5"), release("v1.110.0-rc.1")]).tag_name, "v1.109.0");
  assert.equal(selectRelease([release("v1.107.9")]), null);
});

test("发现阶段的镜像地址跟随当前仓库所有者，不依赖固定账号", async () => {
  const savedFetch = globalThis.fetch;
  const savedRepository = process.env.GITHUB_REPOSITORY;
  try {
    process.env.GITHUB_REPOSITORY = "alice/litellm-zh";
    globalThis.fetch = async (url) => {
      const missing = url.includes("/releases/tags/v1.109.0-zh");
      const body = missing ? { message: "Not Found" } :
        url.includes("/releases/tags/v1.109.0") ? release("v1.109.0", { html_url: "https://example.test" }) :
        { object: { type: "commit", sha: "a".repeat(40) } };
      return new Response(JSON.stringify(body), { status: missing ? 404 : 200, headers: { "content-type": "application/json" } });
    };
    const result = await discover("v1.109.0");
    assert.equal(result.image_repository, "ghcr.io/alice/litellm");
    assert.equal(result.image, "ghcr.io/alice/litellm:v1.109.0-zh");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = savedRepository;
  }
});
