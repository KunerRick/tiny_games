import { _decorator, Component, Node, director } from 'cc';
import { SceneManager } from '../managers/SceneManager';

const { ccclass, property } = _decorator;

@ccclass('BackButton')
export class BackButton extends Component {
    onLoad() {
        this.node.on(Node.EventType.TOUCH_END, this.onClick, this);
    }
    
    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onClick, this);
    }
    
    private onClick() {
        SceneManager.gotoLobby();
    }
}
