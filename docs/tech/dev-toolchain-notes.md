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
