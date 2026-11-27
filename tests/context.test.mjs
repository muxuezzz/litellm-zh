import assert from "node:assert/strict";
import test from "node:test";
import { currentRepository, imageRepository, repositoryOwner } from "../scripts/context.mjs";

test("仓库身份取 GITHUB_REPOSITORY，镜像命名空间随所有者变化", () => {
  const previous = process.env.GITHUB_REPOSITORY;
  try {
    process.env.GITHUB_REPOSITORY = "alice/litellm-zh";
    assert.equal(currentRepository(), "alice/litellm-zh");
    assert.equal(repositoryOwner(), "alice");
    assert.equal(imageRepository(), "ghcr.io/alice/litellm");

    process.env.GITHUB_REPOSITORY = "my-org/litellm-zh";
    assert.equal(imageRepository(), "ghcr.io/my-org/litellm");

    process.env.GITHUB_REPOSITORY = "bad repository";
    assert.throws(() => currentRepository(), /格式非法/);
    process.env.GITHUB_REPOSITORY = "-bad/repo";
    assert.throws(() => imageRepository(), /GHCR 命名空间/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previous;
  }
});

test("本地执行时从 origin 远程推导仓库和镜像名", () => {
  const previous = process.env.GITHUB_REPOSITORY;
  try {
    delete process.env.GITHUB_REPOSITORY;
    const repository = currentRepository();
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.equal(imageRepository(), `ghcr.io/${repository.split("/")[0].toLowerCase()}/litellm`);
  } finally {
    if (previous !== undefined) process.env.GITHUB_REPOSITORY = previous;
  }
});
