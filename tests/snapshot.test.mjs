import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { snapshot } from "../scripts/release.mjs";

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

test("发布分支只包含汉化层，完整源码仍进入归档", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litellm-zh-snapshot-"));
  const artifacts = path.join(root, "artifacts");
  const savedActor = process.env.GITHUB_ACTOR;
  try {
    git(root, "init", "-q");
    const ui = path.join(root, "litellm/ui/litellm-dashboard/src/app");
    fs.mkdirSync(ui, { recursive: true });
    fs.writeFileSync(path.join(ui, "layout.tsx"), 'export default function Layout(){ return <html lang="zh-CN"><body>首页</body></html> }');
    const secretLike = path.join(root, "tests/unit/proxy/spend_tracking/test_spend_tracking_utils.py");
    fs.mkdirSync(path.dirname(secretLike), { recursive: true });
    fs.writeFileSync(secretLike, "TOKEN = 'gitlab-token-placeholder'\n");
    fs.mkdirSync(path.join(root, ".zh"), { recursive: true });
    fs.writeFileSync(path.join(root, ".zh/provenance.json"), "{}\n");
    fs.writeFileSync(path.join(root, ".litellm-zh.json"), JSON.stringify({ ui_source_path: "litellm/ui/litellm-dashboard/src" }));

    process.env.GITHUB_ACTOR = "alice";
    const result = snapshot(root, "v1.111.0", artifacts);

    assert.ok(fs.existsSync(path.join(artifacts, "translated-source.tar.gz")));
    assert.ok(fs.existsSync(path.join(artifacts, "source.bundle")));
    const overlayFiles = git(root, "ls-tree", "-r", "--name-only", result.commit).split("\n").filter(Boolean);
    assert.ok(overlayFiles.includes("litellm/ui/litellm-dashboard/src/app/layout.tsx"));
    assert.ok(overlayFiles.includes(".litellm-zh.json"));
    assert.ok(overlayFiles.includes(".zh/provenance.json"));
    assert.ok(!overlayFiles.some((file) => file.startsWith("tests/")));
    const fullFiles = git(root, "ls-tree", "-r", "--name-only", result.full_tree).split("\n").filter(Boolean);
    assert.ok(fullFiles.includes("tests/unit/proxy/spend_tracking/test_spend_tracking_utils.py"));
    assert.equal(git(root, "rev-parse", "refs/heads/zh-source"), result.commit);
  } finally {
    if (savedActor === undefined) delete process.env.GITHUB_ACTOR;
    else process.env.GITHUB_ACTOR = savedActor;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
