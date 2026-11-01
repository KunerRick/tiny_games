import { _decorator, Component, Node, Layout, UITransform } from 'cc';
import { GAME_LIST, getGameById } from '../../common/managers/GameConfig';
import { StorageManager } from '../../common/managers/StorageManager';
import { SceneManager } from '../../common/managers/SceneManager';
import { GameGrid } from './GameGrid';

const { ccclass, property } = _decorator;

@ccclass('Lobby')
export class Lobby extends Component {
    @property(Node)
    recentSection: Node | null = null;

    @property(GameGrid)
    recentGrid: GameGrid | null = null;

    @property(GameGrid)
    allGamesGrid: GameGrid | null = null;

    @property({ type: Node, tooltip: 'ScrollView 的 content 节点：外层 Layout 由这里统一刷新' })
    content: Node | null = null;

    @property({ type: Node, tooltip: '「下滑查看更多」提示：只在内容超出可视区时显示' })
    scrollHint: Node | null = null;

    onLoad() {
        this.refreshUI();
    }

    refreshUI() {
        const userData = StorageManager.instance.getUserData();

        // Setup recent games section
        if (userData.recentGames.length > 0 && this.recentSection && this.recentGrid) {
            this.recentSection.active = true;
            const recentGames = userData.recentGames
                .map(id => getGameById(id))
                .filter(game => game !== undefined) as typeof GAME_LIST;
            this.recentGrid.setup(recentGames, this.onGameClick.bind(this));
        } else if (this.recentSection) {
            this.recentSection.active = false;
        }

        // Setup all games grid
        if (this.allGamesGrid) {
            this.allGamesGrid.setup(GAME_LIST, this.onGameClick.bind(this));
        }

        // 格子只刷新了自己的 Layout，外层分区与 content 还是旧尺寸
        this.updateLayouts();
    }

    /**
     * 逐层刷新布局：分区 → content。
     * 顺序必须由内向外，否则 content 会按上一轮的分区高度撑开，卡片照样重叠。
     */
    private updateLayouts(): void {
        this.applyLayout(this.recentSection);
        this.applyLayout(this.allGamesGrid ? this.allGamesGrid.node.parent : null);
        this.applyLayout(this.content);
        this.updateScrollHint();
    }

    private applyLayout(node: Node | null): void {
        if (!node || !node.isValid || !node.activeInHierarchy) return;
        const layout = node.getComponent(Layout);
        if (layout) layout.updateLayout();
    }

    /** 内容高于可视区时才提示「下滑查看更多」——否则提示是假的 */
    private updateScrollHint(): void {
        const hint = this.scrollHint;
        if (!hint || !hint.isValid) return;

        const content = this.content;
        if (!content || !content.isValid) {
            hint.active = false;
            return;
        }

        const contentTransform = content.getComponent(UITransform);
        const viewTransform = content.parent ? content.parent.getComponent(UITransform) : null;
        const contentHeight = contentTransform ? contentTransform.height : 0;
        const viewHeight = viewTransform ? viewTransform.height : 0;
        hint.active = contentHeight > viewHeight + 1;
    }

    onGameClick(gameId: string) {
        const game = getGameById(gameId);
        if (!game) return;

        // Save to recent
        StorageManager.instance.addRecentGame(gameId);

        // Goto game scene
        SceneManager.gotoGame(gameId, game.sceneName);
    }
}
