import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyOverlay } from "../scripts/apply.mjs";
import { locateRecipe, prepare } from "../scripts/release.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const uiLayout = 'export default function Layout(){ return <html lang="en"><body>Home</body></html> }';
const workflow = (dockerfile) => `name: smoke\njobs:\n  dashboard-build:\n    steps:\n      - run: docker build --target ui-builder -f ${dockerfile} .\n`;

function writeFixture(root, { dockerfilePath, uiSource, workflowDockerfile = dockerfilePath }) {
  const uiProject = uiSource.replace(/\/src$/, "");
  fs.mkdirSync(path.dirname(path.join(root, dockerfilePath)), { recursive: true });
  fs.writeFileSync(path.join(root, dockerfilePath),
    `FROM alpine AS ui-builder\nCOPY ${uiProject}/package.json ${uiProject}/package-lock.json ./\nRUN npm run build\n`);
  fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github/workflows/test-merge-smoke.yml"), workflow(workflowDockerfile));
  const source = path.join(root, uiSource);
  fs.mkdirSync(path.join(source, "app"), { recursive: true });
  fs.writeFileSync(path.join(source, "app/layout.tsx"), uiLayout);
  return source;
}

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "litellm-zh-recipe-"));
}

test("旧布局沿用根目录 Dockerfile 与 ui/litellm-dashboard", () => {
  const root = temporaryRoot();
  try {
    writeFixture(root, { dockerfilePath: "Dockerfile", uiSource: "ui/litellm-dashboard/src" });
    const recipe = locateRecipe(root);
    assert.equal(recipe.dockerfilePath, "Dockerfile");
    assert.equal(recipe.uiProject, "ui/litellm-dashboard");
    assert.equal(recipe.uiSource, "ui/litellm-dashboard/src");
    assert.equal(recipe.reusedUiCommand, "docker build --target ui-builder -f Dockerfile .");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("v1.111.0 新布局使用 litellm/deploy/docker/Dockerfile 与 litellm/ui", () => {
  const root = temporaryRoot();
  try {
    writeFixture(root, {
      dockerfilePath: "litellm/deploy/docker/Dockerfile",
      uiSource: "litellm/ui/litellm-dashboard/src",
    });
    const recipe = locateRecipe(root);
    assert.equal(recipe.dockerfilePath, "litellm/deploy/docker/Dockerfile");
    assert.equal(recipe.uiProject, "litellm/ui/litellm-dashboard");
    assert.equal(recipe.uiSource, "litellm/ui/litellm-dashboard/src");
    assert.equal(recipe.reusedUiCommand, "docker build --target ui-builder -f litellm/deploy/docker/Dockerfile .");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("上游再次换目录时从构建命令和 Dockerfile 自动适配", () => {
  const root = temporaryRoot();
  try {
    writeFixture(root, {
      dockerfilePath: "build/ci/Containerfile",
      uiSource: "frontend/dashboard/src",
    });
    const recipe = locateRecipe(root);
    assert.equal(recipe.dockerfilePath, "build/ci/Containerfile");
    assert.equal(recipe.uiProject, "frontend/dashboard");
    assert.equal(recipe.uiSource, "frontend/dashboard/src");
    assert.equal(recipe.reusedUiCommand, "docker build --target ui-builder -f build/ci/Containerfile .");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("上游构建命令或目录再次漂移时停止复用", () => {
  const root = temporaryRoot();
  try {
    writeFixture(root, {
      dockerfilePath: "litellm/deploy/docker/Dockerfile",
      uiSource: "litellm/ui/litellm-dashboard/src",
      workflowDockerfile: "Dockerfile",
    });
    assert.throws(() => locateRecipe(root), /公开构建流程或 Dockerfile 路径已变化/);
    fs.rmSync(path.join(root, "litellm/deploy/docker/Dockerfile"));
    assert.throws(() => locateRecipe(root), /公开构建流程或 Dockerfile 路径已变化/);
    fs.writeFileSync(path.join(root, ".github/workflows/test-merge-smoke.yml"), workflow("litellm/deploy/docker/Dockerfile"));
    writeFixture(root, {
      dockerfilePath: "litellm/deploy/docker/Dockerfile",
      uiSource: "litellm/ui/litellm-dashboard/src",
    });
    fs.rmSync(path.join(root, "litellm/ui/litellm-dashboard/src/app/layout.tsx"));
    assert.throws(() => locateRecipe(root), /UI 源码入口已变化/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("新布局下可以汉化并把实际路径写入报告", () => {
  const root = temporaryRoot();
  try {
    const source = writeFixture(root, {
      dockerfilePath: "litellm/deploy/docker/Dockerfile",
      uiSource: "litellm/ui/litellm-dashboard/src",
    });
    const report = applyOverlay(root, { Home: "首页" }, 1);
    assert.equal(report.ui_source_path, "litellm/ui/litellm-dashboard/src");
    assert.ok(fs.readFileSync(path.join(source, "app/layout.tsx"), "utf8").includes('lang="zh-CN"'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("新布局 prepare 记录构建配方并输出供工作流使用的路径", () => {
  const root = temporaryRoot();
  const outputRoot = temporaryRoot();
  const output = path.join(outputRoot, "github-output.txt");
  const envKeys = ["UPSTREAM_TAG", "UPSTREAM_SHA", "GITHUB_SHA", "GITHUB_OUTPUT"];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    const source = writeFixture(root, {
      dockerfilePath: "litellm/deploy/docker/Dockerfile",
      uiSource: "litellm/ui/litellm-dashboard/src",
    });
    const dictionary = JSON.parse(fs.readFileSync(path.join(project, "translations/zh-CN.json"), "utf8"));
    const english = Object.keys(dictionary)
      .filter((key) => /^[A-Za-z][A-Za-z ]{2,60}$/.test(key) && typeof dictionary[key] === "string" && dictionary[key] !== key)
      .slice(0, 100);
    assert.equal(english.length, 100);
    fs.mkdirSync(path.join(source, "i18n/locales"), { recursive: true });
    fs.writeFileSync(path.join(source, "i18n/locales/en.json"), JSON.stringify(Object.fromEntries(english.map((key) => [key, key]))));
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "upstream");

    process.env.UPSTREAM_TAG = "v1.111.0";
    process.env.UPSTREAM_SHA = git(root, "rev-parse", "HEAD");
    process.env.GITHUB_SHA = "overlay-revision";
    process.env.GITHUB_OUTPUT = output;
    fs.writeFileSync(output, "");
    const provenance = prepare(root, "v1.111.0");
    assert.equal(provenance.dockerfile_path, "litellm/deploy/docker/Dockerfile");
    assert.equal(provenance.build_recipe, "litellm/deploy/docker/Dockerfile");
    assert.equal(provenance.reused_ui_command, "docker build --target ui-builder -f litellm/deploy/docker/Dockerfile .");
    assert.equal(provenance.ui_project_path, "litellm/ui/litellm-dashboard");
    assert.equal(provenance.ui_source_path, "litellm/ui/litellm-dashboard/src");
    assert.ok(fs.existsSync(path.join(root, ".zh/upstream-workflows/test-merge-smoke.yml")));
    const written = fs.readFileSync(output, "utf8");
    assert.match(written, /dockerfile=litellm\/deploy\/docker\/Dockerfile/);
    assert.match(written, /ui_project=litellm\/ui\/litellm-dashboard/);
    assert.match(written, /ui_source=litellm\/ui\/litellm-dashboard\/src/);
  } finally {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
