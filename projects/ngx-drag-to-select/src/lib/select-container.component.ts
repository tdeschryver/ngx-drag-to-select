import {
  Component,
  ElementRef,
  Output,
  EventEmitter,
  Input,
  OnDestroy,
  Renderer2,
  NgZone,
  ContentChildren,
  QueryList,
  HostBinding,
  AfterViewInit,
  PLATFORM_ID,
  Inject,
  AfterContentInit
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';

import { Observable, Subject, merge, fromEvent, fromEventPattern } from 'rxjs';

import { takeUntil, map, tap, filter } from 'rxjs/operators';

import { SelectItemDirective } from './select-item.directive';
import { ShortcutService } from './shortcut.service';

import { SelectContainerHost } from './models';

import { AUDIT_TIME, NO_SELECT_CLASS } from './constants';

import {
  inBoundingBox,
  cursorWithinElement,
  clearSelection,
  boxIntersects,
  calculateBoundingClientRect,
  getRelativeMousePosition,
  getMousePosition,
  hasMinimumSize
} from './utils';
import { StateMachine, StateSchema, interpret, Interpreter, actions } from 'xstate';
import { StateContext, dragMachine, StateEvent } from './machine';

const { assign } = actions;
@Component({
  selector: 'dts-select-container',
  exportAs: 'dts-select-container',
  host: {
    class: 'dts-select-container'
  },
  template: `
    <div [attr.data-state]="(state$ | async)?.toStrings()">
      <ng-content></ng-content>
      <div class="select-box"></div>
    </div>
  `,
  styleUrls: ['./select-container.component.scss']
})
export class SelectContainerComponent implements AfterViewInit, OnDestroy, AfterContentInit {
  host: SelectContainerHost;

  @ContentChildren(SelectItemDirective, { descendants: true })
  private $selectableItems: QueryList<SelectItemDirective>;

  @Input() selectedItems: any;
  // is it good to have multiple "active" states?
  // @Input() selectOnDrag = true;
  // @Input() disabled = false;
  // @Input() disableDrag = false;
  // @Input() selectMode = false;
  // @Input() selectWithShortcut = false;
  @Input() set mode(value: string) {
    switch (value) {
      case 'click':
        this.dragService.send({ type: 'toggleClickMode' });
        break;
      case 'drag':
        this.dragService.send({ type: 'toggleDragMode' });
        break;
      case 'select':
        this.dragService.send({ type: 'toggleSelectMode' });
        break;
      case 'shortcut':
        this.dragService.send({ type: 'toggleSelectWithShortcut' });
        break;
      case 'disable':
        this.dragService.send({ type: 'toggleDisabledMode' });
        break;
    }
  }
  @Input()
  @HostBinding('class.dts-custom')
  custom = false;

  @Output() selectedItemsChange = new EventEmitter<any>();
  // @Output() select = new EventEmitter<any>();
  // @Output() itemSelected = new EventEmitter<any>();
  // @Output() itemDeselected = new EventEmitter<any>();
  // @Output() selectionStarted = new EventEmitter<void>();
  // @Output() selectionEnded = new EventEmitter<Array<any>>();

  private destroy$ = new Subject<void>();

  private dragService: Interpreter<StateContext, StateSchema, StateEvent>;
  private state$: Observable<any>;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private shortcuts: ShortcutService,
    private hostElementRef: ElementRef,
    private renderer: Renderer2,
    private ngZone: NgZone
  ) {
    this.dragService = interpret(
      dragMachine.withConfig(
        {
          actions: {
            clearSelection: () => clearSelection(window),
            drawSelectbox: ctx => {
              const selectArea = {
                x1: Math.min(ctx.x1, ctx.x2),
                y1: Math.min(ctx.y1, ctx.y2),
                x2: Math.max(ctx.x1, ctx.x2),
                y2: Math.max(ctx.y1, ctx.y2)
              };

              Object.entries(selectArea).forEach(([key, value]) => {
                this.hostElementRef.nativeElement.style.setProperty(`--mouse-${key}`, value);
              });
            },
            updateSelectedItems: assign(ctx => {
              const selectArea = {
                x1: Math.min(ctx.x1, ctx.x2),
                y1: Math.min(ctx.y1, ctx.y2),
                x2: Math.max(ctx.x1, ctx.x2),
                y2: Math.max(ctx.y1, ctx.y2)
              };

              const selectedDirectiveIds = this.$selectableItems
                .filter(item => {
                  const { left, right, top, bottom } = item.nativeElememnt.getBoundingClientRect();

                  const isInSelectArea =
                    selectArea.x1 <= right && selectArea.x2 >= left && selectArea.y1 <= bottom && selectArea.y2 >= top;

                  return isInSelectArea;
                })
                .map(item => item.id);

              return {
                selectedDirectiveIds
              };
            })
          }
        },
        {
          shortcuts: shortcuts,
          selectWithShortcut: false,
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0,
          selectedDirectiveIds: []
        }
      )
    );
    this.state$ = fromEventPattern(
      handler => {
        this.dragService
          // Listen for state transitions
          .onTransition(handler)
          // Start the service
          .start();

        return this.dragService;
      },
      (handler, service) => service.stop()
    ).pipe(
      map(([state]) => state),
      filter((state, index) => state.changed || index === 0),
      tap(state => {
        this.$selectableItems.forEach(item => {
          if (state.context.selectedDirectiveIds.includes(item.id)) {
            item._select();
          } else {
            item._deselect();
          }
        });
      }),
      tap(state => {
        const selected = this.$selectableItems.filter(item => state.context.selectedDirectiveIds.includes(item.id));
        this.selectedItemsChange.emit(selected.map(item => item.value));
      })
    );
  }

  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.host = this.hostElementRef.nativeElement;

      const mouseup$ = fromEvent<MouseEvent>(window, 'mouseup');
      const mousemove$ = fromEvent<MouseEvent>(window, 'mousemove');
      const mousedown$ = fromEvent<MouseEvent>(this.host, 'mousedown');

      merge(mouseup$, mousemove$, mousedown$)
        .pipe(takeUntil(this.destroy$))
        .subscribe(evt => this.dragService.send(evt as any));
    }
  }

  ngAfterContentInit() {
    this.$selectableItems.forEach(item => {
      item.clicked.pipe(takeUntil(this.destroy$)).subscribe(evt => {
        this.dragService.send({ type: 'click', ctrlKey: evt.ctrlKey, directiveId: item.id });
      });
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectAll() {
    this.dragService.send({ type: 'selectItems', directiveIds: this.$selectableItems.map(c => c.id) });
  }

  clearSelection() {
    this.dragService.send({ type: 'clearAll' });
  }
}
