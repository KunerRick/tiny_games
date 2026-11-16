# 开发工具链与文本编码注意事项

> **适用**：改 `.ts`、跑类型检查、提交前的常规操作。
> **来源**：本项目实际事故（教训 A）与本机环境实测。
> 速查版在 [`../../AGENTS.md`](../../AGENTS.md) 的**红线清单**。

---

## 1. ⚠️ 不要用 PowerShell 改含中文的 TypeScript 文件

### 现象（事故 A）

用 PowerShell `Set-Content` / `Out-File` 批量替换 `BattleUI.ts` 里的 `.node.active`：

- 文件 UTF-8 字节被**重编码为 GBK/ANSI**
- 所有中文字符串变成乱码
- 全项目编译失败，`tsc` 报大量 `Unterminated string literal`

### 正确做法

- 用编辑器/工具的文件写接口（本项目里就是 `write` / `edit` 这类工具）；
- 或用 Python 显式指定编码读写：`open(path, encoding='utf-8')`；
- **不要**用 PowerShell 的 `Set-Content` / `Out-File` 改含中文的 `.ts`；
- 改完**必须**跑一次类型检查（见 §2）确认中文没被破坏。

---

## 2. 类型检查：注意 `npx tsc` 可能解析到不兼容版本

本机 `npx tsc --version` 会解析到全局 **tsc 6.x**，报的却是 `tsconfig.json` **自身**的弃用项：

```
tsconfig.json(6,3): error TS5107: Option 'moduleResolution=node10' is deprecated and will stop functioning in TypeScript 7.0.
```

**这与你的改动无关**，不要据此判断代码有问题。可用编辑器自带的那份（项目实测 5.8.2 通过）：

```bash
TSC="/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc"
node "$TSC" --version        # Version 5.8.2
node "$TSC" --noEmit && echo TS_OK
```

> 说明：`tsconfig.json` 的 `extends: ./temp/tsconfig.cocos.json` 依赖编辑器生成的 `temp/`，所以类型检查需要编辑器至少启动过一次。
> 备选 `npx --yes -p typescript@5.4.5 tsc` 在本机可能因 npm cache 权限（`EPERM`）失败，故优先用上面的绝对路径。

---

## 3. 提交前检查

```bash
git diff --stat          # 变更范围是否符合预期
git diff --check         # 空白/冲突标记
npx tsc --noEmit         # 见 §2 的版本注意事项
```

**不要提交**：`build/`、`library/`、`temp/`、`local/`、`profiles/`、`native/`（已在 `.gitignore`）。
个别 `settings/` 文件（如 `settings/v2/packages/information.json`）可能是本机编辑器的本地差异，提交前逐条确认，别顺手带上。

## 4. Cocos CLI 构建必须脱离沙箱跑（否则产物空场景 + 毁 `.meta`）

用 `CocosCreator --project . --build "configPath=…"` 做无 GUI 构建时，若命令跑在受限沙箱里（例如 AI 工具的默认 Bash 沙箱），会出现一组很隐蔽的症状：

| 症状 | 证据位置 |
|---|---|
| 构建 3–9 s「成功」结束，但 `build/wechatgame/assets/main/config.json` 的 `scenes` / `uuids` 是空的 | 产物只剩 2 MB 左右，场景表 0 条 |
| 日志刷 `Can not find the importer image/video-clip/fbx in editor`（一次构建 1000+ 条） | `temp/asset-db/log/<时间>.log` |
| 资产库把**全项目重新导入**一遍（`%cImport%c:` 上千条） | 同上；正常构建该计数为 0 |
| **`assets/**/*.meta` 被改写成 `"ver": "0.0.1", "importer": "*"`**，`subMetas`（纹理/精灵帧）全部丢失 | `git status` 突然出现几百个 `.meta` 变更 |

根因：沙箱阻断了编辑器插件（importer）的加载，asset-db 退化成「不认识任何资源类型」的模式，于是按未知类型重写 meta 并跳过打包。

**处置**：

1. 构建命令以非沙箱方式执行（本仓库的工具约定里对应 `dangerouslyDisableSandbox: true`）。
2. 已经中招就 `git checkout --` 还原被改写的 `.meta`（它们都是**受 git 跟踪**的，别用编辑器重新导入来"修"）。
3. 判据：构建日志 `grep -c "Can not find the importer"` = **0**，且 `git status` 只剩你自己的改动。
4. 构建正常时 `config.json` 的场景数 = `tools/sync-build-scenes.js --check` 打印的清单长度。

