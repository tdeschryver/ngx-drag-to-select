import {
  Component,
  ElementRef,
  Output,
  EventEmitter,
  Input,
  OnDestroy,
  Renderer2,
  ViewChild,
  NgZone,
  ContentChildren,
  QueryList,
  HostBinding,
  AfterViewInit,
  PLATFORM_ID,
  Inject
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';

import { Observable, Subject, combineLatest, merge, from, fromEvent, BehaviorSubject, asyncScheduler, of } from 'rxjs';

import {
  switchMap,
  takeUntil,
  map,
  tap,
  filter,
  auditTime,
  mapTo,
  share,
  withLatestFrom,
  distinctUntilChanged,
  observeOn,
  startWith,
  concatMapTo,
  first,
  mergeMap,
  last,
  endWith,
  scan,
  flatMap,
  delay,
  debounceTime,
  throttleTime
} from 'rxjs/operators';

import { SelectItemDirective } from './select-item.directive';
import { ShortcutService } from './shortcut.service';

import { createSelectBox, whenSelectBoxVisible, distinctKeyEvents, DragState } from './operators';

import {
  Action,
  SelectBox,
  MousePosition,
  SelectContainerHost,
  UpdateAction,
  UpdateActions,
  PredicateFn
} from './models';

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

interface SelectionMode {
  addToSelection: boolean;
  disableSelection: boolean;
  extendedSelectionShortcut: boolean;
  removeFromSelection: boolean;
  toggleSingleItem: boolean;
}

const createEmptySelectionMode = (): SelectionMode => ({
  addToSelection: false,
  disableSelection: false,
  extendedSelectionShortcut: false,
  removeFromSelection: false,
  toggleSingleItem: false
});

@Component({
  selector: 'dts-select-container',
  exportAs: 'dts-select-container',
  host: {
    class: 'dts-select-container'
  },
  template: `
    <ng-content></ng-content>
    <div
      class="dts-select-box"
      #selectBox
      [ngClass]="selectBoxClasses$ | async"
      [ngStyle]="selectBoxStyles$ | async"
    ></div>
  `,
  styleUrls: ['./select-container.component.scss']
})
export class SelectContainerComponent implements AfterViewInit, OnDestroy {
  host: SelectContainerHost;
  selectBoxStyles$: Observable<SelectBox<string>>;
  selectBoxClasses$: Observable<{ [key: string]: boolean }>;

  @ViewChild('selectBox')
  private $selectBox: ElementRef;

  @ContentChildren(SelectItemDirective, { descendants: true })
  private $selectableItems: QueryList<SelectItemDirective>;

  @Input()
  selectedItems: any;

  @Input()
  selectOnDrag = true;

  @Input()
  disabled = false;

  @Input()
  disableDrag = false;

  @Input()
  selectMode = false;

  @Input()
  selectWithShortcut = false;

  @Input()
  @HostBinding('class.dts-custom')
  custom = false;

  @Output()
  selectedItemsChange = new EventEmitter<any>();

  @Output()
  select = new EventEmitter<any>();

  @Output()
  itemSelected = new EventEmitter<any>();

  @Output()
  itemDeselected = new EventEmitter<any>();

  @Output()
  selectionStarted = new EventEmitter<void>();

  @Output()
  selectionEnded = new EventEmitter<Array<any>>();

  private updateItems$ = new Subject<{ items: { [key: number]: SelectItemDirective[] }; event: DragState }>();
  private destroy$ = new Subject<void>();

  constructor(
    @Inject(PLATFORM_ID) private platformId,
    private shortcuts: ShortcutService,
    private hostElementRef: ElementRef,
    private renderer: Renderer2,
    private ngZone: NgZone
  ) {}

  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.host = this.hostElementRef.nativeElement;

      this._calculateBoundingClientRect();
      this._observeBoundingRectChanges();

      const move$ = fromEvent<MouseEvent>(document, 'mousemove').pipe(share());
      const down$ = fromEvent<MouseEvent>(this.host, 'mousedown').pipe(
        filter(event => event.button === 0),
        tap(() => this.renderer.addClass(document.body, NO_SELECT_CLASS)),
        share()
      );

      const up$ = fromEvent<MouseEvent>(document, 'mouseup').pipe(
        tap(() => this.renderer.removeClass(document.body, NO_SELECT_CLASS)),
        share()
      );
      const keydown$ = fromEvent<KeyboardEvent>(document, 'keydown').pipe(share());
      const keyup$ = fromEvent<KeyboardEvent>(document, 'keyup').pipe(share());

      const keys$ = merge(keydown$, keyup$).pipe(
        distinctKeyEvents(),
        map(
          event =>
            event.type === 'keyup'
              ? createEmptySelectionMode()
              : <SelectionMode>{
                  addToSelection: this.shortcuts.addToSelection(event),
                  disableSelection: this.shortcuts.disableSelection(event),
                  extendedSelectionShortcut: this.shortcuts.extendedSelectionShortcut(event),
                  removeFromSelection: this.shortcuts.removeFromSelection(event),
                  toggleSingleItem: this.shortcuts.toggleSingleItem(event)
                }
        ),
        startWith(createEmptySelectionMode()),
        takeUntil(this.destroy$),
        share()
      );

      const drag: Observable<DragState> = down$.pipe(
        filter(() => !this.disabled),
        auditTime(AUDIT_TIME),
        map(event => getRelativeMousePosition(event, this.host)),
        flatMap(down =>
          move$.pipe(
            map(event => getRelativeMousePosition(event, this.host)),
            map(move => ({ state: 'DRAGGING', down, move })),
            takeUntil(up$),
            startWith({ state: 'DRAGGING_START', down }),
            endWith({ state: 'DRAGGING_END' })
          )
        ),
        takeUntil(this.destroy$),
        share()
      );

      this.updateItems$
        .pipe(
          withLatestFrom(keys$),
          scan<
            [{ items: { [key: number]: SelectItemDirective[] }; event: DragState }, SelectionMode],
            { selectedItems: SelectItemDirective[] }
          >(
            (state, [{ event, items: newItems }, keys]) => {
              // if we emit an action, ignore the options
              if (event.state !== 'FORCED') {
                if (
                  this.selectWithShortcut &&
                  !keys.extendedSelectionShortcut &&
                  !keys.toggleSingleItem &&
                  !keys.addToSelection
                ) {
                  return state;
                }

                if (this.disabled) {
                  return state;
                }

                // take options into account
                if (!this.selectOnDrag && event.state === 'DRAGGING') {
                  return state;
                }

                if (this.selectMode && event.state !== 'DRAGGING_END') {
                  return state;
                } else if (this.selectMode && event.state === 'DRAGGING_END' && newItems[1].length > 1) {
                  // THIS IS A BREAKING CHANGE
                  // Problem is that at this point it has more than 1 selected item - and we don't know the first item selected
                  // In the DRAGGING_START event, the selected items aren't available because the dragbox isn't created
                  // Should we create a second dragbox, only for use in the calucations
                  // And the current dragbox only for UI purposes?
                  return state;
                }
              }

              const newState = { selectedItems: [...state.selectedItems] };

              // calucate selected items
              if (keys.toggleSingleItem || this.selectMode) {
                newItems[1].forEach(item => {
                  if (state.selectedItems.includes(item)) {
                    newState.selectedItems = newState.selectedItems.filter(remove => item !== remove);
                  } else {
                    newState.selectedItems.push(item);
                  }
                });
              } else if (keys.addToSelection) {
                newState.selectedItems.push(...newItems[1].filter(item => !state.selectedItems.includes(item)));
              } else {
                newState.selectedItems = newItems[1];
              }

              // actually select and deselect items
              state.selectedItems.filter(item => !newState.selectedItems.includes(item)).forEach(item => {
                item._deselect();
              });

              newState.selectedItems.filter(item => !state.selectedItems.includes(item)).forEach(item => {
                item._select();
              });

              return newState;
            },
            {
              selectedItems: []
            }
          ),
          takeUntil(this.destroy$)
        )
        .subscribe(items => {
          const values = items.selectedItems.map(x => x.value);

          this.selectedItems.filter(item => !values.includes(item)).forEach(item => {
            const index = this.selectedItems.indexOf(item);
            this.selectedItems.splice(index, 1);
          });

          values.filter(item => !this.selectedItems.includes(item)).forEach(item => {
            this.selectedItems.push(item);
          });
        });

      this.createDragBox(drag);
      this.itemSelectionHandler(drag);
    }
  }

  private createDragBox(drag: Observable<DragState>) {
    this.selectBoxStyles$ = drag.pipe(
      createSelectBox(),
      map(selectBox => ({
        top: `${selectBox.top}px`,
        left: `${selectBox.left}px`,
        width: `${selectBox.width}px`,
        height: `${selectBox.height}px`,
        opacity: this.selectMode ? 0 : selectBox.opacity // still create the box because it's needed in itemSelectionHandler
      }))
    );
  }

  private itemSelectionHandler(drag: Observable<DragState>) {
    drag
      .pipe(
        map(event => {
          const selectionBox = calculateBoundingClientRect(this.$selectBox.nativeElement);
          const items = this.$selectableItems.reduce<{
            [key: number]: SelectItemDirective[];
          }>(
            (dict, item) => {
              const inSelection = boxIntersects(selectionBox, item.getBoundingClientRect());
              dict[inSelection ? 1 : 0] = dict[inSelection ? 1 : 0].concat(item);
              return dict;
            },
            {
              0: [],
              1: []
            }
          );
          return { items, event };
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(items => {
        this.updateItems$.next(items);
      });
  }

  private _calculateBoundingClientRect() {
    this.host.boundingClientRect = calculateBoundingClientRect(this.host);
  }

  private _observeBoundingRectChanges() {
    this.ngZone.runOutsideAngular(() => {
      const resize$ = fromEvent(window, 'resize');
      const windowScroll$ = fromEvent(window, 'scroll');
      const containerScroll$ = fromEvent(this.host, 'scroll');

      merge(resize$, windowScroll$, containerScroll$)
        .pipe(
          startWith('INITIAL_UPDATE'),
          auditTime(AUDIT_TIME),
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          this.update();
        });
    });
  }

  update() {
    this._calculateBoundingClientRect();
    this.$selectableItems.forEach(item => item.calculateBoundingClientRect());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectAll() {
    this.updateItems$.next({
      items: { [1]: this.$selectableItems.toArray(), 0: [] },
      event: { state: 'FORCED' }
    });
  }

  clearSelection() {
    this.updateItems$.next({
      items: { [0]: this.$selectableItems.toArray(), 1: [] },
      event: { state: 'FORCED' }
    });
  }

  toggleItems<T>(predicate: PredicateFn<T>) {
    const items = this.$selectableItems.reduce<{
      [key: number]: SelectItemDirective[];
    }>(
      (dict, item) => {
        const isSelected = item.selected;
        dict[isSelected ? 1 : 0] = dict[isSelected ? 1 : 0].concat(item);
        return dict;
      },
      {
        0: [],
        1: []
      }
    );

    this.updateItems$.next({
      items,
      event: { state: 'FORCED' }
    });
  }

  selectItems<T>(predicate: PredicateFn<T>) {
    this.updateItems$.next({
      items: { 1: this.$selectableItems.filter(item => predicate(item.value)), 0: [] },
      event: { state: 'FORCED' }
    });
  }

  deselectItems<T>(predicate: PredicateFn<T>) {
    this.updateItems$.next({
      items: { 0: this.$selectableItems.filter(item => predicate(item.value)), 1: [] },
      event: { state: 'FORCED' }
    });
  }
}
