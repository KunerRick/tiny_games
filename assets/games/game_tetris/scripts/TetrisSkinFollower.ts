/**
 * 方块坠落 — 皮肤底纹的「跟屁虫」。
 *
 * 背景：一个节点只能有**一个** UIRenderer 生效（见 `TetrisSkin.ensureGraphics`）。
 * 节点自己就是 `Label` 时，底纹既不能画在它身上，也不能画成它的子节点
 * （引擎先画节点自己的 Label、再画子节点，子节点会把文字盖住），只能插成**前一个兄弟节点**。
 *
 * 兄弟节点不会跟着 Label 走：面板用 `node.active` 显隐「新纪录」这类胶囊时，
 * 底纹不跟就会剩一块空底纹。所以本组件挂在**标签自己身上**（它一定会被激活/反激活），
 * 在 `onEnable` / `onDisable` / `update` 里把显隐和位置同步给底纹节点。
 *
 * 为什么不用 `ACTIVE_IN_HIERARCHY_CHANGED`：面板先给标签置 `active=true`、再给整个面板置
 * `active=true`，第一次置位时标签的 `activeInHierarchy` 并没有变，事件不触发，底纹就一直藏着。
 *
 * 注意：单独一个文件——Cocos 规定**一个脚本只能有一个 Component**，
 * 和 `TetrisSkinButton` 放一起会让整个模块注册失败（一堆脚本变成 Unknown / corrupted）。
 */

import { _decorator, Component, Node } from 'cc';

const { ccclass } = _decorator;

@ccclass('TetrisSkinFollower')
export class TetrisSkinFollower extends Component {
    /** 底纹节点（普通字段，不比 @property，onDestroy 里只做 isValid 判断） */
    private _skin: Node | null = null;

    /** 绑定底纹节点（重复调用安全） */
    attach(skin: Node): void {
        this._skin = skin;
        this.sync();
    }

    onEnable(): void {
        this.sync();
    }

    onDisable(): void {
        // 标签被藏起来时，底纹也必须跟着藏
        const skin = this._skin;
        if (skin && skin.isValid && skin.active) {
            skin.active = false;
        }
    }

    /** 标签可能被布局代码挪位，位置/缩放每帧对齐（只有几个节点，开销可忽略） */
    update(): void {
        this.syncPosition();
    }

    onDestroy(): void {
        const skin = this._skin;
        this._skin = null;
        if (skin && skin.isValid) {
            skin.active = false;
        }
    }

    private sync(): void {
        const skin = this._skin;
        if (!skin || !skin.isValid || !this.node.isValid) return;
        if (skin.active !== this.node.active) {
            skin.active = this.node.active;
        }
        this.syncPosition();
    }

    private syncPosition(): void {
        const skin = this._skin;
        if (!skin || !skin.isValid || !this.node.isValid) return;
        if (!skin.active) return;
        const p = this.node.position;
        skin.setPosition(p.x, p.y, p.z);
        skin.setScale(this.node.scale);
    }
}
