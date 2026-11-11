import { _decorator, Component, Node, Layout, UITransform } from 'cc';
import { GAME_CATEGORIES, GAME_LIST, getGameById } from '../../common/managers/GameConfig';
import type { GameCategory } from '../../common/managers/GameConfig';
import { StorageManager } from '../../common/managers/StorageManager';
import { SceneManager } from '../../common/managers/SceneManager';
import { createButton, createNode } from '../../common/ui/GameUIKit';
import type { UiButton } from '../../common/ui/GameUIKit';
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

    /** 当前分类：'all' 或 GameCategory */
    private _filter: 'all' | GameCategory = 'all';
    private _chips: { id: 'all' | GameCategory; btn: UiButton }[] = [];
    private _chipBar: Node | null = null;

    onLoad() {
        this.refreshUI();
    }

    // ==================== 分类标签（试玩报告 §3.1） ====================

    /**
     * 分类条插在 content 的第一个位置（content 是纵向 Layout，整条宽 720）。
     * 场景不用改：节点在运行时创建，滚动区尺寸变化由既有的 updateLayouts() 兜住。
     */
    private _ensureCategoryBar(): void {
        if (this._chipBar && this._chipBar.isValid) return;
        const content = this.content;
        if (!content || !content.isValid) return;

        const bar = createNode('CategoryBar', content, 720, 76);
        const layout = bar.addComponent(Layout);
        layout.type = Layout.Type.HORIZONTAL;
        layout.resizeMode = Layout.ResizeMode.NONE;
        layout.horizontalDirection = Layout.HorizontalDirection.LEFT_TO_RIGHT;
        layout.spacingX = 12;
        // content 的 Layout 会把整条按顺序摆；这里再把它钉到第一位
        bar.setSiblingIndex(0);
        this._chipBar = bar;

        const entries: { id: 'all' | GameCategory; label: string }[] = [
            { id: 'all', label: '全部' },
            ...GAME_CATEGORIES,
        ];
        for (const entry of entries) {
            const btn = createButton(bar, {
                w: 130,
                h: 56,
                text: entry.label,
                fontSize: 22,
                fill: '#1B2436',
                activeFill: '#2563EB',
                radius: 28,
                stroke: '#2B3757',
                onTap: () => this._onCategoryTap(entry.id),
            });
            this._chips.push({ id: entry.id, btn });
        }
        this._syncChips();
        const barLayout = bar.getComponent(Layout);
        if (barLayout) barLayout.updateLayout();
    }

    private _onCategoryTap(id: 'all' | GameCategory): void {
        if (this._filter === id) return;
        this._filter = id;
        this._syncChips();
        this._refreshRecent();
        this._refreshAllGames();
    }

    private _syncChips(): void {
        for (const chip of this._chips) chip.btn.setActive(chip.id === this._filter);
    }

    private _filteredGames(): typeof GAME_LIST {
        if (this._filter === 'all') return GAME_LIST;
        // 没登记分类的新游戏只在「全部」里出现，避免悄悄消失
        return GAME_LIST.filter((game) => game.category === this._filter);
    }

    /**
     * 「最近玩过」跟随分类筛选：以前选「益智」只过滤全部游戏，最近区仍显示
     * 动作 / 休闲条目（第二轮复核 N9）。筛完为空时整段隐藏，避免空标题。
     */
    private _refreshRecent(): void {
        if (!this.recentSection || !this.recentGrid) return;
        const userData = StorageManager.instance.getUserData();
        let recentGames = userData.recentGames
            .map(id => getGameById(id))
            .filter(game => game !== undefined) as typeof GAME_LIST;
        if (this._filter !== 'all') {
            recentGames = recentGames.filter(game => game.category === this._filter);
        }
        if (recentGames.length > 0) {
            this.recentSection.active = true;
            this.recentGrid.setup(recentGames, this.onGameClick.bind(this));
        } else {
            this.recentSection.active = false;
        }
    }

    private _refreshAllGames(): void {
        if (!this.allGamesGrid) return;
        this.allGamesGrid.setup(this._filteredGames(), this.onGameClick.bind(this));
        this.updateLayouts();
    }

    refreshUI() {
        // 最近玩过（跟随分类）
        this._refreshRecent();

        // 分类条 + 按当前分类刷新的全部游戏
        this._ensureCategoryBar();
        if (this.allGamesGrid) {
            this.allGamesGrid.setup(this._filteredGames(), this.onGameClick.bind(this));
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
