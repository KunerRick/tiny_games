import { _decorator, Component, Graphics, Label, Node, Sprite, UITransform } from 'cc';
import { SceneManager } from '../managers/SceneManager';
import { drawBackSkin } from '../ui/GameUIKit';

const { ccclass } = _decorator;

/**
 * 返回大厅按钮。
 *
 * 场景里这些节点是各游戏自己摆的：尺寸 84×48 / 88×88 / 96×96 / 100×100 都有，
 * 皮肤有的是九宫格 Sprite、有的干脆只有一行「返回」文字（午夜幸存者），
 * 摆在一起明显不是一套 UI。加上 `createBackButton`（8 款游戏运行时创建的那颗
 * 圆形 ‹）后，全站出现了两套返回按钮。
 *
 * 统一做法：onLoad 时套一层**矢量皮肤**——深蓝圆盘 + 细描边 + 白色 ‹，
 * 直径取节点短边（保留各自的位置与点击区），并把原来那行「返回 / 大厅」文字藏起来。
 * 画法与 `createBackButton` 共用 `drawBackSkin`，两端只差尺寸。
 *
 * 例外：节点自带 Graphics 的工程（方块坠落有自己的 TetrisSkin 皮肤）保持原样，
 * 否则两套底板会叠在一起。
 */
@ccclass('BackButton')
export class BackButton extends Component {
    onLoad() {
        this.applyUnifiedSkin();
        this.node.on(Node.EventType.TOUCH_END, this.onClick, this);
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onClick, this);
    }

    private onClick() {
        SceneManager.gotoLobby();
    }

    /** 画统一皮肤；幂等（`drawBackSkin` 内部按名字复用子节点） */
    private applyUnifiedSkin(): void {
        const node = this.node;
        if (!node?.isValid) return;

        const ui = node.getComponent(UITransform);
        if (!ui || ui.width <= 2 || ui.height <= 2) return;
        if (node.getComponent(Graphics)) return;

        // 九宫格底板让位给圆盘
        const sprite = node.getComponent(Sprite);
        if (sprite) sprite.enabled = false;

        // 旧的「返回 / 大厅」文字藏起来
        for (const child of node.children) {
            if (child?.isValid && child.getComponent(Label)) child.active = false;
        }

        drawBackSkin(node, Math.min(ui.width, ui.height));
    }
}
