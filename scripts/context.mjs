import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(project, "config.json"), "utf8"));

// Actions 中始终有 GITHUB_REPOSITORY；本地命令回退到 origin 远程，便于任意fork直接使用。
export function currentRepository() {
  const value = process.env.GITHUB_REPOSITORY?.trim();
  if (value) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("GITHUB_REPOSITORY 格式非法");
    return value;
  }
  let remote = "";
  try {
    remote = execFileSync("git", ["-C", project, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    throw new Error("无法确定当前仓库：请设置 GITHUB_REPOSITORY 或配置 origin 远程");
  }
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote);
  if (!match) throw new Error(`无法从 origin 远程解析仓库：${remote}`);
  return `${match[1]}/${match[2]}`;
}

export function repositoryOwner() {
  return currentRepository().split("/")[0];
}

// 镜像命名空间跟随当前仓库所有者；具体镜像名仍由 config.json 的 image 模板决定。
export function imageRepository() {
  const owner = repositoryOwner().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/.test(owner)) throw new Error("仓库所有者名不能作为 GHCR 命名空间");
  if (typeof config.image !== "string" || !config.image.includes("{owner}")) {
    throw new Error("config.json 的 image 必须包含 {owner} 占位符");
  }
  const image = config.image.replaceAll("{owner}", owner);
  if (!/^[a-z0-9.-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image)) throw new Error("image 模板生成了非法镜像地址");
  return image;
}
