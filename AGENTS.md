# Tiny Games 项目规范

## 文档存放规范

**所有项目文档统一存放到 `docs/` 目录下**，包括：
- 设计文档 (`docs/design/`)
- 规格说明 (`docs/specs/`)
- 技术方案 (`docs/tech/`)
- 会议记录 (`docs/meetings/`)
- API 文档 (`docs/api/`)

禁止将文档分散存放在项目根目录或其他位置。

## 项目概述

小游戏集合，基于 Cocos Creator 3.x 开发，支持发布到微信小游戏和移动端 App。

## 技术栈

- **引擎**: Cocos Creator 3.x
- **语言**: TypeScript
- **首要平台**: 微信小游戏
- **次要平台**: iOS/Android App

## 架构模式

独立模式：每个游戏是完全独立的场景，通过主入口（游戏大厅）进入，切换时重新加载。

## 项目结构

```
tiny_games/
├── assets/
│   ├── main/           # 主入口（游戏大厅）
│   ├── games/          # 各游戏独立目录
│   ├── common/         # 公共模块
│   └── resources/      # 动态加载资源
├── build/              # 构建输出
├── docs/               # 项目文档（所有文档统一存放）
└── settings/           # Cocos 项目设置
```
