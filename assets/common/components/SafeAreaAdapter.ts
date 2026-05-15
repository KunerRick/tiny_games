import { _decorator, Component, UITransform, view } from 'cc';

const { ccclass, property, menu } = _decorator;

declare const wx: any;

@ccclass('SafeAreaAdapter')
@menu('Common/SafeAreaAdapter')
export class SafeAreaAdapter extends Component {
    @property({ tooltip: '顶部安全距离（设计分辨率像素），非微信环境或读取失败时使用此值' })
    defaultTopPadding: number = 80;

    start() {
        const padding = this.calculateTopPadding();
        if (padding <= 0) return;
        this.applyOffset(padding);
    }

    private calculateTopPadding(): number {
        if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
            try {
                const info = wx.getSystemInfoSync();
                if (info.safeArea?.top > 0) {
                    const designH = view.getDesignResolutionSize().height;
                    const scale = designH / (info.windowHeight || designH);
                    return Math.ceil(info.safeArea.top * scale);
                }
            } catch {}
        }
        return this.defaultTopPadding;
    }

    private applyOffset(padding: number): void {
        const pos = this.node.position;
        this.node.setPosition(pos.x, pos.y - padding / 2, pos.z);

        const uiTransform = this.node.getComponent(UITransform);
        if (uiTransform) {
            const size = uiTransform.contentSize;
            uiTransform.setContentSize(size.width, size.height - padding);
        }
    }
}
