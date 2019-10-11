import { Machine, actions } from 'xstate';
import { ShortcutService } from './shortcut.service';
import { SelectItemDirective } from './select-item.directive';

const { assign } = actions;

export interface StateSchema {
  states: {
    clickMode: {};
    dragMode: {
      states: {
        idle: {};
        dragging: {};
      };
    };
    selectMode: {};
    shortcutMode: {};
    disabled: {};
  };
}

type clickItem = { type: 'click'; directiveId: number; ctrlKey: boolean };
type selectItems = { type: 'selectItems'; directiveIds: number[] };

export type StateEvent =
  | { type: 'toggleDragMode' }
  | { type: 'toggleSelectMode' }
  | { type: 'toggleClickMode' }
  | { type: 'toggleDisabledMode' }
  | { type: 'toggleSelectWithShortcut' }
  | { type: 'clearAll' }
  | { type: 'selectItems'; directiveIds: number[] }
  | selectItems
  | clickItem
  | ({ type: 'mousedown' } & MouseEvent)
  | ({ type: 'mousemove' } & MouseEvent)
  | ({ type: 'mouseup' } & MouseEvent);

export interface StateContext {
  shortcuts: ShortcutService;
  selectWithShortcut: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selectedDirectiveIds: number[];
}

export const dragMachine = Machine<StateContext, StateSchema, StateEvent>(
  {
    key: 'ngx-drag-to-select',
    initial: 'clickMode',
    context: {
      shortcuts: {} as ShortcutService,
      selectWithShortcut: false,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      selectedDirectiveIds: []
    },
    states: {
      clickMode: {
        on: {
          click: [
            {
              actions: ['clickItemAppend'],
              cond: 'appendItem'
            },
            {
              actions: ['clickItem']
            }
          ]
        }
      },
      dragMode: {
        initial: 'idle',
        states: {
          idle: {
            on: {
              mousedown: {
                target: 'dragging',
                actions: ['clearSelection', 'startDrag']
              }
            }
          },
          dragging: {
            on: {
              mousemove: {
                actions: ['drag', 'drawSelectbox', 'updateSelectedItems']
              },
              mouseup: { target: 'idle', actions: ['resetDrag', 'drawSelectbox'] }
            }
          }
        }
      },
      selectMode: {
        on: {
          click: {
            actions: ['clickItemAppend']
          }
        }
      },
      shortcutMode: {
        on: {
          click: {
            actions: ['clickItemAppend'],
            cond: 'isShortcutPressed'
          }
        }
      },
      disabled: {}
    },
    on: {
      toggleDragMode: 'dragMode',
      toggleSelectMode: 'selectMode',
      toggleClickMode: 'clickMode',
      toggleSelectWithShortcut: 'shortcutMode',
      toggleDisabledMode: 'disabled',
      selectItems: {
        actions: 'selectItems'
      },
      clearAll: {
        actions: 'clearAll'
      }
    }
  },
  {
    actions: {
      clickItem: assign((_, evt: clickItem) => {
        return {
          selectedDirectiveIds: [evt.directiveId]
        };
      }),
      clickItemAppend: assign((ctx, evt: clickItem) => {
        return {
          selectedDirectiveIds: ctx.selectedDirectiveIds.includes(evt.directiveId)
            ? ctx.selectedDirectiveIds.filter(id => id !== evt.directiveId)
            : [...ctx.selectedDirectiveIds, evt.directiveId]
        };
      }),
      resetDrag: assign(() => {
        return {
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0
        };
      }),
      startDrag: assign((_, evt) => {
        const mouseEvt = evt as MouseEvent;
        return {
          x1: mouseEvt.clientX,
          y1: mouseEvt.clientY
        };
      }),
      drag: assign((_, evt) => {
        const mouseEvt = evt as MouseEvent;
        return {
          x2: mouseEvt.clientX,
          y2: mouseEvt.clientY
        };
      }),
      selectItems: assign((_, evt: selectItems) => ({ selectedDirectiveIds: evt.directiveIds })),
      clearAll: assign(() => ({ selectedDirectiveIds: [] }))
    },
    guards: {
      appendItem: (_, evt: clickItem) => evt.ctrlKey,
      isShortcutPressed: (ctx, evt) => ctx.shortcuts.toggleSingleItem(evt as any)
    }
  }
);
