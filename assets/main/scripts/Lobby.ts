import {
    _decorator, Component, Graphics, Node, Layout, UITransform, EditBox, Label,
    HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { GAME_CATEGORIES, GAME_LIST, getGameById } from '../../common/managers/GameConfig';
import type { GameCategory, GameConfig } from '../../common/managers/GameConfig';
import { StorageManager } from '../../common/managers/StorageManager';
import { SceneManager } from '../../common/managers/SceneManager';
import { createButton, createNode, createRoundRect, toColor } from '../../common/ui/GameUIKit';
import type { UiButton } from '../../common/ui/GameUIKit';
import { UI } from '../../common/ui/UITheme';
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

    /** 搜索关键词（去空白、转小写）；空串 = 不搜索 */
    private _keyword = '';
    private _searchBox: EditBox | null = null;
    private _searchBar: Node | null = null;
    /** 搜索胶囊底：点图标 / 两端留白也要能聚焦输入框 */
    private _searchBoxNode: Node | null = null;
    /** 搜索筛空时的提示文字（运行时创建，不占场景） */
    private _emptyHint: Label | null = null;

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
        // 5×130 + 4×12 = 698：左侧补 11 让分类条在 720 宽度里居中，
        // 与搜索条（同宽居中）左右边缘对齐
        layout.paddingLeft = 11;
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

    // ==================== 搜索框（试玩报告 §3.1：24 款靠分类找起来仍慢） ====================

    /**
     * 关键词搜索：输字即筛，与分类标签叠加生效；清空即恢复。
     * 用原生 `EditBox`（微信小游戏会弹系统键盘），不自己接管文字输入。
     * 搜索期间「最近玩过」同样按关键词过滤，筛空自动隐藏。
     */
    private _ensureSearchBar(): void {
        if (this._searchBox && this._searchBox.isValid) return;
        const content = this.content;
        if (!content || !content.isValid) return;

        const bar = createNode('SearchBar', content, 720, 96);
        bar.setSiblingIndex(0);
        this._searchBar = bar;

        // 与分类条同宽（5×130 + 4×12 = 698）：上下两条的边缘对齐，视觉上不再错位
        const boxW = 698;
        const boxH = 64;
        const boxNode = createNode('SearchBox', bar, boxW, boxH);
        createRoundRect(boxNode, 'Bg', boxW, boxH, 32, UI.panel, UI.panelStroke, 2);
        // EditBox 只在自己 540 宽的节点内响应触摸，放大镜与胶囊两端本来是死区；
        // 在胶囊底上接一次 TOUCH_END，让整条搜索框都能唤起键盘
        boxNode.on(Node.EventType.TOUCH_END, this.onSearchBoxTouch, this);
        this._searchBoxNode = boxNode;

        // 放大镜：一个空心圆 + 斜向手柄（不用字符图标，红线 10）
        const iconNode = createNode('SearchIcon', boxNode, 40, 40);
        iconNode.setPosition(-boxW / 2 + 36, 0, 0);
        const icon = iconNode.addComponent(Graphics);
        icon.lineWidth = 3;
        icon.strokeColor = toColor(UI.textDim);
        icon.circle(-2, 3, 10);
        icon.stroke();
        icon.moveTo(6, -6);
        icon.lineTo(14, -14);
        icon.stroke();

        const editNode = createNode('EditBox', boxNode, boxW - 100, boxH - 8);
        editNode.setPosition(24, 0, 0);
        // 先停用时再挂组件：EditBox.onLoad 会在 textLabel 为空时自动建一个
        // 40 号字、内容 "label" 的默认 Label，抢在赋值之前就把画面弄脏了。
        editNode.active = false;
        const edit = editNode.addComponent(EditBox);

        const textLabel = createLabelNode(editNode, 'TEXT_LABEL', UI.text);
        const placeLabel = createLabelNode(editNode, 'PLACEHOLDER_LABEL', UI.textDim);
        // EditBox 把子 Label 摆在自己顶边（_updateLabelPosition: y = +height/2），
        // 所以锚点必须是 (0, 1) 让文字向下铺满输入框；用 (0, 0.5) 会把整行文字抬到框顶外，
        // 就是试玩反馈里「搜索文字没对齐」的根源。
        for (const label of [textLabel, placeLabel]) {
            const ut = label.node.getComponent(UITransform);
            if (ut) ut.setAnchorPoint(0, 1);
        }
        edit.textLabel = textLabel;
        edit.placeholderLabel = placeLabel;
        edit.placeholder = '搜索游戏名 / 关键词';
        edit.maxLength = 12;
        edit.string = '';
        edit.node.on(EditBox.EventType.TEXT_CHANGED, this.onSearchChanged, this);
        // 聚焦时文字交给网页/小游戏的 DOM 输入框，再校正一次行高
        edit.node.on(EditBox.EventType.EDITING_DID_BEGAN, this.onSearchEditingBegan, this);
        editNode.active = true;
        this._centerDomInput(edit);
        this._searchBox = edit;
    }

    /** 整条胶囊都可点：点图标 / 留白时把焦点交给输入框 */
    private onSearchBoxTouch(): void {
        const edit = this._searchBox;
        if (!edit || !edit.isValid || edit.isFocused()) return;
        edit.setFocus();
    }

    /** 聚焦瞬间：网页预览的 DOM 输入框还没有行高，这里补上 */
    private onSearchEditingBegan(): void {
        if (this._searchBox && this._searchBox.isValid) this._centerDomInput(this._searchBox);
    }

    /**
     * 网页预览 / 小游戏里 EditBox 用 DOM 输入框接管文字，Cocos 只同步了字号与颜色、没设行高，
     * 文字会贴输入框顶部。把行高设成框高让它垂直居中，和未聚焦时的 Label 对齐；
     * 原生平台没有 `_edTxt`，这里直接跳过。
     */
    private _centerDomInput(edit: EditBox): void {
        const impl = edit._impl as unknown as { _edTxt?: { style?: CSSStyleDeclaration } } | null;
        const el = impl && impl._edTxt;
        if (!el || !el.style) return;
        const ut = edit.node.getComponent(UITransform);
        const height = ut ? Math.round(ut.height) : 0;
        if (height > 0) el.style.lineHeight = `${height}px`;
    }

    private onSearchChanged(edit: EditBox): void {
        const keyword = (edit.string || '').trim().toLowerCase();
        if (keyword === this._keyword) return;
        this._keyword = keyword;
        this._refreshRecent();
        this._refreshAllGames();
    }

    private _syncChips(): void {
        for (const chip of this._chips) chip.btn.setActive(chip.id === this._filter);
    }

    private _filteredGames(): typeof GAME_LIST {
        let list = this._filter === 'all'
            ? GAME_LIST
            // 没登记分类的新游戏只在「全部」里出现，避免悄悄消失
            : GAME_LIST.filter((game) => game.category === this._filter);
        if (this._keyword) list = list.filter(game => this._matches(game));
        return list;
    }

    /** 搜索匹配：名称 / 描述 / id 任一包含关键词（已转小写） */
    private _matches(game: GameConfig): boolean {
        const kw = this._keyword;
        if (!kw) return true;
        return game.name.toLowerCase().indexOf(kw) >= 0
            || game.id.toLowerCase().indexOf(kw) >= 0
            || (game.description || '').toLowerCase().indexOf(kw) >= 0;
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
        if (this._keyword) recentGames = recentGames.filter(game => this._matches(game));
        if (recentGames.length > 0) {
            this.recentSection.active = true;
            this.recentGrid.setup(recentGames, this.onGameClick.bind(this));
        } else {
            this.recentSection.active = false;
        }
    }

    private _refreshAllGames(): void {
        if (!this.allGamesGrid) return;
        const list = this._filteredGames();
        this.allGamesGrid.setup(list, this.onGameClick.bind(this));
        this._updateEmptyHint(list.length);
        this.updateLayouts();
    }

    /** 搜索筛空时的提示：没有它界面只剩一个「全部游戏」标题，看着像坏了 */
    private _ensureEmptyHint(): Label | null {
        if (this._emptyHint && this._emptyHint.isValid) return this._emptyHint;
        const grid = this.allGamesGrid;
        if (!grid || !grid.node || !grid.node.parent) return null;
        const node = createNode('SearchEmptyHint', grid.node.parent, 600, 60);
        const label = node.addComponent(Label);
        label.string = '';
        label.fontSize = 22;
        label.lineHeight = 30;
        label.color = toColor(UI.textDim);
        label.horizontalAlign = HorizontalTextAlignment.CENTER;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        label.overflow = Label.Overflow.CLAMP;
        label.enableWrapText = true;
        // 视觉顺序：分区标题 → 提示 → 格子
        node.setSiblingIndex(grid.node.getSiblingIndex());
        node.active = false;
        this._emptyHint = label;
        return label;
    }

    private _updateEmptyHint(count: number): void {
        const hint = this._ensureEmptyHint();
        if (!hint || !hint.isValid) return;
        if (count > 0 || !this._keyword) {
            hint.node.active = false;
            return;
        }
        // 分类与关键词是叠加筛的：分类之外有匹配时必须说清原因，
        // 否则玩家会把「动作分类下搜消」当成整库没有这款游戏
        const category = this._filter === 'all'
            ? null
            : GAME_CATEGORIES.find(entry => entry.id === this._filter) || null;
        hint.string = category
            ? `「${category.label}」分类下没有匹配「${this._keyword}」的游戏，切到「全部」再看看`
            : `没有找到匹配「${this._keyword}」的游戏，换个关键词试试`;
        hint.node.active = true;
    }

    refreshUI() {
        // 最近玩过（跟随分类）
        this._refreshRecent();

        // 搜索框 + 分类条 + 按当前分类刷新的全部游戏
        this._ensureSearchBar();
        this._ensureCategoryBar();
        // 分类条自己会把索引钉到 0；搜索框要压在它上面，这里再抢一次
        if (this._searchBar?.isValid) this._searchBar.setSiblingIndex(0);
        this._refreshAllGames();

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

    onDestroy() {
        // 只解绑缓存到的引用；不碰 @property(Node)（红线 4）
        if (this._searchBox && this._searchBox.isValid) {
            this._searchBox.node.off(EditBox.EventType.TEXT_CHANGED, this.onSearchChanged, this);
            this._searchBox.node.off(EditBox.EventType.EDITING_DID_BEGAN, this.onSearchEditingBegan, this);
        }
        if (this._searchBoxNode && this._searchBoxNode.isValid) {
            this._searchBoxNode.off(Node.EventType.TOUCH_END, this.onSearchBoxTouch, this);
        }
        this._searchBoxNode = null;
        this._emptyHint = null;
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

/** EditBox 需要一个独立的 Label 子节点承载文字 / 占位文案 */
function createLabelNode(parent: Node, name: string, colorHex: string): Label {
    const node = createNode(name, parent, parent.getComponent(UITransform)?.width ?? 540, 40);
    const label = node.addComponent(Label);
    label.string = '';
    label.fontSize = 24;
    label.lineHeight = 28;
    label.color = toColor(colorHex);
    label.horizontalAlign = HorizontalTextAlignment.LEFT;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    // 固定成输入框大小（EditBox 会再设一次 contentSize），让垂直居中真正生效；
    // 默认 NONE 会按文字尺寸收缩节点，配合 (0,1) 锚点又贴回框顶
    label.overflow = Label.Overflow.CLAMP;
    return label;
}
