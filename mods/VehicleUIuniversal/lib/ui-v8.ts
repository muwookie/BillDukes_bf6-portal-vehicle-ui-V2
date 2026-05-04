// UI module from bf6-portal-utils v7.0.0 + components v6.x
// Stripped of import/export for namespace bundling
// Includes: Core (Node, Element, Root, Receivers), Container, Button, Text, ContentButton, TextButton

namespace UI {
    /****** Logging ******/

    const logging = new Logging('UI');

    export const LogLevel = Logging.LogLevel;

    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeError);
    }

    /****** Types ******/

    type BaseParams = {
        anchor?: mod.UIAnchor;
        parent?: Parent;
        visible?: boolean;
        bgColor?: mod.Vector;
        bgAlpha?: number;
        bgFill?: mod.UIBgFill;
        depth?: mod.UIDepth;
        receiver?: mod.Player | mod.Team;
        uiInputModeWhenVisible?: boolean;
    };

    export type Size = {
        width: number;
        height: number;
    };

    export type Position = {
        x: number;
        y: number;
    };

    type EitherPosition =
        | ({ position?: Position } & { x?: never; y?: never })
        | ({ x?: number; y?: number } & { position?: never });

    type EitherSize =
        | ({ size?: Size } & { width?: never; height?: never })
        | ({ width?: number; height?: number } & { size?: never });

    export type ElementParams = BaseParams & EitherPosition & EitherSize;

    export type FinalElementParams = {
        name: string;
        parent: Parent;
        anchor: mod.UIAnchor;
        visible: boolean;
        bgColor: mod.Vector;
        bgAlpha: number;
        bgFill: mod.UIBgFill;
        depth: mod.UIDepth;
        x: number;
        y: number;
        width: number;
        height: number;
        receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;
        uiInputModeWhenVisible: boolean;
    };

    /****** Interfaces ******/

    export interface Parent {
        name: string;
        uiWidget: mod.UIWidget;
        receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;
        children: Element[];
        attachChild(child: Element): void;
        detachChild(child: Element): void;
    }

    export interface Button {
        onClick: ((player: mod.Player) => Promise<void> | void) | undefined;
    }

    /****** Receiver Classes ******/

    abstract class Receiver<T extends mod.Player | mod.Team | undefined> {
        protected _id: string;
        protected _nativeReceiver: T;
        protected _inputModeRequesters: Set<Element> = new Set();

        protected constructor(id: string, receiver: T) {
            this._id = id;
            this._nativeReceiver = receiver;
        }

        public get id(): string { return this._id; }
        public get nativeReceiver(): T { return this._nativeReceiver; }
        public get isInputModeRequested(): boolean { return this._inputModeRequesters.size > 0; }

        public addInputModeRequester(element: Element): void {
            const wasAlreadyRequested = this.isInputModeRequested;
            this._inputModeRequesters.add(element);
            if (wasAlreadyRequested) return;
            if (this._nativeReceiver) {
                mod.EnableUIInputMode(true, this._nativeReceiver);
            } else {
                mod.EnableUIInputMode(true);
            }
        }

        public removeInputModeRequester(element: Element): void {
            const wasAlreadyRequested = this.isInputModeRequested;
            this._inputModeRequesters.delete(element);
            if (!wasAlreadyRequested) return;
            if (this.isInputModeRequested) return;
            if (this._nativeReceiver) {
                mod.EnableUIInputMode(false, this._nativeReceiver);
            } else {
                mod.EnableUIInputMode(false);
            }
        }
    }

    export class GlobalReceiver extends Receiver<undefined> {
        public static readonly instance = new GlobalReceiver();
        private constructor() { super('g', undefined); }
    }

    export class TeamReceiver extends Receiver<mod.Team> {
        private static _instances = new Map<number, TeamReceiver>();
        private constructor(receiver: mod.Team) {
            const id = mod.GetObjId(receiver);
            super(`t${id}`, receiver);
            TeamReceiver._instances.set(id, this);
        }
        public static getInstance(receiver: mod.Team): TeamReceiver {
            return TeamReceiver._instances.get(mod.GetObjId(receiver)) ?? new TeamReceiver(receiver);
        }
    }

    export class PlayerReceiver extends Receiver<mod.Player> {
        private static _instances = new Map<number, PlayerReceiver>();
        private constructor(receiver: mod.Player) {
            const id = mod.GetObjId(receiver);
            super(`p${id}`, receiver);
            PlayerReceiver._instances.set(id, this);
        }
        public static getInstance(receiver: mod.Player): PlayerReceiver {
            return PlayerReceiver._instances.get(mod.GetObjId(receiver)) ?? new PlayerReceiver(receiver);
        }
    }

    /****** Node ******/

    export abstract class Node {
        protected readonly _logging: Logging = logging;
        protected _name: string;
        protected _uiWidget: mod.UIWidget;
        protected _receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;

        public constructor(
            name: string,
            uiWidget: mod.UIWidget,
            receiver: GlobalReceiver | TeamReceiver | PlayerReceiver
        ) {
            this._name = name;
            this._uiWidget = uiWidget;
            this._receiver = receiver;
        }

        public get name(): string { return this._name; }
        public get uiWidget(): mod.UIWidget { return this._uiWidget; }
        public get receiver(): GlobalReceiver | TeamReceiver | PlayerReceiver { return this._receiver; }
    }

    /****** Root ******/

    export class Root extends Node implements Parent {
        public static readonly instance = new Root();
        private _children: Set<Element> = new Set();
        private constructor() { super('root', mod.GetUIRoot(), GlobalReceiver.instance); }
        public get children(): Element[] { return Array.from(this._children); }
        public attachChild(child: Element): void { this._children.add(child); }
        public detachChild(child: Element): void { this._children.delete(child); }
    }

    /****** Element ******/

    export abstract class Element extends Node {
        protected _parent: Parent;
        protected _visible: boolean;
        protected _x: number;
        protected _y: number;
        protected _width: number;
        protected _height: number;
        protected _bgColor: mod.Vector;
        protected _bgAlpha: number;
        protected _bgFill: mod.UIBgFill;
        protected _depth: mod.UIDepth;
        protected _anchor: mod.UIAnchor;
        protected _uiInputModeWhenVisible: boolean;
        protected _deleted: boolean = false;

        public constructor(params: FinalElementParams) {
            super(params.name, mod.FindUIWidgetWithName(params.name) as mod.UIWidget, params.receiver);
            this._parent = params.parent;
            this._visible = params.visible;
            this._x = params.x;
            this._y = params.y;
            this._width = params.width;
            this._height = params.height;
            this._bgColor = params.bgColor;
            this._bgAlpha = params.bgAlpha;
            this._bgFill = params.bgFill;
            this._depth = params.depth;
            this._anchor = params.anchor;
            this._uiInputModeWhenVisible = params.uiInputModeWhenVisible;
            this._parent.attachChild(this);
            if (this._uiInputModeWhenVisible && this._visible) {
                this._receiver.addInputModeRequester(this);
            }
        }

        protected _isDeletedCheck(): boolean {
            if (this._deleted) {
                logging.log(`Element ${this.name} already deleted.`, LogLevel.Warning);
                return true;
            }
            return false;
        }

        public get parent(): Parent { return this._parent; }

        public set parent(parent: Parent) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetParent(this._uiWidget, parent.uiWidget);
            this._parent.detachChild(this);
            this._parent = parent;
            this._parent.attachChild(this);
        }

        public get visible(): boolean { return this._visible; }

        public set visible(visible: boolean) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetVisible(this._uiWidget, (this._visible = visible));
            if (!this._uiInputModeWhenVisible) return;
            if (visible) {
                this._receiver.addInputModeRequester(this);
            } else {
                this._receiver.removeInputModeRequester(this);
            }
        }

        public setVisible(visible: boolean): this { this.visible = visible; return this; }
        public show(): this { this.visible = true; return this; }
        public hide(): this { this.visible = false; return this; }
        public toggle(): this { this.visible = !this.visible; return this; }

        public get deleted(): boolean { return this._deleted; }

        public delete(): void {
            if (this._isDeletedCheck()) return;
            this._deleted = true;
            if (this._uiInputModeWhenVisible) {
                this._receiver.removeInputModeRequester(this);
            }
            this._parent.detachChild(this);
            mod.DeleteUIWidget(this._uiWidget);
        }

        public get x(): number { return this._x; }
        public set x(x: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector((this._x = x), this._y, 0));
        }
        public setX(x: number): this { this.x = x; return this; }

        public get y(): number { return this._y; }
        public set y(y: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector(this._x, (this._y = y), 0));
        }
        public setY(y: number): this { this.y = y; return this; }

        public get position(): Position { return { x: this._x, y: this._y }; }
        public set position(params: Position) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector((this._x = params.x), (this._y = params.y), 0));
        }
        public setPosition(params: Position): this { this.position = params; return this; }

        public get width(): number { return this._width; }
        public set width(w: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector((this._width = w), this._height, 0));
        }
        public setWidth(w: number): this { this.width = w; return this; }

        public get height(): number { return this._height; }
        public set height(h: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(this._width, (this._height = h), 0));
        }
        public setHeight(h: number): this { this.height = h; return this; }

        public get size(): Size { return { width: this._width, height: this._height }; }
        public set size(params: Size) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector((this._width = params.width), (this._height = params.height), 0));
        }
        public setSize(params: Size): this { this.size = params; return this; }

        public get bgColor(): mod.Vector { return this._bgColor; }
        public set bgColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetBgColor(this._uiWidget, (this._bgColor = color));
        }
        public setBgColor(color: mod.Vector): this { this.bgColor = color; return this; }

        public get bgAlpha(): number { return this._bgAlpha; }
        public set bgAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetBgAlpha(this._uiWidget, (this._bgAlpha = alpha));
        }
        public setBgAlpha(alpha: number): this { this.bgAlpha = alpha; return this; }

        public get bgFill(): mod.UIBgFill { return this._bgFill; }
        public set bgFill(fill: mod.UIBgFill) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetBgFill(this._uiWidget, (this._bgFill = fill));
        }
        public setBgFill(fill: mod.UIBgFill): this { this.bgFill = fill; return this; }

        public get depth(): mod.UIDepth { return this._depth; }
        public set depth(depth: mod.UIDepth) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetDepth(this._uiWidget, (this._depth = depth));
        }
        public setDepth(depth: mod.UIDepth): this { this.depth = depth; return this; }

        public get anchor(): mod.UIAnchor { return this._anchor; }
        public set anchor(anchor: mod.UIAnchor) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetAnchor(this._uiWidget, (this._anchor = anchor));
        }
        public setAnchor(anchor: mod.UIAnchor): this { this.anchor = anchor; return this; }

        public get uiInputModeWhenVisible(): boolean { return this._uiInputModeWhenVisible; }
        public set uiInputModeWhenVisible(newValue: boolean) {
            if (this._isDeletedCheck()) return;
            const previousValue = this._uiInputModeWhenVisible;
            if (previousValue === newValue) return;
            this._uiInputModeWhenVisible = newValue;
            if (newValue && this.visible) {
                this._receiver.addInputModeRequester(this);
            } else {
                this._receiver.removeInputModeRequester(this);
            }
        }
    }

    /****** Constants ******/

    export const COLORS = {
        BLACK: mod.CreateVector(0, 0, 0),
        GREY_25: mod.CreateVector(0.25, 0.25, 0.25),
        GREY_50: mod.CreateVector(0.5, 0.5, 0.5),
        GREY_75: mod.CreateVector(0.75, 0.75, 0.75),
        WHITE: mod.CreateVector(1, 1, 1),
        RED: mod.CreateVector(1, 0, 0),
        GREEN: mod.CreateVector(0, 1, 0),
        BLUE: mod.CreateVector(0, 0, 1),
        YELLOW: mod.CreateVector(1, 1, 0),
        PURPLE: mod.CreateVector(1, 0, 1),
        CYAN: mod.CreateVector(0, 1, 1),
        MAGENTA: mod.CreateVector(1, 0, 1),
        BF_GREY_1: mod.CreateVector(0.8353, 0.9216, 0.9765),
        BF_GREY_2: mod.CreateVector(0.3294, 0.3686, 0.3882),
        BF_GREY_3: mod.CreateVector(0.2118, 0.2235, 0.2353),
        BF_GREY_4: mod.CreateVector(0.0314, 0.0431, 0.0431),
        BF_BLUE_BRIGHT: mod.CreateVector(0.4392, 0.9216, 1.0),
        BF_BLUE_DARK: mod.CreateVector(0.0745, 0.1843, 0.2471),
        BF_RED_BRIGHT: mod.CreateVector(1.0, 0.5137, 0.3804),
        BF_RED_DARK: mod.CreateVector(0.251, 0.0941, 0.0667),
        BF_GREEN_BRIGHT: mod.CreateVector(0.6784, 0.9922, 0.5255),
        BF_GREEN_DARK: mod.CreateVector(0.2784, 0.4471, 0.2118),
        BF_YELLOW_BRIGHT: mod.CreateVector(1.0, 0.9882, 0.6118),
        BF_YELLOW_DARK: mod.CreateVector(0.4431, 0.3765, 0.0),
    };

    export const ROOT_NODE = Root.instance;

    /****** Button Registry ******/

    const BUTTONS = new Map<string, Button>();

    // Auto-subscribe to button events via Events system
    Events.OnPlayerUIButtonEvent.subscribe(handleButtonEvent);

    function handleButtonEvent(player: mod.Player, widget: mod.UIWidget, event: mod.UIButtonEvent): void {
        // Ignore focus/hover events -- otherwise controller d-pad navigation
        // and deploy-camera focus drift fire onClick on whichever neighbour
        // the focus passes through (highlight AH64, deploy IFV bug).
        // We accept BOTH ButtonDown and ButtonUp here because Portal's
        // mouse-click path sometimes only delivers one of them, and we
        // de-dupe via the per-button debounce in handleVehicleClick.
        if (event === mod.UIButtonEvent.HoverIn ||
            event === mod.UIButtonEvent.HoverOut ||
            event === mod.UIButtonEvent.FocusIn ||
            event === mod.UIButtonEvent.FocusOut) {
            return;
        }
        const name = mod.GetUIWidgetName(widget);
        const onClick = BUTTONS.get(name)?.onClick;
        if (!onClick) return;
        CallbackHandler.invoke(onClick, [player], `click handler for widget ${name}`, logging, LogLevel.Error);
    }

    export function registerButton(name: string, button: Button): () => void {
        if (BUTTONS.has(name)) {
            logging.log(`Button ${name} already registered.`, LogLevel.Warning);
            return () => {};
        }
        BUTTONS.set(name, button);
        return () => { BUTTONS.delete(name); };
    }

    /****** Utils ******/

    let counter: number = 0;

    function isTeam(receiver?: mod.Player | mod.Team): receiver is mod.Team {
        return receiver !== undefined && mod.IsType(receiver, mod.Types.Team);
    }

    function isPlayer(receiver?: mod.Player | mod.Team): receiver is mod.Player {
        return receiver !== undefined && mod.IsType(receiver, mod.Types.Player);
    }

    export function makeName(parent: Parent, receiver: GlobalReceiver | TeamReceiver | PlayerReceiver): string {
        return `${parent.name}${parent.receiver !== receiver ? `_${receiver.id}` : ''}_${counter++}`;
    }

    export function delegateProperties<T extends object, S extends object>(
        target: T,
        source: S,
        properties: readonly string[]
    ): void {
        for (const prop of properties) {
            Object.defineProperty(target, prop, {
                get() { return (source as Record<string, unknown>)[prop]; },
                set(value: unknown) { (source as Record<string, unknown>)[prop] = value; },
                enumerable: true,
                configurable: true,
            });
            const setterMethodName = `set${prop.charAt(0).toUpperCase() + prop.slice(1)}`;
            (target as Record<string, unknown>)[setterMethodName] = function (value: unknown) {
                (source as Record<string, unknown>)[prop] = value;
                return this;
            };
        }
    }

    export function getPosition(params: ElementParams): Position {
        return { x: params.x ?? params.position?.x ?? 0, y: params.y ?? params.position?.y ?? 0 };
    }

    export function getSize(params: ElementParams): Size {
        return { width: params.width ?? params.size?.width ?? 0, height: params.height ?? params.size?.height ?? 0 };
    }

    export function getReceiver(
        parent: Parent,
        receiverParam?: mod.Player | mod.Team
    ): GlobalReceiver | TeamReceiver | PlayerReceiver {
        if (!receiverParam) return parent.receiver;
        if (isTeam(receiverParam)) return TeamReceiver.getInstance(receiverParam);
        if (isPlayer(receiverParam)) return PlayerReceiver.getInstance(receiverParam);
        return GlobalReceiver.instance;
    }

    // =========================================================================
    // COMPONENT: UIContainer (v6.0.1)
    // =========================================================================

    export class UIContainer extends Element implements Parent {
        protected _children: Set<Element> = new Set();

        public constructor(params: UIContainer.Params) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);

            const elementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: params.bgColor ?? COLORS.WHITE,
                bgAlpha: params.bgAlpha ?? 0,
                bgFill: params.bgFill ?? mod.UIBgFill.None,
                depth: params.depth ?? mod.UIDepth.AboveGameUI,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };

            const args: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                elementParams.anchor,
                parent.uiWidget,
                elementParams.visible,
                0,
                elementParams.bgColor,
                elementParams.bgAlpha,
                elementParams.bgFill,
                elementParams.depth,
            ];

            if (receiver instanceof GlobalReceiver) {
                mod.AddUIContainer(...args);
            } else {
                mod.AddUIContainer(...args, receiver.nativeReceiver);
            }

            super(elementParams);

            for (const childParams of params.childrenParams ?? []) {
                childParams.parent = this;
                new childParams.type(childParams);
            }
        }

        public get children(): Element[] { return Array.from(this._children); }

        public override delete(): void {
            for (const child of this._children) { child.delete(); }
            super.delete();
        }

        public attachChild(child: Element): void {
            if (this._deleted) return;
            this._children.add(child);
        }

        public detachChild(child: Element): void {
            this._children.delete(child);
        }
    }

    export namespace UIContainer {
        export type ChildParams<T extends ElementParams> = T & {
            type: new (params: T) => Element;
        };
        export type Params = ElementParams & {
            childrenParams?: ChildParams<any>[];
        };
    }

    // =========================================================================
    // COMPONENT: UIText (v6.0.1)
    // =========================================================================

    export class UIText extends Element {
        protected _message: mod.Message;
        protected _textSize: number;
        protected _textColor: mod.Vector;
        protected _textAlpha: number;
        protected _textAnchor: mod.UIAnchor;
        protected _padding: number;

        public constructor(params: UIText.Params) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);
            const padding = params.padding ?? 0;

            const elementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: params.bgColor ?? COLORS.WHITE,
                bgAlpha: params.bgAlpha ?? 0,
                bgFill: params.bgFill ?? mod.UIBgFill.None,
                depth: params.depth ?? mod.UIDepth.AboveGameUI,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };

            const message = params.message;
            const textSize = params.textSize ?? 36;
            const textColor = params.textColor ?? COLORS.BLACK;
            const textAlpha = params.textAlpha ?? 1;
            const textAnchor = params.textAnchor ?? mod.UIAnchor.Center;

            const args: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, mod.Message, number, mod.Vector, number, mod.UIAnchor, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                elementParams.anchor,
                parent.uiWidget,
                elementParams.visible,
                padding,
                elementParams.bgColor,
                elementParams.bgAlpha,
                elementParams.bgFill,
                message,
                textSize,
                textColor,
                textAlpha,
                textAnchor,
                elementParams.depth,
            ];

            if (receiver instanceof GlobalReceiver) {
                mod.AddUIText(...args);
            } else {
                mod.AddUIText(...args, receiver.nativeReceiver);
            }

            super(elementParams);
            this._message = message;
            this._textSize = textSize;
            this._textColor = textColor;
            this._textAlpha = textAlpha;
            this._textAnchor = textAnchor;
            this._padding = padding;
        }

        public get message(): mod.Message { return this._message; }
        public set message(message: mod.Message) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextLabel(this._uiWidget, (this._message = message));
        }
        public setMessage(message: mod.Message): this { this.message = message; return this; }

        public get textAlpha(): number { return this._textAlpha; }
        public set textAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextAlpha(this._uiWidget, (this._textAlpha = alpha));
        }
        public setTextAlpha(alpha: number): this { this.textAlpha = alpha; return this; }

        public get textAnchor(): mod.UIAnchor { return this._textAnchor; }
        public set textAnchor(anchor: mod.UIAnchor) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextAnchor(this._uiWidget, (this._textAnchor = anchor));
        }
        public setTextAnchor(anchor: mod.UIAnchor): this { this.textAnchor = anchor; return this; }

        public get textColor(): mod.Vector { return this._textColor; }
        public set textColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextColor(this._uiWidget, (this._textColor = color));
        }
        public setTextColor(color: mod.Vector): this { this.textColor = color; return this; }

        public get textSize(): number { return this._textSize; }
        public set textSize(size: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextSize(this._uiWidget, (this._textSize = size));
        }
        public setTextSize(size: number): this { this.textSize = size; return this; }

        public get padding(): number { return this._padding; }
        public set padding(padding: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPadding(this._uiWidget, (this._padding = padding));
        }
        public setPadding(padding: number): this { this.padding = padding; return this; }
    }

    export namespace UIText {
        export type Params = ElementParams & {
            message: mod.Message;
            textSize?: number;
            textColor?: mod.Vector;
            textAlpha?: number;
            textAnchor?: mod.UIAnchor;
            padding?: number;
        };
    }

    // =========================================================================
    // COMPONENT: UIButton (v6.1.1)
    // =========================================================================

    export class UIButton extends Element implements Button {
        protected _enabled: boolean;
        protected _baseColor: mod.Vector;
        protected _baseAlpha: number;
        protected _disabledColor: mod.Vector;
        protected _disabledAlpha: number;
        protected _pressedColor: mod.Vector;
        protected _pressedAlpha: number;
        protected _hoverColor: mod.Vector;
        protected _hoverAlpha: number;
        protected _focusedColor: mod.Vector;
        protected _focusedAlpha: number;
        protected _onClick: ((player: mod.Player) => Promise<void> | void) | undefined;
        protected _unregisterAsButton: () => void;

        public constructor(params: UIButton.Params) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);

            const elementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: params.bgColor ?? COLORS.WHITE,
                bgAlpha: params.bgAlpha ?? 1,
                bgFill: params.bgFill ?? mod.UIBgFill.Solid,
                depth: params.depth ?? mod.UIDepth.AboveGameUI,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };

            const args: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, boolean, mod.Vector, number, mod.Vector, number, mod.Vector, number, mod.Vector, number, mod.Vector, number, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                elementParams.anchor,
                parent.uiWidget,
                elementParams.visible,
                0,
                elementParams.bgColor,
                elementParams.bgAlpha,
                elementParams.bgFill,
                params.enabled ?? true,
                params.baseColor ?? COLORS.BF_GREY_2,
                params.baseAlpha ?? 1,
                params.disabledColor ?? COLORS.BF_GREY_3,
                params.disabledAlpha ?? 1,
                params.pressedColor ?? COLORS.BF_GREEN_BRIGHT,
                params.pressedAlpha ?? 1,
                params.hoverColor ?? COLORS.BF_GREY_1,
                params.hoverAlpha ?? 1,
                params.focusedColor ?? COLORS.BF_GREY_1,
                params.focusedAlpha ?? 1,
                elementParams.depth,
            ];

            if (receiver instanceof GlobalReceiver) {
                mod.AddUIButton(...args);
            } else {
                mod.AddUIButton(...args, receiver.nativeReceiver);
            }

            super(elementParams);
            this._enabled = params.enabled ?? true;
            this._baseColor = params.baseColor ?? COLORS.BF_GREY_2;
            this._baseAlpha = params.baseAlpha ?? 1;
            this._disabledColor = params.disabledColor ?? COLORS.BF_GREY_3;
            this._disabledAlpha = params.disabledAlpha ?? 1;
            this._pressedColor = params.pressedColor ?? COLORS.BF_GREEN_BRIGHT;
            this._pressedAlpha = params.pressedAlpha ?? 1;
            this._hoverColor = params.hoverColor ?? COLORS.BF_GREY_1;
            this._hoverAlpha = params.hoverAlpha ?? 1;
            this._focusedColor = params.focusedColor ?? COLORS.BF_GREY_1;
            this._focusedAlpha = params.focusedAlpha ?? 1;
            this._onClick = params.onClick;
            this._unregisterAsButton = registerButton(this._name, this);
        }

        public override delete(): void {
            this._unregisterAsButton();
            super.delete();
        }

        public get enabled(): boolean { return this._enabled; }
        public set enabled(enabled: boolean) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonEnabled(this._uiWidget, (this._enabled = enabled));
        }
        public setEnabled(enabled: boolean): this { this.enabled = enabled; return this; }

        public get baseColor(): mod.Vector { return this._baseColor; }
        public set baseColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorBase(this._uiWidget, (this._baseColor = color));
        }
        public setBaseColor(color: mod.Vector): this { this.baseColor = color; return this; }

        public get baseAlpha(): number { return this._baseAlpha; }
        public set baseAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonAlphaBase(this._uiWidget, (this._baseAlpha = alpha));
        }
        public setBaseAlpha(alpha: number): this { this.baseAlpha = alpha; return this; }

        public get disabledColor(): mod.Vector { return this._disabledColor; }
        public set disabledColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorDisabled(this._uiWidget, (this._disabledColor = color));
        }
        public setDisabledColor(color: mod.Vector): this { this.disabledColor = color; return this; }

        public get hoverColor(): mod.Vector { return this._hoverColor; }
        public set hoverColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorHover(this._uiWidget, (this._hoverColor = color));
        }
        public setHoverColor(color: mod.Vector): this { this.hoverColor = color; return this; }

        public get pressedColor(): mod.Vector { return this._pressedColor; }
        public set pressedColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorPressed(this._uiWidget, (this._pressedColor = color));
        }
        public setColorPressed(color: mod.Vector): this { this.pressedColor = color; return this; }

        public get focusedColor(): mod.Vector { return this._focusedColor; }
        public set focusedColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorFocused(this._uiWidget, (this._focusedColor = color));
        }
        public setFocusedColor(color: mod.Vector): this { this.focusedColor = color; return this; }

        public get onClick(): ((player: mod.Player) => Promise<void> | void) | undefined { return this._onClick; }
        public set onClick(onClick: ((player: mod.Player) => Promise<void> | void) | undefined) {
            if (this._isDeletedCheck()) return;
            this._onClick = onClick;
        }
        public setOnClick(onClick: ((player: mod.Player) => Promise<void> | void) | undefined): this { this.onClick = onClick; return this; }
    }

    export namespace UIButton {
        export type Params = ElementParams & {
            enabled?: boolean;
            baseColor?: mod.Vector;
            baseAlpha?: number;
            disabledColor?: mod.Vector;
            disabledAlpha?: number;
            pressedColor?: mod.Vector;
            pressedAlpha?: number;
            hoverColor?: mod.Vector;
            hoverAlpha?: number;
            focusedColor?: mod.Vector;
            focusedAlpha?: number;
            onClick?: (player: mod.Player) => Promise<void> | void;
        };
    }

    // =========================================================================
    // COMPONENT: UIContentButton (v6.1.1) - base for buttons with content
    // =========================================================================

    export abstract class UIContentButton<TContent extends Element, TContentProps extends readonly string[]>
        extends Element
    {
        protected _padding: number;
        protected _button: UIButton;
        protected _content: TContent;

        declare public baseColor: mod.Vector;
        declare public baseAlpha: number;
        declare public disabledColor: mod.Vector;
        declare public disabledAlpha: number;
        declare public pressedColor: mod.Vector;
        declare public pressedAlpha: number;
        declare public hoverColor: mod.Vector;
        declare public hoverAlpha: number;
        declare public focusedColor: mod.Vector;
        declare public focusedAlpha: number;
        declare public onClick: ((player: mod.Player) => Promise<void> | void) | undefined;

        declare public setBaseColor: (color: mod.Vector) => this;
        declare public setBaseAlpha: (alpha: number) => this;
        declare public setDisabledColor: (color: mod.Vector) => this;
        declare public setDisabledAlpha: (alpha: number) => this;
        declare public setPressedColor: (color: mod.Vector) => this;
        declare public setPressedAlpha: (alpha: number) => this;
        declare public setHoverColor: (color: mod.Vector) => this;
        declare public setHoverAlpha: (alpha: number) => this;
        declare public setFocusedColor: (color: mod.Vector) => this;
        declare public setFocusedAlpha: (alpha: number) => this;
        declare public setOnClick: (onClick: ((player: mod.Player) => Promise<void> | void) | undefined) => this;

        protected constructor(
            params: UIContentButton.Params,
            createContent: (parent: Parent, width: number, height: number) => TContent,
            contentProperties: TContentProps
        ) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);
            const depth = params.depth ?? mod.UIDepth.AboveGameUI;
            const padding = params.padding ?? 0;

            const containerElementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: COLORS.WHITE,
                bgAlpha: 0,
                bgFill: mod.UIBgFill.None,
                depth,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };

            const containerArgs: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                containerElementParams.anchor,
                parent.uiWidget,
                containerElementParams.visible,
                padding,
                containerElementParams.bgColor,
                containerElementParams.bgAlpha,
                containerElementParams.bgFill,
                containerElementParams.depth,
            ];

            if (receiver instanceof GlobalReceiver) {
                mod.AddUIContainer(...containerArgs);
            } else {
                mod.AddUIContainer(...containerArgs, receiver.nativeReceiver);
            }

            super(containerElementParams);
            this._padding = padding;

            const mockParent: Parent = {
                name: this._name,
                uiWidget: this._uiWidget,
                receiver: this._receiver,
                children: [],
                attachChild(_child: Element): void {},
                detachChild(_child: Element): void {},
            };

            const buttonParams: UIButton.Params = {
                parent: mockParent,
                width, height,
                bgColor: params.bgColor,
                bgAlpha: params.bgAlpha,
                bgFill: params.bgFill,
                enabled: params.enabled,
                baseColor: params.baseColor,
                baseAlpha: params.baseAlpha,
                disabledColor: params.disabledColor,
                disabledAlpha: params.disabledAlpha,
                pressedColor: params.pressedColor,
                pressedAlpha: params.pressedAlpha,
                hoverColor: params.hoverColor,
                hoverAlpha: params.hoverAlpha,
                focusedColor: params.focusedColor,
                focusedAlpha: params.focusedAlpha,
                depth,
                onClick: params.onClick,
            };

            this._button = new UIButton(buttonParams);

            const widthNetOfPadding = Math.max(0, width - padding * 2);
            const heightNetOfPadding = Math.max(0, height - padding * 2);
            this._content = createContent(mockParent, widthNetOfPadding, heightNetOfPadding);

            delegateProperties(this, this._button, [
                'bgColor', 'bgAlpha', 'bgFill',
                'baseColor', 'baseAlpha',
                'disabledColor', 'disabledAlpha',
                'pressedColor', 'pressedAlpha',
                'focusedAlpha', 'focusedColor',
                'hoverAlpha', 'hoverColor',
                'onClick',
            ]);
            delegateProperties(this, this._content, contentProperties);
        }

        public override delete(): void {
            this._button.delete();
            this._content.delete();
            super.delete();
        }

        public override get width(): number { return this._button.width; }
        public override set width(width: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(width, this.height, 0));
            this._button.setWidth(width);
            this._content.setWidth(Math.max(0, width - this._padding * 2));
        }

        public override get height(): number { return this._button.height; }
        public override set height(height: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(this.width, height, 0));
            this._button.setHeight(height);
            this._content.setHeight(Math.max(0, height - this._padding * 2));
        }

        public override get size(): Size { return { width: this._button.width, height: this._button.height }; }
        public override set size(params: Size) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(params.width, params.height, 0));
            this._button.setSize(params);
            this._content.setSize({
                width: Math.max(0, params.width - this._padding * 2),
                height: Math.max(0, params.height - this._padding * 2),
            });
        }

        public get enabled(): boolean { return this._button.enabled; }
        public set enabled(enabled: boolean) {
            if (this._isDeletedCheck()) return;
            this._button.enabled = enabled;
        }
        public setEnabled(enabled: boolean): this { this.enabled = enabled; return this; }
    }

    export namespace UIContentButton {
        export type Params = UIButton.Params & { padding?: number; };
    }

    // =========================================================================
    // COMPONENT: UITextButton (v6.0.1) - button with text label
    // =========================================================================

    const TEXT_BUTTON_CONTENT_PROPERTIES: readonly string[] = ['message', 'textSize', 'textAnchor'] as const;

    export class UITextButton extends UIContentButton<UIText, typeof TEXT_BUTTON_CONTENT_PROPERTIES> {
        declare public message: mod.Message;
        declare public textAnchor: mod.UIAnchor;
        declare public textSize: number;
        declare public setMessage: (message: mod.Message) => this;
        declare public setTextAnchor: (anchor: mod.UIAnchor) => this;
        declare public setTextSize: (size: number) => this;

        protected _textDisabledColor: mod.Vector;
        protected _textDisabledAlpha: number;

        public constructor(params: UITextButton.Params) {
            const createContent = (parent: Parent, width: number, height: number): UIText => {
                return new UIText({
                    parent, width, height,
                    message: params.message,
                    textSize: params.textSize,
                    textColor: params.textColor,
                    textAlpha: params.textAlpha,
                    textAnchor: params.textAnchor,
                    depth: params.depth,
                });
            };

            super(params, createContent, TEXT_BUTTON_CONTENT_PROPERTIES);
            this._textDisabledColor = params.textDisabledColor ?? COLORS.BF_GREY_2;
            this._textDisabledAlpha = params.textDisabledAlpha ?? 1;

            if (!this._button.enabled) {
                this._setContentEnabled(false);
            }
        }

        private _setContentEnabled(enabled: boolean): void {
            if (enabled) {
                mod.SetUITextColor(this._content.uiWidget, this._content.textColor);
                mod.SetUITextAlpha(this._content.uiWidget, this._content.textAlpha);
            } else {
                mod.SetUITextColor(this._content.uiWidget, this._textDisabledColor);
                mod.SetUITextAlpha(this._content.uiWidget, this._textDisabledAlpha);
            }
        }

        public override get enabled(): boolean { return this._button.enabled; }
        public override set enabled(enabled: boolean) {
            if (this._isDeletedCheck()) return;
            this._button.enabled = enabled;
            this._setContentEnabled(enabled);
        }

        public get textColor(): mod.Vector { return this._content.textColor; }
        public set textColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            this._content.textColor = color;
            if (this._button.enabled) mod.SetUITextColor(this._content.uiWidget, color);
        }
        public setTextColor(color: mod.Vector): this { this.textColor = color; return this; }

        public get textAlpha(): number { return this._content.textAlpha; }
        public set textAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            this._content.textAlpha = alpha;
            if (this._button.enabled) mod.SetUITextAlpha(this._content.uiWidget, alpha);
        }
        public setTextAlpha(alpha: number): this { this.textAlpha = alpha; return this; }

        public get textDisabledColor(): mod.Vector { return this._textDisabledColor; }
        public set textDisabledColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            this._textDisabledColor = color;
            if (!this._button.enabled) mod.SetUITextColor(this._content.uiWidget, color);
        }

        public get textDisabledAlpha(): number { return this._textDisabledAlpha; }
        public set textDisabledAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            this._textDisabledAlpha = alpha;
            if (!this._button.enabled) mod.SetUITextAlpha(this._content.uiWidget, alpha);
        }
    }

    export namespace UITextButton {
        export type Params = UIButton.Params & UIText.Params & {
            textDisabledColor?: mod.Vector;
            textDisabledAlpha?: number;
        };
    }
}
